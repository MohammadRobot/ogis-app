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
- `OGIS_CORS_ALLOWED_ORIGINS` (comma-separated origins)

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
