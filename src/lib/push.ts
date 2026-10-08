// Notificaciones push (FCM) + popup in-app.
// - Los tokens se guardan en DB (device_tokens) al hacer login.
// - El envío FCM es best-effort y NUNCA tumba el flujo principal: sin
//   credenciales de Firebase configuradas, notifyUser no hace nada.
// - Anti-spam v1: cooldown en memoria por (usuario, hilo) para mensajes.

import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../db/client";
import { deviceTokens } from "../db/schema";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function fcmConfig(): FcmConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fcmAccessToken(cfg: FcmConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const assertion = jwt.sign(
    {
      iss: cfg.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    cfg.privateKey,
    { algorithm: "RS256" },
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`OAuth2 token falló (${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Sin access_token de Google");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Registra (upsert) el token FCM del dispositivo. Idempotente. */
export async function registerDeviceToken(userId: string, token: string, platform = "android"): Promise<void> {
  const clean = String(token ?? "").trim();
  if (!clean || clean.length > 500) return;
  await db
    .insert(deviceTokens)
    .values({ userId, token: clean, platform: platform === "ios" ? "ios" : "android" })
    .onConflictDoNothing({ target: deviceTokens.token });
  // El token pudo existir de otro usuario (relogin): reasignar.
  await db.update(deviceTokens).set({ userId }).where(eq(deviceTokens.token, clean));
}

/** Borra el token (logout). Silencioso si no existe. */
export async function unregisterDeviceToken(token: string): Promise<void> {
  const clean = String(token ?? "").trim();
  if (!clean) return;
  await db.delete(deviceTokens).where(eq(deviceTokens.token, clean));
}

// Cooldown anti-spam v1: máx 1 push por (usuario, hilo) cada 5 min.
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000;

export function pushAllowed(key: string): boolean {
  const last = cooldowns.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  cooldowns.set(key, Date.now());
  if (cooldowns.size > 5000) cooldowns.clear();
  return true;
}

/**
 * Envía push a todos los dispositivos del usuario. Best-effort: sin config
 * de Firebase devuelve {sent:0} sin lanzar. Nunca rechaza.
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number }> {
  try {
    const cfg = fcmConfig();
    if (!cfg) return { sent: 0 };
    const rows = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
    if (!rows.length) return { sent: 0 };
    const access = await fcmAccessToken(cfg);
    let sent = 0;
    for (const { token } of rows) {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: payload.title, body: payload.body },
                data: payload.data ?? {},
                android: { priority: "high" },
              },
            }),
          },
        );
        if (res.ok) {
          sent++;
        } else if (res.status === 404 || res.status === 400) {
          // Token muerto (app desinstalada): limpiar para no reintentar.
          await unregisterDeviceToken(token);
        }
      } catch {
        /* un token fallido no bloquea los demás */
      }
    }
    return { sent };
  } catch (err) {
    console.error("⚠️ push falló (no fatal):", err instanceof Error ? err.message : err);
    return { sent: 0 };
  }
}
