// Siembra tiendas demo adicionales con fotos reales (Unsplash, verificadas 200)
// para que el catálogo luzca lleno. Idempotente: si el slug ya existe, salta.
//
// Uso (contra la BD que quieras, producción incluida):
//   DATABASE_URL="postgresql://..." node scripts/add-demo-stores.mjs
//
// Cada tienda vive en su propia cuenta (regla "1 usuario = 1 tienda"),
// igual que las tiendas demo originales. Usuario: <slug>@demo.test / Demo1234.

import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (text, params) => (await pool.query(text, params)).rows;

const P = (id, w = 600) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=60`;
const logo = (seed) => `https://picsum.photos/seed/${seed}/400/400`;

// Fotografías reales verificadas (HTTP 200) por giro comercial.
const PHOTOS = {
  ROPA: [
    "photo-1521572163474-6864f9cf17ab",
    "photo-1541099649105-f69ad21f3246",
    "photo-1595777457583-95e059d581b8",
    "photo-1503341504253-dff4815485f1",
    "photo-1531927557220-a9e23c1e4794",
    "photo-1523381210434-271e8be1f52b",
  ],
  CALZADO: [
    "photo-1542291026-7eec264c27ff",
    "photo-1560343090-f0409e92791a",
    "photo-1549298916-b41d501d3772",
    "photo-1606107557195-0e29a4b5b4aa",
    "photo-1543508282-6319a3e2621f",
    "photo-1560769629-975ec94e6a86",
    "photo-1595950653106-6c9ebd614d3a",
  ],
  ACCESORIOS: [
    "photo-1515562141207-7a88fb7ce338",
    "photo-1523170335258-f5ed11844a49",
    "photo-1585386959984-a4155224a1ad",
    "photo-1572635196237-14b3f281503f",
    "photo-1518002171953-a080ee817e1f",
    "photo-1596462502278-27bfdc403348",
    "photo-1598440947619-2c35fc9aa908",
  ],
  HOGAR: [
    "photo-1586023492125-27b2c045efd7",
    "photo-1567016432779-094069958ea5",
    "photo-1616486338812-3dadae4b4ace",
    "photo-1519710164239-da123dc03ef4",
  ],
  ALIMENTOS: [
    "photo-1495474472287-4d71bcdd2085",
    "photo-1509440159596-0249088772ff",
    "photo-1467003909585-2f8a72700288",
    "photo-1546069901-ba9599a7e63c",
    "photo-1565958011703-44f9829ba187",
    "photo-1551024506-0bccd828d307",
  ],
  OTRO: [
    "photo-1505740420928-5e560c06d30e",
    "photo-1546435770-a3e426bf472b",
    "photo-1583394838336-acd977736f90",
    "photo-1484704849700-f032a568e944",
    "photo-1550009158-9ebf69173e03",
    "photo-1523293182086-7651a899d37f",
    "photo-1526170375885-4d8ecf77b99f",
  ],
};

