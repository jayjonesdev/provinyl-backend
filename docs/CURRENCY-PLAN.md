# App-wide Currency — Implementation Plan

Status: **Proposal / not started**
Scope: `provinyl-backend` (primary), `provinyl-web`, `provinyl-ios`

## Goal

Let a user pick a display currency once, and have **every monetary figure** in the
app render in it — market low, "your value", and collection totals — converted
from a known USD base. The user's stored value is kept in the currency they
entered it in; everything is normalised to USD internally and converted at the
edge for display.

> User story: *"I'm in the UK. I want to see £ everywhere, not $, and have the
> Discogs market prices and my collection's total value shown in £."*

---

## 0. Current state (read first)

Three facts about today's code shape the design:

1. **Prices come from Discogs as `lowest_price`** — mapped in
   `src/utils/toRelease.ts:185` (`lowestPrice: r.lowest_price ?? 0`). It is
   **assumed to be USD** but Discogs can return marketplace prices in the
   authenticated account's currency. The base currency must be *pinned*, not
   assumed — see §5.
2. **Owner value is already modelled as money with a currency.**
   `CollectionItemMeta.value` is an `IMoney { amount, currency }`
   (`src/models/CollectionItemMeta.ts`), but iOS always writes `"USD"`
   (`APIClient.setItemValue` default). The shape is ready; the value is just
   never anything but USD today.
3. **A preferences system already exists end-to-end** —
   `IUserPreferences` (`src/types/index.ts:16`), the `preferencesBody` validator
   (`src/validators.ts`), iOS `Preferences.swift`, and the web `usePrefs` hook.
   Currency is a natural new preference field; no new sync mechanism is needed.

Formatting is currently hardcoded to `$` in `provinyl-ios/App/Formatters.swift`
(`Format.money`) and the equivalent web money formatter. Localising the symbol is
a display concern, separate from conversion.

### Discogs ToU note
Marketplace prices are **Restricted Data**, and the 6-hour freshness rule
(`docs/PRO-TIER-PLAN.md` §0.1) applies to the *price value*. Currency conversion
is a pure display transform applied at request time to data we already legitimately
display — it does **not** introduce new storage of marketplace prices, so it does
not change our ToU posture. FX rates themselves are not Discogs data and can be
cached freely. We must **not** start snapshotting converted prices for history.

---

## 1. Design decision

**Store a USD base, convert at the read edge, format by preference.**

```
Discogs lowest_price (pin to USD)  ─┐
owner value (IMoney, any currency) ─┤─► normalise to USD ─► convert(USD→pref) ─► client formats
                                    ─┘         (internal)        (per request)      (symbol/locale)
```

Why server-side conversion (recommended) over shipping rates to clients:
- One implementation, identical numbers across iOS / web / PDF export.
- Keeps `Format.money` dumb (symbol + grouping only).
- Rates and the Discogs base-currency assumption live in one place.

Trade-off: every monetary response depends on the FX cache. Mitigated by an
in-memory + Mongo-backed rate cache with last-known fallback (§2).

---

## 2. FX rate service (backend)

New `src/services/currencyService.ts`:

- `getRates(): Promise<Record<string, number>>` — USD-based rates, e.g.
  `{ GBP: 0.79, EUR: 0.92, ... }`. In-memory cache with a ~24h TTL, backed by a
  small `FxRates` Mongo doc (`{ base: 'USD', rates, fetchedAt }`) so a cold start
  doesn't block on the provider.
- Provider: a free FX API (e.g. exchangerate.host or openexchangerates). Wrap in
  the same resilience pattern as `discogsResilience.ts` (timeout + try/catch).
- **Fallback:** if the provider and the cached doc both fail, return identity
  (treat everything as USD) rather than erroring a collection request.
- `convert(amountUsd: number, currency: string, rates): number`
- `toUsd(money: IMoney, rates): number` — normalises a stored owner value.
- `convertRelease(release, currency, rates)` — maps `lowestPrice`, `value`,
  `displayValue`.

New model `src/models/FxRates.ts` (single doc, upserted on refresh).

A daily refresh can piggyback on the existing auto-refresh cadence; no new
scheduler is required for v1 (lazy refresh on read when the cache is stale).

---

## 3. Preference plumbing

1. `IUserPreferences` — add `currency?: string` (ISO-4217, default `USD`).
2. `preferencesBody` validator — add `currency: z.string().trim().length(3).toUpperCase().optional()`.
3. iOS `Preferences.swift` — add `var currency: String?`.
4. Web `usePrefs` — add `currency` with a default of `USD`.

---

## 4. Apply conversion on responses

In the collection / wantlist / detail / search handlers
(`src/handlers/collectionHandler.ts`, detail, search):

1. Resolve the requester's preferred currency (`req.user.preferences?.currency ?? 'USD'`).
2. After `applyItemMeta` (which sets `value` from `CollectionItemMeta`), run
   `convertRelease(r, currency, rates)` over the result set.
3. Add a `currency` field to the `Release` payload (`src/types/release.ts`) so
   clients know what they received and can format accordingly.

`recomputeStats` (collection totals): sum in **USD**, then convert the total once
— never sum already-converted per-item figures (rounding drift).

---

## 5. Pin the Discogs base currency (must verify first)

Before any conversion is trustworthy, confirm the base of `lowest_price`:

- Request prices with an explicit `curr_abbr=USD` (or whatever Discogs supports
  on the release endpoint) so the base is deterministic.
- If Discogs returns the account currency regardless, store the returned currency
  alongside the price and normalise via `toUsd` instead of assuming USD.

**This is the single biggest correctness risk in the feature.** Do it first.

---

## 6. Client changes

### iOS
- `Format.money(_ amount: Double, currency: String)` using
  `NumberFormatter` with `.currency` style + the ISO code.
- Read currency from prefs; thread it into `ReleaseDetailView`, list cells, stats.
- Settings: a currency picker (writes the preference via `updatePreferences`).
- `setItemValue` should send the user's chosen currency, not hardcoded `"USD"`.

### Web
- Mirror the money formatter (`Intl.NumberFormat(locale, { style: 'currency', currency })`).
- Currency selector in settings, wired through `usePrefs`.

---

## 7. Testing

- Unit: `convert`, `toUsd`, `convertRelease`, and the rate-cache fallback path.
- Update `src/utils/toRelease.test.ts` for the new `currency` field + `personalRating`.
- Snapshot a collection response in a non-USD currency to lock formatting.

---

## 8. Rollout (phased)

1. **Base-currency verification (§5)** — confirm/pin Discogs price currency.
2. **Backend FX service + preference field** — convert on responses, default USD
   so behaviour is unchanged until a user opts in.
3. **iOS** — formatter + settings picker + value-entry currency.
4. **Web** — formatter + settings picker.
5. **Polish** — totals/PDF export currency, empty-state copy.

---

## Open questions

- **Where does value entry happen in the chosen currency?** If a user switches
  GBP→EUR, do we re-interpret stored amounts or convert them? Plan: store as
  entered (currency tagged on `IMoney`), always display converted — never mutate
  the stored amount on a preference change.
- **Per-item currency override** (e.g. a copy bought in JPY) — supported by the
  data model already; out of scope for v1 UI.
- **FX provider + rate refresh SLA** — which provider, and is daily granularity
  acceptable for display? (Yes for v1.)
