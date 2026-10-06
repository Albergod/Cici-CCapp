/**
 * probe-remote.mjs — Prueba los flujos transaccionales contra el backend remoto.
 * No puede leer el log [ai-tokens], así que infiere si el agente determinístico
 * está activo por LATENCIA y por el formato exacto de la respuesta.
 *
 *   API_BASE=https://cici-r511.onrender.com/api npx tsx probe-remote.mjs
 */
const base = process.env.API_BASE || "http://localhost:3000/api";
const EMAIL = process.env.PROBE_EMAIL || "smoke.1791174137@cici.app";
const PASSWORD = process.env.PROBE_PASSWORD || "Smoke1234";

async function raw(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

/** Igual que raw(), pero además mide la latencia en _ms. */
async function j(method, url, body, token) {
  const t0 = Date.now();
  const data = await raw(method, url, body, token);
  return Object.assign(Array.isArray(data) ? [] : {}, data, { _ms: Date.now() - t0 });
}
const login = (email, password) => raw("POST", "/auth/login", { email, password });

const { token } = await login(EMAIL, PASSWORD);
console.log(`sesión ok (${EMAIL})\n`);

/** Textos que SOLO emite el agente determinístico (src/lib/agent/plan.ts). */
const DET = {
  appt: /⭐\s*Cita reservada/,
  offer: /está disponible:\s*.+\. ¿Cuál te queda mejor\?/,
  order: /🛍️\s*Pedido anotado/,
};
const isAgent = (t) => DET.appt.test(t) || DET.offer.test(t) || DET.order.test(t);

async function probe(label, storeSlug, ctx, productId, serviceId, content) {
  const { id: storeId } = await raw("GET", `/stores/${storeSlug}`);
  // Ojo: el backend valida con `if (productId !== undefined)`, así que mandar
  // null explícito lo rechaza con 400. Solo se envía lo que está presente.
  const payload = {};
  if (productId) payload.productId = productId;
  if (serviceId) payload.serviceId = serviceId;
  const conv = await raw("POST", `/stores/${storeId}/conversation`, payload, token);
  const r = await j("POST", `/conversations/${conv.id}/messages`, { content }, token);
  const txt = r.aiReply?.content ?? "—";
  const first = txt.split("\n").find((l) => l.trim()) ?? "";
  console.log(`${label}`);
  console.log(`   "${content}"`);
  console.log(`   ${r._ms} ms   ${isAgent(txt) ? "AGENTE (0 tokens)" : "Groq"}`);
  console.log(`   ${first.slice(0, 110)}`);
  console.log(`   appointmentId=${r.appointmentId ?? "—"}  orderId=${r.orderId ?? "—"}`);
  return r;
}

/** Agenda en 2 pasos: pide franjas y reserva una real de las ofrecidas. */
async function probeBooking(beauty, svc) {
  const { id: storeId } = await raw("GET", `/stores/${beauty.slug}`);
  const conv = await raw("POST", `/stores/${storeId}/conversation`, { serviceId: svc.id }, token);

  const r1 = await j("POST", `/conversations/${conv.id}/messages`,
    { content: `quiero ${svc.name} mañana` }, token);
  const t1 = r1.aiReply?.content ?? "";
  console.log(`CITA paso 1 [${beauty.name}]`);
  console.log(`   "quiero ${svc.name} mañana"`);
  console.log(`   ${r1._ms} ms   ${isAgent(t1) ? "AGENTE (0 tokens)" : "Groq"}`);
  console.log(`   ${t1.split("\n")[0].slice(0, 110)}`);

  // Se saca la primera hora real ofrecida para no adivinar.
  const slot = t1.match(/\d{2}:\d{2}/)?.[0];
  if (!slot) {
    console.log("   (el agente no ofreció franjas)");
    return r1;
  }
  const r2 = await j("POST", `/conversations/${conv.id}/messages`,
    { content: `reserva mañana a las ${slot}` }, token);
  const t2 = r2.aiReply?.content ?? "";
  console.log(`CITA paso 2 (slot ${slot})`);
  console.log(`   "reserva mañana a las ${slot}"`);
  console.log(`   ${r2._ms} ms   ${isAgent(t2) ? "AGENTE (0 tokens)" : "Groq"}`);
  console.log(`   ${t2.split("\n").find((l) => l.trim()).slice(0, 110)}`);
  console.log(`   appointmentId=${r2.appointmentId ?? "—"}`);
  return r2;
}

// ── CITA: salón BELLEZA con servicios ──
const salon = await raw("GET", "/stores?take=100&skip=0");
const beauty = salon.find((s) => s.businessType === "BELLEZA");
if (beauty) {
  const full = await raw("GET", `/stores/${beauty.slug}`);
  const svc = full.services?.[0];
  if (svc) await probeBooking(beauty, svc);
  else console.log(`CITA: ${beauty.name} no tiene servicios`);
}

// ── PEDIDO: tienda PRO no-BELLEZA con productos ──
const cand = salon.filter((s) => s.businessType !== "BELLEZA" && (s.productsCount ?? 0) > 0 && s.plan && s.plan !== "FREE");
const target = cand.find((s) => s.slug === "kiosko-tech") ?? cand[0];
if (target) {
  const full = await raw("GET", `/stores/${target.slug}`);
  const prod = full.products[0];
  await probe(`PEDIDO [${target.name} plan=${target.plan}]`, target.slug, null, prod.id, null,
    `quiero comprar ${prod.name}`);
} else console.log("PEDIDO: no hay tienda PRO con productos");

// ── CHAT AMBIGUO (debe caer a Groq) ──
if (beauty) {
  const { id } = await j("GET", `/stores/${beauty.slug}`);
  const conv = await raw("POST", `/stores/${id}/conversation`, {}, token);
  const r = await j("POST", `/conversations/${conv.id}/messages`,
    { content: "hola, tengo la piel seca, que me recomiendas?" }, token);
  console.log(`CHAT AMBIGUO [${beauty.name}]`);
  console.log(`   ${r._ms} ms   ${isAgent(r.aiReply?.content ?? "") ? "AGENTE" : "Groq"}`);
  console.log(`   ${(r.aiReply?.content ?? "—").split("\n")[0].slice(0, 110)}`);
}