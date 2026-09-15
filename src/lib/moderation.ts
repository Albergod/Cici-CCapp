// Módulo anti-fraude: detección de abusos, violaciones y sanciones escalonadas.
// Las tiendas tienen un estado visible al admin:
//   ACTIVE    – operativa en el centro comercial
//   SUSPENDED – castigada temporalmente (ver suspensionEndsAt). Se oculta del
//               catálogo y se bloquea chat/ventas/publicaciones hasta el final.
//   BANNED    – expulsada (solo la revierte el super admin)
// Cada falta registra una fila en "violations" para que el panel de admin las
// revise y resuelva.

import { and, eq, lt, inArray, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { stores, violations, sales, users, messages } from "../db/schema";
import { openai, AI_MODEL } from "./ai";

// ── Umbrales / constantes de la política anti-fraude ─────────────────────────
export const VERIFIED_MIN_AGE_DAYS = 7; // la tienda debe tener +1 semana de vida
export const VERIFIED_MIN_SALES = 1; // al menos una venta real pagada
export const TRACKED_PAYMENT_METHODS = ["MP", "WOMPI", "CARD"]; // métodos rastreables
export const REFERRAL_BURST_LIMIT = 3; // máx. referidos desde una misma IP en 24h
// Modelo de ventas A (contacto): la venta se cierra por el canal propio del
// comerciante (su WhatsApp), que es el flujo normal y esperado. Por eso NO se
// sanciona mencionar WhatsApp/teléfono en el chat. El control de fraude se
// apoya en: verificación con venta real rastreable, reportes de compradores,
// detección de ventas infladas y revisión manual del admin.
export const SUSPENSION_REPORTS_DAYS = 14; // auto-suspensión tras N reportes
export const SUSPENSION_REPORT_FLAGS = 3;
export const BAN_REPORT_FLAGS = 5;
export const INFLATED_SALE_DAY_BURST = 5; // ventas autoregistradas sin método rastreable

// ── Verificado "duro" ────────────────────────────────────────────────────────
// El check se CONCEDE una vez cumplidos los requisitos (plan activo, puntos >=
// meta, antigüedad y al menos UNA venta rastreable) y luego es "sticky": nunca
// se revoca (ver verified_at en stores). La meta (prestigeGoal) crece +100 por
// cada activación/renovación del plan propio, hasta 1000: los puntos ganados
// por referidos deben alcanzar la meta vigente para obtener el check.
export interface VerifiedInput {
  prestigeActive: boolean;
  prestigePoints: number | string | null;
  prestigeGoal: number | string | null;
  createdAt: Date | string | null;
  trackedSales: number;
  now?: number;
}

export function isStoreVerified(i: VerifiedInput): boolean {
  if (!i.prestigeActive) return false;
  const goal = Number(i.prestigeGoal) || 100;
  if ((Number(i.prestigePoints) || 0) < goal) return false;
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

// ═══════════════════════════════════════════════════════════════════════════
// Moderación de CONDUCTA EN EL CHAT (usuarios) — distinta del anti-fraude de
// tiendas. Objetivo: comunicación respetuosa. Escalera acordada:
//   1ª falta → aviso (sin restricción)
//   2ª falta → chat silenciado (mute) 48 h
//   3ª falta → suspensión 7 días (cuenta + tiendas)
//   4ª falta+ → expulsión (ban) permanente
// Grave (amenaza, odio, extorsión, doxxing) → ban inmediato.
// Reglas:
//   - El mensaje con grosería NO se publica (bloqueo instantáneo por lista).
//   - La IA revisa en segundo plano y retira el mensaje si lo considera abuso
//     (harassment, sarcasmo ofensivo, presión). Deja rastro en "violations".
//   - Contamos las faltas del usuario en los últimos 30 días (type chat_abuse).
// ═══════════════════════════════════════════════════════════════════════════

export const CHAT_ABUSE_TYPE = "chat_abuse";
export const CHAT_ABUSE_WINDOW_DAYS = 30;
export const MUTE_HOURS = 48;
export const SUSPENSION_DAYS = 7;

// Palabras "duras": prohibitivas (ban inmediato). Incluye insultos discriminatorios,
// amenazas explícitas y extorsión/doxxing. Sin variable suelta: solo términos reales.
const HARD_FLAGGED = [
  "maricon", "maricón", "marimacho", "negrato", "putero", "violen",
  "te voy a matar", "te voy a violar", "te violare", "te voy a robar",
  "te quemo", "te disparo",
];

// Palabras "blandas": groserías/slang que se castigan con la escalera.
const SOFT_FLAGGED = [
  "hijueputa", "hijueputas", "hjpta", "hpta", "hijoputa", "hijosdputa", "hijuepuchica",
  "malparido", "malparida", "malparidos", "gonorrea", "gonorreo", "gonorreas",
  "carechimba", "careverga", "carepene", "caremongo",
  "verga", "vergas", "pinga", "carajo", "coño", "mierda", "culo", "puta", "puto",
  "pendejo", "pendeja", "estupido", "estupida", "imbecil", "idiota",
];

/** Normaliza el texto para evadir la lista: minúsculas + leetspeak básico + sin puntuación. */
function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/[0]/g, "o")
    .replace(/[1]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[@]/g, "a")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export type ListCheckResult = {
  flagged: boolean;
  hard: boolean;
  hechos?: string[];
};

/** Revisión instantánea por lista de groserías y patrones. Sin IA, sin costo. */
export function checkProfanityList(text: string): ListCheckResult {
  const tokens = normalizeTokens(text);
  const normMsg = tokens.join(" ");
  if (!normMsg) return { flagged: false, hard: false };

  const matchesPattern = (pattern: string): boolean => {
    const words = normalizeTokens(pattern);
    if (!words.length) return false;
    // Frase: se busca la secuencia completa dentro del mensaje normalizado.
    if (words.length > 1) return normMsg.includes(words.join(" "));
    // Palabra suelta: debe aparecer como palabra completa (evita "musculo"→"culo").
    return tokens.includes(words[0]);
  };

  const hard = HARD_FLAGGED.find(matchesPattern);
  if (hard) return { flagged: true, hard: true, hechos: [hard] };

  const found = SOFT_FLAGGED.filter(matchesPattern);
  if (found.length) return { flagged: true, hard: false, hechos: found };

  return { flagged: false, hard: false };
}

export type AIClassification = {
  offensive: boolean;
  severity: "low" | "medium" | "high";
  reason?: string;
};

/**
 * Clasificación por IA (Groq). Decide si el mensaje es ofensivo en contexto
 * (acoso, sarcasmo con insulto, presión) y su severidad. Nunca lanza.
 */
export async function classifyTextWithAI(input: {
  content: string;
  senderName?: string;
  senderIsMerchant?: boolean;
}): Promise<AIClassification> {
  const result: AIClassification = { offensive: false, severity: "low" };
  if (!openai) return result;
  const role = input.senderIsMerchant ? "un comerciante" : "un cliente";
  const prompt = `Eres el moderador de un centro comercial digital. Un mensaje de ${role} (${
    input.senderName ?? "anónimo"
  }) en el chat de ventas dice: "${input.content}"

Clasifica SI la conducta es irrespetuosa o abusiva. Marca offensive=true SOLO si hay:
- Groserías, insultos o lenguaje de maltrato
- Acoso, presión, intimidación o sarcasmo agresivo dirigido a la otra persona
- Discriminación, amenazas, extorsión o divulgación de datos privados (doxxing)
NO marques ofensivo: lenguaje comercial normal, precios, negociaciones e incluso
desacuerdos sin insultos.

Devuelve SOLO JSON:
{"offensive": boolean, "severity": "low"|"medium"|"high", "reason": "frase corta en español"}.
severity: low=mild, medium=acoso/presión reiterada, high=amenaza/odio/doxxing/extorsión.`;

  try {
    const resp = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as AIClassification;
    if (typeof parsed.offensive === "boolean") {
      result.offensive = parsed.offensive;
      result.severity = parsed.severity === "high" ? "high" : parsed.severity === "medium" ? "medium" : "low";
      result.reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
    }
  } catch {
    // Sin IA o error: dejamos pasar (el filtro por lista ya cubrió lo obvio).
  }
  return result;
}

// ── Estado de moderación del usuario ─────────────────────────────────────────
export interface UserModRow {
  id: string;
  moderationStatus?: string | null;
  moderationUntil?: Date | string | null;
}

export type UserBlockState =
  | { blocked: false }
  | { blocked: true; status: "MUTED" | "SUSPENDED" | "BANNED"; until?: Date | string | null };

/** El usuario está bloqueado (mute/suspensión vigentes o ban permanente). */
export function userBlockState(u: UserModRow): UserBlockState {
  if (u.moderationStatus === "BANNED") return { blocked: true, status: "BANNED" };
  if (u.moderationStatus === "MUTED" || u.moderationStatus === "SUSPENDED") {
    const until = u.moderationUntil;
    if (until && new Date(until).getTime() > Date.now()) {
      return { blocked: true, status: u.moderationStatus, until };
    }
    // Sanción vencida: cuenta como liberada (la reactivación la hace refreshUserModeration).
    return { blocked: false };
  }
  return { blocked: false };
}

/** Reactiva (lazy) usuarios suspendidos/silenciados cuya sanción ya expiró. */
export async function refreshUserModeration(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ moderationStatus: "ACTIVE", moderationUntil: null })
    .where(
      and(
        eq(users.id, userId),
        inArray(users.moderationStatus, ["MUTED", "SUSPENDED"]),
        lt(users.moderationUntil!, new Date()),
      ),
    );
}

