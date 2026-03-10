# OGIS Local Server (Scaffold)

This backend is a local-only scaffold for inspection workflows:

- Express HTTP server
- SQLite database bootstrap and migrations
- RBAC wiring using the shared policy in `src/security/rbac.js`

## Install

```bash
cd server
npm install
```

## Run

```bash
npm run dev
```

Default URL: `http://0.0.0.0:8787`

## Auth Flow

Use local login to get a Bearer token:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"inspector1","password":"local-seed"}' \
  http://localhost:8787/api/auth/login
```

Then call APIs with:

```bash
Authorization: Bearer <access_token>
```

Password rule: minimum 8 characters, with at least one letter and one number.

If `must_change_password` is `true` after login, protected APIs will return:

```json
{
  "error": "Password change required",
  "code": "PASSWORD_CHANGE_REQUIRED"
}
```

In that state, call `POST /api/auth/change-password` first.

## Debug Headers (Optional)

Debug headers are disabled by default. To enable local-only header auth for development, set:

```bash
export OGIS_ALLOW_DEBUG_HEADER_AUTH=1
```

When enabled, this scaffold reads actor context from request headers for loopback requests only:

- `x-user-id`: numeric user id (for example `3`)
- `x-user-role`: role name(s), comma-separated (for example `inspector`)
- `x-team-ids`: team ids, comma-separated (for example `1,2`)

## Deployment Security Settings

Login throttling is SQLite-backed (table `login_rate_limits`), so lockouts persist across restarts and are shared by instances that use the same DB file.

Rate-limit tuning:

```bash
export OGIS_LOGIN_RATE_LIMIT_WINDOW_MS=900000
export OGIS_LOGIN_RATE_LIMIT_MAX_ATTEMPTS=8
export OGIS_LOGIN_RATE_LIMIT_LOCK_MS=900000
```

CORS tuning (disabled by default until allowed origins are set):

```bash
export OGIS_CORS_ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
export OGIS_CORS_ALLOW_CREDENTIALS=1
export OGIS_CORS_ALLOWED_METHODS="GET,POST,PATCH,DELETE,OPTIONS"
export OGIS_CORS_ALLOWED_HEADERS="Authorization,Content-Type"
export OGIS_CORS_MAX_AGE_SECONDS=600
```

Security header tuning:

```bash
export OGIS_API_CSP="default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
export OGIS_PERMISSIONS_POLICY="camera=(), microphone=(), geolocation=()"
```

## Sample Requests

Health:

```bash
curl http://localhost:8787/api/health
```

Current user:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/auth/me
```

List current user sessions:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/auth/sessions
```

Revoke one session:

```bash
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/auth/sessions/12/revoke
```

Revoke all other sessions:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"include_current":false}' \
  http://localhost:8787/api/auth/sessions/revoke-all
```

Change own password:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"current_password":"local-seed","new_password":"Inspector123"}' \
  http://localhost:8787/api/auth/change-password
```

Admin reset user password:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_access_token>" \
  -d '{"new_password":"Reset1234"}' \
  http://localhost:8787/api/auth/users/3/reset-password
```

Read inspection as inspector:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1
```

Inspection activity timeline:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/1/timeline?page=1&limit=50"
```

Include media read events in timeline:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/1/timeline?include_reads=1"
```

Filter timeline by category/action/date:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/1/timeline?category=media,review&action=inspection.media_uploaded&date_from=2026-01-01&date_to=2026-12-31"
```

List inspections (role-scoped):

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections?page=1&limit=20&sort=-created_at"
```

List inspections with filters:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections?status=draft,submitted&team_id=1&search=warehouse&date_from=2026-01-01&date_to=2026-12-31"
```

Get all scoped inspections for a single map (includes `latitude`/`longitude`, no pagination):

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/map?status=draft,submitted&team_id=1"
```

Get master map payload (all inspections with geometry + shared zones/labels):

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/master-map?team_id=1"
```

Create a master map zone:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "kind":"zone",
    "title":"Hazard Zone A",
    "geometry":{
      "type":"Polygon",
      "coordinates":[[[55.2708,25.2048],[55.2730,25.2052],[55.2722,25.2070],[55.2708,25.2048]]]
    }
  }' \
  http://localhost:8787/api/inspections/master-map/overlays
```

Create a master map label:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"kind":"label","label_text":"Main Gate","latitude":25.2054,"longitude":55.2711}' \
  http://localhost:8787/api/inspections/master-map/overlays
```

