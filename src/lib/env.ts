// Validación de configuración de entorno.
//
// El objetivo es fallar ANTES de aceptar tráfico cuando una configuración
// insegura o incompleta podría cobrar dinero real, exponer sesiones o dejar la
// base de datos sin migrar. En desarrollo/test solo se emiten advertencias para
// no bloquear el trabajo local.

export type EnvLike = Record<string, string | undefined>;

export interface EnvValidation {
  errors: string[];
  warnings: string[];
}

export function isProduction(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === "production";
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Orígenes permitidos para CORS. En producción es una allowlist explícita. */
export function allowedCorsOrigins(env: EnvLike = process.env): string[] {
  const origins = new Set<string>();

  for (const raw of (env.CORS_ORIGINS ?? "").split(",")) {
    const origin = raw.trim().replace(/\/+$/, "");
    if (origin) origins.add(origin);
  }

  // La URL pública de la app siempre es un origen legítimo (webhooks,
  // frontend servido por el mismo backend y enlaces absolutos).
  if (hasValue(env.PUBLIC_BASE_URL)) {
    try {
      origins.add(new URL(env.PUBLIC_BASE_URL!.trim()).origin);
    } catch {
      // Se reporta como error de configuración en validateEnv().
    }
  }

  // En desarrollo se mantiene la comodidad de Vite y del backend local.
  if (!isProduction(env)) {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://localhost:3002");
    origins.add("http://127.0.0.1:3002");
  }

  return [...origins];
}

export type WompiKeyMode = "missing" | "sandbox" | "production" | "mixed";

/** Clasifica el juego de llaves de Wompi para impedir sandbox en producción. */
export function wompiKeyMode(env: EnvLike = process.env): WompiKeyMode {
  const keys = [
    env.WOMPI_PUBLIC_KEY,
    env.WOMPI_PRIVATE_KEY,
    env.WOMPI_INTEGRITY_KEY,
    env.WOMPI_EVENTS_KEY,
  ].filter(hasValue) as string[];

  if (keys.length === 0) return "missing";

  const hasSandbox = keys.some((key) => key.includes("_test_"));
  const hasProduction = keys.some((key) => key.includes("_prod_"));
  if (hasSandbox && hasProduction) return "mixed";
  if (hasSandbox) return "sandbox";
  if (hasProduction) return "production";
  // Llaves presentes pero sin prefijo reconocible: no se puede garantizar el
  // entorno, así que se trata como configuración insegura.
  return "mixed";
}

/**
 * Devuelve un mensaje si este proceso NO debe crear cobros, o null si puede.
 * Se usa como segunda barrera en los endpoints de pago (la primera es
 * enforceEnv al arrancar): un staging con llaves _test_ y NODE_ENV=production
 * nunca debe cobrar como si fuera real.
 */
export function paymentEnvironmentError(env: EnvLike = process.env): string | null {
  if (!isProduction(env)) return null;
  const mode = wompiKeyMode(env);
  if (mode === "sandbox" && env.ALLOW_SANDBOX_PAYMENTS !== "true") {
    return "Pagos bloqueados: Wompi está en sandbox (_test_) y NODE_ENV=production. Usa llaves _prod_ o ALLOW_SANDBOX_PAYMENTS=true solo en staging.";
  }
  if (mode === "mixed") {
    return "Pagos bloqueados: las llaves de Wompi mezclan sandbox y producción o están incompletas.";
  }
  return null;
}

/**
 * Guarda de seguridad de pagos. Un despliegue de producción NUNCA debe cobrar
 * con llaves de sandbox: las transacciones se aprobarían sin mover dinero real
 * y la operación quedaría descuadrada. `ALLOW_SANDBOX_PAYMENTS=true` existe
 * solo para un entorno de staging explícito y debe quedar documentado.
 */
export function validatePaymentEnvironment(env: EnvLike = process.env): EnvValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isProduction(env)) {
    if (wompiKeyMode(env) === "sandbox") {
      warnings.push("Wompi está en sandbox (llaves _test_). No cobra dinero real.");
    }
    return { errors, warnings };
  }

  const mode = wompiKeyMode(env);
  const allowSandbox = env.ALLOW_SANDBOX_PAYMENTS === "true";

  if (mode === "sandbox" && !allowSandbox) {
    errors.push(
      "Wompi tiene llaves de sandbox (_test_) en producción. Usa llaves _prod_ o define ALLOW_SANDBOX_PAYMENTS=true solo para staging.",
    );
  }
  if (mode === "mixed") {
    errors.push(
      "Las llaves de Wompi están incompletas o mezclan sandbox/producción. Configura el juego completo del mismo entorno.",
    );
  }
  if (mode === "missing") {
    warnings.push("Wompi no está configurado: el pago protegido y los planes por Nequi quedan deshabilitados.");
  }
  if (mode !== "missing" && !hasValue(env.WOMPI_EVENTS_KEY)) {
    warnings.push("Wompi no tiene WOMPI_EVENTS_KEY: los webhooks no podrán validar la firma.");
  }
  if (mode !== "missing" && !hasValue(env.PUBLIC_BASE_URL)) {
    errors.push("PUBLIC_BASE_URL es obligatorio en producción cuando Wompi está activo (webhooks).");
  }

  return { errors, warnings };
}

