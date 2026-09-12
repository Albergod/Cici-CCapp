# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile para deploy (Railway, Render, etc.).
# Un solo proceso sirve backend (Express + WebSocket en $PORT) y el frontend
# compilado (Vite) desde el mismo dominio.
#
# Variables de entorno requeridas en el deploy:
#   DATABASE_URL, JWT_SECRET, GROQ_API_KEY, GOOGLE_CLIENT_ID
# ─────────────────────────────────────────────────────────────────────────────

# Etapa 1: compilar el frontend (Vite)
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend ./frontend
RUN npm run build --prefix frontend

# Etapa 2: compilar el backend (TypeScript)
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Etapa 3: imagen final (solo runtime)
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]