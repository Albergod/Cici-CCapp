# Cici — Centro Comercial Digital (guía técnica)

Manual corto de cómo está construido el software, qué tecnologías usa y por qué,
cómo se evitan las estafas, cómo la IA y la creación de productos se adaptan a la
categoría de cada tienda, y cómo se hizo cada pieza. Todo en orden y en detalle.

## ¿Qué es?

**Cici** es un centro comercial digital: cada persona abre su **tienda** ("su
local"), publica **productos** y los demás pueden **descubrirlos** en el feed,
**seguirlos** y **conversar** con la tienda por chat (REST + WebSocket) con un
asistente de IA que conoce el catálogo y la categoría del negocio.

El negocio es "el arriendo del local": la tienda se crea gratis y queda en plan
**FREE**; los planes **PRO** y **BUSINESS** se activan **solo** cuando un pago
real (Mercado Pago o Wompi/Nequi) es confirmado por el gateway. El contacto con
clientes no es el muro de pago: lo que paga el plan es prestigio/referidos, el
check verificado, más productos, IA en el chat y prioridad en el feed.

**URLs en producción:**
- App (frontend + API + WebSocket, mismo dominio): `https://cici-r511.onrender.com`
- Backend (Render, servicio `cici`, runtime Docker, plan free)
- Base de datos: PostgreSQL gestionado en **Neon**

## Arquitectura general

```text
                ┌──────────────────────────────────────────────┐
                │             Cliente (navegador)              │
                │      React 18 + Vite + Tailwind (SPA)        │
                └──────────────────────────────────────────────┘
                     │                    │      WebSocket
              /api/* (HTTP JSON)         │      /ws/chat
                     ▼                    ▼
                ┌──────────────────────────────────────────────┐
                │       UN solo proceso Node/Express 4         │
                │  sirve API + WS + el frontend compilado      │
                │  (index.ts + ws/chatServer.ts)               │
                └──────────────────────────────────────────────┘
                     │
            Drizzle ORM (TS puro sobre `pg`)
                     ▼
                ┌──────────────────────────────────────────────┐
                │   PostgreSQL serverless (Neon)               │
                │   users, stores, products, conversations,   │
                │   messages, sales, violations, mp_payments… │
                └──────────────────────────────────────────────┘
                     ▲
          Mercado Pago (Checkout Pro) ─ Wompi (Nequi)
          Groq / OpenAI-compat (IA del chat) ─ Cloudinary (imágenes)
```

Cada flecha es una decisión tecnológica:
- **Express 4** es el API. Es mínimo, se conoce bien y no impone opiniones para
  un MVP.
- **TypeScript** en backend y frontend: un solo lenguaje, errores en compile-time
  y los mismos tipos compartidos entre ambos lados.
- **Drizzle ORM** sobre el driver `pg`: es TypeScript puro, **sin binarios
  nativos**. El proyecto nació con Prisma y se migró a Drizzle porque en NixOS
  los engines de Prisma no tienen build oficial y rompían (ver README).
- **WebSocket (`ws`)** para el chat en tiempo real: mensajes instantáneos sin
  hacer polling cada X segundos.
- **Un solo contenedor** (API + WS + frontend estático Vite) sirve todo desde el
  mismo dominio: no hace falta CORS entre frontend y API ni una CDN aparte.

---

## Backend (`src/`)

### Node.js 20/22 + TypeScript 5
**Qué es:** runtime JS + tipado estático encima.
**Por qué:** mismo lenguaje en todo el repo; `tsx` para desarrollo con recarga y
`tsc` para compilar el deploy.

### Express 4
**Qué es:** framework HTTP.
**Por qué:** routers por dominio (`auth`, `stores`, `products`, `chat`, `sales`,
`admin`, `payments`, `wompi`), middleware para auth, rate-limit, logs y errors,
y un catch-all que sirve `index.html` del frontend en la misma app.

### Drizzle ORM + `pg`
**Qué es:** query builder y migraciones en TypeScript puro.
**Por qué:** escribe `db.query.stores.findMany({ with: { followers: true } })`
con tipos completos; las migraciones son archivos SQL versionados en `drizzle/`
(migraciones `0000`–`0003`).
**Qué es `pg`:** driver PostgreSQL puro.
**Por qué:** conecta directo a la cadena pooled que entrega Neon.

### Zod
**Qué es:** validación de esquemas en runtime.
**Por qué:** cada `req.body` pasa por `safeParse` antes de tocar la BD; rechaza
con 400 y un error legible (p. ej. el número Nequi debe ser `3` + 9 dígitos).

### express-rate-limit
**Qué es:** limitador de peticiones por IP.
**Por qué:** global 200 req / 15 min (con `skip` cuando no hay error), **login**
y **reset de contraseña** 10 / 15 min, **registro** 30 / 15 min, **pagos**
30 / min. Evita fuerza bruta y spam de preferencias de pago.

### jsonwebtoken + bcryptjs
**Qué es:** JWT para sesiones y hash de contraseñas.
**Por qué:** el token dura 7 días, lleva `{ userId }`; `requireAuth`/`optionalAuth`
lo verifican en cada request. Las contraseñas se guardan con bcrypt (coste 10).

### morgan
**Qué es:** log de peticiones HTTP.
**Por qué:** ver en los logs `/logs` qué endpoint llaman, con qué método, status
y duración — clave para depurar el anti-fraude en vivo.

### `openai` SDK (apuntado a Groq)
**Qué es:** cliente de chat compatible con la API de OpenAI.
**Por qué:** la IA del chat usa un modelo **sin depender de ningún proveedor**:
`AI_BASE_URL`, `AI_MODEL` y `GROQ_API_KEY`/`OPENAI_API_KEY` vienen del `.env`
(hoy Groq, modelo `openai/gpt-oss-120b`). Cambiar de proveedor es editar 2 líneas
del `.env` (ver `GUIA-IA.md`). Sin key o ante un error, hay **fallback
determinístico** que arma respuestas desde el catálogo: el chat nunca se ve roto.

### Estructura de carpetas
```text
src/
├── index.ts            Crea la app, monta routers, arranca WS y el cron de planes
├── db/                 client.ts (conexión) y schema.ts (todas las tablas)
├── middleware/
│   ├── auth.ts         requireAuth / optionalAuth / signToken (JWT)
│   └── rate-limit.ts   limitadores globales y por endpoint
├── routes/             auth, auth-google, stores, products, chat, sales,
│                       admin, payments, wompi, upload
├── ws/chatServer.ts    WebSocket del chat (REST + WS comparten lógica)
└── lib/
    ├── ai.ts           IA del chat: perfiles por tipo de negocio + fallback
    ├── categoryFields.ts  Atributos de producto por categoría
    ├── moderation.ts   NÚCLEO anti-fraude: umbrales, sanciones, detección
    ├── plans.ts / plan-config.ts   Precios, ciclos, activación de planes
    ├── prestige.ts     Puntos de prestigio y límites de productos por plan
    ├── subscription.ts Trial de 30 días; el contacto SIEMPRE está disponible
    ├── mercadopago.ts / wompi.ts   Clientes de los gateways de pago
    ├── payment-ref.ts  Parsea external_reference (storeId_PLAN_CICLO | USER_...)
    ├── email.ts        Enlace de reset de contraseña (token con expiración)
    ├── validators.ts   imageUrl() y otros reutilizables
    └── boot-env.ts     Carga variables de entorno temprano
```

---

## Frontend (`frontend/`)

### Vite 6 + React 18 + TypeScript
**Qué es:** bundler/SPA sobre React.
**Por qué:** dev server rápido con HMR y build estático que el backend sirve
desde la misma carpeta (`frontend/dist`).

### react-router-dom v7
**Qué es:** enrutador del lado del cliente.
**Por qué:** rutas declarativas (`/`, `/store/:slug`, `/dashboard`, `/chat/:id`,
`/search`, `/admin`, login/registro/recuperar).

### Tailwind CSS 3
**Qué es:** utility-first CSS.
**Por qué:** estilos consistentes sin mantener hojas CSS gigantes.

### lucide-react + qrcode.react
**Qué es:** iconos y QR.
**Por qué:** iconos tree-shakeable y el código QR del local para compartir la
tienda (`ShareStoreCard`).

### Estructura de carpetas
```text
src/
├── App.tsx             Rutas + layout (Navbar, sidebar de tiendas seguidas)
├── pages/              HomePage, StorePage, DashboardPage, ChatPage,
│                       SearchPage, LoginPage, RegisterPage,
│                       Forgot/ResetPasswordPage, AdminPage
├── components/         ProductCard, StoreCard, ProductCarousel, ChatPage…
├── services/api.ts     Cliente fetch con JWT automático + adminApi (X-Admin-Token)
├── lib/                categoryFields.ts y plan-config.ts (espejo del backend)
├── stores/             Estado global (usuario, etc.)
└── types/              Tipos compartidos (Store, Product, Message, SaleStats…)
```

---

## Base de datos (Neon PostgreSQL)

**Qué es:** PostgreSQL serverless con conexión pooled.
**Por qué:** BD gratis, sin operar servidor, y el driver `pg` conecta directo.
El esquema se aplica con migraciones versionadas (`npm run db:migrate`).

### Enums
- `plan_type`: `FREE | PRO | BUSINESS`
- `subscription_cycle`: `MONTHLY | BI_MONTHLY`
- `store_status`: `ACTIVE | SUSPENDED | BANNED` (anti-fraude)
- `business_type`: `ROPA | CALZADO | ACCESORIOS | HOGAR | ALIMENTOS | SERVICIOS | OTRO`

### Tablas principales
| Tabla | Rol |
|---|---|
| `users` | Cuentas (email único, `ref_code`, `signup_ip` para anti-fraude) |
| `stores` | Locales (slug único, `plan`, `business_type`, `status`, `prestige_points`, `referral_code`) |
| `categories` / `products` | Catálogo; productos llevan `attributes` (JSON) según la categoría |
| `follows` | Seguidores (unique usuario+tienda) |
| `conversations` / `messages` | Chat 1 cliente ↔ 1 tienda; mensajes con `ai_generated` y `wa_text` |
| `sales` / `sale_items` | Ventas; `payment_method` decide si "cuenta" para el check verificado |
| `violations` | Registro de faltas y sanciones (panel admin) |
| `mp_payments` | Pagos de Mercado Pago/Wompi (idempotentes por `mp_payment_id`) |
| `payment_reports` | Códigos de pago reportados por el comerciante (validación de su espacio) |

---

## Almacenamiento de imágenes (Cloudinary + `/uploads` local)

**Qué es:** CDN de imágenes con URL pública estable.
**Por qué:** en Render (plan free) el disco se borra en cada redeploy; las fotos
subidas deben vivir en Cloudinary. El envío es `POST /api/upload` (multer + validación
de tipo); si hay `CLOUDINARY_*` en el entorno la imagen se sube al CDN y se devuelve
URL absoluta; si no, se guarda en `/uploads` (solo desarrollo/demo).

---

## Despliegue (Render + Docker)

### Un solo servicio, un solo contenedor
`render.yaml` define el servicio web `cici` con `runtime: docker`, plan free,
health check `GET /health` y `PORT=10000`. El `Dockerfile` es de 3 etapas:
1. **frontend-build**: compila la SPA de Vite (`frontend/dist`).
2. **backend-build**: compila el TypeScript (`dist/`).
3. **runtime**: `node:20-alpine` con solo dependencias de producción, copia
   dist + frontend/dist y ejecuta `dist/index.js`.

El proceso escucha en `$PORT` y: sirve la API en `/api/*`, el WebSocket en
`/ws/chat`, y `index.html` (catch-all) en el resto → **frontend y backend en el
mismo dominio**, sin CORS ni URL pública extra.

### Variables de entorno (Render)
`DATABASE_URL` (Neon), `JWT_SECRET`, `GROQ_API_KEY`, `ADMIN_TOKEN`,
`MP_ACCESS_TOKEN`, `WOMPI_*`, `CLOUDINARY_*`, `PUBLIC_BASE_URL`, `TRUST_PROXY`,
`AI_BASE_URL`/`AI_MODEL`. `GOOGLE_CLIENT_ID` aún no está puesta (login con Google
pendiente de configurar).

### Git → deploy automático
Cada `git push` a la rama `dev` dispara el redeploy automático en Render.

> Nota sobre la URL: Render asigna el subdominio con hash de forma permanente
> (`cici-r511.onrender.com`); no se puede "renombrar" a `cici.onrender.com`. Una
> URL limpia requiere dominio propio (el plan free incluye hasta 2 custom domains).

---

## Autenticación

### Flujo estándar
```text
1. POST /api/auth/register { email, password, name, refCode? } → crea usuario,
   guarda bcrypt(password) y su IP de registro (signup_ip)
2. POST /api/auth/login → verifica bcrypt y emite JWT (7 días)
3. El frontend guarda el JWT en localStorage
4. Cada request manda Authorization: Bearer <token>
5. requireAuth lo decodifica y pone req.userId
```
- Rate-limits propios: **login/reset** 10/15 min, **registro** 30/15 min.
- **Recuperación de contraseña**: `forgot-password` envía un enlace con token
  consumible por email (`lib/email.ts`); `reset-password` lo valida y reinicia la
  contraseña. No revela si el email existe o no.

### Login con Google (implementado, desactivado a propósito)
`auth-google.routes.ts` ya verifica el ID token de Google contra las claves
públicas (JWKS), emisor y audiencia, crea el usuario si el correo no existe
(hash inutilizable) o inicia sesión si ya existe. Pero **responde 503** mientras
`GOOGLE_CLIENT_ID` esté vacío, y el botón no se muestra. Para activarlo: crear el
client ID en Google Cloud Console (origen JS autorizado
`https://cici-r511.onrender.com` y `http://localhost:5173`) y poner el MISMO valor
en `GOOGLE_CLIENT_ID` (backend) y `VITE_GOOGLE_CLIENT_ID` (frontend).

---

## Planes, pagos y prestigio

### Planes
| | FREE | PRO | BUSINESS |
|---|---|---|---|
| Productos | 20 | 100 | 500 |
| Precio (early access) | $0 | $20.000/mes · $30.000/bimensual | igual que PRO (misma tarifa, más visibilidad) |
| Prestigio / referidos | no | sí | sí |
| IA en el chat | no | sí | sí |
| Feed | al final | segundo | **primero** |
| Check verificado | no | alcanzable | alcanzable |

El trial es de 30 días, pero **el contacto (chat) está siempre disponible**: el
muro de pago no es poder chatear, es prestigio/productos/IA/visibilidad.
Un cron (al arrancar y cada hora, además del endpoint admin) baja a FREE las
tiendas cuyo `subscription_expires_at` venció.

### Mercado Pago (Checkout Pro, Orders API)
1. `POST /api/payments/preferences` crea la orden con `external_reference`
   `"<storeId>_<PLAN>_<CYCLE>"` (o `"USER_<userId>_<PLAN>_<CYCLE>"` si aún no hay
   tienda) y devuelve la URL de checkout.
2. Al volver o por webhook, el backend **consulta el id contra Mercado Pago**
   (`/status` y `/api/payments/mercadopago/webhook`).
3. Solo si el pago está **approved** (y el monto coincide con el precio del plan:
   cualquier `amount_mismatch` se rechaza) se registra la fila en `mp_payments`
   (idempotente por `mp_payment_id`) y se activa el plan.

### Wompi (Nequi)
Misma regla: `POST /api/payments/wompi/nequi` crea la transacción Nequi (le llega
una notificación push al celular del comprador), se guarda `pending`, y el plan se
activa solo cuando Wompi confirma **APPROVED** (webhook con firma verificada por
`X-Event-Checksum` o sondeo en `/api/payments/wompi/status`). Si el pago se hizo
**antes** de crear la tienda, el plan se aplica automáticamente al crearla
(`store.routes.ts`).

### Prestigio y referidos
- Al activar un plan se genera el `referral_code` de la tienda.
- Cada persona que se registra con ese código y **abre su tienda** da +25 puntos
  de prestigio al referidor (solo si el referidor tiene plan de pago).
- A 100 puntos la tienda obtiene el **check verificado** — con la condición
  adicional del anti-fraude (ver abajo).

---

## La IA y la creación de productos se adaptan a la categoría

### El tipo de negocio define los productos
Al crear/editar la tienda el dueño elige `businessType`
(`ROPA | CALZADO | ACCESORIOS | HOGAR | ALIMENTOS | SERVICIOS | OTRO`). Eso dicta
qué atributos tienen sus productos (`src/lib/categoryFields.ts`):

| Negocio | Atributos del producto |
|---|---|
| ROPA | talla (XS…XXL/personalizada), color, material |
| CALZADO | número (20–50), color |
| ACCESORIOS | tipo (joyería/relojes/bijouterie), material, medida, color |
| HOGAR | tipo de unidad, habitaciones, baños, área m², amoblado, ubicación, disponible desde |
| ALIMENTOS | porción/unidad, restricciones/alérgenos |
| SERVICIOS | duración, modalidad (domicilio/local/virtual) |
| OTRO | sin atributos |

El formulario "Publicar producto" muestra **solo los campos de esa categoría**
(el frontend mantiene un espejo de `categoryFields.ts`), y al guardar
`sanitizeAttributes` deja pasar **únicamente los atributos permitidos** para ese
negocio. Quedan en la columna `attributes` (JSONB), se muestran como chips en la
tarjeta y se convierten en texto legible para la IA (`talla: M, color: azul`).

### La IA de la conversación usa el perfil del tipo de negocio
`src/lib/ai.ts` define un **perfil por tipo de tienda** con 6 reglas:

| Perfil | Cómo acompaña la venta | Qué NUNCA pregunta/asume |
|---|---|---|
| ROPA | pregunta/de hecho confirma la talla deseada y disponible, color/estilo | no inventa tallas ni pide medidas corporales |
| CALZADO | pregunta el número de calzado | no pide tallajes corporales |
| ACCESORIOS | pregunta la variante (color/modelo/material); si es anillo/pulsera/reloj, la medida en mm | **nunca** llama "talla" a nada, ni aunque el catálogo mencione talles |
| HOGAR | pregunta período de arriendo, amoblado, zona, personas; describe la unidad con sus atributos | nunca tallas; factura lleva período + amoblado |
| ALIMENTOS | confirma cantidad/porción, alérgenos, retirar o domicilio | nunca tallas ni recomendaciones médicas |
| SERVICIOS | pregunta fecha, hora, lugar | nunca tallas; factura lleva fecha/hora + lugar |

Ese perfil se inyecta en el prompt para:
1. **El saludo** (solo si el cliente llegó a una conversación desde una tarjeta
   de producto y la tienda es PRO/BUSINESS).
2. **Cada respuesta** con contexto del catálogo (primeros 5 productos, precios,
   stock/agotado, atributos) y el historial de la conversación.
3. **El cierre de venta**: la IA genera la factura (entre `---`) con
   `*Producto:* [Nombre] (talla [n]/variante/período…)`, campos extra según
   negocio (período/amoblado para arriendos; fecha/lugar para servicios) y la
   línea de dirección y teléfono. De esa factura se generan dos versiones: la que
   ve el cliente en el chat y la que recibe el comerciante (aviso de pedido).

Todo esto funciona sin atarse a un proveedor: `AI_BASE_URL`/`AI_MODEL` vienen del
entorno, y si no hay key o la IA falla, un fallback determinístico responde con lo
que hay en el catálogo (ver `GUIA-IA.md`).

---

## Anti-fraude: cómo se evitan las estafas (y qué huecos se corrigieron)

Cada tienda tiene un estado público: **ACTIVE**, **SUSPENDED** (penalización con
fecha fin) o **BANNED** (expulsión que solo revierte el admin). Toda falta se
registra en `violations` (tipo, severidad, tienda, motivo, metadata) para que el
panel de moderación la revise.

### Las 4 reglas activas (Modelo de ventas A)

> **Modelo A (venta por contacto):** la compra se cierra por el canal propio del
> comerciante (su WhatsApp), que es el flujo *esperado*. Por eso mencionar
> WhatsApp/teléfono en el chat **no es falta** y no se castiga. El control de
> fraude se concentra en reputación, evidencia para disputas y reportes del
> comprador.

| # | Regla | Umbral | Consecuencia |
|---|---|---|---|
| 1 | **Granja de referidos** | >3 tiendas creadas **desde la misma IP** con el mismo código en 24 h | no se otorga el premio de prestigio + violación `referral_farm` para el admin |
| 2 | **Verificado "duro"** | plan ≠ FREE **y** prestigio ≥ 100 **y** antigüedad ≥ 7 días **y** ≥ 1 venta pagada por MP/WOMPI/CARD | sin esas 4 condiciones no hay check verificado |
| 3 | **Venta inflada** | ≥ 5 ventas autoregistradas en 24 h **sin** método rastreable | violación `inflated_sale` (el admin decide; no bloquea la tienda) |
| 4 | **Reportes de compradores** | 3 reportes abiertos → suspensión 14 días; 5 → **ban** | auto-suspensión / expulsión automática + anti-spam (1 reporte cada 24 h por comprador-tienda) |

### Modelo A: por qué no se sanciona el cierre por WhatsApp
Inicialmente había una "regla 2" que castigaba mencionar WhatsApp/teléfono en el
chat (auto-suspensión 24 h a los 3 "flags" en 7 días). Eso **contradecía el
flujo real**: la propia app recomienda el WhatsApp del comerciante para cerrar la
venta y genera la factura para enviársela. En el Modelo A ese cierre es el
objetivo, así que la detección se eliminó (moderation.ts, chat.routes.ts y
chatServer.ts ya no la usan). La evidencia para resolver una disputa sigue
disponible: el admin puede ver la transcripción real del chat en la tabla
`messages`.

### Dónde se hace cumplir cada sanción
El estado se aplica en **todos** los puntos de operación:
- **Feed** `GET /api/stores` → solo tiendas `status = 'ACTIVE'` (y antes reactiva
  en lote las suspensiones ya vencidas).
- **Perfil público** `GET /api/stores/:slug` → 404 para visitas no dueñas si la
  tienda no opera; el dueño sí entra y ve su estado y el motivo.
- **Chat REST** → abrir conversación o enviar mensaje con una tienda no operativa
  responde 403.
- **WebSocket** `/ws/chat` → cierra con código **4006** si la tienda no opera, y
  **re-chequea el estado en cada mensaje** (una sanción a mitad de conversación
  bloquea el envío y avisa `chat_suspended`).
- **Ventas** `POST /api/sales` → 403 mientras la tienda esté sancionada (evita
  inflar reputación durante la sanción).
- **Publicar producto** `POST /api/stores/:id/products` → 403 si no opera.
- **Buscador de productos** `GET /api/products?...` → incluye
  `EXISTS (SELECT 1 FROM stores WHERE id = store_id AND status='ACTIVE')`, así los
  productos de tiendas ocultas no aparecen en las búsquedas.
- **Reactivación "lazy"**: cuando expira la sanción, el siguiente request
  (`refreshStoreStatus` en perfil/chat/ventas/publicación, o
  `reauthorizeExpiredSuspensions` en feed/admin) la readmite sola; no hace falta
  un cron finito.

### Panel de moderación
- Endpoints bajo `/api/admin` protegidos con el header **`X-Admin-Token`** igual a
  `ADMIN_TOKEN` (sin login de usuario): listar/resolver violaciones (por estado y
  tipo), listar tiendas (con violaciones abiertas y estado de sanción),
  **suspender** (N días u horas), **banear**, **re-activar/unban**, estadísticas,
  pagos recientes y forzar la expiración de planes.
- En la app, `/admin` (`AdminPage`) tiene una sección **Moderación**, y desde el
  perfil de cualquier tienda (`StorePage`) un comprador puede **reportar** con
  motivo (respuesta JSON indica si hubo `none | suspended | banned`).

### Huecos que existían en el primer diseño y cómo se corrigieron
El sistema se construyó en dos capas: primero el negocio funcionaba (referidos,
prestigio, verificado, reportes, pagos) y luego se auditaron los caminos de abuso.
Los huecos encontrados en las pruebas y sus correcciones, en orden:

1. **El check verificado se compraba con referidos.** Bastaba llegar a 100 de
   prestigio (farmeable creando cuentas). → **Verificado duro**: ahora exige plan
   de pago, 100 puntos, **7 días de vida** y **≥1 venta por un medio rastreable**
   (MP/WOMPI/CARD). El prestigio dejó de ser suficiente.
2. **La granja de referidos no se detectaba.** Se podían crear decenas de tiendas
   con el mismo código desde la misma IP. → Detección por `signup_ip` + burst
   `>3 en 24 h` anula el premio y registra `referral_farm`.
3. **El primer diseño castigaba el cierre por WhatsApp.** Se detectaban patrones
   de "pago por fuera" en el chat y a los 3 flags se auto-suspendía 24 h… pero el
   flujo oficial es cerrar la venta por el WhatsApp del comerciante. → **Modelo
   A**: se eliminó esa regla; el cierre por WhatsApp es la operación normal y el
   control de fraude se apoya en las reglas 1-4 (reputación, evidencia en el
   chat y reportes del comprador).
4. **El dueño podía inflar su reputación con ventas "de caja".** → Solo cuentan
   para el check las ventas por medio rastreable; un volumen raro sin método
   (≥5/24 h) dispara `inflated_sale` para que el admin decida (sin bloquear).
5. **Los reportes de compradores no tenían efecto.** Se registraban y nada más. →
   Escalación automática 3 → suspensión 14 días y 5 → ban, con anti-spam de 1
   reporte por comprador-tienda cada 24 h y veto de auto-reporte.
6. **Una tienda sancionada seguía operando por varias vías.** El chat continuaba,
   el feed seguía mostrándola, el buscador devolvía sus productos y podía
   vender/publicar. → Enforcement en **cada** punto (feed, slug, chat REST, WS con
   código 4006 y re-check por mensaje, ventas, publicaciones, búsqueda con
   `EXISTS ACTIVE`) + reactivación lazy.
7. **El admin no tenía dónde ver las faltas.** → Tabla `violations`, endpoints de
   moderación y la sección "Moderación" en `/admin` (suspend/ban/unban/resolver).

### Pruebas del anti-fraude
`scripts/verify-anti-fraud.mjs` es una batería de 27 verificaciones contra una
base de datos descartable que cubre: escalación de reportes (3→susp, 5→ban),
auto-suspensión de 24 h del chat por off-platform, cierre WS 4006, ventas 403,
reactivación lazy, ocultamiento en feed/búsqueda y el verificado duro
(true/false). Resultado: **27/27 OK**. Además hay tests con vitest + supertest en
`tests/` (`auth-flow.test.ts`, `webhook.test.ts`) y `npm test`.

---

## Flujo del comprador (lo que ve el cliente)

```text
1. Navega el feed (/), la barra de tiendas seguidas o /search
2. Entra a una tienda (GET /api/stores/:slug) y ve sus productos con chips
   de atributos (talla, número, porción, ubicación…)
3. Toca una tarjeta de producto → abre/admin el chat con esa tienda,
   asociando el producto a la conversación
4. Si la tienda es PRO/BUSINESS, la IA le saluda y conversa conociendo el
   catálogo y la categoría (pide talla, variante, cantidad, fecha…)
5. Cuando el cliente confirma la compra, la IA genera la factura con los
   datos de la categoría y la dirección/teléfono
6. El cliente envía mensajes por WebSocket (/ws/chat); puede pedir compra,
   la IA o el dueño responden en tiempo real
7. El comprador puede reportar una tienda si hay mala práctica (StorePage)
```

## Flujo del creador (lo que ve el dueño de la tienda)

```text
1. Se registra (o paga su espacio antes de crear la tienda)
2. Crea UNA tienda (POST /api/stores) eligiendo businessType; si ya pagó,
   el plan se activa solo en esa tienda
3. Publica productos con los campos de su categoría; el stock llega a 0
   → el producto se desactiva solo (no se borra) y se reactiva al reponer
4. Su panel (/dashboard) muestra estadísticas: ventas hoy, ingresos,
   productos más vistos/vendidos, tasa de conversión y ventas recientes
5. Admite y responde chats (los pedidos generados por la IA le llegan con
   aviso de esperarlo en la app)
6. Regala su código de referido para ganar prestigio; con 100 puntos y una
   venta real obtiene el check verificado
7. Si incumple las reglas, la tienda se sanciona sola, se oculta del mall y
   el panel de moderación revisa el caso
```

---

## Decisiones de diseño que NO son obvias

### 1. Un usuario = una tienda
Intentar crear una segunda tienda responde 409. Mantiene el modelo limpio (el
"local" es único por persona) y simplifica el anti-fraude.

### 2. Un solo contenedor para todo (API + WS + frontend)
Render sirve `frontend/dist` desde el mismo Express. Se evitan CORS, dos URLs y
un segundo deploy. El costo: escalar frontend y API por separado no es posible.

### 3. JWT en localStorage
Más simple que cookies httpOnly y suficiente a esta escala; vulnerable a XSS.
Si la plataforma crece con datos sensibles, migrar a cookies.

### 4. WebSocket en memoria
Las "rooms" viven en el proceso. Con un solo worker (Render free) funciona; con
varios workers se perderían mensajes entre instancias → redirigir a Redis.

### 5. El plan se activa SOLO con un pago verificado contra el gateway
Ningún "ojo" humano activa PRO/BUSINESS: al volver del checkout o por webhook, el
backend consulta el id del pago a Mercado Pago/Wompi, valida el **monto exacto**
(`amount_mismatch` rechaza) y solo entonces activa. El pago hecho antes de crear
la tienda se aplica en el momento de crearla.

### 6. El chat no es el muro de pago
El contacto está siempre disponible. El plan paga prestigio, referidos, más
productos, IA y visibilidad. Así el emprendedor experimenta el valor antes de pagar.

### 7. Reactivación lazy, no un cron cada minuto
El estado se re-lee y la sanción expirada se limpia en el primer request que pasa
por `refreshStoreStatus`/`reauthorizeExpiredSuspensions`. Barato y suficiente.

### 8. Prestar atención a los códigos HTTP que "parecen raros"
La batería de pruebas reveló que los endpoints de chat devuelven **200** (no 201)
al crear una conversación: es la convención elegida, no un error. Sirvió también
para detectar el desfase de ~5 h del reloj del contenedor PostgreSQL local
(solo en dev, no en Neon).

### 9. Camino Prisma → Drizzle
El proyecto usaba Prisma y migró a Drizzle porque los engines de Prisma no tienen
build oficial en NixOS y rompían; Drizzle sobre `pg` es TypeScript puro sin
binarios. La lección: elegir dependencias sin binarios nativos cuando el sistema
base es NixOS.

---

## Archivos importantes para entender el sistema

| Archivo | Qué hace |
|---|---|
| `src/index.ts` | Crea la app Express, monta routers, arranca WS y el cron de expiración de planes |
| `src/db/schema.ts` | Todas las tablas, enums y relaciones |
| `src/lib/moderation.ts` | NÚCLEO anti-fraude: umbrales, verificado duro, sanciones, detector off-platform |
| `src/lib/ai.ts` | IA por tipo de negocio, factura del pedido y fallback determinístico |
| `src/lib/categoryFields.ts` | Atributos de producto por categoría (y sanitización) |
| `src/routes/store.routes.ts` | Crear tienda (1 por usuario), feed, perfil, referidos, reportes, admin stats/pagos |
| `src/routes/chat.routes.ts` + `src/ws/chatServer.ts` | Chat REST + WebSocket con moderación |
| `src/routes/sale.routes.ts` | Ventas (con regla de venta inflada) y estadísticas del negocio |
| `src/routes/payments.routes.ts` / `wompi.routes.ts` | Mercado Pago (Checkout Pro) y Wompi (Nequi), verificación idempotente |
| `src/routes/admin.routes.ts` | Panel de moderación (violaciones, tiendas, suspender/ban/unban) |
| `drizzle/0003_optimal_agent_brand.sql` | Migración anti-fraude: `store_status`, `violations`, `payment_method`, `signup_ip` |
| `scripts/verify-anti-fraud.mjs` | Batería de 27 verificaciones del anti-fraude |
| `seed_demo.mjs` | Demo reestructurada: 1 usuario = 1 tienda (ver credenciales abajo) |
| `render.yaml` + `Dockerfile` | Despliegue en Render (un solo contenedor) |
| `frontend/src/pages/AdminPage.tsx` | Panel de moderación en la UI |
| `frontend/src/services/api.ts` | Cliente API con JWT + `adminApi` (X-Admin-Token) |

### Cuentas demo (password `Demo1234` para todas)
| Cuenta | Tienda | Tipo |
|---|---|---|
| `owner@demo.test` | Moda Cielo (`moda-cielo`) | ROPA |
| `paso-urbano@demo.test` | Paso Urbano | CALZADO |
| `destellos@demo.test` | Destellos | ACCESORIOS |
| `renta-del-norte@demo.test` | Renta del Norte | HOGAR (apartamentos) |
| `horno-de-la-abuela@demo.test` | Horno de la Abuela | ALIMENTOS |
| `glow-studio@demo.test` | Glow Studio | SERVICIOS |
| `shopper@demo.test` | — | comprador |

---

## Próximos pasos obvios (por si te interesa)

1. **Activar el login con Google**: crear el client ID en Google Cloud Console
   (origen JS `https://cici-r511.onrender.com` + `http://localhost:5173`) y poner
   `GOOGLE_CLIENT_ID` (backend) + `VITE_GOOGLE_CLIENT_ID` (frontend).
2. **Pegar los webhooks** de Mercado Pago
   (`https://cici-r511.onrender.com/api/payments/mercadopago/webhook`) y Wompi
   (`https://cici-r511.onrender.com/api/payments/wompi/webhook`) en sus dashboards.
3. **Decidir el dominio** (`cici-r511.onrender.com` vs dominio propio).
4. **Cerrar el Early Access** de precios ($20k→$30k / $30k→$55k) cuando toque.
5. **Admin con login real** en vez del header `X-Admin-Token` compartido.
6. **Cookies httpOnly** para el JWT y **Redis pub/sub** si el chat escala a varias
   instancias.
7. **Más baterías**: pagos de punta a punta (MP/Wompi contra sandbox) y prueba de
   carga k6 como la que se hizo en restaurant-api.
8. **Autohospedar la IA** (Ollama/vLLM) como respaldo, tal y como documenta
   `GUIA-IA.md`, para no depender de ningún proveedor.