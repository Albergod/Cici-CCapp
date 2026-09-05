# CC Platform Frontend

Frontend para el Centro Comercial Digital - React + Vite + Tailwind CSS

## Inicio Rápido

### 1. Instalar dependencias
```bash
cd frontend
npm install
```

### 2. Iniciar backend (en otra terminal)
```bash
cd ..
npm run dev
```

### 3. Iniciar frontend
```bash
npm run dev
```

El frontend estará disponible en `http://localhost:5173` y se conectará automaticamente al backend en `http://localhost:3000` via proxy de Vite.

## Funcionalidades

### Autenticación
- Registro de nuevos usuarios
- Inicio de sesión con JWT
- Persistencia de sesión en localStorage

### Tiendas
- Feed principal de tiendas
- Perfil de tienda con productos
- Sistema de seguidores
- Creación de tienda propia

### Productos
- Búsqueda de productos
- Vista de detalles
- CRUD de productos (solo propietarios)

### Chat
- Conversaciones en tiempo real via WebSocket
- Chat 1:1 cliente-tienda
- Historial de mensajes

## Estructura

```
frontend/
├── src/
│   ├── components/    # Componentes reutilizables
│   │   ├── Navbar.tsx
│   │   ├── StoreCard.tsx
│   │   └── ProductCard.tsx
│   ├── pages/         # Páginas de la aplicación
│   │   ├── HomePage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── StorePage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── ChatPage.tsx
│   │   └── SearchPage.tsx
│   ├── services/      # Servicios API
│   │   └── api.ts
│   ├── stores/        # Estado global
│   │   └── authStore.ts
│   └── types/         # Tipos TypeScript
│       └── index.ts
├── package.json
├── tailwind.config.js
└── vite.config.ts
```

## Tecnologías

- **React 18** - UI Library
- **TypeScript** - Tipado estático
- **Vite** - Build tool y dev server
- **Tailwind CSS** - Estilos
- **React Router** - Navegación
- **Lucide React** - Iconos

## Configuración

El frontend se conecta automaticamente al backend en `http://localhost:3000` via proxy de Vite (`vite.config.ts`).

### Nota sobre puertos
- El **backend** corre en `http://localhost:3000` (según `PORT` en `.env`).
- El **frontend** corre en `http://localhost:5173` y redirige `/api` y `/ws` hacia el backend.

### Variables de entorno (opcional)
No se requieren variables de entorno para el frontend. La configuración está en `vite.config.ts`.