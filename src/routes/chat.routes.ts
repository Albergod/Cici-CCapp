import { Router } from "express";
import { eq, and, inArray, asc, desc, sql } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, stores, messages, users, products } from "../db/schema";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getStoreGreeting, getIAStoreReply, buildInvoiceVersions } from "../lib/ai";

const router = Router();

// Agrega a cada conversación su último mensaje y el conteo de no leídos para
// el usuario actual. Usa consultas batch con inArray (evita N+1).
async function enrichConversations(convs: Record<string, any>[], userId: string) {
  if (!convs.length) return convs;
  const convoIds = convs.map((c) => c.id);

  // Último mensaje de cada conversación (lote de los más recientes).
  const recentMessages = await db
    .select({
      id: messages.id,
      content: messages.content,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      aiGenerated: messages.aiGenerated,
      waText: messages.waText,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convoIds))
    .orderBy(desc(messages.createdAt))
    .limit(1000);
  const lastByConv = new Map<string, (typeof recentMessages)[number]>();
  for (const m of recentMessages) {
    if (!lastByConv.has(m.conversationId)) lastByConv.set(m.conversationId, m);
  }

  // Última marca de lectura de cada participante (por rol).
  const readStates = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      customerLastReadAt: conversations.customerLastReadAt,
      storeOwnerLastReadAt: conversations.storeOwnerLastReadAt,
    })
    .from(conversations)
    .where(inArray(conversations.id, convoIds));
  const lastReadByConv = new Map<string, number>();
  for (const c of readStates) {
    const lastRead =
      c.customerId === userId ? c.customerLastReadAt : c.storeOwnerLastReadAt;
    lastReadByConv.set(c.id, lastRead ? new Date(lastRead).getTime() : 0);
  }

  // Conteo de no leídos por conversación (mensajes del otro lado posteriores
  // a la última lectura).
  const sentRows = await db
    .select({
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convoIds));
  const unreadByConv = new Map<string, number>();
  for (const m of sentRows) {
    if (m.senderId === userId) continue;
    const lastRead = lastReadByConv.get(m.conversationId) ?? 0;
    if (lastRead === 0 || new Date(m.createdAt).getTime() > lastRead) {
      unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);
    }
  }

  return convs.map((c) => ({
    ...c,
    lastMessage: lastByConv.get(c.id),
    unreadCount: unreadByConv.get(c.id) ?? 0,
  }));
}

// Inserta el saludo inicial de la IA si la conversación nació con un producto
// y la tienda es PRO/BUSINESS. Devuelve el saludo o null.
async function maybeInsertGreeting(conversationCsId: string, storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    with: { products: true },
  });
  if (!store || (store.plan !== "PRO" && store.plan !== "BUSINESS")) return null;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationCsId))
    .limit(1);
  if (!conv) return null;

  const product = conv.assertedProductId
    ? store.products?.find((p) => p.id === conv.assertedProductId) ?? undefined
    : undefined;

  if (!product) return null;

  const greeting = await getStoreGreeting(
    { name: store.name, plan: store.plan, prestigeActive: true },
    product,
  );

  const [aiMsg] = await db
    .insert(messages)
    .values({
      conversationId: conversationCsId,
      senderId: store.ownerId,
      content: greeting,
      aiGenerated: true,
    })
    .returning();
  return aiMsg;
}

// Cliente abre (o recupera) su conversación con una tienda.
router.post("/stores/:storeId/conversation", requireAuth, async (req: AuthRequest, res) => {
  const { storeId } = req.params;
  const { productId } = (req.body ?? {}) as { productId?: string };

  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return res.status(404).json({ error: "Tienda no encontrada" });

  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.customerId, req.userId!), eq(conversations.storeId, storeId)))
    .limit(1);

  const buildResponse = async (conv: { id: string }) =>
    res.json({
      ...conv,
      messages: await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt)),
    });

  if (existing) {
    if (productId && existing.assertedProductId !== productId) {
      await db
        .update(conversations)
        .set({ assertedProductId: productId })
        .where(eq(conversations.id, existing.id));
      existing.assertedProductId = productId;
      await maybeInsertGreeting(existing.id, storeId);
    }
    return buildResponse(existing);
  }

  const [newConv] = await db
    .insert(conversations)
    .values({
      customerId: req.userId!,
      storeId,
      assertedProductId: productId ?? null,
    })
    .returning();

  if (productId) {
    await maybeInsertGreeting(newConv.id, storeId);
  }

  return buildResponse(newConv);
});

