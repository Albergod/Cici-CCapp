import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const planEnum = pgEnum("plan_type", ["FREE", "PRO", "BUSINESS"]);
export const cycleEnum = pgEnum("subscription_cycle", ["MONTHLY", "BI_MONTHLY"]);
// Estado de sanción de una tienda:
//   ACTIVE    - operativa en el centro comercial
//   SUSPENDED - penalizada temporalmente (suspension_ends_at). Se oculta del
//               catálogo y se bloquea chat/ventas hasta que expire.
//   BANNED    - expulsada de la plataforma (solo la revisa el admin).
export const storeStatusEnum = pgEnum("store_status", [
  "ACTIVE",
  "SUSPENDED",
  "BANNED",
]);
// Tipo de negocio: define si los productos de la tienda requieren talla
// (Ropa y Calzado sí; el resto, no).
export const businessTypeEnum = pgEnum("business_type", [
  "ROPA",
  "CALZADO",
  "ACCESORIOS",
  "HOGAR",
  "ALIMENTOS",
  "SERVICIOS",
  "OTRO",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  refCode: text("ref_code"), // código de referido que trajo a este usuario
  signupIp: text("signup_ip"), // IP del registro (detección de cuentas granja)
  // Aceptación de los Términos y Condiciones (obligatoria al registrarse).
  termsAcceptedAt: timestamp("terms_accepted_at"),
  // Estado de moderación del usuario por conducta en el chat:
  //   ACTIVE - puede usar el chat con normalidad
  //   MUTED  - no puede enviar mensajes hasta moderation_until
  //   SUSPENDED - suspendido temporalmente (hasta moderation_until)
  //   BANNED - expulsado de la plataforma (permanente)
  moderationStatus: text("moderation_status").notNull().default("ACTIVE"),
  moderationUntil: timestamp("moderation_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stores = pgTable("stores", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  whatsapp: text("whatsapp"),
  plan: planEnum("plan").default("FREE").notNull(),
  businessType: businessTypeEnum("business_type").default("OTRO").notNull(),
  subscriptionCycle: cycleEnum("subscription_cycle"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  trialStartedAt: timestamp("trial_started_at").defaultNow().notNull(),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  prestigePoints: numeric("prestige_points", { precision: 10, scale: 0 }).default("0").notNull(),
  referralCode: text("referral_code").unique(),
  referredByStoreId: uuid("referred_by_store_id"),
  // Meta de prestigio del comerciante: base 100 y sube +100 cada vez que
  // ACTIVA/RENUEVA/MEJORA SU propio plan (tope PRESTIGE_GOAL_MAX). No son
  // puntos: es el objetivo que debe alcanzar para obtener el check.
  prestigeGoal: integer("prestige_goal").default(100).notNull(),
  // Check de verificado concedido: una vez alcanzado no se pierde nunca
  // ("sticky"). Se otorga en el primer cálculo en el que cumple el criterio.
  verifiedAt: timestamp("verified_at"),
  // El premio de referido (PRESTIGE_PER_REFERRAL) se otorga UNA vez por
  // referido: solo cuando su tienda activa un plan de pago (no al crearla
  // FREE). Esta bandera evita doble premio si el plan se renueva o reactiva.
  referralRewarded: boolean("referral_rewarded").default(false).notNull(),
  // Sanciones (anti-fraude). Status público = ACTIVE; SUSPENDED/BANNED se
  // ocultan del catálogo y bloquean chat/ventas hasta resolverse.
  status: storeStatusEnum("status").default("ACTIVE").notNull(),
  suspensionEndsAt: timestamp("suspension_ends_at"),
  sanctionsCount: integer("sanctions_count").default(0).notNull(),
  banReason: text("ban_reason"),
});

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
  },
  (t) => ({
    storeNameUnique: uniqueIndex("categories_store_name_unique").on(t.storeId, t.name),
  }),
);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  available: boolean("available").default(true).notNull(),
  views: numeric("views", { precision: 10, scale: 0 }).default("0").notNull(),
  stock: numeric("stock", { precision: 10, scale: 0 }).default("0").notNull(),
  // Campos de la categoría de la tienda (talla, habitaciones, porción, etc.).
  // Son un JSON libre: cada tipo de negocio define los suyos (src/lib/categoryFields.ts).
  attributes: jsonb("attributes")
    .$type<Record<string, string | number | boolean>>()
    .default({})
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  categoryId: uuid("category_id").references(() => categories.id),
});

export const follows = pgTable(
  "follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
  },
  (t) => ({
    userStoreUnique: uniqueIndex("follows_user_store_unique").on(t.userId, t.storeId),
  }),
);

// Chat contextual: una conversación = 1 cliente + 1 tienda (no un chat global)
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    assertedProductId: uuid("asserted_product_id").references(() => products.id),
    // Última vez que cada participante abrió/vio la conversación. Permite
    // calcular mensajes no leídos por rol sin guardar estado por mensaje.
    customerLastReadAt: timestamp("customer_last_read_at"),
    storeOwnerLastReadAt: timestamp("store_owner_last_read_at"),
    // Carrito del cliente dentro de este chat: la IA conoce cada producto
    // seleccionado (id + cantidad + opciones como talla/color) desde que se abre
    // la conversación.
    cartItems: jsonb("cart_items").$type<{
      productId: string;
      quantity: number;
      options?: { size?: string; color?: string };
    }[]>(),
  },
  (t) => ({
    customerStoreUnique: uniqueIndex("conversations_customer_store_unique").on(
      t.customerId,
      t.storeId,
    ),
  }),
);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id),
  aiGenerated: boolean("ai_generated").default(false),
  // Versión del mensaje destinada al WhatsApp del comerciante (cuando la
  // respuesta IA contiene una factura, difiere en el aviso de cierre).
  waText: text("wa_text"),
  // Moderación: si la IA retira el mensaje tras publicarse, se marca aquí y el
  // frontend lo muestra reemplazado por el aviso estándar.
  removedAt: timestamp("removed_at"),
  removedReason: text("removed_reason"),
});

