# PDF Export — Implementation Plan

Status: **Proposal / not started**
Primary repo: `provinyl-backend` · Clients: `provinyl-web`, `provinyl-ios`
Related: [PRO-TIER-PLAN.md](./PRO-TIER-PLAN.md) §4 (cost-basis), §7 (appraisal), §7.5 (photos). This doc is the actionable, self-contained plan for the export feature and its two dependencies.

## Goal

A Pro user taps **Export** and gets a **branded PDF inventory** of their collection. Each line item shows the catalog details plus **the value the user set** and **a custom image the user uploaded** for that copy. The document is branded ProVinyl and suitable to hand to an insurer.

Three pillars, built in this order (each usable on its own):

1. **User-set collection item value** — let owners record what each copy is worth.
2. **Custom item image storage** — let owners upload photos of their actual copies.
3. **Branded PDF generation** — compose 1 + 2 + CC0 catalog data into a downloadable PDF.

Plus an in-app **Estimated Value** (Discogs). It is **not printed in the PDF**; instead the PDF carries a short note directing the user to the app to see the current estimate (Pillar 1.6 / Pillar 3.3).

## The two value fields

| Field | Source | Data class | In app? | In PDF? |
| --- | --- | --- | --- | --- |
| **Your Value** | user-entered (`CollectionItemMeta.value`) | user-authored | ✅ | ✅ |
| **Estimated Value** | Discogs value (`getCollectionValue` / per-item `price_suggestions`) | Marketplace Data | ✅ live | ❌ — replaced by a "view in app" note |

"Your Value" is what the user thinks it's worth and is the appraisal figure in the export. "Estimated Value" is the Discogs market figure — kept **live in-app only**; the PDF points the reader to the app rather than baking in a number that's stale the moment it's printed. This also keeps the stored document clear of Restricted Marketplace Data.

## ⚠️ Compliance — read first (Discogs API ToU, see PRO-TIER-PLAN §0.1)

The PDF is a **stored, third-party-facing document**, so it contains **only**:
- **User-authored data** — the value the user set, optional purchase price/notes, user-uploaded images.
- **CC0 catalog fields** — title, artist, year, country, format, **label + catalog #**, genres/styles.

It does **not** print Discogs **Marketplace Data** (price suggestions, lowest price, collection value) — that's Restricted Data (no commercial use) and the 6-hour freshness rule forbids storing it in a long-lived file. The **Estimated Value** stays **live in-app**; the PDF instead shows a **"view the current estimate in the ProVinyl app"** note (Pillar 3.3). This keeps the export compliant and avoids a stale baked-in number.

## Gating

Pro-gated. Use `requirePro` (from PRO-TIER-PLAN §2 billing) once it exists; until then gate with the existing `requireAuth`. The feature is otherwise independent of billing and can be built first.

---

# Pillar 1 — User-set collection item value

The `Release.value` owner field already exists end-to-end (`src/types/release.ts:94`, mirrored in `provinyl-web/src/types.ts` and `provinyl-ios/.../Release.swift`) and both clients already render it — but the backend hardcodes it to `0` (`src/utils/toRelease.ts`: *"value … has no list-level Discogs source and defaults out"*). We populate it from a new owner-owned store.

## 1.1 Data model — `CollectionItemMeta` (new)

`src/models/CollectionItemMeta.ts` + interface in `src/types/index.ts`.

```ts
interface ICollectionItemMeta extends Document {
  userId: string;                          // ref User._id
  releaseId: number;                       // Discogs release id
  instanceId?: number;                     // specific owned copy (Discogs instance)
  value?: { amount: number; currency: string };        // owner's stated worth → Release.value
  purchasePrice?: { amount: number; currency: string };// optional, for gain/loss
  purchaseDate?: Date;
  note?: string;                           // "Amoeba SF, sealed 2nd pressing"
  createdAt: Date; updatedAt: Date;
}
```

- Compound **unique index** `{ userId, releaseId, instanceId }`. `instanceId` optional → use a sentinel (e.g. `0`) in the index key when absent so uniqueness holds for release-level meta.
- Sparse by design: only annotated copies have a document.
- `currency` defaults to the user's preferred currency (add `preferredCurrency` to `User`, default `'USD'`; or accept per-write).

## 1.2 Validators (`src/validators.ts`)

