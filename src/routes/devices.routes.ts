// Registro de tokens push (FCM) por dispositivo.
import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { registerDeviceToken, unregisterDeviceToken } from "../lib/push";

const router = Router();

const registerSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["android", "ios"]).optional(),
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Token inválido." });
  await registerDeviceToken(req.userId!, parsed.data.token, parsed.data.platform ?? "android");
  res.status(201).json({ ok: true });
});

router.delete("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = registerSchema
    .pick({ token: true })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Token inválido." });
  await unregisterDeviceToken(parsed.data.token);
  res.json({ ok: true });
});

export default router;
