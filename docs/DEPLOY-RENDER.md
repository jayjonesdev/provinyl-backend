# Deploying ProVinyl to Render (both apps)

Two Render services, one per repo:

| Service | Repo | Type | URL (predicted) |
|---|---|---|---|
| **provinyl-backend** | `jayjonesdev/provinyl-backend` | Docker web service | `https://provinyl-backend.onrender.com` |
| **provinyl-web** | `jayjonesdev/provinyl-web` | Static site (SPA) | `https://provinyl-web.onrender.com` |

Each repo has its own `render.yaml` ([Blueprint](https://render.com/docs/blueprint-spec)).
MongoDB is **not** on Render — use **MongoDB Atlas**.

> Render may append a random suffix if a service name is taken; use the real URLs
> it gives you wherever the predicted ones appear below.

---

## Prerequisites

1. **MongoDB Atlas** — free M0 cluster + a DB user; allow network access
   (`0.0.0.0/0`, or Render's static egress IPs on paid plans). Copy the
   `mongodb+srv://…` string → `MONGO_URI`.
2. **Discogs app** — register at <https://www.discogs.com/settings/developers> for
   a **Consumer Key** + **Secret**. The callback URL is set after the backend
   deploys (you need its URL first).
3. **`TOKEN_ENC_KEY`** — `openssl rand -hex 32`.

---

## The ordering (URLs reference each other)

The two services' env vars cross-reference each other's URLs, so do it in this
order:

```
1. Deploy backend            → get https://provinyl-backend.onrender.com
2. Deploy frontend with
     VITE_API_BASE = <backend>/api/v1   → get https://provinyl-web.onrender.com
3. Set on the backend:
     CLIENT_ORIGIN        = https://provinyl-web.onrender.com
     DISCOGS_CALLBACK_URL = https://provinyl-backend.onrender.com/api/v1/auth/callback
   and set that same callback URL in the Discogs app settings → redeploy backend
```

---

## Step 1 — Backend (Docker web service)

1. Render → **New → Blueprint** → connect `jayjonesdev/provinyl-backend`. It reads
   `render.yaml` and creates `provinyl-backend`.
2. Fill the `sync: false` env vars (leave `CLIENT_ORIGIN` / `DISCOGS_CALLBACK_URL`
   as placeholders for now; `JWT_SECRET` is auto-generated; `NODE_ENV`, `PORT`,
   JWT expiries are preset):
   | Key | Value |
   |---|---|
   | `MONGO_URI` | your Atlas `mongodb+srv://…` |
   | `DISCOGS_CONSUMER_KEY` / `_SECRET` | from the Discogs app |
   | `TOKEN_ENC_KEY` | `openssl rand -hex 32` |
   | `CLIENT_ORIGIN` | `https://provinyl-web.onrender.com` (set/confirm after step 2) |
   | `DISCOGS_CALLBACK_URL` | `https://provinyl-backend.onrender.com/api/v1/auth/callback` |
3. Deploy. Render builds the Dockerfile and health-checks `/api/v1/health`. Note
   the URL.

## Step 2 — Frontend (static site)

1. Render → **New → Blueprint** → connect `jayjonesdev/provinyl-web` (or **New →
   Static Site** manually: build `npm ci --include=dev && npm run build`, publish
   `dist`, add a rewrite `/* → /index.html`).
2. Set the build-time env var:
   | Key | Value |
   |---|---|
   | `VITE_API_BASE` | `https://provinyl-backend.onrender.com/api/v1` |
3. Deploy. Note the URL (e.g. `https://provinyl-web.onrender.com`).

> `VITE_API_BASE` is **baked in at build time** — if you change it later, trigger
> a **manual rebuild** (clear build cache) for it to take effect.

## Step 3 — Wire them together

1. On **provinyl-backend**, confirm `CLIENT_ORIGIN` = the frontend URL and
   `DISCOGS_CALLBACK_URL` = `<backend>/api/v1/auth/callback`.
2. In the **Discogs app settings**, set the **Callback URL** to that same value.
3. Redeploy the backend.

---

## Verify

```bash
curl https://provinyl-backend.onrender.com/api/v1/health   # {"status":"ok",...}
```
Open `https://provinyl-web.onrender.com` → "Connect Discogs" → approve → you land
back signed in, with your collection loading.

---

## Notes

- **Cross-site cookies (handled).** `*.onrender.com` subdomains are *cross-site*
  per the Public Suffix List, so in production the session cookies are issued
  `SameSite=None; Secure` (`src/auth/cookies.ts`, keyed on `NODE_ENV`). That
  requires HTTPS — Render provides it. CORS is pinned to `CLIENT_ORIGIN` with
  credentials, and the SPA sends `credentials: 'include'`. If you later move both
  apps under one domain (`app.x.com` + `api.x.com`) you could relax to
  `SameSite=Lax`, but `None` works in both cases.
- **Free plan** spins services down when idle; the first request after idle is
  slow (cold start). The in-memory cache, rate-limit semaphore, and pending-OAuth
  store are per-instance — fine for a single free/starter instance; move them to
  Redis before scaling to multiple instances.
- **CI** (`.github/workflows/ci.yml`) runs lint/typecheck/test/build on every push;
  with `autoDeploy`, Render redeploys `master` automatically.
- See [`AUTH.md`](./AUTH.md) for how the session/OAuth/refresh works.
