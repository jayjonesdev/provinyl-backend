# ProVinyl Pro — Data Model & Implementation Plan

Status: **Proposal / not started**
Scope: `provinyl-backend` (primary), `provinyl-web`, `provinyl-ios`

## Launch bundle

ProVinyl Pro is one paid tier built around a single story: **treat your collection as an asset.**

| Feature | One-liner | Gate |
| --- | --- | --- |
| Unlimited collection | Free is capped; Pro removes the cap | Free cap enforced at proxy |
| Price-drop wantlist alerts | Notify when a wantlist copy hits a target price | Pro to create (free: 1 teaser) |
| Value-over-time portfolio | Chart collection value over time | Pro |
| Cost-basis & gain/loss | Track what you paid vs current value | Pro |
| PDF appraisal export | Branded, insurance-ready inventory PDF | Pro |

---

## 0. Architectural premise (read this first)

Today the backend is a **thin, stateless proxy over Discogs**. The only persisted documents are `User` and `RefreshToken` (`src/models/`). Collection and wantlist data is **never stored** — it's fetched live from Discogs on every request (`getAllCollection`, `getAllWantlist` in `src/services/discogsService.ts`).

**Three of the five Pro features require ProVinyl to start owning its own data:**

- **Cost-basis** — Discogs has no place to store "what I paid," so ProVinyl must persist per-copy metadata.
- **Value-over-time** — Discogs only returns *current* value (`GET /users/:u/collection/value`); history must be snapshotted and stored by us.
- **Price alerts** — alert definitions + dedupe state live nowhere in Discogs.

So this bundle is the moment ProVinyl graduates from "proxy" to "proxy + system of record." Everything below is designed so the proxy stays the source of truth for *catalog* data, and ProVinyl owns only the *derived / user-authored* data that Discogs can't hold.

**Two prerequisites the current schema lacks:**

1. **Email.** Auth is Discogs OAuth (`src/auth/discogsOAuth.ts`); `User` has no email. We need one for alert delivery and Stripe. Capture it at Stripe Checkout (Checkout collects it) and persist via webhook — do **not** assume Discogs exposes it.
2. **Scheduling.** Portfolio snapshots and alert polling are recurring jobs. The app is a single Express service on Render with no scheduler today. See §8.

**Compliance gate (do this before building the money features):** The Discogs API ToU materially constrains this bundle — read **§0.1** before building anything that touches marketplace prices.

---

## 0.1 Discogs API ToU compliance (read before §3–§7)

Source: [Discogs API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) (Effective Dec 11 2019). Quotes below are verbatim. *Not legal advice; Discogs reserves "sole discretion" throughout — get written confirmation before relying on any reading here.*

### The data split that governs everything
Discogs classifies API data into two buckets, and the split maps almost exactly onto our free features vs. our money features:

- **CC0 Data** (No Rights Reserved — usable commercially, freely): *"Release titles, notes, dates, format, track listings, barcodes and other identifiers, credits, versions… Artist names… Label… names."* → **catalog metadata.**
- **Restricted Data**: *"'Marketplace Data' such as related inventory, orders, lists, fees, pricing suggestions, including but not limited to: pricing, release images posted in connection with offers for sale, and sales history,"* plus *"Discogs User Data"* which **explicitly includes the user's "collection, and wantlist,"** plus Images.

### The four clauses that bind us
1. **Restricted Data has a flat commercial ban — no permission carve-out:** *"with respect to all Restricted Data, You may not: Transfer Restricted Data to any third party. **Use Restricted Data for any commercial purposes.**"* → **All marketplace pricing is off-limits for a paid feature.**
2. **6-hour freshness / no long-term storage:** *"You may not display in any format or to any audience the Content if it is more than six (6) hours older than the information on Our online properties… You may not cache or store the Content longer than is necessary to provide a service to Your application's users."* → **kills storing historical marketplace values.**
3. **General paid-app clause (has an escape hatch):** prohibited uses include *"Charging a fee to use or access any part of Your application that integrates with Our API or the Content if we provide that access to users free of charge, **without Our express written permission**."* → **any paid tier over Discogs data needs written permission.**
4. **Attribution (mandatory, regardless of monetization):** must display *"This application uses Discogs' API but is not affiliated with, sponsored or endorsed by Discogs. 'Discogs' is a trademark of Zink Media, LLC."* and, **directly next to any data used**, *"Data provided by Discogs"* with a **dofollow** hyperlink to the relevant discogs.com page (*"must not use any mechanism that prevents passing along search engine ranking credit, such as 'nofollow'"*). **Status: implemented** — see §0.2.

