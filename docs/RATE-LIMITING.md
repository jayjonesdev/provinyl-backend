# Rate limiting

ProVinyl throttles in **two independent directions**. Don't conflate them:

| Direction    | Protects                         | Trigger                                  | Where                                   |
| ------------ | -------------------------------- | ---------------------------------------- | --------------------------------------- |
| **Outbound** | Discogs' API limit (60 req/min)  | _our_ calls _to_ Discogs                 | `src/services/discogsResilience.ts`     |
| **Inbound**  | _our_ CPU, Mongo, and Discogs budget | requests _from_ clients _to_ our endpoints | `src/middleware/rateLimitMiddleware.ts` |

---

## 1. Outbound — Discogs request resilience

Discogs allows **60 requests/minute** for an authenticated token and replies `429`
when you exceed it. Every Discogs call the backend makes is routed through the
`disconnect` client and wrapped by `runDiscogs()` so we stay under that ceiling and
survive transient 429s.

**Path:** `discogsService.call()` → `runDiscogs()` → `disconnect` client
(`src/services/discogsService.ts:40`, `src/services/discogsResilience.ts:90`).

### What it enforces

| Knob                  | Value     | Purpose                                                                 |
| --------------------- | --------- | ----------------------------------------------------------------------- |
| `MAX_CONCURRENT`      | `5`       | Semaphore caps in-flight Discogs requests, smoothing bursts under 60/min |
| `MAX_RETRIES`         | `3`       | Retry attempts on a `429` before giving up                              |
| `BASE_DELAY_MS`       | `2000`    | Base for exponential backoff (`2000 × 2^attempt`)                       |
| `MAX_DELAY_MS`        | `15000`   | Ceiling on a single backoff wait                                        |
| `REQUEST_TIMEOUT_MS`  | `15000`   | Hard per-call timeout so a hung `disconnect` stream can't pin a slot    |

### Behaviour

- **429 detection** — `isRateLimited()` matches `statusCode === 429` or a
  `/429|rate limit/i` message (`discogsResilience.ts:70`).
- **Backoff** — honours Discogs' **`Retry-After`** header when present; otherwise
  `min(2000 × 2^attempt, 15000) + jitter(≤250ms)` (`discogsResilience.ts:75`).
- **Concurrency** — a process-local `Semaphore(5)` queues the 6th+ concurrent call
  until a slot frees (`discogsResilience.ts:38`).
- **Timeout** — `withTimeout()` rejects after 15s and releases the semaphore slot,
  which also rescues a request from the `disconnect` client's habit of throwing
  synchronously inside its own stream callback (`discogsResilience.ts:18`).

### Scaling caveat

The semaphore is **process-local**. Running more than one instance multiplies
effective concurrency and would breach Discogs' 60/min. Before scaling out, move
throttling to a shared store (Redis) — noted at `discogsResilience.ts:8`.

---

## 2. Inbound — is it needed?

**Yes — and it's now implemented.** The case:

- The app is internet-facing on Render with **unauthenticated, crawler-facing
  endpoints**: `/u/:username`, `/card/:username.png`, and
  `/api/v1/public/:username/collection`. Each returns a full public collection or
  triggers a **CPU-heavy `satori`/`sharp` card render** — prime scrape/DoS targets,
  previously uncapped.
- **OAuth/token endpoints** (`/auth/login`, `/auth/callback`, `/auth/refresh`,
  `/auth/logout`) had no brute-force / token-churn guard.
- Every uncapped request can fan out into a Discogs call, so inbound floods also
  burn our **outbound** Discogs budget.
- `express-rate-limit` was already a dependency — installed but unused.

### What was added

`src/middleware/rateLimitMiddleware.ts` defines three **IP-keyed**, layered limiters
(express-rate-limit v8, default in-memory store). Limits stack: a public-API request
counts against both `apiLimiter` and `publicLimiter`, and the stricter one wins.

| Limiter         | Window | Limit / IP | Applies to                                                                                   | Rationale                                                                 |
| --------------- | ------ | ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apiLimiter`    | 15 min | **3000**   | all of `/api/v1` (`app.ts`)                                                                   | Generous net. High on purpose — one card render fans out many `/images/proxy` calls (one per cover), so a tight cap would break large-collection views. |
| `publicLimiter` | 15 min | **100**    | `/u/:username`, `/card/:username.png`, `/api/v1/public/:username/collection`                  | Anti-scrape. Ample for humans + link unfurls; stops bulk harvesting of public collections and card renders. |
| `authLimiter`   | 15 min | **30**     | `/auth/login`, `/auth/callback`, `/auth/refresh`, `/auth/logout`                              | Anti-bruteforce. Low real-user volume, so a tight cap throttles credential stuffing / token churn. |

`publicLimiter` is a **single shared instance** mounted on both the root share
surfaces and the public collection API, so a scraper's page hits and API hits draw
from **one** budget. `/auth/me` and `/auth/me/preferences` deliberately stay on the
baseline `apiLimiter` only — the SPA polls them during normal authenticated use.

### Keying & the proxy

Limiters key on **client IP** (`req.ip`). Render terminates TLS at its edge and
forwards via `X-Forwarded-For`, so `app.ts` sets `app.set('trust proxy', 1)` — one
proxy hop — to recover the real client IP. A numeric hop count (not `true`) also
satisfies express-rate-limit's spoofing-prevention check.

### Response when limited

A throttled request gets `429` in the standard error envelope (the custom `handler`
overrides the library's plain-text default):

```json
{ "error": { "code": "rate_limited", "message": "Too many requests — please slow down and try again shortly." } }
```

Standard IETF `RateLimit-*` headers and `Retry-After` are sent
(`standardHeaders: true`); the deprecated `X-RateLimit-*` set is suppressed
(`legacyHeaders: false`). Each breach is logged at `warn` with the IP, path, and
limiter name.

### Not throttled

- `/api/v1/health` liveness/health-check probes — sit under the generous
  `apiLimiter` (3000/15 min) only. `publicLimiter` is attached per-route inside
  `routes/public.ts`, so it counts only real `/u/:username` and `/card/:username.png`
  hits — not every app request.
- The **test suite** — limiters `skip` when `NODE_ENV === 'test'` so supertest can
  hammer the app without the MemoryStore counter bleeding across cases. The limiter's
  own test passes an explicit non-skipping predicate to exercise the 429 path
  (`rateLimitMiddleware.test.ts`).

### Scaling caveat

The default store is **in-memory and per-instance** — correct for a single Render
instance (matches `docs/DEPLOY-RENDER.md`'s note that per-instance state is fine
until you scale out). On multiple instances each holds its own counter, so a client's
effective budget multiplies by the instance count. Before scaling out, back the
limiters with a shared store (e.g. `rate-limit-redis`).

---

## Tuning

- **Outbound:** edit the constants at the top of `src/services/discogsResilience.ts`,
  or pass `ResilienceOptions` (`maxRetries`, `baseDelayMs`, `timeoutMs`) per call.
- **Inbound:** edit the `windowMs` / `limit` on the three `createRateLimiter(...)`
  calls at the bottom of `src/middleware/rateLimitMiddleware.ts`.

## Future work

- Move both throttling layers to Redis before running >1 instance.
- Consider **per-user** keying (not just per-IP) on authenticated routes so users
  behind a shared NAT/corporate IP don't share one bucket.
- Consider a dedicated, looser allowance for `/images/proxy` if large collections
  approach the `apiLimiter` ceiling in practice.