Get dashboard summary (counts by status with same filters):

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/summary?team_id=1&search=warehouse"
```

Get dashboard summary by assignee:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/summary/by-assignee?team_id=1"
```

Admin debug: query plans for list + timeline (index usage):

```bash
curl \
  -H "Authorization: Bearer <admin_access_token>" \
  "http://localhost:8787/api/inspections/debug/index-plan?status=submitted&team_id=1&tl_inspection_id=1&tl_category=media,review&tl_include_reads=1"
```

Admin debug: performance snapshot (row counts + recent timings):

```bash
curl \
  -H "Authorization: Bearer <admin_access_token>" \
  "http://localhost:8787/api/inspections/debug/perf-snapshot?status=submitted&team_id=1&tl_inspection_id=1&recent_limit=10"
```

Perf samples are persisted in SQLite (`query_perf_samples`) with retention per series.

Admin debug: purge/reset persisted perf samples on demand:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_access_token>" \
  -d '{"series":["list","timeline"],"older_than_days":30,"keep_latest":200}' \
  http://localhost:8787/api/inspections/debug/perf-snapshot/purge
```

Reset all samples for one series:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_access_token>" \
  -d '{"series":["timeline"],"reset":true}' \
  http://localhost:8787/api/inspections/debug/perf-snapshot/purge
```

Preview only (dry run, no rows deleted):

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_access_token>" \
  -d '{"series":["list"],"keep_latest":100,"dry_run":true}' \
  http://localhost:8787/api/inspections/debug/perf-snapshot/purge
```

Create inspection:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"site_name":"Warehouse B","team_id":1,"assigned_to":3,"latitude":25.2048,"longitude":55.2708,"notes":"Initial visit"}' \
  http://localhost:8787/api/inspections
```

Create inspection with area geometry:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "site_name":"Warehouse C",
    "team_id":1,
    "assigned_to":3,
    "geometry":{
      "type":"Polygon",
      "coordinates":[[[55.2708,25.2048],[55.2730,25.2052],[55.2722,25.2070],[55.2708,25.2048]]]
    },
    "notes":"Area-based inspection"
  }' \
  http://localhost:8787/api/inspections
```

Update notes/location as inspector:

```bash
curl -X PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{"notes":"Checklist item updated.","latitude":25.2060,"longitude":55.2721}' \
  http://localhost:8787/api/inspections/1
```

Update inspection geometry (point/area):

```bash
curl -X PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "geometry":{
      "type":"Polygon",
      "coordinates":[[[55.2708,25.2048],[55.2730,25.2052],[55.2722,25.2070],[55.2708,25.2048]]]
    }
  }' \
  http://localhost:8787/api/inspections/1
```

Submit inspection:

```bash
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/submit
```

Upsert checklist item responses:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "items": [
      {"item_key":"safety_signage","item_label":"Safety signage","result":"pass","comment":"Visible"},
      {"item_key":"fire_extinguisher","item_label":"Fire extinguisher","result":"fail","comment":"Expired"}
    ]
  }' \
  http://localhost:8787/api/inspections/1/items
```

Get checklist item responses:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/items
```

Upload media evidence (`multipart/form-data`):

```bash
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@/path/to/photo.jpg" \
  -F "item_key=safety_signage" \
  http://localhost:8787/api/inspections/1/media
```

Optional link by response id:

```bash
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@/path/to/report.pdf" \
  -F "item_response_id=12" \
  http://localhost:8787/api/inspections/1/media
```

List media:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/media
```

Read media file (inline):

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/media/5/file
```

Download media file as attachment:

```bash
curl -L \
  -H "Authorization: Bearer <access_token>" \
  "http://localhost:8787/api/inspections/1/media/5/file?download=1" \
  -o evidence.bin
```

Delete media:

```bash
curl -X DELETE \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/media/5
```

Files are stored locally under `server/data/media/<inspection_id>/`.

`overall_result` is auto-calculated from item results:
- any `fail` => `fail`
- otherwise any `pass` => `pass`
- otherwise => `na`

Review decision (supervisor/admin):

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <supervisor_or_admin_token>" \
  -d '{"decision":"review","comment":"Start QA review"}' \
  http://localhost:8787/api/inspections/1/review
```

Valid decisions: `review`, `approve`, `reject`, `reopen`.

List review history:

```bash
curl \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/inspections/1/reviews
```

Logout:

```bash
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  http://localhost:8787/api/auth/logout
```
