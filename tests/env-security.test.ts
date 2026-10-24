import { describe, it, expect } from "vitest";
import {
  allowedCorsOrigins,
  paymentEnvironmentError,
  validateEnv,
  wompiKeyMode,
} from "../src/lib/env";

const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example/cc",
  JWT_SECRET: "x".repeat(40),
  ADMIN_TOKEN: "y".repeat(24),
  PUBLIC_BASE_URL: "https://cici.example",
  CORS_ORIGINS: "https://cici.example,https://www.cici.example/",
  WOMPI_PUBLIC_KEY: "pub_prod_123",
  WOMPI_PRIVATE_KEY: "prv_prod_123",
  WOMPI_INTEGRITY_KEY: "prod_integrity_123",
  WOMPI_EVENTS_KEY: "prod_events_123",
};

describe("Configuración de seguridad", () => {
  it("clasifica las llaves de Wompi y bloquea sandbox en producción", () => {
    expect(wompiKeyMode({ WOMPI_PUBLIC_KEY: "pub_test_a" })).toBe("sandbox");
    expect(wompiKeyMode(prod)).toBe("production");

    const sandboxProd = {
      ...prod,
      WOMPI_PUBLIC_KEY: "pub_test_a",
      WOMPI_PRIVATE_KEY: "prv_test_b",
      WOMPI_INTEGRITY_KEY: "test_integrity_c",
      WOMPI_EVENTS_KEY: "test_events_d",
    };
    expect(paymentEnvironmentError(sandboxProd)).toMatch(/sandbox/i);
    expect(validateEnv(sandboxProd).errors.join(" ")).toMatch(/sandbox/i);

    const staging = { ...sandboxProd, ALLOW_SANDBOX_PAYMENTS: "true" };
    expect(paymentEnvironmentError(staging)).toBeNull();
    expect(validateEnv(staging).errors).toHaveLength(0);
  });

  it("en producción exige JWT_SECRET y ADMIN_TOKEN fuertes", () => {
    const weak = { ...prod, JWT_SECRET: "corto", ADMIN_TOKEN: "corto" };
    const errors = validateEnv(weak).errors.join(" ");
    expect(errors).toContain("JWT_SECRET");
    expect(errors).toContain("ADMIN_TOKEN");
  });

  it("CORS en producción es una allowlist explícita (sin localhost)", () => {
    const origins = allowedCorsOrigins(prod);
    expect(origins).toContain("https://cici.example");
    expect(origins).toContain("https://www.cici.example");
    expect(origins.some((origin) => origin.includes("localhost"))).toBe(false);
    expect(origins).not.toContain("https://evil.example");
  });

  it("en desarrollo mantiene los orígenes locales para Vite", () => {
    const origins = allowedCorsOrigins({ NODE_ENV: "development" });
    expect(origins).toContain("http://localhost:5173");
  });
});
