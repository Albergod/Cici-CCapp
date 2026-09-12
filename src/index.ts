import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.routes";
import googleAuthRoutes from "./routes/auth-google.routes";
import storeRoutes from "./routes/store.routes";
import productRoutes from "./routes/product.routes";
import chatRoutes from "./routes/chat.routes";
import saleRoutes from "./routes/sale.routes";
import uploadRoutes from "./routes/upload.routes";
import paymentRoutes from "./routes/payments.routes";
import { attachChatWebSocket } from "./ws/chatServer";
import { globalLimiter, authLimiter } from "./middleware/rate-limit";

export function createApp() {
  const app = express();

  // ── Rate limiting global ──────────────────────────────────────────────────
  app.use(globalLimiter);

  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));

  // ── Archivos estáticos (términos, privacidad, etc.) ────────────────────────
  const publicDir = path.join(process.cwd(), "public");
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    console.log(`📄 Sirviendo archivos públicos desde ${publicDir}`);
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ── Rutas de autenticación (rate-limit más estricto) ──────────────────────
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/auth", googleAuthRoutes);
  app.use("/api/stores", storeRoutes);
  app.use("/api", productRoutes);
  app.use("/api", chatRoutes);
  app.use("/api", saleRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/payments", paymentRoutes);

  const frontendDist = path.join(process.cwd(), "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || req.path.startsWith("/public/")) return next();
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    console.log(`📦 Sirviendo frontend desde ${frontendDist}`);
  }

  return app;
}

export const app = createApp();

// ── SERVER solo se inicia si este archivo es ejecutado directamente (no importado).
// Los tests importan app desde aquí o desde test-utils.ts y no levantan el server.
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const server = http.createServer(app);
  attachChatWebSocket(server);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🏬 CC Platform corriendo en http://localhost:${PORT}`);
    console.log(`   WebSocket de chat en ws://localhost:${PORT}/ws/chat`);
  });
}

// Export default para compatibilidad con import default.
export default app;
