import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { conversations, messages, stores } from "../db/schema";
import { JWT_SECRET } from "../middleware/auth";
import { getContactEligibility } from "../lib/subscription";

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
      const store = await db
        .select()
        .from(stores)
        .where(eq(stores.id, conversation.storeId))
        .limit(1);
      if (!store[0]) {
        ws.close(4004, "Conversación no encontrada");
        return;
      }
      const elig = getContactEligibility(
        store[0].trialStartedAt,
        store[0].subscriptionExpiresAt,
      );
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

        const [message] = await db
          .insert(messages)
          .values({ conversationId, senderId: userId, content: content.trim() })
          .returning();

        broadcast(conversationId, { type: "message", message });
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Payload inválido" }));
      }
    });

    ws.on("close", () => leaveRoom(client));
  });

  return wss;
}
