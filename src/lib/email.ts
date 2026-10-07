import { createHash, randomUUID } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client";
import { passwordResets, users } from "../db/schema";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Genera un token de restablecimiento y lo envía por el proveedor
 * configurado (Resend por ahora). El token se guarda HASHEADO en DB
 * (sobrevive reinicios/sleep del servidor) y es de un solo uso.
 * Si el email no existe, no se guarda nada (no revelar), pero se devuelve
 * un link con formato válido para no filtrar información.
 */
export async function sendResetLink(email: string, baseUrl?: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  const token = randomUUID();
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
  const resetLink = `${base}/reset-password/${token}`;

  if (!user) return resetLink;

  // Limpieza barata: borra tokens vencidos de este usuario y emite uno nuevo.
  await db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), lt(passwordResets.expiresAt, new Date())));
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  const provider = process.env.EMAIL_PROVIDER?.toLowerCase();

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.io/v1/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "noreply@ccplatform.com",
          to: normalized,
          subject: "Reinicia tu contraseña en CC Platform",
          html: `
            <p>Has solicitado reiniciar tu contraseña.</p>
            <p><a href="${resetLink}">Haz clic aquí para continuar</a> (o pega el link en tu navegador)</p>
            <p>Este enlace caduca en 1 hora y solo se puede usar una vez.</p>
            <p>Si no solicitaste esto, ignora este correo.</p>
          `,
        }),
      });
      if (!res.ok) {
        console.error("⚠️ Resend rechazó el envío:", res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error("⚠️ Error enviando correo con Resend:", err);
    }
  }

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
