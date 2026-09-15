import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, messages, stores, products, users } from "../db/schema";
import { JWT_SECRET } from "../middleware/auth";
import { getIAStoreReply, buildInvoiceVersions } from "../lib/ai";
import {
  storeOperational,
  refreshStoreStatus,
  userBlockState,
  refreshUserModeration,
  gateIncomingMessage,
  retractIfFlaggedByAI,
} from "../lib/moderation";

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

    // Anti-fraude: no se abre el canal de chat de una tienda suspendida/banneada.
    if (!storeOperational(conversation.store)) {
      ws.close(4006, "Tienda temporalmente no disponible");
      return;
    }

    // Moderación: si el usuario tiene sanciones vigentes (mute/suspensión) o
    // fue expulsado (ban), no puede usar el chat hasta que expiren.
    const [modUser] = await db
      .select({ id: users.id, name: users.name, moderationStatus: users.moderationStatus, moderationUntil: users.moderationUntil })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (modUser) await refreshUserModeration(userId);
    const modState = userBlockState(modUser ?? { id: userId });
    if (modState.blocked) {
      const restante =
        modState.status === "BANNED"
          ? "Tu cuenta fue expulsada por violar las normas de conducta del chat."
          : modState.status === "MUTED"
            ? `Tu chat está silenciado hasta el ${new Date(String(modState.until)).toLocaleString("es-CO")}.`
            : `Tu cuenta está suspendida hasta el ${new Date(String(modState.until)).toLocaleString("es-CO")}.`;
      ws.send(JSON.stringify({ type: "moderation_blocked", accountStatus: modState.status, until: modState.until, message: restante }));
      ws.close(4007, "Cuenta con sanción de moderación activa");
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

        // Re-chequear el estado de la tienda (una sanción pudo activarse en
        // medio de la conversación) antes de guardar el mensaje.
        const [freshStore] = await db
          .select({ id: stores.id, status: stores.status, suspensionEndsAt: stores.suspensionEndsAt })
          .from(stores)
          .where(eq(stores.id, conversation.storeId))
          .limit(1);
        if (freshStore) {
          await refreshStoreStatus(freshStore);
          if (!storeOperational(freshStore)) {
            ws.send(JSON.stringify({
              type: "chat_suspended",
              message: "El chat de esta tienda está suspendido temporalmente. No se envió el mensaje.",
            }));
            return;
          }
        }

        // Moderación del mensaje: bloqueo instantáneo por lista (groserías /
        // contenido prohibido) y por cuenta sancionada.
        const gate = await gateIncomingMessage({
          userId,
          content: content.trim(),
          senderName: modUser?.name,
          senderIsMerchant: isStoreOwner,
        });
        if (gate.status === "blocked_by_state") {
          const messageText =
            gate.accountStatus === "BANNED"
              ? "Tu cuenta fue expulsada por violar las normas de conducta del chat."
              : gate.accountStatus === "MUTED"
                ? `Tu chat está silenciado hasta el ${new Date(String(gate.until)).toLocaleString("es-CO")}. No se envió el mensaje.`
                : `Tu cuenta está suspendida hasta el ${new Date(String(gate.until)).toLocaleString("es-CO")}. No se envió el mensaje.`;
          ws.send(JSON.stringify({ type: "moderation_blocked", accountStatus: gate.accountStatus, until: gate.until, message: messageText }));
          return;
        }
        if (gate.status === "blocked") {
          ws.send(JSON.stringify({
            type: "message_blocked",
            action: gate.action,
            until: gate.until ?? null,
            reason: gate.reason,
          }));
          return;
        }

        // Insertar el mensaje del cliente
        const [message] = await db
          .insert(messages)
          .values({ conversationId, senderId: userId, content: content.trim() })
          .returning();

        broadcast(conversationId, { type: "message", message });

        // Revisión en segundo plano con IA: si detecta abuso (acoso, sarcasmo
        // ofensivo, presión), retira el mensaje publicado y aplica la escalera.
        void retractIfFlaggedByAI({
          userId,
          senderName: modUser?.name,
          senderIsMerchant: isStoreOwner,
          messageId: message.id,
          content: content.trim(),
          onRetracted: (reason) => {
            broadcast(conversationId, { type: "message_retracted", messageId: message.id, reason });
          },
        });

        // Modelo de ventas A: el cierre se hace por el WhatsApp del comerciante
        // (flujo normal). No se sanciona mencionarlo; solo se bloquea si la
        // tienda está suspendida/baneada por reportes o ventas infladas.

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