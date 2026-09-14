// Batería de verificación del sistema anti-fraude (4 reglas + enforcement, Modelo A).
// Se ejecuta contra una DB/API descartables ya sembradas (API_BASE y PG_URL via env).
import pg from "pg";
import WebSocket from "ws";

const { Client } = pg;
const BASE = process.env.API_BASE || "http://localhost:3113/api";
const ADMIN = process.env.ADMIN_TOKEN;
const dbc = new Client({ connectionString: process.env.PG_URL });

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
};

await dbc.connect();
const q = async (text, params) => (await dbc.query(text, params)).rows;
const j = async (method, url, body, token, xff) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (xff) headers["X-Forwarded-For"] = xff;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};
const login = async (email, password, xff) =>
  (await j("POST", "/auth/login", { email, password }, undefined, xff)).data.token;
const register = async (email, password, name, xff) =>
  (await j("POST", "/auth/register", { email, password, name }, undefined, xff)).data;
const adminReq = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const storeId = async (slug) => (await q(`SELECT id FROM stores WHERE slug=$1`, [slug]))[0].id;

const glow = await storeId("glow-studio");
const paso = await storeId("paso-urbano");
const horno = await storeId("horno-de-la-abuela");
const moda = await storeId("moda-cielo");
const renta = await storeId("renta-del-norte");

// ── A. Escalación de reportes de compradores (5 reportes) ──────────────
console.log("\nA. Reportes → suspensión (3) → veto (5)");
const expected = ["none", "none", "suspended", "suspended", "banned"];
for (let n = 1; n <= 5; n++) {
  const email = `rapport${n}@test.co`;
  const xff = `192.168.1.${n}`;
  await register(email, "test123", `Rapport ${n}`, xff);
  const tok = await login(email, "test123", xff);
  const { status, data } = await j(
    "POST",
    `/stores/${glow}/report`,
    { reason: `prueba escalación ${n}` },
    tok,
    xff,
  );
  const got = data.action;
  check(
    `reporte #${n} de glow-studio → ${expected[n - 1]}`,
    status === 201 && got === expected[n - 1],
    `got=${got}`,
  );
  const st = (await q(`SELECT status FROM stores WHERE id=$1`, [glow]))[0];
  check(`estado DB de glow tras reporte #${n}`, st.status === (n >= 5 ? "BANNED" : n >= 3 ? "SUSPENDED" : "ACTIVE"), `status=${st.status}`);
}
const glowPub = await j("GET", `/stores/glow-studio`);
check("glow-studio baneada no se ve en público (404)", glowPub.status === 404);

// ── B. Modelo A: mencionar WhatsApp en el chat NO suspende ni castiga ──
console.log("\nB. Modelo A: cerrar por WhatsApp en el chat no es falta");
const shopperTok = await login("shopper@demo.test", "Demo1234", "192.168.4.10");
const conv = await j("POST", `/stores/${paso}/conversation`, {}, shopperTok, "192.168.4.10");
check("shopper abre conversación con paso-urbano", conv.status === 200, `status=${conv.status}`);
const cid = conv.data.id;
for (let i = 1; i <= 3; i++) {
  const r = await j(
    "POST",
    `/conversations/${cid}/messages`,
    { content: "mi whatsapp es 3001234567" },
    shopperTok,
    "192.168.4.10",
  );
  check(`mensaje #${i} con teléfono se envía sin castigo`, r.status === 200, `status=${r.status}`);
}
let st = (await q(`SELECT status FROM stores WHERE id=$1`, [paso]))[0];
check("paso-urbano sigue ACTIVE tras mencionar WhatsApp", st.status === "ACTIVE", `status=${st.status}`);

// Suspendemos paso-urbano vía admin para poder probar enforcement abajo.
const suspPaso = await adminReq("POST", `/admin/stores/${paso}/suspend`, { hours: 2, reason: "prueba enforcement" });
check("admin suspende paso-urbano para probar enforcement", suspPaso.status === 200, `status=${suspPaso.status}`);

