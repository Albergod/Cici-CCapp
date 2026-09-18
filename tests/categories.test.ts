import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, stores, products } from "../src/db/schema";
import { sanitizeAttributes, fieldsFor, BusinessType } from "../src/lib/categoryFields";
import "dotenv/config";

let app: Express;
const ts = Date.now();

type Case = {
  type: BusinessType;
  input: Record<string, unknown>;
  expected: Record<string, string | number | boolean>;
};

// Atributos válidos por categoría + un campo "basura" que debe descartarse.
const CASES: Case[] = [
  {
    type: "ROPA",
    input: { talla: "M", color: "azul", material: "algodón", hack: "x" },
    expected: { talla: "M", color: "azul", material: "algodón" },
  },
  {
    type: "CALZADO",
    input: { numero: "42", color: "blanco", extra: 1 },
    expected: { numero: 42, color: "blanco" },
  },
  {
    type: "ACCESORIOS",
    input: { tipo: "Relojes", material: "acero", medida: "42mm", color: "dorado", x: "y" },
    expected: { tipo: "Relojes", material: "acero", medida: "42mm", color: "dorado" },
  },
  {
    type: "HOGAR",
    input: {
      tipoUnidad: "Apartamento",
      habitaciones: "2",
      banos: 1,
      areaM2: 60,
      amoblado: true,
      ubicacion: "El Prado",
      disponibleDesde: "marzo 2026",
      otra: "z",
    },
    expected: {
      tipoUnidad: "Apartamento",
      habitaciones: 2,
      banos: 1,
      areaM2: 60,
      amoblado: true,
      ubicacion: "El Prado",
      disponibleDesde: "marzo 2026",
    },
  },
  {
    type: "ALIMENTOS",
    input: { porcion: "Docena", restricciones: "gluten", x: 1 },
    expected: { porcion: "Docena", restricciones: "gluten" },
  },
  {
    type: "SERVICIOS",
    input: { duracion: "1 hora", modalidad: "Virtual", x: 1 },
    expected: { duracion: "1 hora", modalidad: "Virtual" },
  },
  // BELLEZA y OTRO no definen campos de producto → se descarta todo.
  { type: "BELLEZA", input: { foo: "bar", talla: "M" }, expected: {} },
  { type: "OTRO", input: { foo: "bar" }, expected: {} },
];

async function registerUser(email: string) {
  await request(app).post("/api/auth/register").send({
    email,
    password: "demo123456",
    name: "Cat User",
    termsAccepted: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email, password: "demo123456" });
  return login.body.token as string;
}

describe("Categorías: campos dinámicos por tipo de negocio", () => {
  const emails = CASES.map((c) => `cat-${c.type.toLowerCase()}-${ts}@example.com`);

  beforeAll(async () => {
    const mod = await import("../src/index");
    app = (mod as unknown as { default: Express }).default || (mod as unknown as Express);
  });

  afterAll(async () => {
    for (const email of emails) {
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .innerJoin(users, eq(stores.ownerId, users.id))
        .where(eq(users.email, email))
        .limit(1);
      if (store) {
        const prods = await db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.storeId, store.id));
        if (prods.length) {
          await db.delete(products).where(inArray(products.id, prods.map((p) => p.id)));
        }
        await db.delete(stores).where(eq(stores.id, store.id));
      }
      await db.delete(users).where(eq(users.email, email));
    }
  });

  it("todas las categorías tienen su definición de campos", () => {
    for (const c of CASES) {
      expect(fieldsFor(c.type)).toBeDefined();
      // BELLEZA/OTRO no exponen campos de producto; el resto sí.
      if (c.type === "BELLEZA" || c.type === "OTRO") {
        expect(fieldsFor(c.type)).toHaveLength(0);
      } else {
        expect(fieldsFor(c.type).length).toBeGreaterThan(0);
      }
    }
  });

  it("sanitizeAttributes descarta basura y coacciona tipos en cada categoría", () => {
    for (const c of CASES) {
      expect(sanitizeAttributes(c.type, c.input)).toEqual(c.expected);
    }
  });

  for (const c of CASES) {
    it(`API: crea tienda y producto ${c.type} con atributos válidos`, async () => {
      const email = `cat-${c.type.toLowerCase()}-${ts}@example.com`;
      const token = await registerUser(email);

      const storeRes = await request(app)
        .post("/api/stores")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `Cat ${c.type} ${ts}`, description: "Test", businessType: c.type });
      expect(storeRes.status).toBe(201);
      expect(storeRes.body.businessType).toBe(c.type);

      const prodRes = await request(app)
        .post(`/api/stores/${storeRes.body.id}/products`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `Producto ${c.type}`, price: 10000, stock: 5, attributes: c.input });
      expect(prodRes.status).toBe(201);
      expect(prodRes.body.attributes).toEqual(c.expected);
    });
  }
});
