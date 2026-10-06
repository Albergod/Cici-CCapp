/**
 * probe-transactional.mjs — Prueba el agente determinístico con mensajes REALES
 * (servicio/producto nombrado + hora exacta) y separa lo que va a Groq.
 */
const base = process.env.API_BASE || "http://localhost:3000/api";
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
const LOG = "/tmp/opencode/cici/backend.log";
const lines = () => readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes("[ai-tokens]"));

async function run(label, convId, content, token) {
  const before = lines().length;
  const t0 = Date.now();
  const r = await j("POST", `/conversations/${convId}/messages`, { content }, token);
  await sleep(250);
  const n = lines().length - before;
  const txt = r.aiReply?.content ?? "—";
  console.log(`   "${content}"`);
  console.log(`     LLM=${n}  ${Date.now() - t0}ms`);
  console.log(`     ${txt.split("\n").slice(0, 3).join(" ⏎ ")}`);
  console.log(`     appointmentId=${r.appointmentId ?? "—"}  orderId=${r.orderId ?? "—"}`);
  return r;
}

const shopper = await login("shopper@demo.test", "Demo1234");
const stores = await j("GET", "/stores?take=100&skip=0");
const salon = stores.find((s) => s.businessType === "BELLEZA");
const ropa = stores.find((s) => s.slug === "moda-cielo");
const salonFull = await j("GET", `/stores/${salon.slug}`);
const ropaFull = await j("GET", `/stores/${ropa.slug}`);
const svc = salonFull.services.find((s) => /corte/i.test(s.name));
const prod = ropaFull.products[0];

console.log("════ CITA: servicio nombrado + hora exacta ════");
const c1 = await j("POST", `/stores/${salon.id}/conversation`, { serviceId: svc.id }, shopper.token);
await run("A", c1.id, `quiero reservar ${svc.name} mañana a las 8:00`, shopper.token);

console.log("\n════ CITA: franjas primero, luego elige ════");
const c2 = await j("POST", `/stores/${salon.id}/conversation`, { serviceId: svc.id }, shopper.token);
await run("B", c2.id, `quiero ${svc.name} mañana`, shopper.token);
await run("C", c2.id, "reserva a las 8:00", shopper.token);

console.log("\n════ PEDIDO: producto nombrado ════");
const c3 = await j("POST", `/stores/${ropa.id}/conversation`, { productId: prod.id }, shopper.token);
await run("D", c3.id, `quiero comprar ${prod.name}`, shopper.token);

console.log("\n════ PEDIDO: cantidad explícita ════");
const c4 = await j("POST", `/stores/${ropa.id}/conversation`, { productId: prod.id }, shopper.token);
await run("E", c4.id, `quiero 3 ${prod.name}`, shopper.token);

console.log("\n════ CHAT AMBIGUO (debe ser Groq) ════");
const c5 = await j("POST", `/stores/${salon.id}/conversation`, {}, shopper.token);
await run("F", c5.id, "hola, tengo la piel seca, que me recomiendas?", shopper.token);