// ── F. WS rechaza tienda suspendida ────────────────────────────────────
console.log("\nF. WebSocket: cierre al conectar a tienda suspendida");
const wsResult = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:3113/ws/chat?token=${shopperTok}&conversationId=${cid}`);
  let closed = false;
  ws.on("close", (code) => { closed = true; resolve({ code, message: "close" }); });
  ws.on("error", (err) => resolve({ code: -1, message: String(err).slice(0, 60) }));
  setTimeout(() => { if (!closed) { ws.close(); resolve({ code: null, message: "timeout" }); } }, 4000);
});
check("WS cierra conexión a tienda suspendida", wsResult.code === 4006, `code=${wsResult.code} (${wsResult.message})`);

// ── C. Ventas: bloqueadas mientras hay sanción; reauth lazy al expirar ──
console.log("\nC. Ventas: 403 con tienda suspendida; reactivación lazy");
const pasoOwner = await login("paso-urbano@demo.test", "Demo1234", "192.168.4.20");
const prod = (await q(`SELECT id FROM products WHERE store_id=$1 ORDER BY created_at LIMIT 1`, [paso]))[0];
const blockedSale = await j(
  "POST",
  "/sales",
  { items: [{ productId: prod.id, quantity: 1 }], paymentMethod: "EFECTIVO" },
  pasoOwner,
  "192.168.4.20",
);
check("venta de tienda suspendida → 403", blockedSale.status === 403, `status=${blockedSale.status}`);

const deSusp = await adminReq("POST", `/admin/stores/${paso}/suspend`, { hours: 1, reason: "prueba horas mínimas" });
check("admin puede suspender (days u hours >= 1)", deSusp.status === 200, `status=${deSusp.status}`);
await q(`UPDATE stores SET suspension_ends_at = now() - interval '1 minute', status='SUSPENDED' WHERE id=$1`, [paso]);
const feed = await j("GET", "/stores?take=50");
check("feed público reactiva paso-urbano (sanción expirada, lazy)", feed.data.some((s) => s.slug === "paso-urbano"), `present=${feed.data.some((s) => s.slug === "paso-urbano")}`);
const okSale = await j(
  "POST",
  "/sales",
  { items: [{ productId: prod.id, quantity: 1 }], paymentMethod: "EFECTIVO" },
  pasoOwner,
  "192.168.4.20",
);
check("venta ya permitida tras reactivación", okSale.status === 201, `status=${okSale.status}`);

// ── E. Búsqueda de productos oculta tiendas no activas ─────────────────
console.log("\nE. Búsqueda de productos ⊃ solo tiendas ACTIVE");
const deRenta = await adminReq("POST", `/admin/stores/${renta}/suspend`, { days: 1, reason: "prueba búsqueda" });
const searchHidden = await j("GET", "/products?q=apartamento");
const rentaHit = (searchHidden.data || []).some((p) => p.store?.slug === "renta-del-norte");
check("producto de renta-del-norte (suspendida) NO aparece en búsqueda", searchHidden.status === 200 && !rentaHit, `hit=${rentaHit}`);
const searchVisible = await j("GET", "/products?q=camiseta");
const modaHit = (searchVisible.data || []).some((p) => p.store?.slug === "moda-cielo");
check("producto de moda-cielo (ACTIVE) sí aparece", searchVisible.status === 200 && modaHit, `hit=${modaHit}`);

// ── D. Verified TRUE: antigüedad + venta rastreable ────────────────────
console.log("\nD. Verified verdadero (7 días + venta MP)");
await q(`UPDATE stores SET plan='PRO', prestige_points=120, created_at=now()-interval '10 days' WHERE id=$1`, [moda]);
await q(`INSERT INTO sales (total, store_id, payment_method) VALUES (18, $1, 'MP')`, [moda]);
const det = await j("GET", "/stores/moda-cielo");
check("moda-cielo verified:true", det.data?.verified === true, `verified=${det.data?.verified}`);

const base = await j("GET", "/stores/destellos");
check("destellos (plan FREE, sin venta) verified:false", base.data?.verified === false, `verified=${base.data?.verified}`);

console.log(`\nRESULTADO: ${results.filter((r) => r.ok).length}/${results.length} checks OK`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log("FAILS:", failed.map((f) => f.name).join(" | "));
  process.exitCode = 1;
}
await dbc.end();