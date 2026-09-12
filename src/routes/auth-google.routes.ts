// ─────────────────────────────────────────────────────────────────────────────
// LOGIN CON GOOGLE — implementado pero DESACTIVADO por el momento.
//
// ESTADO ACTUAL: la ruta está montada pero devuelve 503 si no se configura la
// variable GOOGLE_CLIENT_ID en .env. No se usa ninguna credencial real todavía.
//
// CÓMO ACTIVARLO (cuando tengas las credenciales):
//   1. En Google Cloud Console: APIs y servicios → Credenciales → Crear
//      credenciales → ID de cliente OAuth. Tipo: "Aplicación web".
//      - Orígenes de JS autorizados:  http://localhost:5173 (y tu dominio en prod)
//      - URIs de redireccionamiento: (no obligatorias para este flujo, pero se
//        pueden dejar vacías)
//   2. Copia el "ID de cliente" en .env →  GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
//   3. Copia el MISMO valor en frontend/.env → VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
//   4. Reinicia backend y frontend. Listo: el botón "Continuar con Google"
//      aparece automáticamente en Registro y Login (ver GoogleAuthButton.tsx).
//
// CÓMO DESACTIVARLO: borra o comenta las dos variables del .env.
//
// FLUJO QUE IMPLEMENTA:
//   - El frontend carga el script oficial de Google Identity Services y muestra
//     el botón. Google devuelve un "ID token" (JWT) firmado.
//   - POST /api/auth/google verifica el token contra las claves públicas de
//     Google (JWKS), valida emisor y audiencia, y:
//       · si el correo NO existe → crea el usuario (con un hash de contraseña
//         inutilizable, porque su acceso es por Google) y guarda avatar.
//       · si el correo YA existe → simplemente inicia sesión (una sola cuenta,
//         sin duplicados).
//   - Responde { token, user } con el mismo JWT de siempre.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db } from "../db/client";
import { users } from "../db/schema";
import { signToken } from "../middleware/auth";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

interface GoogleJwtPayload extends JwtPayload {
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

interface JwkKey {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

/**
 * Verifica el ID token de Google (JWT firmado con RS256) contra las claves
 * públicas oficiales, el emisor y la audiencia (nuestro client_id).
 * Devuelve los datos verificados del usuario o lanza un error.
 */
async function verifyGoogleIdToken(credential: string): Promise<GoogleJwtPayload> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Login con Google no configurado (falta GOOGLE_CLIENT_ID)");
  }

  // Extrae la cabecera para saber qué kid / algoritmo usó Google.
  const decodedHeader = jwt.decode(credential, { complete: true });
  if (!decodedHeader || typeof decodedHeader === "string" || decodedHeader.header.alg !== "RS256") {
    throw new Error("Token de Google inválido");
  }
  const kid = decodedHeader.header.kid;

  // Descarga las claves públicas de Google para verificar la firma.
  const certsRes = await fetch(GOOGLE_JWKS_URL);
  const { keys } = (await certsRes.json()) as { keys: JwkKey[] };
  const signingKey = keys.find((k) => k.kid === kid);
  if (!signingKey) {
    throw new Error("No se encontró la clave pública de Google para verificar el token");
  }

  const payload = jwt.verify(credential, signingKey as unknown as jwt.Secret, {
    algorithms: ["RS256"],
    audience: GOOGLE_CLIENT_ID,
  }) as GoogleJwtPayload;

  if (!payload.iss || !GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new Error("Emisor del token de Google no válido");
  }
  if (!payload.email || !payload.email_verified) {
    throw new Error("El correo de la cuenta de Google no está verificado");
  }

  return payload;
}

const googleSchema = z.object({
  credential: z.string().min(1),
  refCode: z.string().optional(),
});

// Expone al frontend si el login con Google está configurado y con qué client
// id. El frontend lee esto en runtime, evitando incrustar secretos en el build.
router.get("/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID ?? null });
});

router.post("/google", async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    // Ruta desactivada: se activa al definir GOOGLE_CLIENT_ID en .env.
    return res.status(503).json({ error: "El acceso con Google todavía no está disponible" });
  }

  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Credencial de Google requerida" });
  }

  try {
    const googleUser = await verifyGoogleIdToken(parsed.data.credential);
    const email = googleUser.email;
    if (!email) {
      throw new Error("El token de Google no incluyó un correo");
    }

    // Busca por correo: si ya existe, inicia sesión; si no, crea el usuario.
    let [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({
          email,
          // Hash inutilizable: este usuario nunca inicia sesión con contraseña.
          passwordHash: await bcrypt.hash(randomUUID(), 10),
          name: googleUser.name || email.split("@")[0],
          avatarUrl: googleUser.picture ?? null,
          refCode: parsed.data.refCode ?? null,
        })
        .returning({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl });
      user = created;
    }

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    });
  } catch (err) {
    console.error("Error en login con Google:", err);
    res.status(401).json({ error: err instanceof Error ? err.message : "No se pudo autenticar con Google" });
  }
});

export default router;