// Registro de ventas del comercio: una venta puede omitir cliente o producto
export const sales = pgTable("sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  soldAt: timestamp("sold_at").defaultNow().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  customerId: uuid("customer_id").references(() => users.id),
  // Método con el que el cliente pagó. Solo las ventas pagadas por un medio
  // rastreable (MP/WOMPI/CARD) son "ventas reales" para el check verificado;
  // las de efectivo/transferencia por fuera no inflan reputación.
  paymentMethod: text("payment_method"),
});

// Registro de faltas y sanciones (anti-fraude). El panel de super admin las
// revisa y resuelve; los flujos automáticos (chat, referidos, reportes)
// insertan violaciones y aplican sanciones escalonadas sobre la tienda.
export const violations = pgTable("violations", {
  id: uuid("id").defaultRandom().primaryKey(),
  // referral_farm | buyer_report | off_platform_chat | inflated_sale | admin_action
  type: text("type").notNull(),
  // info | warning | suspension | ban
  severity: text("severity").notNull().default("info"),
  status: text("status").notNull().default("OPEN"), // OPEN | RESOLVED
  storeId: uuid("store_id").references(() => stores.id),
  userId: uuid("user_id").references(() => users.id),
  reporterId: uuid("reporter_id").references(() => users.id),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  actionTaken: text("action_taken"),
  resolvedNote: text("resolved_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const saleItems = pgTable("sale_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => sales.id),
  productId: uuid("product_id").references(() => products.id),
});

// Pagos procesados por Mercado Pago (Checkout Pro). El único camino válido
// para pasar a PRO/BUSINESS: el plan se activa SOLO cuando la app confirma que
// el pago fue aprobado (webhook + verificación del id de pago vs Mercado Pago).
export const mpPayments = pgTable(
  "mp_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mpPaymentId: text("mp_payment_id").notNull(), // id del pago en Mercado Pago
    status: text("status").notNull(), // approved | pending | rejected | ...
    plan: planEnum("plan").notNull(),
    cycle: cycleEnum("cycle").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
    // storeId puede ser nulo: el comerciante puede pagar antes de crear su
    // tienda. En ese caso el pago queda asociado al usuario (userId) y el plan
    // se activa cuando el comerciante cree su tienda (routes/store.routes.ts).
    storeId: uuid("store_id").references(() => stores.id),
    userId: uuid("user_id").references(() => users.id),
  },
  (t) => ({
    mpPaymentUnique: uniqueIndex("mp_payments_mp_payment_id_unique").on(t.mpPaymentId),
  }),
);

// Registro de pagos reportados por el comerciante para validar su espacio Premium
export const paymentReports = pgTable("payment_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(), // código de referencia del pago (9 dígitos)
  plan: planEnum("plan").notNull(),
  cycle: cycleEnum("cycle"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
});

// --- Relaciones (habilitan db.query.X.findMany({ with: {...} })) ---

export const usersRelations = relations(users, ({ many }) => ({
  stores: many(stores),
  follows: many(follows),
  conversations: many(conversations),
  messages: many(messages),
}));

export const storesRelations = relations(stores, ({ one, many }) => ({
  owner: one(users, { fields: [stores.ownerId], references: [users.id] }),
  products: many(products),
  categories: many(categories),
  followers: many(follows),
  conversations: many(conversations),
  sales: many(sales),
  paymentReports: many(paymentReports),
  mpPayments: many(mpPayments),
  violations: many(violations),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  store: one(stores, { fields: [categories.storeId], references: [stores.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  saleItems: many(saleItems),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  user: one(users, { fields: [follows.userId], references: [users.id] }),
  store: one(stores, { fields: [follows.storeId], references: [stores.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  customer: one(users, { fields: [conversations.customerId], references: [users.id] }),
  store: one(stores, { fields: [conversations.storeId], references: [stores.id] }),
  assertedProduct: one(products, {
    fields: [conversations.assertedProductId],
    references: [products.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export const salesRelations = relations(sales, ({ one, many }) => ({
  store: one(stores, { fields: [sales.storeId], references: [stores.id] }),
  customer: one(users, { fields: [sales.customerId], references: [users.id] }),
  items: many(saleItems),
}));

export const violationsRelations = relations(violations, ({ one }) => ({
  store: one(stores, { fields: [violations.storeId], references: [stores.id] }),
  user: one(users, { fields: [violations.userId], references: [users.id] }),
  reporter: one(users, { fields: [violations.reporterId], references: [users.id] }),
}));

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  product: one(products, { fields: [saleItems.productId], references: [products.id] }),
}));

export const paymentReportsRelations = relations(paymentReports, ({ one }) => ({
  store: one(stores, { fields: [paymentReports.storeId], references: [stores.id] }),
}));

export const mpPaymentsRelations = relations(mpPayments, ({ one }) => ({
  store: one(stores, { fields: [mpPayments.storeId], references: [stores.id] }),
}));
