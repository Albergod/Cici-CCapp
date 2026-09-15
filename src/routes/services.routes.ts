// CRUD de servicios para tiendas BELLEZA. Un servicio tiene duración estimada
// (en minutos) que la agenda usa para reservar el slot. Solo el dueño puede
// gestionarlos, y solo en tiendas de tipo BELLEZA.
import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { appointments, storeServices, stores } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { sql } from "drizzle-orm";

const router = Router();

async function requireOwnBeautyStore(userId: string) {
  const [store] = await db
    .select({ id: stores.id, businessType: stores.businessType })
    .from(stores)
    .where(eq(stores.ownerId, userId))
    .limit(1);
  return store ?? null;
}

const serviceSchema = z.object({
  name: z.string().min(2, "El nombre del servicio es obligatorio"),
  description: z.string().max(500).optional(),
  price: z.number().positive("El precio debe ser mayor a 0"),
  durationMinutes: z
    .number()
    .int()
    .min(5, "Mínimo 5 minutos")
    .max(480, "Máximo 8 horas"),
});

// Plantillas rápidas de servicios comunes para precargar la primera vez.
const TEMPLATES: { name: string; durationMinutes: number }[] = [
  { name: "Manicura", durationMinutes: 60 },
  { name: "Pedicura", durationMinutes: 60 },
  { name: "Corte de cabello dama", durationMinutes: 45 },
  { name: "Corte de cabello caballero", durationMinutes: 30 },
  { name: "Cepillado", durationMinutes: 40 },
  { name: "Arreglo de uñas (básico)", durationMinutes: 45 },
  { name: "Uñas acrílicas", durationMinutes: 150 },
  { name: "Masaje relajante", durationMinutes: 60 },
];

// Listar servicios propios
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const store = await requireOwnBeautyStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  const rows = await db
    .select()
    .from(storeServices)
    .where(eq(storeServices.storeId, store.id))
    .orderBy(desc(storeServices.createdAt));
  res.json(rows);
});

// Plantillas rápidas (para el dashboard)
router.get("/templates", requireAuth, async (_req: AuthRequest, res) => {
  res.json(TEMPLATES);
});

// Crear servicio
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const store = await requireOwnBeautyStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });
  if (store.businessType !== "BELLEZA") {
    return res.status(400).json({ error: "Esta tienda no usa servicios." });
  }
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [row] = await db
    .insert(storeServices)
    .values({
      storeId: store.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      price: String(parsed.data.price),
      durationMinutes: parsed.data.durationMinutes,
    })
    .returning();
  res.status(201).json(row);
});

// Editar servicio
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const store = await requireOwnBeautyStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const [service] = await db
    .select({ id: storeServices.id })
    .from(storeServices)
    .where(and(eq(storeServices.id, req.params.id), eq(storeServices.storeId, store.id)))
    .limit(1);
  if (!service) return res.status(404).json({ error: "Servicio no encontrado." });

  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.price !== undefined) patch.price = String(parsed.data.price);
  if (parsed.data.durationMinutes !== undefined) patch.durationMinutes = parsed.data.durationMinutes;

  const [updated] = await db
    .update(storeServices)
    .set(patch)
    .where(eq(storeServices.id, service.id))
    .returning();
  res.json(updated);
});

// Eliminar servicio (bloqueado si tiene citas futuras confirmadas)
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const store = await requireOwnBeautyStore(req.userId!);
  if (!store) return res.status(404).json({ error: "No tienes una tienda." });

  const [service] = await db
    .select({ id: storeServices.id })
    .from(storeServices)
    .where(and(eq(storeServices.id, req.params.id), eq(storeServices.storeId, store.id)))
    .limit(1);
  if (!service) return res.status(404).json({ error: "Servicio no encontrado." });

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.serviceId, service.id),
        eq(appointments.status, "confirmed"),
        sql`${appointments.appointmentDate} >= now()`,
      ),
    );
  if (Number(n) > 0) {
    return res.status(409).json({
      error: `Este servicio tiene ${n} cita(s) futuras. Cancélalas antes de borrarlo.`,
    });
  }

  // Elimina también la historia de citas del servicio para no violar la FK.
  await db.delete(appointments).where(eq(appointments.serviceId, service.id));
  await db.delete(storeServices).where(eq(storeServices.id, service.id));
  res.json({ ok: true });
});

export default router;