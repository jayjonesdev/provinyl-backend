# ProVinyl Backend — Implementation Plan

A reference for finishing the ProVinyl backend: a Node/TypeScript service that
proxies the **Discogs API** for the ProVinyl web app, owns the OAuth flow and
session, and returns data in the frontend's `Release` contract.

| | |
|---|---|
| **Surface** | REST API at `/api/v1`, consumed by `provinyl-web` (Vite/React SPA) |
| **Approach** | **Refactor the existing repo in place** (keep Git history) — audit, fill gaps, reshape the contract |
| **Status** | Phase-6 backend exists and works; this plan takes it to production-ready |
| **Decisions** | Emit frontend `Release` shape · MongoDB/Mongoose · httpOnly-cookie sessions |

> **Note on scope.** The original ask was "delete everything and start from
> scratch." On review the repo already contains a near-complete, well-structured
> backend, so we chose to **refactor in place** instead — nothing is deleted.

---

## 1. Decisions (locked)

1. **Refactor in place.** Keep the repo, history, and proven pieces (OAuth 1.0a
   flow, JWT rotation/reuse-detection, the Discogs service, normalize layer).
2. **Response contract = the frontend `Release` shape.** The backend owns the
   Discogs→`Release` mapping and assigns the procedural-cover fallback. The
   frontend's `DiscogsAdapter` becomes a thin fetch wrapper.
3. **MongoDB/Mongoose** stays the persistence layer (per-user Discogs OAuth
   tokens + refresh-token rotation state).
4. **httpOnly cookies** carry the session — tokens never touch JS or the URL.

---

## 2. Current-state audit

### Keep as-is (already solid)
- Express 5 + TS skeleton, `zod`-validated env (`config/env.ts`), `pino` logging.
- Security middleware: `helmet`, `cors` (credentialed), `express-rate-limit`.
- **Discogs OAuth 1.0a** (`auth/discogsOAuth.ts`) via `disconnect/lib/oauth`,
  with a TTL'd in-memory pending request-token store.
- **JWT access/refresh** (`auth/jwtService.ts`, `services/tokenService.ts`):
  rotation, reuse detection, family revocation, device fields.
- **Discogs service** (`services/discogsService.ts`): per-user OAuth client +
  app-level client, promisified disconnect calls.
- Mongo `User` / `RefreshToken` models; ownership checks in handlers.
- Route surface under `/api/v1`; `/health`.

### Change
| Area | Current | Change |
|---|---|---|
| **Response shape** | `Api*` types (Discogs-faithful: `basic_information`, `cover_image`) | Map to the frontend **`Release`** shape (§4); assign `art` fallback + `coverImage` |
| **Session delivery** | Callback redirects with tokens in **URL query** → SPA stores in localStorage | Set **httpOnly/Secure/SameSite cookies**; `requireAuth`/`refresh`/`logout` read/clear cookies; add `cookie-parser` + CSRF for mutations |
| **Identity call** | Hand-rolled PLAINTEXT OAuth header in `authHandler` | Use disconnect's `client.getIdentity()` |
| **Remove-from-collection** | Requires `instance_id` in request body | Backend resolves the `instance_id` server-side from the release id (frontend stays simple) |
| **Collection/wantlist paging** | Single page (`per_page` ≤ 100) | Aggregate **all pages** server-side (the SPA filters/sorts the full list client-side) + cache |
| **Validation** | Manual `parseInt`/guards per handler | `zod` schemas via a `validate` middleware (params/query/body) |
| **Search wantlist flag** | Checks only first 100 wantlist items | Use a cached full set of wantlist ids |

### Add
- **`Release` contract module** + `toRelease()` mappers (list + detail variants).
- **Discogs resilience layer**: 429/`Retry-After` backoff, a small request
  concurrency cap, and a **cache** (release details + search) to respect the
  60 req/min authenticated limit.
- **Stats endpoint** (`GET /collection/:username/value`) passthrough for Overview
  totals (Discogs Collection Value), since per-item value isn't in list data (§5).
