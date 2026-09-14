import "./lib/boot-env";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import path from "path";
import fs from "fs";

import authRoutes from "./routes/auth.routes";
import googleAuthRoutes from "./routes/auth-google.routes";
import storeRoutes from "./routes/store.routes";
import productRoutes from "./routes/product.routes";
import chatRoutes from "./routes/chat.routes";
import saleRoutes from "./routes/sale.routes";
import adminRoutes from "./routes/admin.routes";
import uploadRoutes from "./routes/upload.routes";
import paymentRoutes from "./routes/payments.routes";
import wompiRoutes from "./routes/wompi.routes";
import { attachChatWebSocket } from "./ws/chatServer";
import { globalLimiter } from "./middleware/rate-limit";
import { expireStoresAndReturnCount } from "./routes/store.routes";

export function createApp() {
  const app = express();

  // ── Trust proxy ──────────────────────────────────────────────────────────
  // Detrás de un reverse proxy (Railway/Render/Cloudflare), req.ip viene de
  // X-Forwarded-For. TRUST_PROXY=1 (o N saltos) hace que el rate-limit y las
  // URLs generadas usen la IP y el host reales del cliente.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set("trust proxy", trustProxy === "true" ? 1 : Number(trustProxy) || 1);
  }

  // ── Rate limiting global ──────────────────────────────────────────────────
  app.use(globalLimiter);

  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));

  // ── Archivos estáticos (términos, privacidad, etc.) ────────────────────────
  // Resolvemos rutas desde la ubicación real del código (__dirname) en vez de
  // process.cwd(), porque el cwd puede variar según el entorno (Alwaysdata).
  const appRoot = path.resolve(__dirname, "..");
  const publicDir = path.join(appRoot, "public");
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    console.log(`📄 Sirviendo archivos públicos desde ${publicDir}`);
  }

  const uploadsDir = path.join(appRoot, "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ── Rutas de autenticación (rate-limit por endpoint dentro del router) ───
  app.use("/api/auth", authRoutes);
  app.use("/api/auth", googleAuthRoutes);
  app.use("/api/stores", storeRoutes);
  app.use("/api", productRoutes);
  app.use("/api", chatRoutes);
  app.use("/api", saleRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/payments/wompi", wompiRoutes);

  const frontendDist = path.join(appRoot, "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || req.path.startsWith("/public/")) return next();
      res.sendFile(path.join(frontendDist, "index.html"));
    });
    console.log(`📦 Sirviendo frontend desde ${frontendDist}`);
  }

  // ── Error middleware: un fallo en cualquier ruta responde 500 (y no mata el server).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("❌ error en ruta:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}

// Seguro de vida: un "unhandled rejection" (p. ej. un FK de una sesión vieja)
// loguea pero NO tira abajo el servidor.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ unhandledRejection (no fatal):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ uncaughtException (no fatal):", err);
});

export const app = createApp();

// ── SERVER solo se inicia si este archivo es ejecutado directamente (no importado).
// Los tests importan app desde aquí o desde test-utils.ts y no levantan el server.
const isMainModule = process.argv[1] === __filename;
if (isMainModule) {
  const server = http.createServer(app);
  attachChatWebSocket(server);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🏬 CC Platform corriendo en http://localhost:${PORT}`);
    console.log(`   WebSocket de chat en ws://localhost:${PORT}/ws/chat`);
  });

  // ── Cron de expiración de planes ─────────────────────────────────────────
  // Baja automáticamente a FREE las tiendas cuyo plan (PRO/BUSINESS) venció.
  // Corremos en el arranque (limpia vencidas) y cada hora: idempotente y barato.
  async function runExpiryCheck() {
    try {
      const expired = await expireStoresAndReturnCount();
      if (expired > 0) {
        console.log(`⏳ ${expired} tienda(s) con plan vencido → FREE`);
      }
    } catch (err) {
      console.error("error en cron de expiración:", err);
    }
  }
  runExpiryCheck();
  setInterval(runExpiryCheck, 60 * 60 * 1000);
}

// Export default para compatibilidad con import default.
export default app;