### What this does to the bundle
The "treat your collection as an asset" money features are exactly the ones the ToU most restricts, because they all run on **Marketplace Data** (Restricted + no-commercial-use), and the 6-hour rule separately forbids *historical* value tracking.

| Feature | Compliance verdict |
| --- | --- |
| Unlimited collection (§3) | ⚠️ Doesn't touch Marketplace Data, but charging for an API-integrating app trips clause 3 → **needs written permission**. |
| Cost-basis & gain/loss (§4) | ⚠️ User-entered purchase price is **the user's own data — safe to store & monetize**. Current value via marketplace is Restricted + must be live (<6h) — keep it free/live, don't store it. |
| Value-over-time portfolio (§5) | ❌ **Out of scope** (dropped June 2026). Was a double violation — Restricted Marketplace Data + 6-hour rule. |
| Price-drop alerts (§6) | ❌ Built entirely on marketplace pricing (Restricted, clause 1). A paid alert *is* the prohibited commercial use. |
| PDF appraisal (§7) | ✅ **after redesign** — uses only the **user-entered value** + CC0 catalog fields (see §7), no marketplace data. |

### Two viable paths (not mutually exclusive)
1. **Get express written permission from Discogs** for commercial use of Marketplace/Restricted Data. The ToU repeatedly offers *"without Our express written permission"* and says *"If You have questions about whether Your intended use will violate the TOU, please contact Us,"* and Discogs *"reserve[s] the right to charge for access… in the future."* **Required before building §5/§6 as paid features.**
2. **Gate Pro on user-authored + CC0 data only** — cost-basis via user-entered prices, unlimited collection, tags/shelves/lending/location, photo storage, and PDF export of the CC0 catalog + user-entered values. Keep marketplace-derived value/alerts as **free, live, <6h** conveniences until permission lands.

**Recommendation:** ship the path-2 bundle first; pursue permission (path 1) in parallel before committing engineering to §5/§6.

## 0.2 Required notices — implementation status

Both ToU notices are implemented across the clients:

- **Trademark / not-affiliated notice** (clause 4):
  - web — account popover, `provinyl-web/src/components/Header.tsx` (`.pv-account-legal`).
  - iOS — sign-in screen, `provinyl-ios/.../Features/Auth/ConnectView.swift`.
- **"Data provided by Discogs" + dofollow link** next to the data (clause 4):
  - web — release detail, `provinyl-web/src/components/Detail.tsx` (`.pv-d-attribution`, `rel="noopener"` — **not** `nofollow`), links to `discogs.com/release/{id}`.
  - iOS — release detail, `provinyl-ios/.../Features/Detail/ReleaseDetailView.swift` (`discogsAttribution`, SwiftUI `Link`).
- **Backend:** also surface the trademark notice in any public-facing API docs / landing page and the app's terms.

---

## 1. Data-model changes

### 1.1 `User` — add tier + billing identity (modify existing)

`src/models/User.ts` / `src/types/index.ts`

```ts
// IUser additions
email?: string;                 // captured at checkout; required for alerts/billing
tier: 'free' | 'pro';           // cached entitlement, source of truth = Subscription
proSince?: Date;                // first time they became pro (for backfill anchor)
```

```ts
// userSchema additions
email:    { type: String, trim: true, lowercase: true, index: true },
tier:     { type: String, enum: ['free', 'pro'], default: 'free', index: true },
proSince: { type: Date },
```

`tier` is a **denormalized cache** kept in sync by the Stripe webhook (§2). The `Subscription` document is authoritative; `tier` exists so hot-path auth checks don't need a join.

