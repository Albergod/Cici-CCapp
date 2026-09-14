import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { signToken } from "../middleware/auth";
import { authLimiter, registerLimiter } from "../middleware/rate-limit";
import { clientIp } from "../lib/moderation";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  refCode: z.string().optional(),
});

router.post("/register", registerLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, name, refCode } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "Ese correo ya está registrado" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, name, refCode: refCode ?? null, signupIp: clientIp(req) })
    .returning();

  const token = signToken(user.id);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Credenciales inválidas" });

  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// ── Recuperación de contraseña ──────────────────────────────────────────────
const forgotSchema = z.object({ email: z.string().email() });

router.post("/forgot-password", authLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email inválido" });

  const { email } = parsed.data;

  // No revelar si el email existe o no.
  const resetLink = await import("../lib/email").then((m) => m.sendResetLink(email));

  res.json({
    message: "Si el email está registrado, recibirás el enlace para reiniciar.",
    link: process.env.NODE_ENV === "development" ? resetLink : undefined,
  });
});

const resetSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
});

router.post("/reset-password", authLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { token, password } = parsed.data;
  const email = await import("../lib/email").then((m) => m.validateAndConsumeToken(token));

  if (!email) return res.status(400).json({ error: "Token inválido o expirado" });

  const passwordHash = await bcrypt.hash(password, 10);
  await db.update(users).set({ passwordHash }).where(eq(users.email, email));

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const jwt = signToken(user.id);
  res.json({ message: "Contraseña reiniciada", token: jwt });
});

export default router;
