import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const planEnum = pgEnum("plan_type", ["FREE", "PRO", "BUSINESS"]);
export const cycleEnum = pgEnum("subscription_cycle", ["MONTHLY", "BI_MONTHLY"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stores = pgTable("stores", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  plan: planEnum("plan").default("FREE").notNull(),
  subscriptionCycle: cycleEnum("subscription_cycle"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  trialStartedAt: timestamp("trial_started_at").defaultNow().notNull(),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
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

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  product: one(products, { fields: [saleItems.productId], references: [products.id] }),
}));

export const paymentReportsRelations = relations(paymentReports, ({ one }) => ({
  store: one(stores, { fields: [paymentReports.storeId], references: [stores.id] }),
}));
