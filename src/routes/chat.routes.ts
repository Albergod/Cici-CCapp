import { Router } from "express";
import { eq, and, inArray, asc, desc } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, stores, messages } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getContactEligibility } from "../lib/subscription";

const router = Router();

const SUBSCRIPTION_REQUIRED_MSG =
  "Esta tienda no tiene el canal de contacto activo. El vendedor necesita una suscripción de espacio para recibir mensajes.";

// Cliente abre (o recupera) su conversación con una tienda
router.post("/stores/:storeId/conversation", requireAuth, async (req: AuthRequest, res) => {
  const { storeId } = req.params;

  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  // Bloquear si la tienda no tiene contacto disponible (prueba vencida sin suscripción)
  const elig = getContactEligibility(store.trialStartedAt, store.subscriptionExpiresAt);
  if (!elig.contactAvailable) {
    return res
      .status(403)
      .json({ error: SUBSCRIPTION_REQUIRED_MSG, code: "SUBSCRIPTION_REQUIRED" });
  }

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.customerId, req.userId!), eq(conversations.storeId, storeId)))
    .limit(1);

  if (existing) return res.json(existing);

  const [conversation] = await db
    .insert(conversations)
    .values({ customerId: req.userId!, storeId })
    .returning();

  res.json(conversation);
});

// Lista de conversaciones del usuario (como cliente) o de la tienda (como dueño)
router.get("/conversations", requireAuth, async (req: AuthRequest, res) => {
  const asCustomer = await db.query.conversations.findMany({
    where: eq(conversations.customerId, req.userId!),
    with: { store: { columns: { name: true, slug: true, logoUrl: true } } },
    orderBy: [desc(conversations.createdAt)],
  });

  const ownedStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.ownerId, req.userId!));

  const ownedStoreIds = ownedStores.map((s) => s.id);
  const asStoreOwner = ownedStoreIds.length
    ? await db.query.conversations.findMany({
        where: inArray(conversations.storeId, ownedStoreIds),
        with: { customer: { columns: { name: true, avatarUrl: true } } },
        orderBy: [desc(conversations.createdAt)],
      })
    : [];

  res.json({ asCustomer, asStoreOwner });
});

// Historial de mensajes de una conversación
router.get("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, req.params.id),
    with: { store: true },
  });
  if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

  const isCustomer = conversation.customerId === req.userId;
  const isStoreOwner = conversation.store.ownerId === req.userId;
  if (!isCustomer && !isStoreOwner) return res.status(403).json({ error: "No autorizado" });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));

  res.json(history);
});

export default router;
