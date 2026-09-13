#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh — Sube la app a Alwaysdata (un solo comando)
#
#  Uso:  ./deploy.sh
#  Qué hace:
#    1. Compila el backend  (dist/)
#    2. Compila el frontend (frontend/dist/)
#    3. Empaca y sube por SSH al servidor
#    4. Extrae los archivos en la carpeta de la app
#
#  Después de subir:
#    • Cambios de frontend: ya están visibles (sin reiniciar).
#    • Cambios de backend: reinicia el sitio en
#      https://admin.alwaysdata.com → Web → Sitios → Reiniciar
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuración ──────────────────────────────────────────────────────────
SSH_HOST="ssh-cici.alwaysdata.net"      # host SSH de Alwaysdata
SSH_USER="cici"                         # usuario SSH
REMOTE_APP="/home/$SSH_USER/www/app"    # carpeta de la app en el servidor
TAR_NAME="cc-deploy.tar.gz"

# ── Salida amigable ─────────────────────────────────────────────────────────
log() { printf "\033[1;34m▶\033[0m %s\n" "$*"; }

# Nos ubicamos en la raíz del proyecto (una carpeta arriba de este script).
cd "$(dirname "$0")"

#── 1. Backend ────────────────────────────────────────────────────────────────
log "Compilando backend (npm run build) ..."
npm run build

# ── 2. Frontend ─────────────────────────────────────────────────────────────
log "Compilando frontend (npm run build) ..."
(cd frontend && npm run build)

# ── 3. Empaquetar y subir ────────────────────────────────────────────────────
log "Empacando dist + frontend/dist ..."
tar czf "/tmp/$TAR_NAME" dist frontend/dist package.json

log "Subiendo por SSH a $SSH_USER@$SSH_HOST ..."
scp -o BatchMode=yes "/tmp/$TAR_NAME" "$SSH_USER@$SSH_HOST:$TAR_NAME"

log "Extrayendo en el servidor ($REMOTE_APP) ..."
ssh -o BatchMode=yes "$SSH_USER@$SSH_HOST" "cd '$REMOTE_APP' && rm -rf dist frontend/dist && tar xzf \"\$HOME/$TAR_NAME\" && rm \"\$HOME/$TAR_NAME\""

# ── 4. Resumen ──────────────────────────────────────────────────────────────
echo ""
printf "\033[1;32m✔ Listo, código subido.\033[0m\n"
echo ""
echo "  Si cambiaste el BACKEND, reinicia el sitio una vez:"
echo "    https://admin.alwaysdata.com → Web → Sitios → Reiniciar"
echo ""