### 1.2 `Subscription` — billing state (new model)

`src/models/Subscription.ts`

```ts
interface ISubscription extends Document {
  userId: string;                       // ref User._id, unique
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  priceId?: string;                     // Stripe price (monthly/annual)
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date; updatedAt: Date;
}
```

- Unique index on `userId`; index on `stripeCustomerId` and `stripeSubscriptionId` for webhook lookups.
- `tier === 'pro'` iff `status ∈ {active, trialing}`. Webhook recomputes `User.tier` on every change.

### 1.3 `CollectionItemMeta` — per-copy data Discogs can't hold (new model)

Backs **cost-basis**. Keyed to a Discogs *instance* (a specific owned copy), falling back to release-level when no instance is known.

`src/models/CollectionItemMeta.ts`

```ts
interface ICollectionItemMeta extends Document {
  userId: string;                       // ref User._id
  releaseId: number;                    // Discogs release id
  instanceId?: number;                  // Discogs collection instance (specific copy)
  purchasePrice?: { amount: number; currency: string };
  statedValue?: { amount: number; currency: string };  // owner's own valuation (for appraisal §7) — NOT marketplace
  purchaseDate?: Date;
  purchaseNote?: string;                // "Amoeba SF, 2nd pressing"
  createdAt: Date; updatedAt: Date;
}
```

- Compound unique index `{ userId, releaseId, instanceId }`.
- This document is **sparse**: only copies the user has annotated exist. Catalog data still comes from Discogs; we join meta in at read time (§4.4).
- Not gated by storage cap — but only surfaced/computed for Pro.

### 1.4 `ValueSnapshot` — portfolio time series (new model)

Backs **value-over-time**. One row per user per capture (daily).

`src/models/ValueSnapshot.ts`

```ts
interface IValueSnapshot extends Document {
  userId: string;
  capturedAt: Date;                     // truncated to day
  value: { minimum: number; median: number; maximum: number; currency: string };
  itemCount: number;
  costBasisTotal?: number;              // sum of known purchase prices at capture time
  createdAt: Date;
}
```

- Compound unique index `{ userId, capturedAt }` (idempotent daily writes).
- Index `{ userId, capturedAt: -1 }` for range queries.
- Mirrors the shape Discogs returns from `getCollectionValue` (`DiscogsCollectionValue`) plus our derived fields.

### 1.5 `PriceAlert` — wantlist deal watches (new model)

Backs **price-drop alerts**.

`src/models/PriceAlert.ts`

```ts
interface IPriceAlert extends Document {
  userId: string;
  releaseId: number;                    // wantlist release being watched
  targetPrice: { amount: number; currency: string };
  minMediaGrade?: string;               // optional: only alert on copies >= this grade
  active: boolean;
  lastSeenLowest?: number;              // last polled marketplace low (for "dropped to $X")
  lastNotifiedAt?: Date;                // dedupe — don't re-notify within cooldown
  lastNotifiedPrice?: number;
  createdAt: Date; updatedAt: Date;
}
```

- Index `{ active: 1 }` for the poller sweep; compound `{ userId, releaseId }` unique.
- Free tier: max 1 active alert (teaser). Pro: unlimited.

### 1.6 `DeviceToken` — iOS push delivery (new model)

Needed so alerts can reach the iOS app via APNs.

`src/models/DeviceToken.ts`

```ts
interface IDeviceToken extends Document {
  userId: string;
  token: string;                        // APNs device token, unique
  platform: 'ios';
  lastSeenAt: Date;
}
```

---

## 2. Billing & entitlement (foundation — build first)

Everything else gates on this.

**New dependency:** `stripe`. **New env (`src/config/env.ts`):**

```
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL
```

