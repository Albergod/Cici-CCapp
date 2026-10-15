// Perfil propio: ver, editar (nombre/avatar) y cambiar clave.
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { imageUrl } from "../lib/validators";

const router = Router();

const COLS = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  termsAcceptedAt: users.termsAcceptedAt,
  moderationStatus: users.moderationStatus,
  moderationUntil: users.moderationUntil,
} as const;

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const [me] = await db.select(COLS).from(users).where(eq(users.id, req.userId!)).limit(1);
  if (!me) return res.status(404).json({ error: "Usuario no encontrado." });
  res.json(me);
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 letras.").max(80).optional(),
  avatarUrl: imageUrl().nullable().optional(),
});

router.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos." });
  const patch: { name?: string; avatarUrl?: string | null } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nada que actualizar." });
  const [updated] = await db.update(users).set(patch).where(eq(users.id, req.userId!)).returning(COLS);
  res.json(updated);
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu clave actual."),
  newPassword: z.string().min(6, "La nueva clave debe tener al menos 6 caracteres.").max(100),
});

router.post("/me/password", requireAuth, async (req: AuthRequest, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos." });
  const [me] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, req.userId!))
    .limit(1);
  if (!me) return res.status(404).json({ error: "Usuario no encontrado." });
  const ok = await bcrypt.compare(parsed.data.currentPassword, me.passwordHash);
  if (!ok) return res.status(403).json({ error: "Tu clave actual no coincide." });
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) })
    .where(eq(users.id, req.userId!));
  res.json({ ok: true, message: "Clave actualizada." });
});

export default router;
