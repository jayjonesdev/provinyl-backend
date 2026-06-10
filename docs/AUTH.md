# Authentication & Sessions

How ProVinyl authenticates users and keeps them signed in. There are **two
independent token systems** — keep them separate in your head:

1. **Discogs OAuth 1.0a tokens** — let the backend call Discogs *as the user*.
   Long-lived, encrypted at rest. These never "refresh."
2. **App session (JWT)** — our own short-lived access token + long-lived refresh
   token, delivered as httpOnly cookies. This is what gates the API and what the
   silent-refresh flow renews.

---

## 1. Discogs OAuth 1.0a (the connection to Discogs)

Login is the standard 3-legged OAuth 1.0a dance:

```
Browser            Backend                         Discogs
   │  GET /auth/login  │                               │
   │──────────────────▶│  getRequestToken ────────────▶│
   │                   │  store reqToken secret (10m)   │
   │  { authUrl }      │◀───────────────────────────────│
   │◀──────────────────│                               │
   │  redirect to Discogs authorize URL ───────────────▶│
   │                   │            user approves       │
   │  GET /auth/callback?oauth_token&oauth_verifier ◀───│
   │──────────────────▶│  getAccessToken ─────────────▶│
   │                   │  getIdentity + getProfile ────▶│
   │                   │  upsert User (tokens ENCRYPTED)│
   │                   │  issue JWT pair → set cookies  │
   │  302 → CLIENT_ORIGIN (clean URL) ◀─────────────────│
```

- The **request-token secret** is held in an in-memory map with a **10-minute
  TTL** (`auth/discogsOAuth.ts`) — only needed between `/auth/login` and
  `/auth/callback`.
- The resulting **access token + secret** are stored on the `User` document
  **AES-256-GCM encrypted** (`utils/crypto.ts`, key = `TOKEN_ENC_KEY`). They're
  decrypted on demand whenever the backend calls Discogs
  (`discogsService.createUserClientFor → decrypt`).
- **Lifetime: effectively permanent.** OAuth 1.0a tokens have no expiry and no
  refresh — they're valid until the user revokes the app in their Discogs
  settings. So this system never needs renewing.

---

## 2. App session (JWT in httpOnly cookies)

After the callback, the backend issues **its own** JWT pair (HS256, signed with
`JWT_SECRET`) and sets cookies. The browser never sees raw tokens in JS or URLs.

### Cookies

| Cookie | Contents | httpOnly | Path | Max-Age | Purpose |
|---|---|---|---|---|---|
| `pv_access` | access JWT | ✅ | `/` | **15m** | sent on every API call |
| `pv_refresh` | refresh JWT | ✅ | `/api/v1/auth` | **30d** | sent only to auth routes |
| `pv_csrf` | random token | ❌ (JS-readable) | `/` | session | double-submit CSRF |

All are `Secure` in production and `SameSite=Lax`. (`auth/cookies.ts`.)

### JWT claims
```
access : { user_id, username, token_type: 'access' }
refresh: { user_id, username, token_type: 'refresh', family: <uuid> }
```
The refresh token's **`family`** ties a chain of rotations together (see reuse
detection below).

### Authenticating a request
`requireAuth` (`middleware/authMiddleware.ts`) reads `pv_access` (falling back to
an `Authorization: Bearer` header for non-browser clients), verifies the JWT,
loads the user, and attaches `req.user`. An expired/invalid access token → **401**.

---

## 3. Lifetimes & refresh

| Token | Lifetime | Renews? |
|---|---|---|
| Discogs OAuth token | permanent (until revoked on Discogs) | n/a |
| App **access** JWT (`pv_access`) | **15 minutes** | via refresh |
| App **refresh** JWT (`pv_refresh`) | **30 days, sliding** | each refresh mints a new 30-day token |

**Sliding window:** every successful refresh issues a *fresh* 30-day refresh
token, so an active user stays signed in indefinitely. Idle for more than 30 days
→ the refresh token expires → must reconnect Discogs.

### Refresh + rotation + reuse detection (`POST /auth/refresh`)

```
1. Read pv_refresh cookie → verify JWT (must be token_type 'refresh', have family)
2. Look it up in Mongo (RefreshToken):
     - NOT found  → REUSE: revoke the whole family, clear cookies → 401 token_reuse
     - found      → continue
3. Rotate: delete the used token, issue a NEW access+refresh pair (same family),
   store the new refresh token, set new cookies
4. Respond { user, expiresIn }
```

- **Rotation** means a refresh token is single-use; using it returns a new one.
- **Reuse detection:** if someone replays a refresh token that was already
  rotated away (valid JWT, but no longer in the DB), the entire family is revoked
  (`tokenService.revokeFamilyTokens`) — the standard defense against a stolen
  refresh token. (`handlers/authHandler.ts`, `models/RefreshToken.ts`.)

### Silent refresh on the client

The SPA never schedules refreshes — it reacts to 401s. In `src/api/client.ts`:

```
request() → 401 (and not already retried, and not the refresh call itself)
          → POST /auth/refresh  (single-flight: concurrent 401s share one call)
          → success: retry the original request once (new cookies are in place)
          → failure: onSessionExpired()  →  useAuth drops to the login gate
```

So the 15-minute access token is invisible to the user: it silently rotates in
the background, and only a truly dead session (refresh expired or revoked) sends
them back to "Connect Discogs."

---

## 4. CSRF

Because the session is cookie-based, state-changing requests use a **double-submit
token** (`middleware/csrfMiddleware.ts`):