**New handler** `src/handlers/billingHandler.ts` + routes:

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /billing/checkout` | requireAuth | Create Stripe Checkout Session (mode=subscription), return URL |
| `POST /billing/portal` | requireAuth | Create Customer Portal session (manage/cancel) |
| `POST /billing/webhook` | **raw body, signature-verified** | Sync subscription → `Subscription` + `User.tier` |

Implementation notes:
- The webhook must mount **before** `express.json()` (or use `express.raw({type:'application/json'})` on just that route) so Stripe signature verification sees the raw body. This is the one place the current app's global JSON parser needs a carve-out.
- Map `customer.subscription.{created,updated,deleted}` and `checkout.session.completed` → upsert `Subscription`, set `User.email`, recompute `User.tier`, set `proSince` on first activation.
- Idempotency: webhook keyed on Stripe event id; safe to replay.

**New middleware** `src/middleware/requirePro.ts`:

```ts
// 402 payment_required if req.user.tier !== 'pro'
export const requirePro = (req, res, next) =>
  req.user?.tier === 'pro' ? next() : fail(res, 402, 'upgrade_required', 'ProVinyl Pro required');
```

**Expose entitlement to clients:** extend the `/auth/me` response (`authHandler.me`) with `{ tier, entitlements }` so web/iOS can gate UI and show upgrade prompts. Add `tier` to the iOS `MeResponse` and web `useAuth` store.

---

## 3. Feature: Unlimited collection (the limit lever)

**There is no cap today** — collection lives in Discogs, unbounded. "Unlimited" only has meaning if we *introduce* a free cap and remove it for Pro.

**Mechanism — enforce at the proxy on write:**
- Pick a cap, e.g. `FREE_COLLECTION_CAP = 100`.
- In `addToCollection` (`collectionHandler.ts`), before adding: if `user.tier === 'free'`, read the current collection size cheaply. Page 1 of the Discogs collection already returns `pagination.items` (total) — no full aggregation needed. If `items >= CAP`, return `402 upgrade_required` with `{ cap, current }`.
- Grandfather existing over-cap users: reads always work; only **new adds** are blocked past the cap. (Don't delete anyone's data.)

**Clients:**
- Web/iOS show `X / 100` with an upgrade CTA as they approach the cap; intercept the `402` from add and open the paywall.

**Effort:** S. No new model. One count + guard in the add path, plus client paywall plumbing.

---

## 4. Feature: Cost-basis & gain/loss

**Data:** `CollectionItemMeta` (§1.3). **Gate:** Pro.

> **ToU (§0.1):** purchase price and stated value are the **user's own data** — safe to persist and to monetize. Any *marketplace*-derived "current value" is Restricted Data: show it **live (<6h) and free**, never stored, never the thing you charge for. The paid surface here is the user-owned cost/value tracking, not a Discogs valuation.

### 4.1 Write — record what you paid / what it's worth
`POST /collection/:username/:releaseId/cost` (mirrors the existing `/condition` route shape)
Body: `{ instanceId?, purchasePrice?: {amount,currency}, statedValue?: {amount,currency}, purchaseDate?, purchaseNote? }` → upsert `CollectionItemMeta`. Both figures are owner-entered.

### 4.2 Reference value while editing (free, live, not stored)
To help the user set a `statedValue`, the in-app editor *may* show a **live** Discogs reference (release `lowest_price`, or `GET /marketplace/price_suggestions/:releaseId` per media grade — add `getPriceSuggestions` to `discogsService`). This is a **read-through convenience, fetched on demand, <6h old, free for all users, and never persisted**. Only the owner's chosen `statedValue` is saved.

### 4.3 Compute
Per item: `gain = statedValue − purchasePrice` (both owner-entered). Aggregate for a collection-level unrealized gain/loss + a "top movers" list — all from user data, so no ToU exposure.

### 4.4 Join into the collection response
Extend the collection read path: after `collectionItemToRelease`, left-join `CollectionItemMeta` by `(releaseId, instanceId)` and attach `{ purchasePrice, statedValue, gain }` onto the `Release` owner fields. Add these optional fields to the `Release` type in **all three** repos (`provinyl-backend/src/types/release.ts`, `provinyl-web/src/types.ts`, `provinyl-ios/.../Models/Release.swift`).

**Effort:** M. New model + 1 write route + read-path join + optional live `price_suggestions` reference. Clients: price/value inputs in the detail drawer + gain/loss display.

---

## 5. Feature: Value-over-time portfolio — ❌ OUT OF SCOPE

> **Dropped for now (decision, June 2026).** Not building a Discogs-value portfolio: it's the least-compliant feature (collection value is Restricted Marketplace Data + the 6-hour storage rule), and it isn't a current priority. `ValueSnapshot` (§1.4) and the `snapshot-portfolios` job (§8) are **not built** unless this is revived.
>
> **If revived,** the only version worth pursuing without Discogs permission is a **user-data** one: snapshot the owner's own `statedValue` / `costBasis` over time (not Discogs value), which carries no ToU exposure. The Discogs-value version below stays parked behind written permission.

**Data:** `ValueSnapshot` (§1.4). **Gate:** Pro.

### 5.1 Capture (scheduled — see §8)
Daily job over Pro users: call `getCollectionValue` (already exists) + `pagination.items` for count + sum of known `CollectionItemMeta.purchasePrice` for `costBasisTotal`; upsert one `ValueSnapshot` per user per day. Stagger requests to respect Discogs rate limits (the resilience layer in `discogsResilience.ts` already handles 429 backoff — reuse it).

### 5.2 Backfill
No historical Discogs data exists, so the series **starts at upgrade**. On first Pro activation, write an initial snapshot immediately so the chart isn't empty. Be honest in the UI: "Tracking since {proSince}."

### 5.3 Read
`GET /portfolio/history?from&to` (Pro) → ordered `ValueSnapshot[]`. Web/iOS render a line chart of median value over time (web already has chart components in `Overview`; iOS uses Swift Charts).

**Effort:** M (mostly the scheduler in §8). The capture reuses an existing Discogs call.

---

## 6. Feature: Price-drop wantlist alerts

**Data:** `PriceAlert` + `DeviceToken` (§1.5/1.6). **Gate:** Pro to create (free: 1).
**The most habit-forming feature — the recurring reason to keep paying.**

> **⛔ ToU blocker (§0.1):** alerts are built entirely on Restricted **Marketplace pricing**; a *paid* alert is exactly the prohibited commercial use of Restricted Data. **Requires express written permission from Discogs before shipping as a Pro feature.** Until then it can't launch (paid or free-teaser) in a form that monetizes the data. Pursue permission in parallel; do not commit engineering until it lands.

### 6.1 Manage alerts (CRUD)
`POST /alerts` `{ releaseId, targetPrice, minMediaGrade? }`, `GET /alerts`, `DELETE /alerts/:id`.
Enforce the free-tier count limit on create. Optionally auto-suggest a target from current marketplace low.

### 6.2 Poll (scheduled — see §8)
Periodic sweep (e.g. every 6h) over `{ active: true }` alerts, grouped by `releaseId` to dedupe Discogs calls:
- Fetch current lowest price (release `lowest_price`, or marketplace listings filtered by `minMediaGrade`).
- If `lowest <= targetPrice` **and** not notified within cooldown (e.g. 7d) **and** price changed since `lastNotifiedPrice` → enqueue a notification, set `lastNotifiedAt/lastNotifiedPrice/lastSeenLowest`.

### 6.3 Deliver
- **Email** (primary): add a provider — Resend / Postmark / SES. New `src/services/notificationService.ts`.
- **iOS push** (APNs): register tokens via `POST /devices` from the app; send via APNs in the same service.
- Web: in-app notification center reading recent alert fires (optional v1.1).

**Effort:** L. New models + CRUD + poller + a notification provider integration + iOS push registration/handling. Biggest lift; sequence it last but it's the retention anchor.

---

## 7. Feature: PDF appraisal export

**Gate:** Pro. **Data:** collection (CC0 catalog fields only) + `CollectionItemMeta` + `Photo` (§7.4). **No marketplace data.**

> **ToU compliance (§0.1):** the PDF is a stored, potentially long-lived document shown to third parties (insurers). It therefore uses **only the user's own values** — purchase price and a user-entered **stated value** (`CollectionItemMeta`) — plus **CC0 catalog fields** (title, artist, label, catalog #, format). It does **not** pull, store, or display Discogs Marketplace Data (price suggestions, lowest price, collection value), which would violate the Restricted-Data commercial ban and the 6-hour freshness rule. This is what makes the appraisal exportable and compliant.

`GET /export/appraisal.pdf?scope=all|over:<amount>` (Pro) →
- Aggregate the owner's collection (existing path), keep only CC0 catalog fields, join `CollectionItemMeta` (purchase price + stated value).
- Compose the three sections below.
- **Library:** `pdfkit` (lightweight, programmatic — preferred for a service with no browser) or `puppeteer` (HTML→PDF, heavier on Render). Recommend **pdfkit**.
- Stream the PDF as the response with `Content-Disposition: attachment`.

The export has three parts: a cover/summary page, the line-item inventory, and the credibility metadata that makes it more than a pretty list — i.e. what an insurer or appraiser actually needs.

### 7.1 Cover & summary page
- **Owner identity** — Discogs username, optional real name, email on file, generation date ("Appraisal as of {date}").
- **Headline totals:** total item count; total **stated value** (sum of `CollectionItemMeta.statedValue`); total **cost basis** (sum of `CollectionItemMeta.purchasePrice`); **unrealized gain/loss** (stated − cost basis).
- **Coverage caveats** — how many items have a stated value / purchase price recorded vs. blank. Source line: **"Values are owner-supplied estimates, not Discogs marketplace data and not a certified appraisal."** This honesty is both accurate and what keeps it ToU-compliant.
- Currency.

### 7.2 Line-item inventory (the body)
One row per owned copy, from the collection read path joined with `CollectionItemMeta`:

| Column | Source |
| --- | --- |
| Artist | `Release.artist` |
| Title | `Release.title` |
| Year / Country | `Release.year`, `Release.country` |
| Format | `Release.formatMain` / `formats` (e.g. "LP, 180g, Reissue") |
| Label / Catalog # | `Release.labels[].name` + `catno` — key identifier for an appraiser |
| Media / Sleeve grade | `Release.condition` (graded via Discogs custom fields) |
| Purchase price + date | `CollectionItemMeta.purchasePrice`, `purchaseDate` |
| Stated value | `CollectionItemMeta.statedValue` — **owner-entered**, not marketplace |
| Gain/loss | stated − purchase |

Sort/group sensibly — by artist, or by stated value descending so high-worth items lead. For long collections, page the table with running subtotals.

### 7.3 What makes it "insurance-ready" (vs. a CSV dump)
- **Catalog # + grade on every row** — how a claims adjuster verifies a *specific pressing*. A "Dark Side of the Moon" with no catalog # / grade is worthless for a claim; the first-press graded NM is the point. (Catalog #, format, grade are all CC0 / user-owned — safe to export.)
- **Owner-stated valuation** — the value the owner assigns each item. Encourage users to base it on their own research, but it remains *their* figure; ProVinyl neither supplies nor stores a Discogs number here. To help them, the in-app value editor can show a live (<6h, free) Discogs reference *while editing* — but only the owner's chosen figure is persisted and exported.
- **Provenance line** — `purchaseNote` ("Amoeba SF, sealed") + purchase date establish ownership history.
- **Dated** — every figure stamped "as of {date}, owner-supplied estimate"; an appraisal is a point-in-time statement.
- **Branded footer** with ProVinyl + page numbers, so it reads as a document of record.

### 7.4 Optional upgrades
- **Cover thumbnails** (`Release.coverImage`) — visual ID for adjusters; bloats the file, so make it a toggle.
- **Photos of the actual copy** — if user photo storage (§7.5) ships, embedding the owner's real sleeve/vinyl photos is the strongest evidence for a claim.
- **"Top 10 most valuable items"** highlight on the summary page.
- **Scope filter** — whole collection, or only items over a per-item threshold (insurers often only schedule items above a limit) — hence the `scope` query param.

**Effort:** S–M. Pure server-side composition over data the other features already assemble — build it **after** cost-basis so values are present.

### 7.5 User photo storage (secure design)

Lets owners attach photos of their *actual* copies (sleeve, vinyl, signature, receipt) — provenance for the appraisal (§7.4) and a differentiator vs. stock Discogs art. Photos are personal user content, so the design is security-first.

**Storage tier — never store binaries in Mongo.** Use object storage: **Cloudflare R2** (recommended — S3-compatible, zero egress fees, cheap) or S3 / Backblaze B2. **Private bucket, no public ACLs.** SSE (encryption at rest) is on by default for all three.

**New model** `src/models/Photo.ts`:
```ts
interface IPhoto extends Document {
  userId: string;                       // ref User._id — ownership
  releaseId: number;
  instanceId?: number;                  // which owned copy
  kind: 'sleeve' | 'vinyl' | 'signature' | 'receipt' | 'other';
  storageKey: string;                   // users/{userId}/photos/{uuid}.jpg
  contentType: string;                  // image/jpeg|png|heic only
  sizeBytes: number;
  width?: number; height?: number;
  status: 'pending' | 'ready';          // pending until post-upload processing done
  createdAt: Date;
}
```
- Object key **namespaced by `userId`** (`users/{userId}/photos/{uuid}`) so ownership is structural, never derived from client input.
- Per-item and per-user **count caps** (storage cost + abuse) — gate creation on tier.

**Upload flow — presigned, direct-to-bucket (keeps image bytes off the app server):**
1. `POST /photos/upload-url` (requireAuth + requirePro) `{ releaseId, instanceId?, kind, contentType, sizeBytes }` → server validates type/size, mints a **short-lived (≈5 min) presigned PUT URL** to a `users/{userId}/...` key, writes a `Photo` row as `pending`. Enforce a **content-length-range** on the presigned URL so the bucket itself rejects oversized uploads.
2. Client `PUT`s the file directly to R2/S3 (never through Express).
3. `POST /photos/:id/confirm` → marks `ready` (or a post-upload processing step does, below).

**Security controls (the important part):**
- **Authorization on every access** — a user can only mint URLs for, read, or delete their own `Photo` rows; verify `photo.userId === req.userId` server-side. Never trust a client-supplied key.
- **Private serving** — no public bucket URLs. Read via **short-lived presigned GET** URLs minted per request (`GET /photos/:id/url`), or proxy through the backend with an ownership check. URLs expire (≈5 min) so they can't be shared/leaked durably.
- **Validate, then re-encode** — check the **magic bytes** (not just the client `Content-Type`), restrict to `image/jpeg|png|heic`. After upload, a processing step (job, or Cloudflare Images / a Lambda) **re-encodes** the image. Re-encoding both **strips EXIF metadata** — critically GPS coordinates that would leak the owner's home address — and neutralizes most malicious payloads hidden in image files. Generate a **thumbnail** here too (for the grid + PDF embedding).
- **Quarantine pattern** (optional, stronger): upload to a `quarantine/` prefix, process/validate, then move to the canonical key; only then flip `status: ready`.
- **Rate-limit** the upload-url endpoint (reuse `express-rate-limit`).
- **Lifecycle / deletion** — deleting a `Photo`, or the user's account, must delete the underlying object (GDPR / data-ownership). Cascade on account deletion.

**New env:** `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (or `S3_*`). **New dependency:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 is S3-compatible) and a re-encode lib (`sharp`).