- **Tests** (vitest + supertest): mappers, OAuth/JWT units, handler integration.
- **CI** (GitHub Actions: lint + typecheck + test) and a local **docker-compose**
  (api + mongo). Harden the `Dockerfile` (multi-stage, non-root, healthcheck).
- **CSRF** protection for cookie-authenticated mutations.

---

## 3. Final endpoint surface (`/api/v1`)

| Method | Path | Auth | Returns | Notes |
|---|---|---|---|---|
| GET | `/health` | — | `{status,timestamp}` | |
| GET | `/auth/login` | — | `{authUrl}` | Begins OAuth; stores pending request-token secret |
| GET | `/auth/callback` | — | 302 → `CLIENT_ORIGIN` | Exchanges verifier, upserts user, **sets cookies** |
| GET | `/auth/me` | cookie | `{username, avatarUrl}` | |
| POST | `/auth/refresh` | refresh cookie | sets new cookies | Rotation + reuse detection |
| POST | `/auth/logout` | cookie | `{message}` | Clears cookies + deletes stored refresh token |
| GET | `/collection/:username` | cookie\* | `Release[]` (`list:'collection'`) | All pages aggregated; owner→user client, else app client |
| POST | `/collection/:username` | cookie | `Release` | body `{releaseId}` |
| DELETE | `/collection/:username/:releaseId` | cookie | 204 | Resolves `instance_id` server-side |
| GET | `/collection/:username/value` | cookie | `{minimum,median,maximum,currency}` | Overview totals |
| GET | `/wantlist/:username` | cookie | `Release[]` (`list:'wantlist'`) | |
| POST | `/wantlist/:username` | cookie | `Release` | body `{releaseId}` |
| DELETE | `/wantlist/:username/:releaseId` | cookie | 204 | |
| POST | `/wantlist/:username/:releaseId/move` | cookie | `Release` | want → collection |
| GET | `/release/:id` | — | `Release` (full) | App-level creds; rating/tracklist/videos/credits |
| GET | `/search?q=&type=&page=` | cookie | `{results: Release[], pagination}` | Drives the Add modal; `in_wantlist` flag per result |

\* Public collections of other users fall back to the app-level client.

---

## 4. The `Release` contract & mapping

The single source of truth is the frontend's `Release` (`provinyl-web/src/types.ts`).
The backend mirrors it in `src/types/release.ts` (and we later extract a shared
`@provinyl/contracts` package). Two small additions to `Release` (frontend + backend):

- `coverImage?: string` — real Discogs art URL; the procedural `art` renders as
  the loading/empty fallback when absent.
- `instanceId?: number` — Discogs collection instance id (internal; optional).

### Field mapping (Discogs → `Release`)

| `Release` field | Source | List | Detail |
|---|---|---|---|
| `id` | `release_id` / release `id` | ✓ | ✓ |
| `title` | `basic_information.title` / `title` | ✓ | ✓ |
| `artist` | join `artists[].(anv\|name)` | ✓ | ✓ |
| `year` | `year` | ✓ | ✓ |
| `country` | release `country` | — | ✓ |
| `genres` / `styles` | `genres` / `styles` | ✓ | ✓ |
| `formatMain` / `formats` | `formats[0].name` / `formats` | ✓ | ✓ |
| `labels` | `labels[].{name,catno}` | ✓ | ✓ |
| `coverImage` | `cover_image` / `images[0].uri` | ✓ | ✓ |
| `art` | **derived** from `id` (deterministic tpl+pal) | ✓ | ✓ |
| `dateAdded` | `date_added` (→ `YYYY-MM-DD`) | ✓ | n/a |
| `rating{avg,count}` | release `community.rating.{average,count}` | ✗→`{0,0}` | ✓ |
| `have`/`want`/`lowestPrice`/`numForSale` | release `community.*`, `lowest_price`, `num_for_sale` | ✗→`0` | ✓ |
| `tracklist` | release `tracklist` (`position,title,duration`) | ✗→`[]` | ✓ |
| `videos` | release `videos` (parse YouTube id from `uri`) | ✗→`[]` | ✓ |
| `credits` | release `extraartists[].{role,name}` | ✗→`[]` | ✓ |
| `notes` | release `notes` | ✗→`''` | ✓ |
| `condition{media,sleeve}` | Discogs collection **custom fields** if set, else `'—'` | ✓/`—` | ✓/`—` |
| `value` | **not available per-item** (see §5) | `0` | `0` |
| `list` | set by the endpoint | ✓ | from collection membership |

