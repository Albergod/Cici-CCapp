import "./lib/boot-env";
// Express 4 no captura rechazos de handlers async (solo next(err)). Al importar
// este módulo se parchea el dispatch para que un error en cualquier ruta llegue
// al middleware de error (500) en vez de dejar la petición colgada.
import "express-async-errors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import http from "http";
import path from "path";
import fs from "fs";

import authRoutes from "./routes/auth.routes";
import googleAuthRoutes from "./routes/auth-google.routes";
import usersRoutes from "./routes/users.routes";
import devicesRoutes from "./routes/devices.routes";
import protectedRoutes from "./routes/protected.routes";
import storeRoutes from "./routes/store.routes";
import productRoutes from "./routes/product.routes";
import chatRoutes from "./routes/chat.routes";
import saleRoutes from "./routes/sale.routes";
import adminRoutes from "./routes/admin.routes";
import uploadRoutes from "./routes/upload.routes";
import paymentRoutes from "./routes/payments.routes";
import wompiRoutes from "./routes/wompi.routes";
import servicesRouter from "./routes/services.routes";
import appointmentsRouter from "./routes/appointments.routes";
import ordersRouter from "./routes/orders.routes";
import { attachChatWebSocket } from "./ws/chatServer";
import { globalLimiter } from "./middleware/rate-limit";
import { expireStoresAndReturnCount } from "./routes/store.routes";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db/client";
import { sql } from "drizzle-orm";
import { allowedCorsOrigins, enforceEnv, isProduction } from "./lib/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  // ── Cabeceras de seguridad ────────────────────────────────────────────────
  // CSP explícita para la SPA: solo scripts propios + Google Identity, fuentes
  // de Google Fonts, imágenes propias/Cloudinary y conexiones HTTPS/WSS.
  // HSTS y upgrade-insecure-requests solo en producción (en localhost forzar
  // HTTPS rompería el desarrollo).
  const prod = isProduction();
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "https://accounts.google.com"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": ["'self'", "https:", "wss:", "ws:"],
          "frame-src": ["https://accounts.google.com"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "upgrade-insecure-requests": prod ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: prod ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  // ── CORS por allowlist ────────────────────────────────────────────────────
  // Sin Origin (apps móviles, curl, same-origin) se permite. Un navegador con
  // Origin solo recibe cabeceras CORS si está en CORS_ORIGINS o PUBLIC_BASE_URL.
  const corsOrigins = allowedCorsOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        return callback(null, corsOrigins.includes(origin));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  );

  // ── Rate limiting global ──────────────────────────────────────────────────
  app.use(globalLimiter);

  app.use(express.json());
  app.use(morgan("dev"));
  // Compresión gzip para JSON y estáticos: el feed y los catálogos pesan mucho
  // menos por la red (~70-80% de ahorro).
  app.use(compression());

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
  app.use("/api/users", usersRoutes);
  app.use("/api/devices", devicesRoutes);
  app.use("/api/protected", protectedRoutes);
  app.use("/api/stores", storeRoutes);
  app.use("/api", productRoutes);
  app.use("/api", chatRoutes);
  app.use("/api", saleRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/payments/wompi", wompiRoutes);
  app.use("/api/services", servicesRouter);
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/orders", ordersRouter);

  const frontendDist = path.join(appRoot, "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));

    // ── SEO básico: robots + sitemap (tráfico gratis) ──
    app.get("/robots.txt", (_req, res) => {
      const host = _req.protocol + "://" + _req.get("host");
      res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml\n`);
    });

    app.get("/sitemap.xml", async (_req, res) => {
      try {
        const rows = await db.execute(sql`SELECT slug FROM stores ORDER BY created_at DESC LIMIT 5000`);
        const host = _req.protocol + "://" + _req.get("host");
        const urls = (rows.rows as { slug: string }[])
          .map((r) => `  <url><loc>${host}/store/${r.slug}</loc><changefreq>daily</changefreq></url>`)
          .join("\n");
        res.type("application/xml").send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${host}/</loc><changefreq>daily</changefreq></url>\n${urls}\n</urlset>`,
        );
      } catch {
        res.status(500).type("application/xml").send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`);
      }
    });

    // ── Open Graph por tienda: previews lindos en WhatsApp/Google ──
    // Como el frontend es SPA, inyectamos OG server-side al servir /store/:slug.
    app.get("/store/:slug", async (req, res, next) => {
      try {
        const indexPath = path.join(frontendDist, "index.html");
        if (!fs.existsSync(indexPath)) return next();
        const rows = await db.execute(
          sql`SELECT name, description, logo_url, banner_url FROM stores WHERE slug = ${req.params.slug} LIMIT 1`,
        );
        const row = (rows.rows as { name?: string; description?: string | null; logo_url?: string | null; banner_url?: string | null }[])[0];
        if (!row) {
          return res.sendFile(indexPath);
        }
        const host = req.protocol + "://" + req.get("host");
        const title = `${row.name} · CC Platform`;
        const desc = (row.description ?? "Descubre esta tienda en CC Platform: productos y contacto directo por chat.").slice(0, 200);
        const img = row.banner_url ?? row.logo_url ?? `${host}/logo.svg`;
        const url = `${host}/store/${req.params.slug}`;
        let html = fs.readFileSync(indexPath, "utf8");
        // Título dinámico
        html = html.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
        // Inyecta OG/Twitter antes de </head>
        const og = [
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="CC Platform" />`,
          `<meta property="og:title" content="${escapeHtml(title)}" />`,
          `<meta property="og:description" content="${escapeHtml(desc)}" />`,
          `<meta property="og:image" content="${escapeHtml(img)}" />`,
          `<meta property="og:url" content="${escapeHtml(url)}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
          `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
          `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
          `<meta name="description" content="${escapeHtml(desc)}" />`,
          `<link rel="canonical" href="${escapeHtml(url)}" />`,
        ].join("\n    ");
        html = html.replace("</head>", `    ${og}\n  </head>`);
        res.type("html").send(html);
      } catch {
        return next();
      }
    });

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
  // ── Migraciones al arranque ───────────────────────────────────────────────
  // La ÚNICA fuente de verdad del esquema es drizzle/schema.ts + drizzle/*.sql.
  // No hay sincronización manual paralela: si una base nació con `db:push` y no
  // tiene journal, se adopta una vez con `npm run db:baseline` o se resetea.
  async function runMigrations(): Promise<void> {
    const migrationsDir = path.join(path.resolve(__dirname, ".."), "drizzle");
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`No existe la carpeta de migraciones: ${migrationsDir}`);
    }
    console.log("🧬 Aplicando migraciones de la base de datos…");
    await migrate(db, { migrationsFolder: migrationsDir });
    console.log("🧬 Migraciones aplicadas correctamente.");
  }

  // La configuración crítica se valida ANTES de tocar la base o aceptar tráfico.
  try {
    enforceEnv();
  } catch (err) {
    console.error("❌ Configuración inválida:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const server = http.createServer(app);
  attachChatWebSocket(server);
  const PORT = process.env.PORT || 3000;

  runMigrations()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`🏬 CC Platform corriendo en http://localhost:${PORT}`);
        console.log(`   WebSocket de chat en ws://localhost:${PORT}/ws/chat`);
      });
    })
    .catch((err) => {
      // Fallo fatal: mejor morir que arrancar con un esquema desincronizado.
      console.error("❌ No se pudieron aplicar las migraciones:", err);
      process.exit(1);
    });

  // ── Cron de expiración de planes + liberación de pagos protegidos ──────
  // Baja automáticamente a FREE las tiendas cuyo plan (PRO/BUSINESS) venció
  // y libera lo retenido +48h. Idempotente y barato, cada hora.
  async function runExpiryCheck() {
    try {
      const expired = await expireStoresAndReturnCount();
      if (expired > 0) {
        console.log(`⏳ ${expired} tienda(s) con plan vencido → FREE`);
      }
    } catch (err) {
      console.error("error en cron de expiración:", err);
    }
    try {
      const { releaseDueProtected } = await import("./lib/protected");
      const released = await releaseDueProtected();
      if (released > 0) {
        console.log(`🔓 ${released} pago(s) protegido(s) liberados (+48h)`);
      }
    } catch (err) {
      console.error("error en cron de pagos protegidos:", err);
    }
  }
  runExpiryCheck();
  setInterval(runExpiryCheck, 60 * 60 * 1000);
}

// Export default para compatibilidad con import default.
export default app;