const STORES = [
  {
    slug: "cafecito-del-barrio",
    name: "Cafecito del Barrio",
    description: "Café de origen colombiano y panadería artesanal todos los días.",
    businessType: "ALIMENTOS",
    plan: "FREE",
    whatsapp: "573001234561",
    products: [
      { name: "Café de origen huilense 250g", desc: "Tostión media, notas de caramelo y castaña.", price: 18000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
      { name: "Dúo de café molido 500g", desc: "Ideal para la cafetera de la casa.", price: 32000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
      { name: "Pan de papa de Cundinamarca", desc: "Horneado en la mañana, crujiente por fuera.", price: 5000, attrs: { porcion: "Unidad", restricciones: "Contiene gluten" } },
      { name: "Docena de pandebonos", desc: "La tanda de la casa, queso y yuca.", price: 24000, attrs: { porcion: "Docena", restricciones: "Contiene gluten, lácteos" } },
      { name: "Agua de panela con limón 1L", desc: "Bebida refrescante tradicional.", price: 12000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
    ],
  },
  {
    slug: "golosinas-dona-rosa",
    name: "Golosinas Doña Rosa",
    description: "Dulces, chocolates y confites que traen recuerdos.",
    businessType: "ALIMENTOS",
    plan: "FREE",
    whatsapp: "573009876542",
    products: [
      { name: "Caja de chocolates surtidos 450g", desc: "Chocolate de leche, oscuro y blanco.", price: 28000, attrs: { porcion: "Unidad", restricciones: "Lácteos, soya" } },
      { name: "Media docena de galletas de avena", desc: "Con pasas, hechas al horno.", price: 15000, attrs: { porcion: "Media docena", restricciones: "Gluten" } },
      { name: "Dulce de leche artesanal frasco", desc: "Receta casera, sin conservantes.", price: 22000, attrs: { porcion: "Unidad", restricciones: "Lácteos" } },
    ],
  },
  {
    slug: "calzado-caminante",
    name: "Calzado Caminante",
    description: "Zapatos y zapatillas cómodas para el día a día.",
    businessType: "CALZADO",
    plan: "PRO",
    whatsapp: "573001112233",
    referralCode: "CAMINANTE",
    products: [
      { name: "Zapatilla urbana roja", desc: "Suela antideslizante, cuero sintético.", price: 215000, attrs: { numero: 41, color: "rojo" } },
      { name: "Zapatilla deportiva blanca", desc: "Ligera para caminar toda la ciudad.", price: 239000, attrs: { numero: 42, color: "blanco" } },
      { name: "Botín clásico negro", desc: "Para oficina, punta redonda.", price: 259000, attrs: { numero: 40, color: "negro" } },
      { name: "Zapatilla casual gris", desc: "Estilo minimalista con plantilla ergonómica.", price: 199000, attrs: { numero: 43, color: "gris" } },
      { name: "Tenis vintage azul", desc: "Harás match con cualquier outfit.", price: 224500, attrs: { numero: 41, color: "azul" } },
      { name: "Zapatilla deportiva negra", desc: "Respirable, para entrenamiento.", price: 189000, attrs: { numero: 42, color: "negro" } },
    ],
  },
  {
    slug: "polaris-tech",
    name: "Polaris Tech",
    description: "Auriculares, accesorios y gadgets con garantía.",
    businessType: "OTRO",
    plan: "PRO",
    whatsapp: "573004556677",
    referralCode: "POLARIS",
    products: [
      { name: "Audífonos inalámbricos negros", desc: "Bluetooth 5.3, cancelación de ruido.", price: 189000, attrs: {} },
      { name: "Audífonos over-ear premium", desc: "Batería de 30 horas, diadema acolchada.", price: 349000, attrs: {} },
      { name: "Audífonos tipo on-ear", desc: "Ligeros y plegables para viajar.", price: 159000, attrs: {} },
      { name: "Cámara instantánea compacta", desc: "Captura y guarda tus recuerdos al instante.", price: 420000, attrs: {} },
      { name: "Audífonos gaming con micrófono", desc: "Sonido envolvente, cable trenzado.", price: 129000, attrs: {} },
    ],
  },
  {
    slug: "luna-y-plata",
    name: "Luna y Plata",
    description: "Joyería artesanal y accesorios con carácter.",
    businessType: "ACCESORIOS",
    plan: "FREE",
    whatsapp: "573007778899",
    products: [
      { name: "Anillo de plata artesanal", desc: "Hilera grabada a mano, talla ajustable.", price: 98000, attrs: { tipo: "Joyería", material: "plata 950", color: "plata" } },
      { name: "Reloj clásico de cuero marrón", desc: "Movimiento de cuarzo, correa intercambiable.", price: 145000, attrs: { tipo: "Relojes", material: "cuero", color: "marrón" } },
      { name: "Perfume compacto 50ml", desc: "Notas de vainilla y sándalo.", price: 87000, attrs: { tipo: "Otro", material: "vidrio", color: "ámbar" } },
      { name: "Gafas de sol estilo aviador", desc: "Protección UV400, marco metálico.", price: 76000, attrs: { tipo: "Otro", material: "metal", color: "negro" } },
      { name: "Collar minimalista de perla", desc: "Cadena fina con cierre seguro.", price: 112000, attrs: { tipo: "Joyería", material: "acero", color: "blanco" } },
    ],
  },
  {
    slug: "boutique-andina",
    name: "Boutique Andina",
    description: "Moda con identidad: básicos de calidad y telas cómodas.",
    businessType: "ROPA",
    plan: "FREE",
    whatsapp: "573006665544",
    products: [
      { name: "Camiseta básica de algodón", desc: "Suave, 100% algodón peinado.", price: 45000, attrs: { talla: "M", color: "blanco", material: "algodón" } },
      { name: "Jeans acampanados", desc: "Corte vintage, denim con elastano.", price: 129000, attrs: { talla: "30", color: "azul", material: "denim" } },
      { name: "Vestido de verano coral", desc: "Ligero, perfecto para el clima cálido.", price: 98000, attrs: { talla: "S", color: "coral", material: "lino" } },
      { name: "Camisa Oxford blanca", desc: "Clásica de oficina, sin planchar.", price: 88000, attrs: { talla: "M", color: "blanco", material: "algodón" } },
      { name: "Cartera tote de cuero", desc: "Espaciosa, con compartimento interno.", price: 156000, attrs: { talla: "Única", color: "café", material: "cuero" } },
    ],
  },
  {
    slug: "terra-hogar",
    name: "Terra Hogar",
    description: "Decora tu espacio con piezas que cuentan historias.",
    businessType: "HOGAR",
    plan: "PRO",
    whatsapp: "573003332244",
    referralCode: "TERRAHOGAR",
    products: [
      { name: "Jarrón de cerámica minimalista", desc: "Acabado mate, ideal para flores secas.", price: 89000, attrs: {} },
      { name: "Set de velas aromáticas x3", desc: "Lavanda, vainilla y canela.", price: 48000, attrs: {} },
      { name: "Cojín texturizado gris", desc: "Funda lavable, relleno de poliéster.", price: 59000, attrs: {} },
      { name: "Cafetera de vidrio con filtro", desc: "Prepara café en estufa, 8 tazas.", price: 115000, attrs: {} },
    ],
  },
  {
    slug: "dulce-tentacion",
    name: "Dulce Tentación",
    description: "Repostería casera que endulza tus días.",
    businessType: "ALIMENTOS",
    plan: "FREE",
    whatsapp: "573005998877",
    products: [
      { name: "Tarta de chocolate artesanal", desc: "Con cobertura de ganache, 8 porciones.", price: 65000, attrs: { porcion: "Unidad", restricciones: "Gluten, lácteos" } },
      { name: "Galleta gigante con chips", desc: "Suave por dentro, crujiente por fuera.", price: 9000, attrs: { porcion: "Unidad", restricciones: "Gluten" } },
      { name: "Bowl de frutas con quinoa", desc: "Fresco, variado y sin azúcar añadida.", price: 22000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
    ],
  },
  {
    slug: "verde-organico",
    name: "Verde Orgánico",
    description: "Frutas, verduras y granos de cultivo responsable.",
    businessType: "ALIMENTOS",
    plan: "FREE",
    whatsapp: "573001119955",
    products: [
      { name: "Canasta de frutas de temporada", desc: "Surte variado para la semana.", price: 38000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
      { name: "Café orgánico molido 500g", desc: "Tostión clara de finca certificada.", price: 34000, attrs: { porcion: "Unidad", restricciones: "Ninguna" } },
      { name: "Chocolate orgánico 70% barra", desc: "Cacao de origen, endulzado con panela.", price: 15000, attrs: { porcion: "Unidad", restricciones: "Lácteos, soya" } },
    ],
  },
  {
    slug: "moda-masculina",
    name: "Moda Masculina",
    description: "Ropa de hombre, del básico al outfit completo.",
    businessType: "ROPA",
    plan: "FREE",
    whatsapp: "573008877665",
    products: [
      { name: "Camiseta básica hombre", desc: "Algodón peinado, corte clásico.", price: 42000, attrs: { talla: "M", color: "blanco", material: "algodón" } },
      { name: "Pantalón chino beige", desc: "Tela fresca, bolsillos funcionales.", price: 135000, attrs: { talla: "34", color: "beige", material: "algodón" } },
      { name: "Camisa de cuadros casual", desc: "Para el fin de semana, suave al tacto.", price: 98000, attrs: { talla: "L", color: "azul", material: "algodón" } },
      { name: "Abrigo bomber deportivo", desc: "Liviano, con capucha y cierre.", price: 189000, attrs: { talla: "L", color: "verde", material: "sintético" } },
    ],
  },
  {
    slug: "kiosko-tech",
    name: "Kiosko Tech",
    description: "Gadgets y accesorios digitales a buen precio.",
    businessType: "OTRO",
    plan: "PRO",
    whatsapp: "573006644332",
    referralCode: "KIOSKO1",
    products: [
      { name: "Cámara digital compacta", desc: "Fotos nítidas y video en Full HD.", price: 520000, attrs: {} },
      { name: "Cargador inalámbrico doble", desc: "Carga tu celular y tus audífonos.", price: 89000, attrs: {} },
      { name: "Adaptador USB-C multifunción", desc: "HDMI, USB y lector de tarjetas.", price: 35000, attrs: {} },
      { name: "Lente macro para celular", desc: "Descubre el detalle que no ves.", price: 42000, attrs: {} },
    ],
  },
  {
    slug: "perfumeria-aura",
    name: "Perfumería Aura",
    description: "Perfumes y cosméticos para tu rutina de cuidado.",
    businessType: "ACCESORIOS",
    plan: "FREE",
    whatsapp: "573005544111",
    products: [
      { name: "Perfume floral 50ml", desc: "Notas de gardenia y bergamota.", price: 96000, attrs: { tipo: "Otro", material: "vidrio", color: "rosa" } },
      { name: "Set de cosméticos esenciales", desc: "Piel limpia e hidratada en 3 pasos.", price: 145000, attrs: { tipo: "Otro", material: "sintético", color: "neutro" } },
      { name: "Brillo labial hidratante", desc: "Con aloe vera, tono transparente.", price: 28000, attrs: { tipo: "Otro", color: "transparente" } },
      { name: "Kit de brochas de maquillaje", desc: "6 brochas de cerdas sintéticas.", price: 74000, attrs: { tipo: "Otro", material: "sintético", color: "negro" } },
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash("Demo1234", 10);
  let created = 0;
  let skipped = 0;
  let productsCreated = 0;

  for (const s of STORES) {
    const isRoot = !s.referralCode; // una cuenta raíz demo por tienda (1 usuario = 1 tienda)
    const exists = (await q(`SELECT 1 FROM stores WHERE slug = $1`, [s.slug])).length;
    if (exists) {
      console.log(`skip  ${s.slug.padEnd(20)} ya existe`);
      skipped++;
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const email = `${s.slug.replace(/-/g, "")}@demo.test`;
      let user = (await client.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0];
      if (!user) {
        const ins = await client.query(
          `INSERT INTO users (email, password_hash, name, signup_ip)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [email, passwordHash, `Dueño de ${s.name}`, "::1"],
        );
        user = ins.rows[0];
      }
      const banner = `https://picsum.photos/seed/${s.slug}-ban/1600/500`;
      const store = await client.query(
        `INSERT INTO stores (name, slug, description, logo_url, banner_url, plan, business_type, whatsapp, referral_code, prestige_points, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          s.name, s.slug, s.description, logo(s.slug), banner, s.plan, s.businessType,
          s.whatsapp, s.referralCode ?? null, s.plan === "PRO" ? 140 : 0, user.id,
        ],
      );
      const storeId = store.rows[0].id;
      const photos = PHOTOS[s.businessType] ?? PHOTOS.OTRO;
      let i = 0;
      for (const p of s.products) {
        await client.query(
          `INSERT INTO products (name, description, price, image_url, available, store_id, attributes, stock, views)
           VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8)`,
          [p.name, p.desc, p.price, P(photos[i % photos.length]), storeId, JSON.stringify(p.attrs), 0, 0],
        );
        i++;
        productsCreated++;
      }
      await client.query("COMMIT");
      created++;
      console.log(`ok    ${s.slug.padEnd(20)} ${s.name} (${s.products.length} productos)`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`\nTotales: ${created} creadas, ${skipped} saltadas, ${productsCreated} productos insertados.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});