`art` fallback: hash `id` → pick one of the 8 templates and one palette
deterministically, so a given release always renders the same fallback cover.

---

## 5. Known data-availability constraints (important)

Discogs **list** endpoints return only `basic_information` — **not** rating,
have/want, prices, or per-item value. Those live on the **release-detail**
endpoint, and some not at all:

- **Per-item `value`** has no Discogs source. The collection-value endpoint gives
  an **aggregate** (min/median/max) only. Plan:
  - Overview "Collection value" / "Est. to acquire" → `GET /collection/:username/value`.
  - Per-row value in the grid/table → **hidden** when `value` is absent (frontend
    treats `0`/undefined as "no value"); optionally populated from a user-defined
    Discogs collection custom field if one exists.
- **Rating in list rows** isn't in list data. Options (pick in build):
  1. Show stars on **detail only**; list omits them (recommended default).
  2. **Lazy-enrich** visible rows via `/release/:id` with caching (costs calls).
- **`condition`** (media/sleeve) is available only if the user records it as a
  Discogs collection custom field; otherwise `'—'`.

These imply **small frontend adjustments** (treat rating/value as optional in list
views, render `coverImage` with `Cover` as fallback) — tracked in §8.

---

## 6. Security & sessions (httpOnly cookies)

- **Callback** sets two cookies — `pv_access` (short-lived) and `pv_refresh`
  (long-lived, `Path=/api/v1/auth/refresh`) — `httpOnly`, `Secure` (prod),
  `SameSite=Lax`; redirects to a clean `CLIENT_ORIGIN` URL (no tokens in URL).
- **`requireAuth`** reads `pv_access` from the cookie (optional `Authorization:
  Bearer` fallback for non-browser clients).
- **`refresh`** reads `pv_refresh`, rotates, re-sets cookies; **`logout`** clears
  both and deletes the stored refresh token.
- **CORS**: `credentials: true` + exact `CLIENT_ORIGIN` (already set); add
  `cookie-parser`.
- **CSRF**: with cookie auth, protect mutations — `SameSite=Lax` + a
  double-submit CSRF token header (`GET /auth/csrf` issues it) or `SameSite=Strict`.
- **At rest**: Discogs token secrets in Mongo should be **encrypted** (AES-GCM via
  a `TOKEN_ENC_KEY`) rather than stored plaintext.
- **Scaling note**: the in-memory pending-OAuth store and any cache must move to
  Mongo/Redis before running more than one instance.

---

## 7. Discogs integration concerns

- **Rate limit**: 60 req/min authenticated, 25/min unauthenticated. disconnect
  surfaces `rateLimit` in callbacks. Add a wrapper that: caps concurrency, honors
  `429`/`Retry-After` with backoff, and returns a clean `503` to the client.
- **Caching**: in-memory LRU (or Mongo TTL collection) for release details and
  search results to cut repeat calls; short TTL for collection/wantlist.
- **Pagination**: aggregate all collection/wantlist pages server-side (cap with a
  sane maximum + warn-log on truncation; never silently cut).
- **User-Agent**: identify the app (`ProVinyl/1.0 +url`) on every Discogs call.

---

## 8. Frontend touch-points (provinyl-web)

Backend-driven, minimal:
- Replace the mock `discogs` adapter (`src/api/discogs.ts`) with `fetch` calls to
  this API (`credentials: 'include'`); keep the `DiscogsAdapter` interface.
- Add **auth**: `GET /auth/login` → redirect; a `/auth/callback` landing route;
  `me`/`logout`; 401 → re-auth.
