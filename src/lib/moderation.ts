// Módulo anti-fraude: detección de abusos, violaciones y sanciones escalonadas.
// Las tiendas tienen un estado visible al admin:
//   ACTIVE    – operativa en el centro comercial
//   SUSPENDED – castigada temporalmente (ver suspensionEndsAt). Se oculta del
//               catálogo y se bloquea chat/ventas/publicaciones hasta el final.
//   BANNED    – expulsada (solo la revierte el super admin)
// Cada falta registra una fila en "violations" para que el panel de admin las
// revise y resuelva.

import { and, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { stores, violations, sales } from "../db/schema";

// ── Umbrales / constantes de la política anti-fraude ─────────────────────────
export const VERIFIED_MIN_AGE_DAYS = 7; // la tienda debe tener +1 semana de vida
export const VERIFIED_MIN_SALES = 1; // al menos una venta real pagada
export const TRACKED_PAYMENT_METHODS = ["MP", "WOMPI", "CARD"]; // métodos rastreables
export const REFERRAL_BURST_LIMIT = 3; // máx. referidos desde una misma IP en 24h
export const OFF_PLATFORM_BURST_LIMIT = 3; // flags de "pago por fuera" en 7 días
export const OFF_PLATFORM_SUSPENSION_HOURS = 24;
export const SUSPENSION_REPORTS_DAYS = 14; // auto-suspensión tras N reportes
export const SUSPENSION_REPORT_FLAGS = 3;
export const BAN_REPORT_FLAGS = 5;
export const INFLATED_SALE_DAY_BURST = 5; // ventas autoregistradas sin método rastreable

// ── Verificado "duro" ────────────────────────────────────────────────────────
// Ya no basta con tener 100 de prestigio: la tienda debe tener antigüedad y al
// menos UNA venta pagada por un medio rastreable. Esto hace inútil farmear
// referidos para obtener el check: el prestigio solo es condición necesaria.
export interface VerifiedInput {
  prestigeActive: boolean;
  prestigePoints: number | string | null;
  createdAt: Date | string | null;
  trackedSales: number;
  now?: number;
}

export function isStoreVerified(i: VerifiedInput): boolean {
  if (!i.prestigeActive) return false;
  if ((Number(i.prestigePoints) || 0) < 100) return false;
  if (!i.createdAt) return false;
  const now = i.now ?? Date.now();
  const ageMs = now - new Date(i.createdAt).getTime();
  if (ageMs < VERIFIED_MIN_AGE_DAYS * 24 * 60 * 60 * 1000) return false;
  if ((i.trackedSales ?? 0) < VERIFIED_MIN_SALES) return false;
  return true;
}

/** Ventas "reales" por tienda: contadas solo si se pagaron por un medio rastreable. */
export async function getTrackedSalesCounts(storeIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!storeIds.length) return map;
  const rows = await db
    .select({ storeId: sales.storeId, n: sql<number>`count(*)::int` })
    .from(sales)
    .where(
      and(
        inArray(sales.storeId, storeIds),
        inArray(sales.paymentMethod, TRACKED_PAYMENT_METHODS),
      ),
    )
    .groupBy(sales.storeId);
  for (const r of rows) map.set(r.storeId, Number(r.n) || 0);
  return map;
}

// ── Estado de la tienda (sanciones) ──────────────────────────────────────────
export interface StoreStatusRow {
  id: string;
  status: string | null;
  suspensionEndsAt: Date | string | null;
}

/** true si la tienda está SUSPENDIDA y la sanción sigue vigente. */
export function suspensionActive(store: Pick<StoreStatusRow, "status" | "suspensionEndsAt">): boolean {
  if (store.status !== "SUSPENDED") return false;
  if (!store.suspensionEndsAt) return true;
  return new Date(store.suspensionEndsAt).getTime() > Date.now();
}

/** true si la tienda puede operar (ni baneada ni suspendida activamente). */
export function storeOperational(store: Pick<StoreStatusRow, "status" | "suspensionEndsAt">): boolean {
  if (store.status === "BANNED") return false;
  if (suspensionActive(store)) return false;
  return true;
}

/** Reactiva (lazy) tiendas suspendidas cuya sanción ya expiró. */
export async function refreshStoreStatus(store: Pick<StoreStatusRow, "id" | "status" | "suspensionEndsAt">): Promise<void> {
  if (store.status !== "SUSPENDED") return;
  if (store.suspensionEndsAt && new Date(store.suspensionEndsAt).getTime() <= Date.now()) {
    await db
      .update(stores)
      .set({ status: "ACTIVE", suspensionEndsAt: null })
      .where(eq(stores.id, store.id));
  }
}

/** Reautoriza en lote las suspensiones vencidas (se invoca en el feed/admin). */
export async function reauthorizeExpiredSuspensions(): Promise<number> {
  const result = await db
    .update(stores)
    .set({ status: "ACTIVE", suspensionEndsAt: null })
    .where(and(eq(stores.status, "SUSPENDED"), lt(stores.suspensionEndsAt, new Date())))
    .returning({ id: stores.id });
  return result.length;
}