**Routes:** `POST /photos/upload-url`, `POST /photos/:id/confirm`, `GET /photos?releaseId=`, `GET /photos/:id/url`, `DELETE /photos/:id` — all Pro-gated, all ownership-checked.

**Clients:** web — drag/drop or file picker in the detail drawer, gallery thumbnails; iOS — `PhotosPicker` / camera capture, upload via presigned URL. Both fetch presigned GET URLs to display.

**Effort:** M. New model + object-storage integration + presigned upload/serve + post-upload re-encode/thumbnail pipeline. Independent of the other features — can land any time after billing, but pairs naturally with the PDF (§7.4) and the original "photos of your actual copies" idea.

---

## 8. Scheduling (cross-cutting prerequisite)

Portfolio capture (§5) and alert polling (§6) need a scheduler the app doesn't have. Options, in order of preference:

1. **Render Cron Job** (separate service in `render.yaml`) that runs the same codebase with a `--job=<name>` entrypoint, or hits an internal authenticated endpoint. Cleanest separation; no in-process timer competing with web traffic.
2. **`node-cron` in-process** — simplest to start, but runs in the web dyno and double-fires if you ever scale to >1 instance. Acceptable for v1 single-instance.
3. External scheduler (GitHub Actions / Upstash QStash) hitting a protected `POST /internal/jobs/:name`.