```ts
const money = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3).toUpperCase(),
});
export const itemMetaBody = z.object({
  value: money.optional(),
  purchasePrice: money.optional(),
  purchaseDate: z.coerce.date().optional(),
  note: z.string().max(280).optional(),
  instanceId: z.coerce.number().int().positive().optional(),
}).strict().refine(
  (b) => b.value || b.purchasePrice || b.purchaseDate || b.note !== undefined,
  { message: 'Provide at least one field' },
);
export type ItemMetaBody = z.infer<typeof itemMetaBody>;
```

## 1.3 Routes + handler

New `src/handlers/itemMetaHandler.ts`; mount in `src/routes/index.ts` (mirrors the `/condition` route shape):

```
GET    /api/v1/collection/:username/:releaseId/meta     → ICollectionItemMeta | null
POST   /api/v1/collection/:username/:releaseId/meta     → upsert (body: itemMetaBody)
DELETE /api/v1/collection/:username/:releaseId/meta     → clear
```

- All `requireAuth` + ownership check (`req.user?.username === username`, as in `collectionHandler`).
- Upsert by `{ userId, releaseId, instanceId }`.

## 1.4 Join into the collection read path

In `getCollection` (`collectionHandler.ts`), after mapping releases:
- Batch-load this user's `CollectionItemMeta` for the returned `releaseId`s in **one** query (`find({ userId, releaseId: { $in } })`).
- Set `release.value = meta.value?.amount ?? 0` (keep the existing `0` default when absent).
- Optionally attach `purchasePrice` / `note` as new optional owner fields on the `Release` contract (add to all three repos in lockstep — the file header warns to keep them mirrored).

This means the **existing collection UI shows the user's values immediately** once they set them — no new display surface required for the value itself.

## 1.5 Client UI

- **web** (`src/components/Detail.tsx`): a small editable "Your value" field in the owner section; on blur, `POST …/meta`, optimistic update of the store (`useLibrary`). Reuse the optimistic-mutation pattern already in `useLibrary`.
- **iOS** (`Features/Detail/ReleaseDetailView.swift`): an editable value row in `statGrid`/owner area; write via `AppState.setItemValue(...)` calling the new endpoint, mirroring `setCondition`.

**Effort:** S–M.

## 1.6 Estimated Value (Discogs) — in-app reference field

A read-only **Estimated Value** shown next to "Your Value", sourced from the **Discogs collection value** so the user has a market reference when deciding what to set.

**Already wired:** the backend exposes `GET /collection/:username/value` (`getCollectionValue` → `{ minimum, median, maximum }`), and both clients already fetch and display the **median** (`useLibrary.collectionValue` on web; `AppState.collectionValue` on iOS). This pillar is mostly **labeling/surfacing** that existing data as "Estimated Value (Discogs)".

**Granularity:** `getCollectionValue` is a **collection-level aggregate** (min/median/max total), not per-item. So:
- **Collection-level Estimated Value** — the Discogs median total, shown next to the user-set total **in-app** (Overview). Free, live, no extra calls. The PDF references this with a "view in app" note rather than printing it.
- **Per-item Estimated Value (optional)** — available via `GET /marketplace/price_suggestions/:releaseId` (per media grade), falling back to the release `lowestPrice` already on the contract. Add `getPriceSuggestions` to `discogsService`; fetch live **in-app** while editing. Not used in the PDF.

**Constraints:**
- Always **fetch fresh** in-app on view; never persisted.
- **Not printed in the PDF** — the export shows "Your Value" and a note pointing the reader to the app for the live Estimated Value (Pillar 3.3).
- Label it clearly as a Discogs estimate, distinct from the owner's figure.

**Effort:** XS for collection-level (relabel existing data); S for optional per-item live suggestions (`getPriceSuggestions` + grade matching).

---

# Pillar 2 — Custom item image storage

Lets owners attach photos of their actual copies; the PDF embeds them. Personal user content → security-first. (Expanded from PRO-TIER-PLAN §7.5.)

## 2.1 Storage backend

Object storage, **not** Mongo/GridFS. **Cloudflare R2** recommended (S3-compatible, zero egress, cheap; SSE-at-rest by default). Alternatives: S3, Backblaze B2. **Private bucket, no public ACLs.**

- **Deps:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp` (re-encode/thumbnail).
- **Env (`src/config/env.ts`):** `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.
- New `src/services/storageService.ts` wraps the S3 client: `presignPut`, `presignGet`, `getObject`, `deleteObject`.

## 2.2 Data model — `Photo` (new)

`src/models/Photo.ts`:

