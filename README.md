# CC Platform — Centro Comercial Digital (MVP)

Backend del MVP: cada persona crea su **Tienda** (su "canal"), publica
**Productos**, otros usuarios pueden **seguir** la tienda y **descubrirla**
en el feed, y hay un **chat contextual** (uno por cliente-tienda) vía REST +
WebSocket.

Alcance a propósito reducido — sin pagos, sin delivery, sin livestreaming
todavía. Primero se valida el núcleo: crear tienda → publicar → que te
descubran → que te escriban.

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
npm run db:push     # aplica el esquema directamente (rápido, para MVP)
npm run dev          # servidor con recarga en :3000
```

Cuando el proyecto crezca y quieras migraciones versionadas en vez de
`db:push`, usa:

```bash
npm run db:generate  # genera el SQL de migración en ./drizzle
npm run db:migrate    # lo aplica
```

`npm run db:studio` abre una UI web para explorar los datos.

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
