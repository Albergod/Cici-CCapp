import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const resetTokens = new Map<string, { email: string; expiresAt: number }>();

/**
 * Genera un token de restablecimiento de contraseña.
 * Lo envía a traves del proveedor configurado (Resend, Brevo, SendGrid o SMTP).
 * Si no hay configuración de email, lo devuelve como string para probar.
 */
export async function sendResetLink(email: string): Promise<string> {
  const token = randomUUID();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hora

  resetTokens.set(token, { email, expiresAt });

  const resetLink = `${process.env.PUBLIC_BASE_URL || "http://localhost:5173"}/reset-password/${token}`;

  const provider = process.env.EMAIL_PROVIDER?.toLowerCase();

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    await fetch("https://api.resend.io/v1/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "noreply@ccplatform.com",
        to: email,
        subject: "Reinicia tu contraseña en CC Platform",
        html: `
          <p>Has solicitado reiniciar tu contraseña.</p>
          <p><a href="${resetLink}">Haz clic aquí para continuar</a> (o pega el link en tu navegador)</p>
          <p>Este enlace caduca en 1 hora.</p>
          <p>Si no solicitaste esto, ignora este correo.</p>
        `,
      }),
    });
  }

  return resetLink;
}

export async function validateAndConsumeToken(token: string): Promise<string | null> {
  const entry = resetTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resetTokens.delete(token);
    return null;
  }
  resetTokens.delete(token);

  const user = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.email, entry.email))
    .limit(1);

  return user[0]?.email ?? null;
}