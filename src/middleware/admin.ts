import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./auth";

// El ADMIN_TOKEN de entorno es solo una credencial de bootstrap: se cambia una
// vez por un JWT corto (2 h) y el panel usa ese JWT en cada petición. Así el
// secreto de administración no viaja en cada request ni queda guardado en el
// navegador. El JWT se firma con JWT_SECRET y lleva rol/audiencia explícitos
// para que no pueda confundirse con una sesión normal de usuario.
const ADMIN_ISSUER = "cici-admin";
const ADMIN_AUDIENCE = "cici-platform";
export const ADMIN_SESSION_TTL_SECONDS = 2 * 60 * 60;

interface AdminClaims extends jwt.JwtPayload {
  role?: string;
  typ?: string;
}

export function signAdminToken(): string {
  return jwt.sign({ role: "admin", typ: "admin", jti: crypto.randomUUID() }, JWT_SECRET, {
    expiresIn: ADMIN_SESSION_TTL_SECONDS,
    issuer: ADMIN_ISSUER,
    audience: ADMIN_AUDIENCE,
  });
}

/** Comparación en tiempo constante para el token de bootstrap. */
export function verifyBootstrapToken(candidate: string | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !candidate) return false;

  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Se compara igual para no filtrar la longitud por tiempo de respuesta.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!process.env.ADMIN_TOKEN) {
    return res.status(503).json({ error: "Admin endpoint deshabilitado" });
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Sesión de administrador requerida" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const claims = jwt.verify(token, JWT_SECRET, {
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
    }) as AdminClaims;
    if (claims.role !== "admin" || claims.typ !== "admin") {
      return res.status(403).json({ error: "Token de administrador inválido" });
    }
    next();
  } catch {
    return res.status(401).json({ error: "Sesión de administrador inválida o expirada" });
  }
}