Jobs to implement: `snapshot-portfolios` (daily), `poll-price-alerts` (every 6h). Both iterate Pro users / active alerts, reuse `discogsService` + `discogsResilience`, and must stagger to respect Discogs rate limits.

---

## 9. Build order

Reordered around the ToU (§0.1): ship the **permission-free, user-data bundle** first; gate the marketplace-data features behind written permission from Discogs.

**Phase 1 — launch bundle (no Discogs permission required):**
1. **Billing foundation** (§2) + `User.tier` (§1.1) + `requirePro` + `/auth/me` entitlement. Nothing ships without this.
2. **Attribution notices** (§0.2) — *already done*; verify they render in every public surface before charging anyone.
3. **Unlimited collection** (§3) — smallest feature, validates the gate end-to-end and the paywall UX. (Still relies on ToU clause-3 written permission to charge — see §11.)
4. **Cost-basis & stated value** (§4) — `CollectionItemMeta`; all user-owned data, fully compliant.
5. **PDF appraisal** (§7) — composes over §4's user-entered values + CC0 catalog; no marketplace data.
6. **Photo storage** (§7.5) — user content; pairs with the PDF.

**Phase 2 — gated on express written permission from Discogs:**
7. **Price alerts** (§6) — retention anchor, but blocked until permission lands.

