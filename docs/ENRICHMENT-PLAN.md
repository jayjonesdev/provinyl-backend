# Background Enrichment — Implementation Plan

Populate **per-item value** (and community rating, prices) for the collection and
wantlist so the value-based stats work: most-valuable, value-over-time, top-5,
per-item value in the grid/table, and the wantlist cells (est. to acquire, avg
price, hardest find). The collection *total* is already real via the aggregate
value endpoint — this plan is about **per-release** figures.

| | |
|---|---|
| **Value source** | Discogs marketplace **price suggestion for the item's media condition**, falling back to `lowest_price` |
| **Approach** | Persistent backend enrichment (Mongo) + background worker + scheduled refresh |
| **Builds on** | Existing resilience layer (concurrency cap + 429 backoff), release-detail cache, `/release/:id`, and the aggregate value endpoint |
| **Estimate** | ~2 days across three sub-phases (E1–E3) |

---

## 1. Why this is non-trivial

Discogs list endpoints return only `basic_information` — no per-item value, price,
or community rating. Those require **per-release** calls, and the API is capped at
**60 req/min** (authenticated). "Value for my condition" needs **two** Discogs
reads per release:

1. `GET /releases/{id}` → `lowest_price`, `community.rating`, `num_for_sale`.
2. `GET /marketplace/price_suggestions/{id}` → suggested price **per condition**.

…plus the item's **condition grade**, which lives on the *collection instance*
(not the release) and we currently default to "—".

At ~2 calls/item, a 500-record library is **~17 min** to enrich cold. So we
compute once, **persist** in Mongo, and reuse — subsequent loads are instant; a
scheduled job keeps prices fresh.

> **Seller-account caveat.** `price_suggestions` may require the authenticated
> user to have a Discogs **seller account**; it can return 403 otherwise. The
> worker detects this and falls back to `lowest_price` as the value. Surface the
> degraded mode in the UI.

---

## 2. Data model & sources

### Per-item condition (per user, from the collection)
- `GET /users/{username}/collection/fields` (once, cached) → field definitions;
  identify the **Media Condition** field id (Discogs default field_id `1`,
  Sleeve `2`, but read it from this endpoint rather than hard-coding).
- Each collection instance already carries `notes: [{ field_id, value }]` when the
  user records conditions. **Enhance `collectionItemToRelease`** to read media /
  sleeve condition from `notes` (today it defaults to `'—'`).
- Condition strings use Discogs long-form labels (e.g. `"Very Good Plus (VG+)"`),
  which match the `price_suggestions` keys — so they join directly.

### Release-level enrichment (shared across users) — new Mongo model
```ts
// models/ReleaseEnrichment.ts
{
  releaseId: number,            // unique index
  lowestPrice: number | null,
  numForSale: number,
  communityRating: { avg: number; count: number },
  // price suggestion keyed by Discogs condition label
  priceSuggestions: Record<string, number>,  // { "Very Good Plus (VG+)": 42.00, ... }
  currency: string,             // user/account currency from Discogs
  fetchedAt: Date,              // for staleness / refresh
}
```
Release enrichment is **user-independent** (prices/ratings are global). The
**per-item value** is derived at response time: `priceSuggestions[itemCondition]
?? lowestPrice ?? 0`.

---

## 3. Worker & queue

- **Trigger:** on `GET /collection|/wantlist` (or `sync`), diff the library's
  release ids against `ReleaseEnrichment`; enqueue ids that are **missing** or
  **stale** (`fetchedAt` older than the refresh interval, e.g. 7 days).
- **Worker:** an in-process async loop that drains the queue through the existing
  `runDiscogs()` (concurrency cap 5 + 429 backoff), upserting `ReleaseEnrichment`.
  Two Discogs calls per release (detail + price suggestions), both already cached.
- **Idempotent & deduped:** a release in-flight or freshly enriched is skipped.
- **Multi-instance:** the in-process queue + resilience semaphore are
  per-instance. Before scaling beyond one instance, move the queue to **Redis +
  BullMQ** and the rate-limit token bucket to Redis (noted; out of scope for v1).