- Safe requests (GET/HEAD/OPTIONS) ensure a `pv_csrf` cookie exists.
  `GET /auth/csrf` also returns the token in the body for the SPA to cache.
- Mutations (POST/DELETE) must send the same value in an `X-CSRF-Token` header;
  it's compared to the cookie in constant time. Mismatch → **403 csrf_invalid**.

A cross-site attacker can't read the `pv_csrf` cookie, so they can't forge the
header. The SPA reads it once via `/auth/csrf` and attaches it to every mutation
(`src/api/client.ts`).

---

## 5. Logout

`POST /auth/logout` deletes the refresh token from Mongo and clears `pv_access` /
`pv_refresh`. The SPA also drops its cached CSRF token and flips to the login
gate. (The Discogs OAuth token stays stored — re-login doesn't re-authorize on
Discogs unless the user revoked access there.)

---

## 6. Security properties

- Tokens are **httpOnly** → XSS can't read them; never placed in URLs.
- **Refresh-token rotation + reuse detection** limits the blast radius of a
  stolen refresh token.
- Discogs tokens **encrypted at rest** (AES-256-GCM).
- **CSRF** double-submit on all mutations.
- `helmet`, credentialed CORS pinned to `CLIENT_ORIGIN`, per-API rate limiting.

---

## 7. Configuration

| Env var | Meaning | Default |
|---|---|---|
| `JWT_SECRET` | signs the app JWTs (≥32 chars) | — |
| `JWT_ACCESS_EXPIRY` | access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRY` | refresh token lifetime | `30d` |
| `TOKEN_ENC_KEY` | AES-256-GCM key for Discogs tokens (64 hex) | — |
| `DISCOGS_CONSUMER_KEY` / `_SECRET` | Discogs app credentials | — |
| `DISCOGS_CALLBACK_URL` | OAuth callback (`…/api/v1/auth/callback`) | — |
| `CLIENT_ORIGIN` | SPA origin (CORS + post-login redirect) | — |

> **SameSite caveat.** Cookies are `SameSite=Lax`, which requires the SPA and API
> to share a registrable domain (fine for `localhost:5173`↔`:8080`, or
> `app.x.com`↔`api.x.com`). For a cross-site split (e.g. `*.vercel.app` +
> `*.onrender.com`) switch the cookies to `SameSite=None; Secure` in
> `auth/cookies.ts`, and ensure the SPA uses `credentials: 'include'` (it does).

---

## 7a. Native (iOS) clients

The web flow above is cookie-based. Native apps (`provinyl-ios`) can't use httpOnly
cookies or the web redirect, so three **additive** behaviors support them — web
behavior is unchanged:

1. **Login → 302.** `GET /auth/login?platform=ios` 302-redirects straight to the
   Discogs authorize URL (instead of returning `{ authUrl }`), so the app can drive
   it with `ASWebAuthenticationSession`. The pending request-token is flagged
   `mobile` (`auth/discogsOAuth.ts`).
2. **Callback → deep link.** For a mobile flow, `/auth/callback` skips cookies and
   redirects to `IOS_CALLBACK_URL` (default `provinyl://auth/callback`) with the JWT
   pair in the **URL fragment**: `#access=<jwt>&refresh=<jwt>` (a fragment never
   reaches server logs). On error: `#error=auth_failed`. The app captures the
   redirect, parses the fragment, and stores both tokens in the **Keychain**.
3. **Cookieless session.** `requireAuth` already accepts `Authorization: Bearer
   <access>`. The app refreshes via `POST /auth/refresh` with the **refresh** token
   in a `Bearer` header (or `{ refreshToken }` body) — when there's no `pv_refresh`
   cookie the response returns `{ user, accessToken, refreshToken, expiresIn }` in
   the body (web responses stay token-free). `logout` likewise accepts the refresh
   token via Bearer/body. **CSRF** is bypassed only for cookieless Bearer requests
   (no `pv_csrf` cookie + a `Bearer` header) — CSRF only threatens ambient-cookie
   auth (`middleware/csrfMiddleware.ts`).

```
iOS app                Backend                         Discogs
  │ ASWebAuth → /auth/login?platform=ios ──302──▶ authorize │
  │                              user approves              │
  │ /auth/callback?oauth_token&oauth_verifier ◀─────────────│
  │ ◀─302 provinyl://auth/callback#access=…&refresh=…       │
  │ store both in Keychain; Bearer <access> on every call   │
  │ 401 → POST /auth/refresh (Bearer <refresh>) → new pair  │
```

Config: `IOS_CALLBACK_URL` (`src/config/env.ts`) must match the app's registered
URL scheme.

---

## 8. Where the code lives

| Concern | File |
|---|---|
| OAuth 1.0a flow, pending-token store, User-Agent | `src/auth/discogsOAuth.ts` |
| JWT sign/verify | `src/auth/jwtService.ts` |
| Cookie set/clear, CSRF cookie | `src/auth/cookies.ts` |
| Refresh-token persistence (rotation, family revoke) | `src/services/tokenService.ts`, `src/models/RefreshToken.ts` |
| Token encryption at rest | `src/utils/crypto.ts` |
| login / callback / me / refresh / logout | `src/handlers/authHandler.ts` |
| requireAuth | `src/middleware/authMiddleware.ts` |
| CSRF | `src/middleware/csrfMiddleware.ts` |
| **Client** silent-refresh + CSRF | `provinyl-web/src/api/client.ts` |
| **Client** session state / login gate | `provinyl-web/src/store/useAuth.ts` |