*(Value-over-time portfolio, §5, is out of scope — see that section. The scheduler in §8 is only needed for Phase 2 alert polling now, not portfolio snapshots.)*

> Even Phase 1 charging technically needs clause-3 written permission (paid app over the API). Open the conversation with Discogs early — it unblocks both phases.

## 10. Cross-repo touch points

- **backend:** new models (§1.2–1.6, `Photo` §7.5), `User` changes (§1.1), handlers (billing, alerts, export, cost, devices, portfolio, photos), `requirePro` middleware, `discogsService` additions (`getPriceSuggestions`, marketplace low), `notificationService`, object-storage service + re-encode/thumbnail pipeline, scheduler entrypoints, env additions (Stripe + R2/S3), Stripe webhook body carve-out.
- **provinyl-web:** `tier` in `useAuth`, paywall modal, collection cap meter, cost-basis + stated-value inputs + gain/loss in detail drawer, photo upload/gallery in detail drawer, "Export PDF" action. *(Phase 2: alerts management screen.)*
- **provinyl-ios:** `tier` in `MeResponse`, StoreKit **or** web-checkout handoff (note: Apple may require IAP for digital subscriptions — decide whether iOS upgrades go through StoreKit with server-side receipt validation, or open Safari to Stripe Checkout; this affects revenue share and must be settled before iOS billing UI), cost-basis + stated-value inputs, `PhotosPicker`/camera capture + presigned upload. *(Phase 2: alerts screen, APNs registration `POST /devices` + push handling.)*

## 11. Open decisions

- **Discogs written permission** (§0.1, clause 3) — contact Discogs to (a) authorize a paid app over their API, and (b) authorize commercial use of Marketplace Data for §5/§6. **Top priority — gates Phase 1 charging and all of Phase 2.** Until granted, do not build §5 (Discogs-value variant) or §6.
- **Free collection cap number** (100? 250?). Lower = stronger conversion, more friction.
- **iOS billing** — StoreKit IAP vs Stripe-in-Safari (App Store policy + 15–30% cut). **Blocks iOS upgrade UI.**
- **Notification provider** — Resend / Postmark / SES (only needed once §6 is unblocked).
- **Pricing** — monthly + annual amounts; free trial?