```ts
interface IPhoto extends Document {
  userId: string;
  releaseId: number;
  instanceId?: number;
  kind: 'sleeve' | 'vinyl' | 'signature' | 'receipt' | 'other';
  storageKey: string;                       // users/{userId}/photos/{uuid}.jpg
  thumbKey?: string;                        // users/{userId}/photos/{uuid}_thumb.jpg
  contentType: string;                      // image/jpeg|png|heic
  sizeBytes: number;
  width?: number; height?: number;
  status: 'pending' | 'ready';              // ready after re-encode/thumb
  createdAt: Date;
}
```

- Object key **namespaced by `userId`** → ownership is structural, never from client input.
- Index `{ userId, releaseId }`. Per-item and per-user **count caps** (cost/abuse).

## 2.3 Secure upload flow (presigned, direct-to-bucket — image bytes never hit Express)

```
POST   /api/v1/photos/upload-url   { releaseId, instanceId?, kind, contentType, sizeBytes }
         → validate type+size; mint a ~5-min presigned PUT to users/{userId}/…; write Photo(status:pending); return { photoId, url }
PUT    <presigned url>             (client → R2 directly)
POST   /api/v1/photos/:id/confirm  → trigger processing (2.4), flip to ready
GET    /api/v1/photos?releaseId=   → Photo[] for that release (owner only)
GET    /api/v1/photos/:id/url      → short-lived presigned GET (display)
DELETE /api/v1/photos/:id          → delete object(s) + doc
```

All `requireAuth` (later `requirePro`) + **ownership check on every call** (`photo.userId === req.userId`). Rate-limit `upload-url` (reuse `express-rate-limit`). Enforce a **content-length-range** on the presigned PUT so the bucket rejects oversize uploads.

## 2.4 Post-upload processing (the security-critical step)