### Scheduled refresh
- A daily cron (the repo already has a scheduling story via Render/cron, or a
  simple `setInterval` guarded for single-instance) re-enqueues entries with
  `fetchedAt` older than the price-refresh TTL, spreading calls over time.

---

## 4. Merging into responses

- `getCollection` / `getWantlist`: after mapping to `Release[]`, **left-join**
  `ReleaseEnrichment` by `releaseId` and set, per item:
  - `value = priceSuggestions[condition] ?? lowestPrice ?? 0`
  - `lowestPrice`, `numForSale`, `rating` (community), and `condition` (from notes)
- Items not yet enriched keep `value: 0` (today's behavior) until the worker
  catches up — the stats refine as enrichment completes.

### Progress endpoint
- `GET /collection/:username/enrichment-status` → `{ total, enriched, pending }`
  so the SPA can show "Valuing your collection… 120 / 500" and re-poll.

---

## 5. Frontend changes (provinyl-web)

- **Stats strip:** restore the value-centric cells now that data exists —
  collection: `Collection value` (already real) + `Most valuable`; wantlist:
  `Est. to acquire` / `Avg price` / `Hardest find` (sum / avg / max of per-item
  value). Keep counts as secondary.
- **Overview:** value-over-time (cumulative per-item value by `dateAdded`) and
  top-5 most valuable become real.
- **Grid/Table:** per-item value renders instead of being hidden.
- **Progress UI:** a subtle "valuing…" indicator driven by the status endpoint;
  poll and recompute stats until `pending === 0`.
- **Degraded mode:** if the backend reports price suggestions unavailable
  (no seller account), label the value as "lowest price" rather than "est. value".

---

## 6. Sub-phases

| Phase | Scope | Effort |
|---|---|---|
| **E1** | `ReleaseEnrichment` model; read condition from collection `notes` (+ `/collection/fields`); worker fetching `/releases/{id}` for `lowest_price` + community rating + `num_for_sale`; merge into responses; enqueue-on-load. Unlocks **most-valuable** (via lowest_price), real community ratings, wantlist prices. | ~1 day |
| **E2** | Add `price_suggestions` call keyed by condition → accurate "your copy's value"; seller-account fallback to `lowest_price`. | ~0.5 day |
| **E3** | `enrichment-status` endpoint + frontend progress UI; scheduled refresh of stale prices. | ~0.5 day |

---

## 7. Rate-limit budget

- 60 req/min ÷ 2 calls/item ≈ **30 items/min**. 500 items ≈ ~17 min cold; instant
  thereafter. The worker self-paces via `runDiscogs`; never blocks user requests
  (enrichment is background, responses return immediately with whatever's ready).
- Caches: `/collection/fields` (long TTL), release detail (existing 1h), price
  suggestions (e.g. 24h). Refresh interval for persisted value: ~7 days.

---

## 8. Risks & open questions

- **Seller account** required for price suggestions → may force the `lowest_price`
  fallback for some users. Confirm against the live Discogs app.
- **Currency** — prices come in the account's currency; store and display it
  (don't assume USD).
- **First-run latency** — minutes for large libraries; set expectations in the UI.
- **Multi-instance** — in-memory queue/semaphore must move to Redis before
  horizontal scaling (also true of the existing rate-limit semaphore + pending-
  OAuth store).
- **Discogs ToS / fair use** — bulk per-release fetching should stay within rate
  limits and caching; avoid re-enriching aggressively.
- **Condition coverage** — users who don't record conditions get `lowestPrice`
  as value (no condition to key the suggestion on).

---

## 9. Definition of done

- Collection/wantlist responses carry real per-item `value`, `lowestPrice`,
  `rating`, and `condition` once enriched.
- Stats strip + Overview value widgets populate (progressively, then instantly on
  later loads).
- Enrichment respects the rate limit, survives restarts (persisted), and refreshes
  stale prices on a schedule.
- Graceful fallback + clear labeling when price suggestions aren't available.