// ── Escalera de castigos ─────────────────────────────────────────────────────
export type ChatAction = "warning" | "mute" | "suspension" | "ban";
export type ApplyChatViolationResult = {
  action: ChatAction;
  until?: Date;
};

function severityForStrike(currentStrikes: number): ChatAction {
  if (currentStrikes >= 3) return "ban";
  if (currentStrikes === 2) return "suspension";
  if (currentStrikes === 1) return "mute";
  return "warning";
}

export async function countChatAbuse(userId: string): Promise<number> {
  const since = new Date(Date.now() - CHAT_ABUSE_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.userId, userId),
        eq(violations.type, CHAT_ABUSE_TYPE),
        gte(violations.createdAt, since),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Aplica una falta de conducta en el chat y ejecuta el castigo de la escalera.
 * severity "high" → ban inmediato. Inserta la violación con su acción y ajusta
 * el estado del usuario (y de sus tiendas en suspensión/ban).
 */
export async function applyChatViolation(opts: {
  userId: string;
  senderName?: string;
  severity: "low" | "medium" | "high";
  messageId?: string;
  messageContent?: string;
  reason: string;
}): Promise<ApplyChatViolationResult> {
  if (opts.severity === "high") {
    await banUser(opts.userId, opts.reason, opts);
    return { action: "ban" };
  }

  const strikes = await countChatAbuse(opts.userId);
  const action = severityForStrike(strikes);

  // 4.ª falta+ (o más) → expulsión permanente (inserta violación + ban cuenta + tiendas).
  if (action === "ban") {
    await banUser(opts.userId, opts.reason, opts);
    return { action: "ban" };
  }

  await db.insert(violations).values({
    type: CHAT_ABUSE_TYPE,
    severity: action,
    userId: opts.userId,
    reason: opts.reason,
    metadata: {
      messageId: opts.messageId ?? null,
      messageContent: opts.messageContent ?? null,
      senderName: opts.senderName ?? null,
    },
    actionTaken: action,
  });

  if (action === "mute") {
    const until = new Date(Date.now() + MUTE_HOURS * 3_600_000);
    await db
      .update(users)
      .set({ moderationStatus: "MUTED", moderationUntil: until })
      .where(eq(users.id, opts.userId));
    return { action, until };
  }

  if (action === "suspension") {
    const until = new Date(Date.now() + SUSPENSION_DAYS * 86_400_000);
    await db
      .update(users)
      .set({ moderationStatus: "SUSPENDED", moderationUntil: until })
      .where(eq(users.id, opts.userId));
    // Sanción comercial: las tiendas del usuario dejan de operar el mismo tiempo.
    const owned = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, opts.userId));
    for (const s of owned) {
      await applySuspension(s.id, {
        days: SUSPENSION_DAYS,
        reason: "Suspensión de cuenta por conducta en el chat",
        actionTaken: "suspensión automática por chat",
      });
    }
    return { action, until };
  }

  // warning: sin restricción, ya quedó registrada la violación.
  return { action };
}

