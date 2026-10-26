import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { empresariosLeads } from "../db/schema";
import { empresariosLeadLimiter } from "../middleware/rate-limit";

const router = Router();

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const leadSchema = z.object({
  companyName: z.string().trim().min(2, "Escribe el nombre de la empresa.").max(120),
  contactName: z.string().trim().min(2, "Escribe el nombre de contacto.").max(80),
  email: z.string().trim().email("Escribe un correo válido.").max(160),
  phone: optionalText(30),
  storeCount: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce
      .number()
      .int("El número de tiendas debe ser entero.")
      .min(1, "Indica al menos una tienda.")
      .max(10000)
      .optional(),
  ),
  website: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().url("Escribe una URL válida.").max(200).optional(),
  ),
  message: optionalText(1000),
});

// POST /api/empresarios/leads
// Público: guarda una solicitud de acceso anticipado desde la landing. No
// crea empresa ni tienda; solo deja el lead para el equipo comercial.
router.post("/leads", empresariosLeadLimiter, async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    });
  }

  const data = parsed.data;

  try {
    await db.insert(empresariosLeads).values({
      companyName: data.companyName,
      contactName: data.contactName,
      email: data.email.toLowerCase(),
      phone: data.phone ?? null,
      storeCount: data.storeCount ?? null,
      website: data.website ?? null,
      message: data.message ?? null,
      source: "landing",
    });
  } catch (err) {
    console.error("empresarios lead error:", err);
    return res.status(500).json({ error: "No pudimos guardar tu solicitud. Intenta de nuevo." });
  }

  return res.status(201).json({
    ok: true,
    message: "Solicitud recibida. Te contactaremos para conocer tu operación.",
  });
});

export default router;