export type ViolationInput = {
  type: string;
  severity?: string;
  storeId?: string | null;
  userId?: string | null;
  reporterId?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
  actionTaken?: string | null;
};

export async function insertViolation(v: ViolationInput): Promise<void> {
  await db.insert(violations).values({
    type: v.type,
    severity: v.severity ?? "info",
    storeId: v.storeId ?? null,
    userId: v.userId ?? null,
    reporterId: v.reporterId ?? null,
    reason: v.reason,
    metadata: v.metadata ?? {},
    actionTaken: v.actionTaken ?? null,
  });
}

export async function applySuspension(
  storeId: string,
  opts: { hours?: number; days?: number; reason: string; actionTaken: string },
): Promise<{ until: Date; sanctionsCount: number }> {
  const hours = opts.hours ?? 0;
  const days = opts.days ?? 0;
  const until = new Date(Date.now() + hours * 3_600_000 + days * 86_400_000);
  await db
    .update(stores)
    .set({
      status: "SUSPENDED",
      suspensionEndsAt: until,
      sanctionsCount: sql`${stores.sanctionsCount} + 1`,
      banReason: null,
    })
    .where(eq(stores.id, storeId));
  await insertViolation({
    type: "admin_action",
    severity: "suspension",
    storeId,
    reason: opts.reason,
    actionTaken: opts.actionTaken,
    metadata: { until },
  });
  return { until, sanctionsCount: 0 };
}

export async function banStore(storeId: string, reason: string): Promise<void> {
  await db
    .update(stores)
    .set({
      status: "BANNED",
      suspensionEndsAt: null,
      sanctionsCount: sql`${stores.sanctionsCount} + 1`,
      banReason: reason,
    })
    .where(eq(stores.id, storeId));
  await insertViolation({
    type: "admin_action",
    severity: "ban",
    storeId,
    reason,
    actionTaken: "ban",
  });
}

// ── Detección de "pago/comunicación por fuera de la plataforma" ──────────────
const OFF_PLATFORM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(whatsapp|wsp|watsap|waapp?)\b/i, label: "se menciona WhatsApp" },
  {
    re: /\b(telefono|celular|cel|tel\.|telegram|instagram|insta|facebook|fb|tik\s?tok|tiktok|youtube|correo|email|e-?mail)\b/i,
    label: "se comparte un contacto/canal externo",
  },
  {
    re: /\b(pagar\s?por\s?fuera|hablemos\s?por|hablame\s?por|escribeme\s?por|escribe\s?me\s?por|contactame\s?por|fuera\s?de\s?la\s?plataforma|por\s?fuera\s?de\s?aqui)\b/i,
    label: "se intenta derivar la venta fuera de la plataforma",
  },
  {
    re: /(\+?[0-9]{2}[\s.-]?)?[3-9][0-9]{2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}/,
    label: "se compartió un número de teléfono",
  },
];

export function detectOffPlatform(text: string): string | null {
  for (const p of OFF_PLATFORM_PATTERNS) {
    if (p.re.test(text)) return p.label;
  }
  return null;
}

/** Registra un flag de pago/contacto por fuera. Al acumularse dispara auto-suspensión. */
export async function recordOffPlatformFlag(opts: {
  storeId: string;
  senderId: string;
  content: string;
  reason: string;
  conversationId?: string;
}): Promise<{ flags: number; suspended: boolean; until: Date | null }> {
  await insertViolation({
    type: "off_platform_chat",
    severity: "warning",
    storeId: opts.storeId,
    userId: opts.senderId,
    reason: opts.reason,
    metadata: { content: opts.content.slice(0, 300), conversationId: opts.conversationId ?? null },
  });

  const since = new Date(Date.now() - 7 * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.storeId, opts.storeId),
        eq(violations.type, "off_platform_chat"),
        gte(violations.createdAt, since),
      ),
    );
  const flags = Number(row?.n ?? 0);

  if (flags >= OFF_PLATFORM_BURST_LIMIT) {
    const until = new Date(Date.now() + OFF_PLATFORM_SUSPENSION_HOURS * 3_600_000);
    await db
      .update(stores)
      .set({
        status: "SUSPENDED",
        suspensionEndsAt: until,
        sanctionsCount: sql`${stores.sanctionsCount} + 1`,
      })
      .where(eq(stores.id, opts.storeId));
    await db
      .update(violations)
      .set({
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedNote: `Auto-suspensión de ${OFF_PLATFORM_SUSPENSION_HOURS}h por repetir intentos de pago/contacto fuera de la plataforma`,
      })
      .where(
        and(
          eq(violations.storeId, opts.storeId),
          eq(violations.type, "off_platform_chat"),
          eq(violations.status, "OPEN"),
        ),
      );
    return { flags, suspended: true, until };
  }

  return { flags, suspended: false, until: null };
}

// ── IP del cliente (se usa el mismo trust proxy que Express) ────────────────
export function clientIp(req: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.socket?.remoteAddress ?? null;
}