async function banUser(
  userId: string,
  reason: string,
  opts: { senderName?: string; messageId?: string; messageContent?: string },
): Promise<void> {
  await db.insert(violations).values({
    type: CHAT_ABUSE_TYPE,
    severity: "ban",
    userId,
    reason,
    metadata: {
      messageId: opts.messageId ?? null,
      messageContent: opts.messageContent ?? null,
      senderName: opts.senderName ?? null,
    },
    actionTaken: "ban",
  });
  await db
    .update(users)
    .set({ moderationStatus: "BANNED", moderationUntil: null })
    .where(eq(users.id, userId));
  const owned = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, userId));
  for (const s of owned) {
    await banStore(s.id, "Cuenta expulsada por conducta en el chat");
  }
}

// ── Puente para el chat (WS + REST) ─────────────────────────────────────────
export type MessageGateResult =
  | { status: "ok" }
  | { status: "blocked_by_state"; accountStatus: "MUTED" | "SUSPENDED" | "BANNED"; until?: Date | string | null }
  | { status: "blocked"; action: ChatAction; reason: string; until?: Date };

/**
 * Valida un mensaje ANTES de publicarlo. Devuelve "ok" si pasa, o la razón del
 * bloqueo. Los mensajes generados por IA (isAI) se omiten del control.
 */