// Lista de conversaciones del usuario (como cliente) o de la tienda (como dueño)
router.get("/conversations", requireAuth, async (req: AuthRequest, res) => {
  const asCustomer = await db.query.conversations.findMany({
    where: eq(conversations.customerId, req.userId!),
    with: {
      store: {
        columns: {
          name: true,
          slug: true,
          logoUrl: true,
          whatsapp: true,
          plan: true,
          businessType: true,
        },
      },
    },
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

  const [customerEnriched, ownerEnriched] = await Promise.all([
    enrichConversations(asCustomer, req.userId!),
    enrichConversations(asStoreOwner, req.userId!),
  ]);

  res.json({ asCustomer: customerEnriched, asStoreOwner: ownerEnriched });
});

// Total de mensajes no leídos del usuario actual (para el badge global).
router.get("/conversations/unread-count", requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sender_id <> ${req.userId!}
      AND (c.customer_id = ${req.userId!}
        OR c.store_id IN (SELECT id FROM stores WHERE owner_id = ${req.userId!}))
      AND m.created_at > COALESCE(
        CASE WHEN c.customer_id = ${req.userId!} THEN c.customer_last_read_at
             ELSE c.store_owner_last_read_at END,
        to_timestamp(0))
  `);
  res.json({ totalUnread: Number(rows[0]?.total ?? 0) });
});

// Marca como leída la conversación para el usuario que la está viendo.
router.post("/conversations/:id/read", requireAuth, async (req: AuthRequest, res) => {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, req.params.id),
    with: { store: true },
  });
  if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

  const isCustomer = conversation.customerId === req.userId;
  const isStoreOwner = conversation.store.ownerId === req.userId;
  if (!isCustomer && !isStoreOwner) return res.status(403).json({ error: "No autorizado" });

  await db
    .update(conversations)
    .set(
      isCustomer ? { customerLastReadAt: new Date() } : { storeOwnerLastReadAt: new Date() },
    )
    .where(eq(conversations.id, conversation.id));

  res.json({ ok: true });
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

// Enviar un mensaje a una conversación (llamado por WebSocket)
router.post("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, req.params.id),
    with: { store: { with: { products: true } } },
  });
  if (!conversation) return res.status(404).json({ error: "Conversación no encontrada" });

  const isCustomer = conversation.customerId === req.userId;
  const isStoreOwner = conversation.store.ownerId === req.userId;
  if (!isCustomer && !isStoreOwner) return res.status(403).json({ error: "No autorizado" });

  const { content } = (req.body ?? {}) as { content?: string };
  const textToSend = content?.trim();
  if (!textToSend) return res.status(400).json({ error: "El mensaje no puede estar vacío" });

  // Guardar el mensaje del cliente
  const [savedMsg] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      senderId: req.userId!,
      content: textToSend,
    })
    .returning();

  // La IA actúa si el chat tiene contexto (un producto asociado).
  let aiReply: string | null = null;
  const isPaidPlan = conversation.store.plan === "PRO" || conversation.store.plan === "BUSINESS";
  const hasContext = !!conversation.assertedProductId;

  if (isCustomer && isPaidPlan && hasContext) {
    const storeInfo = {
      name: conversation.store.name,
      plan: conversation.store.plan as "PRO" | "BUSINESS",
      prestigeActive: true,
      whatsapp: conversation.store.whatsapp ?? null,
      businessType: conversation.store.businessType as string,
    };

    const storeProducts = conversation.store.products?.map((p: any) => ({
      name: p.name,
      price: Number(p.price),
      description: p.description ?? undefined,
      stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null,
    })) || [];

    const contextProduct = conversation.assertedProductId
      ? conversation.store.products?.find((p: any) => p.id === conversation.assertedProductId) ?? null
      : null;

    // Obtener el nombre del cliente para la factura
    const [customer] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, conversation.customerId))
      .limit(1);

    // Historial de mensajes anterior (para que la IA recuerde datos ya
    // aportados: talla, dirección, teléfono, etc.)
    const orderHistory = await db
      .select({ content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt));

    aiReply = await getIAStoreReply({
      store: storeInfo,
      products: storeProducts,
      history: orderHistory,
      contextProduct,
      customerName: customer?.name,
    });

    // Si la respuesta es una factura, separar la versión del chat (cliente)
    // de la versión de WhatsApp (comerciante) y guardar ambas.
    const invoiceVersions = buildInvoiceVersions(aiReply);

    // Insertar la respuesta de la IA en la base de datos
    const [aiMsg] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        senderId: conversation.store.ownerId,
        content: invoiceVersions ? invoiceVersions.chat : aiReply,
        waText: invoiceVersions ? invoiceVersions.wa : null,
        aiGenerated: true,
      })
      .returning();

    return res.json({ message: savedMsg, aiReply: aiMsg });
  }

  res.json({ message: savedMsg, aiReply: null });
});

export default router;
