#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-ogis-backend}"
SERVICE_USER="${SERVICE_USER:-$USER}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER" 2>/dev/null || echo "$SERVICE_USER")}"
SERVICE_HOME="${SERVICE_HOME:-$(getent passwd "$SERVICE_USER" | cut -d: -f6 2>/dev/null || echo "/home/$SERVICE_USER")}"
ENV_FILE="${ENV_FILE:-$APP_DIR/server/.env.production}"
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-0}"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8443}"
NODE_ENV="${NODE_ENV:-production}"

DATA_DIR="${OGIS_DATA_DIR:-$APP_DIR/server/data}"
DB_FILE="${OGIS_DB_FILE:-$DATA_DIR/ogis-local.sqlite}"
WEB_DIST_DIR="${OGIS_WEB_DIST_DIR:-$APP_DIR/dist}"
CORS_ALLOWED_ORIGINS="${OGIS_CORS_ALLOWED_ORIGINS:-}"

TLS_CERT_FILE="${OGIS_TLS_CERT_FILE:-}"
TLS_KEY_FILE="${OGIS_TLS_KEY_FILE:-}"
TLS_CA_FILE="${OGIS_TLS_CA_FILE:-}"
TLS_PASSPHRASE="${OGIS_TLS_PASSPHRASE:-}"
NODE_BIN="${OGIS_NODE_BIN:-}"

version_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

pick_node_bin() {
  if [[ -n "$NODE_BIN" ]]; then
    if [[ ! -x "$NODE_BIN" ]]; then
      echo "ERROR: OGIS_NODE_BIN is not executable: $NODE_BIN" >&2
      exit 1
    fi
    if [[ "$(version_major "$NODE_BIN")" -lt 20 ]]; then
      echo "ERROR: OGIS_NODE_BIN must be Node.js 20+: $NODE_BIN" >&2
      exit 1
    fi
    echo "$NODE_BIN"
    return 0
  fi

  local candidate
  candidate="$(command -v node 2>/dev/null || true)"
  if [[ -n "$candidate" && -x "$candidate" && "$(version_major "$candidate")" -ge 20 ]]; then
    echo "$candidate"
    return 0
  fi

  for candidate in /usr/local/bin/node /usr/bin/node /bin/node; do
    if [[ -x "$candidate" && "$(version_major "$candidate")" -ge 20 ]]; then
      echo "$candidate"
      return 0
    fi
  done

  echo "ERROR: Could not find Node.js 20+ binary. Set OGIS_NODE_BIN=/full/path/to/node" >&2
  exit 1
}

if [[ -n "$TLS_CERT_FILE" && -z "$TLS_KEY_FILE" ]]; then
  echo "ERROR: OGIS_TLS_KEY_FILE is required when OGIS_TLS_CERT_FILE is set." >&2
  exit 1
fi

if [[ -z "$TLS_CERT_FILE" && -n "$TLS_KEY_FILE" ]]; then
  echo "ERROR: OGIS_TLS_CERT_FILE is required when OGIS_TLS_KEY_FILE is set." >&2
  exit 1
fi

if [[ -n "$TLS_CERT_FILE" && ! -f "$TLS_CERT_FILE" ]]; then
  echo "ERROR: TLS cert file not found: $TLS_CERT_FILE" >&2
  exit 1
fi

if [[ -n "$TLS_KEY_FILE" && ! -f "$TLS_KEY_FILE" ]]; then
  echo "ERROR: TLS key file not found: $TLS_KEY_FILE" >&2
  exit 1
fi

if [[ -n "$TLS_CA_FILE" && ! -f "$TLS_CA_FILE" ]]; then
  echo "ERROR: TLS CA file not found: $TLS_CA_FILE" >&2
  exit 1
fi

NODE_BIN="$(pick_node_bin)"
echo "Using Node binary: $NODE_BIN"

echo "[1/4] Installing dependencies..."
(cd "$APP_DIR" && npm install)
(cd "$APP_DIR/server" && npm install)

echo "[2/4] Building frontend..."
(cd "$APP_DIR" && npm run build)

echo "[3/4] Writing runtime environment file: $ENV_FILE"
mkdir -p "$(dirname -- "$ENV_FILE")"
mkdir -p "$DATA_DIR"

cat >"$ENV_FILE" <<EOF
HOST=$HOST
PORT=$PORT
NODE_ENV=$NODE_ENV
OGIS_DATA_DIR=$DATA_DIR
OGIS_DB_FILE=$DB_FILE
OGIS_WEB_DIST_DIR=$WEB_DIST_DIR
OGIS_CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS
OGIS_TLS_CERT_FILE=$TLS_CERT_FILE
OGIS_TLS_KEY_FILE=$TLS_KEY_FILE
OGIS_TLS_CA_FILE=$TLS_CA_FILE
OGIS_TLS_PASSPHRASE=$TLS_PASSPHRASE
OGIS_NODE_BIN=$NODE_BIN
EOF

if [[ "$INSTALL_SYSTEMD" == "1" ]]; then
  echo "[4/4] Installing and starting systemd service: $SERVICE_NAME"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=OGIS Backend Service
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
Environment=HOME=$SERVICE_HOME
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/bin/ogis-node src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager
else
  echo "[4/4] Skipped systemd installation (set INSTALL_SYSTEMD=1 to enable)."
  echo
  echo "Run manually:"
  echo "cd \"$APP_DIR/server\" && set -a && . \"$ENV_FILE\" && set +a && \"$APP_DIR/bin/ogis-node\" src/index.js"
fi

if [[ -n "$TLS_CERT_FILE" && -n "$TLS_KEY_FILE" ]]; then
  echo
  echo "Deployment complete. Open: https://<server-ip-or-domain>:$PORT"
else
  echo
  echo "Deployment complete. Open: http://<server-ip-or-domain>:$PORT"
  echo "Tip: set OGIS_TLS_CERT_FILE and OGIS_TLS_KEY_FILE for HTTPS."
fi
