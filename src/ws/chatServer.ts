import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, messages, stores, products } from "../db/schema";
import { JWT_SECRET } from "../middleware/auth";
import { getIAStoreReply, buildInvoiceVersions } from "../lib/ai";

interface ClientInfo {
  ws: WebSocket;
  userId: string;
  conversationId: string;
}

// Todas las conexiones activas, agrupadas por conversación
const rooms = new Map<string, Set<ClientInfo>>();

function joinRoom(client: ClientInfo) {
  if (!rooms.has(client.conversationId)) rooms.set(client.conversationId, new Set());
  rooms.get(client.conversationId)!.add(client);
}

function leaveRoom(client: ClientInfo) {
  rooms.get(client.conversationId)?.delete(client);
}

function broadcast(conversationId: string, payload: unknown) {
  const clients = rooms.get(conversationId);
  if (!clients) return;
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

// Conexión: ws://host/ws/chat?token=JWT&conversationId=xxx
export function attachChatWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/chat" });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token");
    const conversationId = url.searchParams.get("conversationId");

    if (!token || !conversationId) {
      ws.close(4000, "Faltan token o conversationId");
      return;
    }

    let userId: string;
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      userId = payload.userId;
    } catch {
      ws.close(4001, "Token inválido");
      return;
    }

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      with: { store: true },
    });
    if (!conversation) {
      ws.close(4004, "Conversación no encontrada");
      return;
    }
    const isCustomer = conversation.customerId === userId;
    const isStoreOwner = conversation.store.ownerId === userId;
    if (!isCustomer && !isStoreOwner) {
      ws.close(4003, "No autorizado");
      return;
    }

    // El cliente solo puede conectarse si la tienda tiene el contacto activo
    // (prueba gratis vigente o suscripción de espacio). El dueño siempre accede.
    if (isCustomer) {
      const store = await db.select().from(stores).where(eq(stores.id, conversation.storeId)).limit(1);
      if (!store[0]) {
        ws.close(4004, "Conversación no encontrada");
        return;
      }
      const elig = { contactAvailable: true }; // contacto siempre disponible
      if (!elig.contactAvailable) {
        ws.close(4005, "Contacto no disponible: se requiere suscripción de espacio");
        return;
      }
    }

    const client: ClientInfo = { ws, userId, conversationId };
    joinRoom(client);

    ws.on("message", async (raw) => {
      try {
        const { content } = JSON.parse(raw.toString());
        if (!content || typeof content !== "string" || !content.trim()) return;

        // Insertar el mensaje del cliente
        const [message] = await db
          .insert(messages)
          .values({ conversationId, senderId: userId, content: content.trim() })
          .returning();

        broadcast(conversationId, { type: "message", message });

        // La IA solo actúa si el cliente llegó por una productCard (hay producto
        // asociado a la conversación). Si usó el botón "Contactar" general de la
        // tienda, el mensaje queda esperando la respuesta del vendedor humano.
        const isCustomerMsg = conversation.customerId === userId;
        const isPaidPlan = conversation.store.plan === "PRO" || conversation.store.plan === "BUSINESS";

        if (isCustomerMsg && isPaidPlan && conversation.assertedProductId) {
          // Traer los productos de la tienda
          const storeWithProducts = await db.query.stores.findFirst({
            where: eq(stores.id, conversation.storeId),
            with: { products: true },
          });

          if (storeWithProducts) {
            const storeInfo = {
              name: storeWithProducts.name,
              plan: storeWithProducts.plan as "PRO" | "BUSINESS",
              prestigeActive: true,
              whatsapp: storeWithProducts.whatsapp ?? null,
              needsSizes: (storeWithProducts.businessType as string || "OTRO") === "ROPA"
                || (storeWithProducts.businessType as string || "OTRO") === "CALZADO",
            };

            const storeProducts = (storeWithProducts.products || []).map((p) => ({
              name: p.name,
              price: Number(p.price),
              description: p.description ?? undefined,
              stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : null,
            }));

            const contextProduct = conversation.assertedProductId
              ? storeWithProducts.products?.find((p) => p.id === conversation.assertedProductId) ?? null
              : null;

            // Historial previo para que la IA recuerde datos ya aportados
            const history = await db
              .select({ content: messages.content })
              .from(messages)
              .where(eq(messages.conversationId, conversationId))
              .orderBy(asc(messages.createdAt));

            const aiReply = await getIAStoreReply({
              store: storeInfo,
              products: storeProducts,
              history,
              contextProduct,
            });

            // Si es una factura, separar versión chat (cliente) y WhatsApp (comerciante)
            const invoiceVersions = buildInvoiceVersions(aiReply);

            // Insertar el mensaje de la IA
            const [aiMsg] = await db
              .insert(messages)
              .values({
                conversationId,
                senderId: storeWithProducts.ownerId,
                content: invoiceVersions ? invoiceVersions.chat : aiReply,
                waText: invoiceVersions ? invoiceVersions.wa : null,
                aiGenerated: true,
              })
              .returning();

            broadcast(conversationId, { type: "message", message: aiMsg });
          }
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Payload inválido" }));
      }
    });

    ws.on("close", () => leaveRoom(client));
  });

  return wss;
}