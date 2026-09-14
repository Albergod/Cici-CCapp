// Restructura el demo para respetar la regla "1 usuario = 1 tienda":
//   - owner@demo.test se queda con Moda Cielo.
//   - Las otras 5 tiendas demo pasan a dueños propios (una cuenta por tienda).
// Idempotente: no duplica usuarios ni cambia tiendas ya reasignadas.
//
// Uso: DATABASE_URL=... node scripts/restructure-demo.mjs

import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

// Tiendas demo que permanecen en manos de owner@demo.test (1 usuario = 1 tienda).
const KEEP_WITH_ORIGINAL = ["moda-cielo"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (text, params) => (await pool.query(text, params)).rows;

async function main() {
  const [owner] = await q(`SELECT id FROM users WHERE email = $1`, ["owner@demo.test"]);
  if (!owner) throw new Error("No existe owner@demo.test");
  if (!owner.id) throw new Error("owner@demo.test no tiene id");

  const stores = await q(
    `SELECT id, slug, name FROM stores WHERE owner_id = $1 ORDER BY created_at`,
    [owner.id],
  );

  const passwordHash = await bcrypt.hash("Demo1234", 10);
  const moves = [];
  for (const s of stores) {
    if (KEEP_WITH_ORIGINAL.includes(s.slug)) {
      console.log(`keep  ${s.slug.padEnd(20)} owner@demo.test`);
      continue;
    }
    const email = `${s.slug}@demo.test`;
    const brand = (await q(`SELECT id FROM users WHERE email = $1`, [email]))[0] ?? null;
    if (brand) {
      await q(`UPDATE stores SET owner_id = $1 WHERE id = $2`, [brand.id, s.id]);
      moves.push(`${s.slug} -> ${email}`);
      console.log(`move  ${s.slug.padEnd(20)} ${email}`);
      continue;
    }
    const created = await q(
      `INSERT INTO users (email, password_hash, name, signup_ip)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, passwordHash, `Dueño de ${s.name}`, "::1"],
    );
    await q(`UPDATE stores SET owner_id = $1 WHERE id = $2`, [created[0].id, s.id]);
    moves.push(`${s.slug} -> ${email}`);
    console.log(`new   ${s.slug.padEnd(20)} ${email}`);
  }

  const left = (await q(`SELECT count(*)::int AS n FROM stores WHERE owner_id = $1`, [owner.id]))[0].n;
  console.log(`\nTiendas restantes de owner@demo.test: ${left}`);
  console.log(moves.length ? `Reasignadas: ${moves.join(", ")}` : "Nada que reasignar.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});