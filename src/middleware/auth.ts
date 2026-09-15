import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

// Seguridad: el secreto NUNCA debe ser un valor fijo conocido. Si el entorno no
// define JWT_SECRET, se genera uno aleatorio en cada arranque del proceso: los
// tokens forjados con el valor por defecto (o con un secreto anterior) quedan
// inválidos de inmediato. Lo correcto es fijar JWT_SECRET en el entorno (Render/
// Neon/Lambda) para que las sesiones sobrevivan a reinicios.
if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️ JWT_SECRET no está definido en el entorno: se genera un secreto aleatorio por arranque. Las sesiones se reiniciarán en cada deploy/restart. Define JWT_SECRET en producción.",
  );
}
const JWT_SECRET: string = process.env.JWT_SECRET || randomBytes(32).toString("hex");

export interface AuthRequest extends Request {
  userId?: string;
}

export function signToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autenticación" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// Igual que requireAuth pero no falla si no hay token: deja req.userId sin definir.
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      req.userId = payload.userId;
    } catch {
      // token inválido: se ignora, se trata como sin sesión
    }
  }
  next();
}

export { JWT_SECRET };