On `confirm` (inline for v1; a job/queue later):
1. `getObject` the upload.
2. **Validate magic bytes** (not the client `Content-Type`); restrict to JPEG/PNG/HEIC.
3. **Re-encode with `sharp`** → strips **EXIF metadata (incl. GPS — would otherwise leak the owner's home address)** and neutralizes payloads hidden in image files. Write back the normalized image + a **thumbnail** (`thumbKey`, ~400px for the PDF/grid).
4. Set `width/height`, `status: 'ready'`.

(Optional hardening: upload to a `quarantine/` prefix, process, then move to the canonical key.)

## 2.5 Other controls

- **Private serving only** — presigned GET (~5 min) or a backend proxy with an ownership check; never public URLs.
- **Lifecycle** — deleting a `Photo` or the user's account deletes the underlying object(s) (GDPR). Cascade on account delete.

## 2.6 Client UI

- **web:** file picker / drag-drop in `Detail.tsx`; request `upload-url`, `PUT` to R2, `confirm`; gallery via presigned GETs.
- **iOS:** `PhotosPicker` + camera capture; upload via the presigned URL; thumbnails via presigned GETs.

**Effort:** M.

---

# Pillar 3 — Branded PDF generation

## 3.1 Endpoint

```
GET /api/v1/export/appraisal.pdf?scope=all|over:<amount>&images=1
```
`requireAuth` (later `requirePro`). Streams `application/pdf` with `Content-Disposition: attachment; filename="provinyl-appraisal-YYYY-MM-DD.pdf"`. New `src/handlers/exportHandler.ts` + `src/services/pdfService.ts`.

**Library:** `pdfkit` (programmatic, no headless browser — best fit for a Render service). `pdfkit` embeds JPEG/PNG via `doc.image(buffer)`.

## 3.2 Data assembly (server-side)

1. Aggregate the owner's collection (existing `getAllCollection` path); keep **CC0 catalog fields only**.
2. Batch-join `CollectionItemMeta` (value, purchasePrice, note) by `releaseId`/`instanceId`.
3. If `images=1`, batch-load `Photo` (status `ready`) per release; `getObject` each **`thumbKey`** into a buffer for embedding. Cap embedded images (e.g. 1 primary per item) to bound file size; `log`/note when capped.
4. Apply `scope` filter (`over:<amount>` keeps items whose user-set value ≥ amount).

No Discogs marketplace/value calls happen here — Estimated Value is not printed (see Pillar 1.6).

## 3.3 Document structure

**Cover / summary page**
- ProVinyl wordmark/logo, "Collection Appraisal", owner (Discogs username + optional real name), generation date.
- Totals: **item count**, **total stated value** (Σ user-set `value`), total **cost basis** (Σ `purchasePrice`), **unrealized gain/loss** (stated − cost).
- Coverage line: N of M items have a stated value.
- Disclaimer: **"'Your Value' figures are owner-supplied and not a certified appraisal."**
- **Estimated Value note:** **"For the current estimated market value of your collection, open it in the ProVinyl app — estimates update over time and aren't printed here."** (This replaces any Discogs figure in the file.)

**Line-item inventory** — one row per copy:

| Column | Source | Class |
| --- | --- | --- |
| Image (if `images=1`) | `Photo.thumbKey` buffer | user |
| Artist / Title | `Release.artist` / `.title` | CC0 |
| Year / Country | `Release.year` / `.country` | CC0 |
| Format | `Release.formatMain` / `formats` | CC0 |
| Label / Catalog # | `Release.labels[]` | CC0 |
| Media / Sleeve grade | `Release.condition` | user/CC0 |
| Purchase price | `CollectionItemMeta.purchasePrice` | user |
| **Your Value** | `CollectionItemMeta.value` | user |

Sort by Your Value desc (high-worth first); paginate with running subtotals for long collections. (No per-item Estimated Value column — that figure lives in the app per Pillar 1.6.)

**Branding / footer (every page)**
- ProVinyl mark + page numbers; brand accent `#5f5c74` (matches the apps); brand font if a TTF is bundled (else Helvetica).
- Required Discogs notice: **"This application uses Discogs' API but is not affiliated with, sponsored or endorsed by Discogs. 'Discogs' is a trademark of Zink Media, LLC."**
- The catalog fields (title, label, catalog #, etc.) are Discogs-sourced, so include **"Data provided by Discogs."** in the footer per the attribution clause.

## 3.4 Branding assets

Add `src/assets/` with the ProVinyl logo (PNG/SVG→PNG) and optional brand TTF. Keep a small `pdfService` theme object (colors, fonts, margins) so the look stays consistent and tweakable.

## 3.5 Performance / streaming

- Stream directly to `res` (`doc.pipe(res)`) — don't buffer the whole PDF in memory.
- Large collections + images = many `getObject`s: fetch image buffers with bounded concurrency (reuse the resilience/limit pattern). Consider a soft cap (e.g. first 500 items) with a noted truncation line for v1.

**Effort:** M (S–M without images).

---

# Cross-cutting

## Dependencies
`pdfkit`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`. (Types: `@types/pdfkit`.)

## Env additions
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.

## Build order
1. **Pillar 1** (user-set value) — new model + meta routes + read-path join + client value inputs. Ships standalone value; nothing else depends on billing.
2. **Pillar 3 (text-only)** — PDF with cover + line items + user values + CC0 catalog. Useful on its own.
3. **Pillar 2** (image storage) — object storage + secure upload + processing + client capture.
4. **Pillar 3 (images)** — embed thumbnails; add `images=1`.

## Testing
- **Unit:** value join in `getCollection` (Vitest, mock meta); validators; `scope`/`over` filter; magic-byte validation; presign URL shape.
- **Integration (supertest):** meta CRUD + ownership 403s; photo upload-url/confirm happy path (mock S3); `GET /export/appraisal.pdf` returns `application/pdf` with the right headers and a non-trivial body; **assert no marketplace fields appear** in the generated data (compliance guard).
- **Manual:** generate a PDF for a seeded collection with/without images; verify branding, totals, disclaimer, attribution.

## Cross-repo touch points
- **backend:** models `CollectionItemMeta`, `Photo`; handlers `itemMetaHandler`, `photoHandler`, `exportHandler`; services `storageService`, `pdfService`; validators; routes; `getCollection` join; env; assets; `requirePro` once billing lands.
- **provinyl-web:** value input + **Estimated Value (Discogs) label** + photo upload/gallery in `Detail.tsx`; "Export PDF" action (download the stream); `Release` type additions.
- **provinyl-ios:** value input + **Estimated Value (Discogs) label** + `PhotosPicker`/camera in `ReleaseDetailView.swift`; "Export PDF" (open/share the downloaded file); `Release` model additions.

## Open decisions
- **Currency** — single `User.preferredCurrency` vs per-item currency (mixed-currency totals need a display rule).
- **Estimated Value granularity** — collection-level median only (free, no new calls) vs optional per-item live `price_suggestions` (extra Discogs calls, in-app only).
- **Images in PDF** — primary image only vs a small grid per item (file-size tradeoff).
- **Item-count cap** for v1 export (e.g. 500) before paging/async generation.
- **Object storage provider** — R2 (recommended) vs S3 vs B2.
- **Async export** for very large collections — synchronous stream now; email-a-link/job later if needed.
