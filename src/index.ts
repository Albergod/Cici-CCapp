import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";

import authRoutes from "./routes/auth.routes";
import storeRoutes from "./routes/store.routes";
import productRoutes from "./routes/product.routes";
import chatRoutes from "./routes/chat.routes";
import saleRoutes from "./routes/sale.routes";
import { attachChatWebSocket } from "./ws/chatServer";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api", productRoutes); // /api/stores/:storeId/products, /api/products
app.use("/api", chatRoutes); // /api/stores/:storeId/conversation, /api/conversations
app.use("/api", saleRoutes); // /api/sales, /api/sales/stats

const server = http.createServer(app);
attachChatWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏬 CC Platform corriendo en http://localhost:${PORT}`);
  console.log(`   WebSocket de chat en ws://localhost:${PORT}/ws/chat`);
});
