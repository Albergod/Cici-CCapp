/**
 * setup-test-pro.mjs — Prepara datos para probar el agente transaccional (0 tokens).
 *
 * Crea (o reutiliza) una tienda BELLEZA con servicios y horario, deja la tienda de
 * ropa lista para pedidos, y sube ambas a plan PRO con activatePaidPlan (sin
 * pasar por la pasarela de pagos). Escribe directo en la DB local.
 */
const base = process.env.API_BASE || "http://localhost:3000/api";

async function j(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const login = (email, password) => j("POST", "/auth/login", { email, password });

const SALON = {
  email: "salon@demo.test",
  password: "Demo1234",
  name: "Dueña del salón",
  store: {
    name: "Sala de Belleza Aura",
    description: "Salón de belleza con cortes, manicura y tratamientos faciales.",
    businessType: "BELLEZA",
    whatsapp: "3001112233",
    schedule: {
      openTime: "08:00",
      closeTime: "18:00",
      lunchStart: "13:00",
      lunchEnd: "14:00",
      workingDays: [1, 2, 3, 4, 5, 6],
      bookingHorizonDays: 14,
      timezone: "America/Bogota",
    },
  },
  services: [
    { name: "Corte de cabello dama", price: 45000, durationMinutes: 45 },
    { name: "Manicura premium", price: 38000, durationMinutes: 60 },
    { name: "Masaje relajante", price: 70000, durationMinutes: 60 },
  ],
};

const log = (...a) => console.log("  ", ...a);

/** Crea el dueño si no existe y devuelve su token + storeId. */
async function ensureOwner({ email, password, name, store }) {
  let token, storeId;
  try {
    const r = await j("POST", "/auth/register", { email, password, name, termsAccepted: true });
    token = r.token;
  } catch {
    const r = await login(email, password);
    token = r.token;
  }

  const mine = await j("GET", "/stores/mine", undefined, token).catch(() => null);
  if (mine?.id) {
    storeId = mine.id;
    log(`dueño ${email} ya tenía tienda "${mine.name}"`);
  } else {
    const s = await j("POST", "/stores", store, token);
    storeId = s.id ?? s.store?.id;
    log(`tienda creada: ${store.name} (${store.businessType})`);
  }
  return { token, storeId };
}

(async () => {
  console.log("→ Montando escenario para el agente transaccional");

  const salon = await ensureOwner(SALON);
  const srv = await j("GET", "/services", undefined, salon.token);
  if (!srv?.length) {
    for (const s of SALON.services) {
      await j("POST", "/services", s, salon.token);
      log(`servicio creado: ${s.name} ($${s.price}, ${s.durationMinutes} min)`);
    }
  } else {
    log(`el salón ya tenía ${srv.length} servicios`);
  }

  // Tienda de ropa (productos) para el flujo de pedido.
  const ropa = await login("owner@demo.test", "Demo1234");
  const ropaStore = await j("GET", "/stores/mine", undefined, ropa.token);

  console.log("→ Subiendo a PRO (activatePaidPlan, sin pasarela)");
  const { activatePaidPlan } = await import("../src/lib/plans.ts");
  for (const [label, id] of [
    ["salón BELLEZA (citas)", salon.storeId],
    ["moda-cielo (pedidos)", ropaStore.id],
  ]) {
    await activatePaidPlan(id, "PRO", "MONTHLY");
    log(`${label} → PRO`);
  }

  console.log("→ Listo");
  console.log(`   cliente:  shopper@demo.test / Demo1234`);
  console.log(`   salón:    ${salon.storeId} (BELLEZA, PRO, ${SALON.services.length} servicios)`);
  console.log(`   ropa:     ${ropaStore.id} (productos, PRO)`);
})().catch((e) => {
  console.error("fallo:", e.message);
  process.exit(1);
});