/* ProVinyl — request schemas (zod). Coerce numeric path/query params and reject
 * malformed input at the edge so handlers receive typed, validated data via
 * `req.valid` (see middleware/validate.ts). */

import { z } from 'zod';

const username = z.string().min(1);
const releaseId = z.coerce.number().int().positive();
const listKind = z.enum(['collection', 'wantlist', 'catalog']);

// ── auth ────────────────────────────────────────────────────────────────────
export const callbackQuery = z.object({
  oauth_token: z.string().min(1),
  oauth_verifier: z.string().min(1),
});

// ── collection / wantlist ────────────────────────────────────────────────────
export const usernameParams = z.object({ username });
export const releaseBody = z.object({ releaseId });
export const usernameReleaseParams = z.object({ username, releaseId });

// ── release ──────────────────────────────────────────────────────────────────
export const releaseParams = z.object({ id: releaseId });
export const releaseQuery = z.object({ list: listKind.optional().default('catalog') });

// ── search ───────────────────────────────────────────────────────────────────
export const searchQuery = z.object({
  q: z.string().trim().min(1),
  type: z.enum(['title', 'artist', 'label', 'catno', 'barcode', 'track']).optional().default('title'),
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().positive().max(100).optional().default(25),
});

// Inferred types handlers read off req.valid.
export type CallbackQuery = z.infer<typeof callbackQuery>;
export type UsernameParams = z.infer<typeof usernameParams>;
export type ReleaseBody = z.infer<typeof releaseBody>;
export type UsernameReleaseParams = z.infer<typeof usernameReleaseParams>;
export type ReleaseParams = z.infer<typeof releaseParams>;
export type ReleaseQuery = z.infer<typeof releaseQuery>;
export type SearchQuery = z.infer<typeof searchQuery>;
