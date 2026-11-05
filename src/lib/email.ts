import { createHash } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client";
import { passwordResets, users } from "../db/schema";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isResendConfigured(): boolean {
  return process.env.EMAIL_PROVIDER?.toLowerCase() === "resend" && Boolean(process.env.RESEND_API_KEY);
}

/** Envía un correo de forma best-effort: nunca lanza. */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<{ ok: boolean; skipped: boolean }> {
  if (!isResendConfigured()) {
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "noreply@ccplatform.com",
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
    if (!res.ok) {
      console.error("⚠️ Resend rechazó el envío:", res.status, await res.text().catch(() => ""));
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    console.error("⚠️ Error enviando correo:", err);
    return { ok: false, skipped: false };
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function emailConfigured(): boolean {
  return isResendConfigured();
}

const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:5173").replace(/\/$/, "");

/**
 * Genera un token de restablecimiento y lo envía por Resend. El token se
 * guarda HASHEADO en DB (sobrevive reinicios/sleep del servidor) y es de un
 * solo uso. Si el email no existe, no se guarda nada (no revelar), pero se
 * devuelve un link con formato válido para no filtrar información.
 */
export async function sendResetLink(email: string, baseUrl?: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  const token = randomToken();
  const base = (baseUrl || BASE).replace(/\/$/, "");
  const resetLink = `${base}/reset-password/${token}`;

  if (!user) return resetLink;

  // Limpieza barata: borra tokens vencidos de este usuario y emite uno nuevo.
  await db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), lt(passwordResets.expiresAt, new Date())));
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  await sendEmail({
    to: normalized,
    subject: "Reinicia tu contraseña en CC Platform",
    html: `
      <p>Has solicitado reiniciar tu contraseña.</p>
      <p><a href="${resetLink}">Haz clic aquí para continuar</a> (o pega el link en tu navegador)</p>
      <p>Este enlace caduca en 1 hora y solo se puede usar una vez.</p>
      <p>Si no solicitaste esto, ignora este correo.</p>
    `,
  }).catch(() => {});

  return resetLink;
}

/** Valida un token (vigente y sin usar), lo marca usado y devuelve el email. */
export async function validateAndConsumeToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(String(token ?? "").trim());
  const [row] = await db
    .select({ id: passwordResets.id, userId: passwordResets.userId, expiresAt: passwordResets.expiresAt, usedAt: passwordResets.usedAt })
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, tokenHash))
    .limit(1);
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    if (row) await db.delete(passwordResets).where(eq(passwordResets.id, row.id));
    return null;
  }
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  return user?.email ?? null;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GuestOrderEmailParams {
  email: string;
  orderId: string;
  guestCode: string;
  storeName: string;
  customerName?: string | null;
  total: number;
  nequiPhone: string;
  nequiHolder: string;
  storeSlug: string;
}

/** Le envía al comprador su código de acceso y los datos del pago directo. */
export async function sendGuestOrderCode(params: GuestOrderEmailParams): Promise<void> {
  const orderUrl = `${BASE}/pedido?email=${encodeURIComponent(params.email)}&code=${encodeURIComponent(params.guestCode)}`;
  await sendEmail({
    to: params.email,
    subject: `Tu pedido en ${esc(params.storeName)} está listo`,
    html: `
      <p>Hola${esc(params.customerName ? ` ${params.customerName}` : "")},</p>
      <p>Tu pedido en <strong>${esc(params.storeName)}</strong> fue creado. Guarda este código junto a tu email:</p>
      <p style="font-size:1.25rem;font-weight:bold;letter-spacing:2px">${esc(params.guestCode)}</p>
      <p><strong>Total a pagar:</strong> ${formatMoney(params.total)}</p>
      <p>Paga directo al Nequi del comerciante:</p>
      <p style="font-size:1.25rem;font-weight:bold;letter-spacing:2px">${esc(params.nequiPhone)}</p>
      <p>Titular: ${esc(params.nequiHolder)}</p>
      <p>Cuando termines la transferencia, avisale a la tienda para que confirme tu pedido.</p>
      <p><a href="${orderUrl}">Seguir mi pedido</a></p>
      <p>Si no reconocés esta compra, ignora este mensaje.</p>
    `,
    text: `Hola${params.customerName ? ` ${params.customerName}` : ""}.\nTu pedido en ${params.storeName} fue creado.\nCódigo: ${params.guestCode}\nTotal: ${formatMoney(params.total)}\nPaga al Nequi ${params.nequiPhone} (${params.nequiHolder}).\nSeguir pedido: ${orderUrl}\nSi no reconocés esta compra, ignora este mensaje.`,
  }).catch(() => {});
}

export interface MerchantOrderEmailParams {
  ownerEmail: string;
  storeName: string;
  customerName?: string | null;
  customerEmail?: string | null;
  total: number;
  orderId: string;
  storeSlug: string;
}

/** Avisa al comerciante que entró un nuevo pedido por Nequi directo. */
export async function sendMerchantNewOrder(params: MerchantOrderEmailParams): Promise<void> {
  const ordersUrl = `${BASE}/dashboard?tab=pedidos`;
  await sendEmail({
    to: params.ownerEmail,
    subject: `Nuevo pedido por Nequi en ${esc(params.storeName)}`,
    html: `
      <p>Hola,</p>
      <p>Llegó un pedido nuevo a <strong>${esc(params.storeName)}</strong>.</p>
      <p><strong>Cliente:</strong> ${esc(params.customerName || "Sin nombre")} (${esc(params.customerEmail || "—")})</p>
      <p><strong>Total:</strong> ${formatMoney(params.total)}</p>
      <p>El pago es directo a tu Nequi: verificalo y confirma el pedido en tu panel.</p>
      <p><a href="${ordersUrl}">Ir a Pedidos</a></p>
    `,
  }).catch(() => {});
}

export interface MerchantPaidReportParams {
  ownerEmail: string;
  storeName: string;
  customerName?: string | null;
  customerEmail?: string | null;
  total: number;
  orderId: string;
  storeSlug: string;
}

/** Avisa al comerciante que el comprador reportó "ya pagué". */
export async function sendMerchantBuyerReportedPaid(params: MerchantPaidReportParams): Promise<void> {
  const ordersUrl = `${BASE}/dashboard?tab=pedidos`;
  await sendEmail({
    to: params.ownerEmail,
    subject: `El comprador dice que ya pagó — ${esc(params.storeName)}`,
    html: `
      <p>Hola,</p>
      <p>El cliente <strong>${esc(params.customerName || "Sin nombre")}</strong> reportó que ya pagó su pedido de ${formatMoney(params.total)} en <strong>${esc(params.storeName)}</strong>.</p>
      <p>Verificá el pago en tu Nequi y confirmá o cancelá el pedido en tu panel.</p>
      <p><a href="${ordersUrl}">Ir a Pedidos</a></p>
    `,
  }).catch(() => {});
}

function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}