/** Validación general de arranque para producción. */
export function validateEnv(env: EnvLike = process.env): EnvValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasValue(env.DATABASE_URL)) {
    errors.push("DATABASE_URL es obligatorio.");
  }

  if (isProduction(env)) {
    if (!hasValue(env.JWT_SECRET) || (env.JWT_SECRET?.trim().length ?? 0) < 32) {
      errors.push("JWT_SECRET debe existir y tener al menos 32 caracteres en producción.");
    }
    if (!hasValue(env.ADMIN_TOKEN) || (env.ADMIN_TOKEN?.trim().length ?? 0) < 16) {
      errors.push("ADMIN_TOKEN debe existir y tener al menos 16 caracteres en producción.");
    }
    if (hasValue(env.PUBLIC_BASE_URL)) {
      try {
        const url = new URL(env.PUBLIC_BASE_URL!.trim());
        if (url.protocol !== "https:") {
          errors.push("PUBLIC_BASE_URL debe usar https en producción.");
        }
      } catch {
        errors.push("PUBLIC_BASE_URL no es una URL válida.");
      }
    } else {
      warnings.push("PUBLIC_BASE_URL no está definida: los enlaces absolutos y webhooks usarán el host de la petición.");
    }
    if (!hasValue(env.TRUST_PROXY)) {
      warnings.push("TRUST_PROXY no está definido: el rate-limit puede ver la IP del proxy, no la del cliente.");
    }
    if (!hasValue(env.CORS_ORIGINS) && !hasValue(env.PUBLIC_BASE_URL)) {
      warnings.push("CORS_ORIGINS no está definido: solo se permitirá el mismo origen.");
    }
  }

  const payments = validatePaymentEnvironment(env);
  errors.push(...payments.errors);
  warnings.push(...payments.warnings);

  return { errors, warnings };
}

/**
 * Aplica la validación al arranque real del servidor. En producción lanza para
 * abortar el deploy; en desarrollo/test solo imprime advertencias.
 */
export function enforceEnv(env: EnvLike = process.env): void {
  const { errors, warnings } = validateEnv(env);
  for (const warning of warnings) console.warn(`⚠️ config: ${warning}`);
  if (errors.length > 0) {
    const message = errors.map((e) => `- ${e}`).join("\n");
    if (isProduction(env)) {
      throw new Error(`Configuración de producción inválida:\n${message}`);
    }
    console.warn(`⚠️ configuración incompleta (no fatal fuera de producción):\n${message}`);
  }
}