export async function gateIncomingMessage(opts: {
  userId: string;
  content: string;
  senderName?: string;
  senderIsMerchant?: boolean;
  isAI?: boolean;
}): Promise<MessageGateResult> {
  if (opts.isAI) return { status: "ok" };

  const [user] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
  if (!user) return { status: "blocked_by_state", accountStatus: "BANNED" };

  const state = userBlockState(user);
  if (state.blocked) {
    return { status: "blocked_by_state", accountStatus: state.status, until: state.until };
  }

  const list = checkProfanityList(opts.content);
  if (list.flagged) {
    const result = await applyChatViolation({
      userId: opts.userId,
      senderName: opts.senderName,
      severity: list.hard ? "high" : "low",
      messageContent: opts.content,
      reason: list.hard
        ? "Contenido prohibido en el chat (amenaza, odio, extorsión o discriminación)."
        : "Lenguaje ofensivo en el chat.",
    });
    return {
      status: "blocked",
      action: result.action,
      until: result.until,
      reason: list.hard
        ? "Tu mensaje contenía contenido prohibido. Fue bloqueado y tu cuenta fue expulsada."
        : "Mensaje bloqueado. Tu mensaje usó lenguaje ofensivo y quedó registrado como falta.",
    };
  }

  return { status: "ok" };
}

/**
 * Revisión en segundo plano con IA: si detecta abuso, retira el mensaje ya
 * publicado, aplica la escalera y avisa por WebSocket. Nunca lanza ni bloquea.
 */
export async function retractIfFlaggedByAI(opts: {
  userId: string;
  senderName?: string;
  senderIsMerchant?: boolean;
  messageId: string;
  content: string;
  onRetracted: (reason: string) => void;
}): Promise<void> {
  try {
    const verdict = await classifyTextWithAI({
      content: opts.content,
      senderName: opts.senderName,
      senderIsMerchant: opts.senderIsMerchant,
    });
    if (!verdict.offensive) return;

    const result = await applyChatViolation({
      userId: opts.userId,
      senderName: opts.senderName,
      severity: verdict.severity,
      messageId: opts.messageId,
      messageContent: opts.content,
      reason: verdict.reason ?? "Conducta abusiva detectada por moderación.",
    });

    await db
      .update(messages)
      .set({ removedAt: new Date(), removedReason: verdict.reason })
      .where(eq(messages.id, opts.messageId));

    opts.onRetracted(verdict.reason ?? "Mensaje retirado por moderación");
  } catch {
    // Nunca romper el flujo del usuario por un error del moderador.
  }
}