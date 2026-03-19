# OGIS Inspection App

Local-network web app for field inspections with:

- Map-first inspection management
- Checklist/media/review workflow
- Admin backup/restore
- Local SQLite backend (no cloud dependency)

## Stack

- Frontend: Vue 3 + Vite + Leaflet
- Backend: Express + SQLite (`better-sqlite3`)

## Requirements

- Node.js 20+ (required)
- npm 9+
- Linux/macOS (or Windows with WSL recommended)

The project uses `./bin/ogis-node` to force a Node 20+ binary for both frontend and backend scripts.

## Fresh Installation

```bash
git clone <your-repo-url> ogis-app
cd ogis-app

# Frontend dependencies
npm install

# Backend dependencies
cd server
npm install
cd ..
```

## Development Run

Run backend and frontend in separate terminals.

Terminal 1:
```bash
cd server
npm run dev
```

Terminal 2:
```bash
cd /path/to/ogis-app
npm run dev
```

If backend is running on HTTPS `:8443`, run frontend dev with proxy env vars:

```bash
cd /path/to/ogis-app
VITE_API_PROXY_TARGET=https://127.0.0.1:8443 VITE_API_PROXY_SECURE=0 npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API health: `http://localhost:8787/api/health`

LAN access (phone/other PC on same network):

- Frontend: `http://<your-pc-ip>:5173`
- Backend: `http://<your-pc-ip>:8787`

Make sure OS firewall allows inbound TCP on `5173` and `8787`.

## Default Seed Accounts

Created on first backend start:

- `admin` / `local-seed`
- `supervisor1` / `local-seed`
- `inspector1` / `local-seed`
- `inspector2` / `local-seed`

Password change is required after first login.

## Production Build + Run

### Quick Deploy (Single Service)

This project now supports running frontend + backend from one backend process.

Run:

```bash
cd /path/to/ogis-app
./scripts/deploy.sh
```

With systemd + HTTPS:

```bash
cd /path/to/ogis-app
INSTALL_SYSTEMD=1 \
OGIS_TLS_CERT_FILE=/etc/letsencrypt/live/your-domain/fullchain.pem \
OGIS_TLS_KEY_FILE=/etc/letsencrypt/live/your-domain/privkey.pem \
OGIS_CORS_ALLOWED_ORIGINS=https://your-domain:8443 \
./scripts/deploy.sh
```

After deploy, app is served from backend on `http(s)://<server>:8443` by default.

Notes:

- Replace `your-domain` with your real domain.
- Cert/key paths must exist; deploy script now validates them before starting service.
- If you do not have TLS certs yet, run without `OGIS_TLS_CERT_FILE` and `OGIS_TLS_KEY_FILE` first (HTTP mode), then enable HTTPS later.

Generate a self-signed cert for local testing:

```bash
cd /path/to/ogis-app
mkdir -p server/certs

cat > server/certs/openssl-san.cnf <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = AE
ST = Dubai
L = Dubai
O = OGIS Local
OU = Dev
CN = localhost

[v3_req]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server/certs/selfsigned-key.pem \
  -out server/certs/selfsigned-cert.pem \
  -config server/certs/openssl-san.cnf

chmod 600 server/certs/selfsigned-key.pem
```

Deploy with the generated cert:

```bash
cd /path/to/ogis-app
INSTALL_SYSTEMD=1 \
OGIS_TLS_CERT_FILE=$PWD/server/certs/selfsigned-cert.pem \
OGIS_TLS_KEY_FILE=$PWD/server/certs/selfsigned-key.pem \
OGIS_CORS_ALLOWED_ORIGINS=https://localhost:8443 \
./scripts/deploy.sh
```

For LAN access, add your server IP to both certificate SAN and `OGIS_CORS_ALLOWED_ORIGINS`.

### Service Control (systemd)

Stop backend service:

```bash
sudo systemctl stop ogis-backend
```

Check status:

```bash
systemctl status ogis-backend --no-pager
```

Disable auto-start on boot:

```bash
sudo systemctl disable ogis-backend
```

### 1) Build frontend

```bash
cd /path/to/ogis-app
npm run build
```

This generates static files in `dist/`.

### 2) Run backend in production mode

```bash
cd /path/to/ogis-app/server
HOST=127.0.0.1 PORT=8787 npm run start
```

Important backend environment variables:

- `HOST` (default `0.0.0.0`)
- `PORT` (default `8787`)
- `OGIS_DATA_DIR` (default `server/data`)
- `OGIS_DB_FILE` (default `<OGIS_DATA_DIR>/ogis-local.sqlite`)
- `OGIS_WEB_DIST_DIR` (default `<repo>/dist`, served by backend if `index.html` exists)
- `OGIS_CORS_ALLOWED_ORIGINS` (comma-separated origins)
- `OGIS_TLS_CERT_FILE` (enable native HTTPS when set with key file)
- `OGIS_TLS_KEY_FILE` (enable native HTTPS when set with cert file)
- `OGIS_TLS_CA_FILE` (optional CA chain)
- `OGIS_TLS_PASSPHRASE` (optional private key passphrase)

### 3) Serve `dist/` and proxy `/api` to backend

Example Nginx server block:

```nginx
server {
    listen 80;
    server_name _;

    root /opt/ogis-app/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Data and Backups

- Database and media are stored under `server/data/` by default.
- Admin panel supports export/import backup for full restore.
- Include `server/data/` in your system backup policy.

## Notes

- This repository is cleaned for the current inspection workflow.
- Legacy Waymark editor assets/components were removed because they are not used by this app.
