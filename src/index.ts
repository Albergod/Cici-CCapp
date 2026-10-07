import "./lib/boot-env";
// Express 4 no captura rechazos de handlers async (solo next(err)). Al importar
// este módulo se parchea el dispatch para que un error en cualquier ruta llegue
// al middleware de error (500) en vez de dejar la petición colgada.
import "express-async-errors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import compression from "compression";
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
import servicesRouter from "./routes/services.routes";
import appointmentsRouter from "./routes/appointments.routes";
import ordersRouter from "./routes/orders.routes";
import { attachChatWebSocket } from "./ws/chatServer";
import { globalLimiter } from "./middleware/rate-limit";
import { expireStoresAndReturnCount } from "./routes/store.routes";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db/client";
import { sql } from "drizzle-orm";

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

  // ── Rate limiting global ──────────────────────────────────────────────────
  app.use(globalLimiter);

  app.use(cors());
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
  // Aplica el esquema nuevo de forma RESILIENTE, porque la DB de producción
  // puede haber nacido por "db:push" (sin journal de migraciones) o por
  // "drizzle-kit migrate" (con journal):
  //   1. Si existe journal → aplica migraciones pendientes (p. ej. 0004) y listo.
  //   2. Si no (o si el journal no aplica) → sincroniza el esquema esencial con
  //      ALTER idempotentes (ADD COLUMN IF NOT EXISTS), sin tumbar el arranque.
  // Así los deploys nunca revientan por esquema desincronizado.
  async function syncEssentialSchema(): Promise<void> {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'ACTIVE'`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_until timestamp`);
    // Trial manual: la prueba no arranca al crear la tienda, solo al activarla.
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used_at timestamp`);
    // La prueba no arranca al crear la tienda: trial_started_at debe aceptar NULL
    // (una tienda FREE recién creada no lo fija). En prod pudo quedar NOT NULL de
    // un esquema viejo creado con db:push → si no lo soltamos, INSERT falla.
    await db.execute(sql`ALTER TABLE stores ALTER COLUMN trial_started_at DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE stores ALTER COLUMN trial_started_at DROP DEFAULT`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS removed_at timestamp`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS removed_reason text`);
    await db.execute(sql`ALTER TABLE stores ADD COLUMN IF NOT EXISTS referral_rewarded boolean NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE stores ADD COLUMN IF NOT EXISTS prestige_goal integer NOT NULL DEFAULT 100`);
    await db.execute(sql`ALTER TABLE stores ADD COLUMN IF NOT EXISTS verified_at timestamp`);
    // ── Belleza / agenda ────────────────────────────────────────────────────
    // El enum no admite ADD VALUE ... IF NOT EXISTS en todas las versiones;
    // se agrega condicionalmente y fuera de transacción (db.execute por auto).
    try {
      await db.execute(sql`ALTER TYPE business_type ADD VALUE IF NOT EXISTS 'BELLEZA'`);
    } catch {
      const has = await db.execute(sql`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='business_type' AND e.enumlabel='BELLEZA'`);
      if (!has.rows.length) await db.execute(sql`ALTER TYPE business_type ADD VALUE 'BELLEZA'`);
    }
    await db.execute(sql`ALTER TABLE stores ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '{"openTime":"08:00","closeTime":"21:00","lunchStart":"12:00","lunchEnd":"13:00","workingDays":[1,2,3,4,5,6],"bookingHorizonDays":30,"timezone":"America/Bogota"}'::jsonb`);
    await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS asserted_service_id uuid`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS store_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      name text NOT NULL,
      description text,
      price numeric(10, 2) NOT NULL,
      duration_minutes integer NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      store_id uuid NOT NULL REFERENCES stores(id)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      appointment_date timestamp NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      status text DEFAULT 'confirmed' NOT NULL,
      note text,
      created_at timestamp DEFAULT now() NOT NULL,
      store_id uuid NOT NULL REFERENCES stores(id),
      service_id uuid NOT NULL REFERENCES store_services(id),
      customer_id uuid REFERENCES users(id),
      manual_customer_name text
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS appointments_store_date_unique
      ON appointments (store_id, appointment_date, start_time)
      WHERE status <> 'cancelled'`);
    // Citas manuales (modo manual de las tiendas FREE): el comerciante agenda
    // para un cliente sin cuenta, así que customer_id ya no es obligatorio.
    await db.execute(sql`ALTER TABLE appointments ALTER COLUMN customer_id DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS manual_customer_name text`);
    // ── Cita → venta ────────────────────────────────────────────────────────
    await db.execute(sql`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS service_id uuid`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sale_id uuid`);
    await db.execute(sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'`);
    // ── Pedidos del chat (Fase 2): venta automática de productos ────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      store_id uuid NOT NULL REFERENCES stores(id),
      customer_id uuid REFERENCES users(id),
      note text,
      sale_id uuid REFERENCES sales(id)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      order_id uuid NOT NULL REFERENCES orders(id),
      product_id uuid REFERENCES products(id),
      name text NOT NULL,
      unit_price numeric(10, 2) NOT NULL,
      quantity numeric(10, 0) NOT NULL
    )`);
    // ── Reseñas por tienda (prueba social): 1 por cliente y tienda (upsert).
    await db.execute(sql`CREATE TABLE IF NOT EXISTS store_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      store_id uuid NOT NULL REFERENCES stores(id),
      customer_id uuid NOT NULL REFERENCES users(id),
      rating integer NOT NULL,
      comment text,
      image_url text
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS store_reviews_customer_store_unique
      ON store_reviews (customer_id, store_id)`);
    // ── Ofertas estilo Shopee (v1): precio promo + fin de vigencia ──────────
    await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_price numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_ends_at timestamp`);
    // ── Recuperación de contraseña (tokens en DB, no en memoria) ───────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS password_resets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id),
      token_hash text NOT NULL,
      expires_at timestamp NOT NULL,
      used_at timestamp
    )`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_hash_unique
      ON password_resets (token_hash)`);
  }

  async function runMigrations(): Promise<void> {
    const migrationsDir = path.join(path.resolve(__dirname, ".."), "drizzle");
    if (fs.existsSync(migrationsDir)) {
      try {
        console.log("🧬 Aplicando migraciones de la base de datos…");
        await migrate(db, { migrationsFolder: migrationsDir });
        console.log("🧬 Migraciones aplicadas correctamente.");
        return;
      } catch (err) {
        // Quien creó la DB con db:push no tiene journal → "migrate" no aplica.
        // Se sigue con la sincronización idempotente (no es fatal).
        console.warn(
          "⚠️ Migración por journal no aplicable; sincronizando esquema esencial.",
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log("🧬 Sincronizando esquema esencial (idempotente)…");
    await syncEssentialSchema();
    console.log("🧬 Esquema sincronizado.");
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
