# CiCi — Centro Comercial Digital

Plataforma para crear una **Tienda**, publicar **Productos** y **Servicios**,
vender por **chat contextual** (REST + WebSocket), agendar citas, cobrar
**planes** (Mercado Pago / Wompi-Nequi) y operar **pago protegido** con
custodia y liberación a 48 h.

El proyecto está en fase de **piloto cerrado**, no es un MVP: el backend
incluye migraciones versionadas, moderación, trial, referidos, prestigio y
pruebas de integridad financiera.

## Stack

- Node.js 22 + TypeScript + Express
- PostgreSQL (en Docker) + **Drizzle ORM** (JS/TS puro, sin binarios nativos)
- WebSocket (`ws`) para el chat en tiempo real
- JWT para auth, `zod` para validación

> Nota: la primera versión de este proyecto usaba Prisma, pero en NixOS los
> binarios de engine de Prisma dan problemas recurrentes (no hay build
> publicado para NixOS, y la versión de `prisma-engines` en Nixpkgs no
> siempre coincide con la de `@prisma/client`). Se cambió a Drizzle porque
> es TypeScript puro sobre el driver `pg` — sin binarios que resolver.

## Requisitos previos

- **Nix** (ya lo tienes en NixOS).
- **Docker**, corriendo. La base de datos vive en un contenedor — mismo
  patrón que en `restaurant-api`.

## Uso en NixOS

```bash
cd cc-platform
nix-shell
```

La primera vez, `nix-shell` va a:
1. Traer Node 22 (nada más — sin engines que resolver).
2. Levantar el contenedor de PostgreSQL con `docker compose up -d db`
   (si Docker está corriendo).
3. Crear tu `.env` a partir de `.env.example` si no existe.

Dentro de la shell:

```bash
npm install
npm run db:migrate   # aplica drizzle/ (única fuente de verdad del esquema)
npm run dev          # servidor con recarga en :3000
```

El esquema se versiona **solo** con migraciones Drizzle:

```bash
npm run db:generate  # genera el SQL de una migración nueva en ./drizzle
npm run db:migrate    # aplica las pendientes
npm run db:studio     # UI web para explorar los datos
```

Si la base nació con `db:push` y no tiene journal de migraciones, adóptala
una sola vez con `npm run db:baseline -- --yes --through=0019_store_members`
y luego ejecuta `npm run db:migrate`. No se debe usar `db:push` en producción.

Para apagar la base de datos: `docker compose stop` (los datos se
conservan). Para borrarla del todo: `docker compose down -v`.

## Endpoints principales

| Método | Ruta                                   | Qué hace                                  |
|--------|-----------------------------------------|--------------------------------------------|
| POST   | `/api/auth/register`                    | Crear usuario                              |
| POST   | `/api/auth/login`                       | Login → JWT                                |
| POST   | `/api/stores`                           | Crear tienda (requiere auth)               |
| GET    | `/api/stores`                           | Feed / explorar tiendas                    |
| GET    | `/api/stores/:slug`                     | Perfil de una tienda ("canal")             |
| POST   | `/api/stores/:id/follow`                | Seguir / dejar de seguir                   |
| POST   | `/api/stores/:storeId/products`         | Publicar producto (dueño de la tienda)     |
| PATCH  | `/api/products/:id`                     | Editar / dar de baja producto              |
| GET    | `/api/products?q=...`                   | Buscar productos / tendencias              |
| POST   | `/api/stores/:storeId/conversation`     | Abrir chat con una tienda                  |
| GET    | `/api/conversations`                    | Mis conversaciones (como cliente y dueño)  |
| GET    | `/api/conversations/:id/messages`       | Historial de un chat                       |
| WS     | `/ws/chat?token=JWT&conversationId=...` | Mensajes en tiempo real                    |

## Modelo de datos

`User → Store → Product / Category`, `User —follow→ Store`,
`Conversation (customer + store) → Message`. Ver `src/db/schema.ts`.

## Próximos pasos sugeridos

1. Endpoint de subida de imágenes (logo, banner, fotos de producto) — hoy se
   reciben como URL directa para no complicar el MVP.
2. Niveles de plan (`FREE` / `PRO` / `BUSINESS`) ya están en el modelo pero
   sin lógica de límites todavía (ej. tope de 20 productos en `FREE`).
3. Frontend estilo feed (YouTube/Twitch) que consuma `/api/stores` y
   `/api/products`.
4. Live shopping — cuando el resto esté validado, no antes.
