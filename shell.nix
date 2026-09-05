{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "cc-platform-dev";

  # Nada de binarios de engines que descargar ni resolver: drizzle-orm + pg
  # son JS/TS puro, así que el entorno Nix se reduce a Node y ya.
  buildInputs = with pkgs; [
    nodejs_22 # LTS activo; trae npm y npx incluidos
  ];

  shellHook = ''
    echo "🏬 Entorno CC Platform (NixOS)"
    echo "Node: $(node -v)"

    # Postgres vive en Docker, no en Nix — mismo patrón que restaurant-api.
    if ! (echo >/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
      if docker info >/dev/null 2>&1; then
        echo "→ Iniciando PostgreSQL (Docker) ..."
        docker compose up -d db
      else
        echo "⚠ Docker no está disponible o no está corriendo."
        echo "  Inicia Docker y vuelve a entrar a nix-shell, o levanta"
        echo "  PostgreSQL manualmente y ajusta DATABASE_URL en .env."
      fi
    else
      echo "→ Ya hay algo escuchando en el puerto 5432 (probablemente el contenedor)."
    fi

    if [ ! -f .env ]; then
      cp .env.example .env
      echo "→ Creado .env a partir de .env.example"
    fi

    echo ""
    echo "Listo. Comandos útiles:"
    echo "  npm install               # instala dependencias"
    echo "  npm run db:push           # crea/actualiza las tablas (rápido, para MVP)"
    echo "  npm run dev               # levanta el servidor con recarga"
    echo ""
    echo "Para apagar la base de datos: docker compose stop"
  '';
}
