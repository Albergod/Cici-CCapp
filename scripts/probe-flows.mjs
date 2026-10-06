/**
 * probe-flows.mjs — Comprueba qué flujo resuelve el AGENTE determinístico (0 tokens)
 * y cuál cae a Groq, mirando la respuesta y el log [ai-tokens] del backend.
 */
const base = process.env.API_BASE || "http://localhost:3000/api";
const LOG = "/tmp/opencode/cici/backend.log";

import { readFileSync } from "node:fs";

async function j(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const login = (email, password) => j("POST", "/auth/login", { email, password });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cuenta cuántas llamadas LLM ([ai-tokens])occurrence mientras se corre fn(). */
async function withoutLlm(label, fn) {
  const before = readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes("[ai-tokens]")).length;
  const t0 = Date.now();
  const out = await fn();
  await sleep(300);
  const after = readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes("[ai-tokens]")).length;
  console.log(`   LLM llamadas: ${after - before}   (${Date.now() - t0} ms)  → ${label}`);
  return { ...out, llmCalls: after - before };
}

const shopper = await login("shopper@demo.test", "Demo1234");

const stores = await j("GET", "/stores?take=100&skip=0");
const salon = stores.find((s) => s.businessType === "BELLEZA" && (s.productsCount ?? 0) === 0);
const ropa = stores.find((s) => s.slug === "moda-cielo");
console.log(`salón: ${salon?.name} (${salon?.plan})   ropa: ${ropa?.name} (${ropa?.plan})`);

const salonFull = await j("GET", `/stores/${salon.slug}`);
const ropaFull = await j("GET", `/stores/${ropa.slug}`);
const servicio = salonFull.services[0];
const producto = ropaFull.products[0];

console.log("\n════ FLUJO 1: CITA (agente determinístico) ════");
const convCita = await j("POST", `/stores/${salon.id}/conversation`, { serviceId: servicio.id }, shopper.token);
console.log(`   servicio: "${servicio.name}" ($${servicio.price})`);
const cita1 = await withoutLlm("ofeciendo franjas", () =>
  j("POST", `/conversations/${convCita.id}/messages`, { content: "quiero reservar" }, shopper.token));
console.log(`   IA: ${cita1.aiReply?.content}`);
console.log(`   appointmentId: ${cita1.appointmentId ?? "—"}`);

const cita2 = await withoutLlm("creando la cita", () =>
  j("POST", `/conversations/${convCita.id}/messages`, { content: "reserva mañana a las 10:00" }, shopper.token));
console.log(`   IA: ${cita2.aiReply?.content}`);
console.log(`   appointmentId: ${cita2.appointmentId ?? "—"}`);

console.log("\n════ FLUJO 2: PEDIDO (agente determinístico) ════");
const convPedido = await j("POST", `/stores/${ropa.id}/conversation`, { productId: producto.id }, shopper.token);
console.log(`   producto: "${producto.name}" ($${producto.price})`);
const ped1 = await withoutLlm("confirmando el pedido", () =>
  j("POST", `/conversations/${convPedido.id}/messages`, { content: `quiero comprar ${producto.name}` }, shopper.token));
console.log(`   IA: ${ped1.aiReply?.content ?? "—"}`);
console.log(`   orderId: ${ped1.orderId ?? "—"}`);

const ped2 = await withoutLlm("segundo mensaje", () =>
  j("POST", `/conversations/${convPedido.id}/messages`, { content: "dame 2 de esos" }, shopper.token));
console.log(`   IA: ${ped2.aiReply?.content ?? "—"}`);
console.log(`   orderId: ${ped2.orderId ?? "—"}`);

console.log("\n════ FLUJO 3: CHAT AMBIGUO (debe caer a Groq) ════");
const convChat = await j("POST", `/stores/${salon.id}/conversation`, {}, shopper.token);
const chat1 = await withoutLlm("pregunta abierta", () =>
  j("POST", `/conversations/${convChat.id}/messages`, { content: "hola, tengo la piel seca, que me recomiendas?" }, shopper.token));
console.log(`   IA: ${chat1.aiReply?.content ?? "—"}`);
console.log(`   orderId: ${chat1.orderId ?? "—"}   appointmentId: ${chat1.appointmentId ?? "—"}`);