- `Release`: add `coverImage?` + render `<img>` with `Cover` as fallback; treat
  `rating`/`value` as optional in list views.
- **Add modal**: switch from filtering a static catalog to calling `/search?q=`.
- **Overview**: source totals from `/collection/:username/value`.
- Wire `add`/`remove`/`move` to the API as optimistic mutations with rollback.

---

## 9. Phased delivery

1. **Contract & mappers** ✅ **done** — `types/release.ts`, `utils/toRelease.ts`
   (collection/wantlist/release/search mappers), `utils/coverFallback.ts`
   deterministic `art`, 25 vitest unit tests. All read+write handlers emit
   `Release`; old `normalize.ts`/`api.types.ts` removed. typecheck + build + lint
   green. *(core)*
2. **Cookie sessions** ✅ **done** — `cookie-parser`; `auth/cookies.ts`
   (httpOnly access + refresh cookies, refresh scoped to `/api/v1/auth`);
   callback sets cookies + encrypts Discogs tokens (`utils/crypto.ts`,
   AES-256-GCM) + clean redirect; refresh/logout read+clear cookies;
   `requireAuth` reads the access cookie (Bearer fallback); double-submit CSRF
   (`middleware/csrfMiddleware.ts` + `/auth/csrf`); `TOKEN_ENC_KEY` env. 10 new
   tests; typecheck/build/lint green. *(auth)*
3. **Discogs resilience** ✅ **done** — `services/discogsResilience.ts`
   (concurrency cap + 429/Retry-After backoff); `utils/cache.ts` TTL cache on
   release detail (1h) + search (5m); all-pages aggregation for
   collection/wantlist (parallel, capped, warn-logged); `getIdentity()` +
   `getProfile()` replace the hand-rolled OAuth header (axios dropped);
   `removeFromCollection` resolves instance + folder server-side (fixes the
   folder-0 bug; DELETE needs no body); User-Agent on all Discogs clients. 10 new
   tests (45 total); typecheck/build/lint green. *(reliability)*
4. **Validation & errors** ✅ **done** — `validators.ts` (zod params/query/body,
   coercing numbers) + `middleware/validate.ts` (populates `req.valid`, 400s via
   the envelope); handlers read typed input from `req.valid` (manual
   parseInt/isNaN gone). Consistent error envelope
   `{ error: { code, message, details? } }` via `utils/httpError.ts`
   (`ApiError` + `fail`); error/not-found/auth/csrf middleware + handlers all use
   it. Structured request logs via `pino-http` (morgan dropped). 8 new tests
   (53 total); typecheck/build/lint green. *(hardening)*
5. **Tests & CI** — vitest + supertest coverage; GitHub Actions (lint/typecheck/
   test); docker-compose for local mongo. *(quality)*
6. **Deploy** — multi-stage Dockerfile, healthcheck, env docs, target wiring
   (TBD — see open questions). *(ship)*

---

## 10. Testing strategy

- **Unit**: `toRelease()` mappers (every field + missing-data paths), JWT
  generate/validate/rotate, OAuth header/flow (disconnect mocked).
- **Integration** (supertest): each route incl. auth guards, ownership (403),
  cookie set/clear, refresh rotation + reuse-revocation, validation 400s.
- **Discogs** calls mocked at the service boundary; one optional live smoke test
  behind an env flag.

---

## 11. Open questions / TODO

- **Deployment target?** The old `provinyl-services` used AWS (CodeBuild
  buildspecs). Where does this run — AWS (ECS/Fargate), Fly, Render, a VPS? Drives
  Dockerfile, secrets, and CI/CD.
- **Discogs app credentials** (consumer key/secret) + registered callback URL
  needed to exercise the live flow.
- **Per-item value/condition**: confirm whether your Discogs collection uses
  custom fields we can read, or whether per-row value stays hidden.
- **Rating in list**: detail-only (default) vs lazy-enriched rows?
- **Shared contract**: inline-duplicate `Release` now, or extract a shared
  `@provinyl/contracts` package consumed by both repos?
