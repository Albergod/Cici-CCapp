const base = 'http://localhost:3000/api';
const img = (id, w = 600, h = 600) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=60`;

async function j(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const register = async (email, password, name) => {
  try {
    const r = await j('POST', '/auth/register', { email, password, name });
    return r;
  } catch (e) {
    throw e;
  }
};
const login = (email, password) => j('POST', '/auth/login', { email, password });

const stores = [
  {
    name: 'Moda Cielo',
    description: 'Ropa femenina con estilo y comodidad. Envíos a todo el país.',
    businessType: 'ROPA',
    banner: 'photo-1441986300917-64674bd600d8',
    products: [
      { name: 'Camiseta básica algodón', price: 18, image: 'photo-1521572163474-6864f9cf17ab', desc: 'Camiseta 100% algodón peinado, corte recto y cuello redondo.', attrs: { talla: 'M', color: 'blanco', material: 'algodón' } },
      { name: 'Jeans acampanados', price: 39.5, image: 'photo-1541099649105-f69ad21f3246', desc: 'Jeans denim con leve campana, talle alto.', attrs: { talla: '30', color: 'azul', material: 'denim' } },
      { name: 'Vestido de verano', price: 42, image: 'photo-1595777457583-95e059d581b8', desc: 'Vestido ligero con vuelo, perfecto para los días cálidos.', attrs: { talla: 'S', color: 'coral', material: 'lino' } },
    ],
  },
  {
    name: 'Paso Urbano',
    description: 'Calzado deportivo y casual de las mejores marcas.',
    businessType: 'CALZADO',
    banner: 'photo-1449505278894-297fdb3edbc1',
    products: [
      { name: 'Runner Rojo Air', price: 89, image: 'photo-1542291026-7eec264c27ff', desc: 'Zapatilla runner con amortiguación Air, ideal para entrenar.', attrs: { numero: 42, color: 'rojo' } },
      { name: 'Casual Blanco Clásico', price: 74, image: 'photo-1595950653106-6c9ebd614d3a', desc: 'Zapatilla casual blanca, comodidad todo el día.', attrs: { numero: 40, color: 'blanco' } },
    ],
  },
  {
    name: 'Destellos',
    description: 'Joyería, relojes y bijouterie fina.',
    businessType: 'ACCESORIOS',
    banner: 'photo-1522312346375-d1a52e2b99b3',
    products: [
      { name: 'Reloj Acuático Plateado', price: 129, image: 'photo-1523275335684-37898b6baf30', desc: 'Reloj acuático con caja de acero inoxidable y malla plateada.', attrs: { tipo: 'Relojes', material: 'acero inoxidable', medida: 'diámetro 42mm', color: 'plateado' } },
      { name: 'Gafas Aviador Doradas', price: 45, image: 'photo-1511499767150-a48a237f0083', desc: 'Gafas de sol estilo aviador con montura dorada.', attrs: { tipo: 'Bijouterie', material: 'metal', medida: 'puente 56mm', color: 'dorado' } },
    ],
  },
  {
    name: 'Renta del Norte',
    description: 'Apartamentos y studios en arriendo, amoblados o vacíos.',
    businessType: 'HOGAR',
    banner: 'photo-1522708323590-d24dbb6b0267',
    products: [
      { name: 'Apartamento El Prado (2 hab)', price: 600, image: 'photo-1522708323590-d24dbb6b0267', desc: 'Apartamento de 2 habitaciones amoblado, área social y cocina equipada.', attrs: { tipoUnidad: 'Apartamento', habitaciones: 2, banos: 1, areaM2: 60, amoblado: true, ubicacion: 'El Prado, norte', disponibleDesde: 'marzo 2026' } },
      { name: 'Studio San Felipe (1 hab)', price: 400, image: 'photo-1502672260266-1c1ef2d93688', desc: 'Studio compacto sin amoblar, ideal para estudiante o pareja.', attrs: { tipoUnidad: 'Studio', habitaciones: 1, banos: 1, areaM2: 35, amoblado: false, ubicacion: 'San Felipe', disponibleDesde: 'disponible ya' } },
    ],
  },
  {
    name: 'Horno de la Abuela',
    description: 'Pan artesanal y repostería fresca todos los días.',
    businessType: 'ALIMENTOS',
    banner: 'photo-1509440159596-0249088772ff',
    products: [
      { name: 'Pan campesino artesanal', price: 6, image: 'photo-1509440159596-0249088772ff', desc: 'Pan campesino horneado al día, corteza crujiente.', attrs: { porcion: 'Docena', restricciones: 'sin restricciones' } },
      { name: 'Porción de torta tres leches', price: 4.5, image: 'photo-1578985545062-69928b1d9587', desc: 'Torta tres leches esponjosa con cobertura de merengue.', attrs: { porcion: 'Porción', restricciones: 'contiene gluten, lácteos' } },
    ],
  },
  {
    name: 'Glow Studio',
    description: 'Salón de belleza: cortes, peinados y cuidados faciales.',
    businessType: 'SERVICIOS',
    banner: 'photo-1560066984-138dadb4c035',
    products: [
      { name: 'Corte + peinado', price: 25, image: 'photo-1560066984-138dadb4c035', desc: 'Consulta de asesoría, lavado, corte y peinado.', attrs: { duracion: '45 min', modalidad: 'En el local' } },
    ],
  },
];

(async () => {
  const owner = await register('owner@demo.test', 'Demo1234', 'Carolina Dueñas');
  const shopper = await register('shopper@demo.test', 'Demo1234', 'Ana Martínez');
  const session = await login('owner@demo.test', 'Demo1234');
  const token = session.token;

  let totalProducts = 0;
  for (const s of stores) {
    const st = await j('POST', '/stores', {
      name: s.name,
      description: s.description,
      businessType: s.businessType,
      logoUrl: img(s.banner, 400, 400),
      bannerUrl: img(s.banner, 1200, 420),
    }, token);
    for (const p of s.products) {
      await j('POST', `/stores/${st.id}/products`, {
        name: p.name,
        description: p.desc,
        price: p.price,
        stock: 25,
        imageUrl: img(p.image),
        attributes: p.attrs,
      }, token);
      totalProducts++;
    }
    console.log(`ok ${s.businessType.padEnd(11)} ${st.slug}  id=${st.id}  productos=${s.products.length}`);
  }
  console.log(`\nUsuarios: owner@demo.test / shopper@demo.test  (Demo1234)`);
  console.log(`Tiendas: ${stores.length}   Productos: ${totalProducts}`);
})().catch((e) => { console.error(e); process.exit(1); });