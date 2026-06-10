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

// ── collection condition (Media/Sleeve grading) ──────────────────────────────
// The standard Discogs grade vocabulary; '' clears the field ("Not Graded").
export const GRADES = [
  'Mint (M)',
  'Near Mint (NM or M-)',
  'Very Good Plus (VG+)',
  'Very Good (VG)',
  'Good Plus (G+)',
  'Good (G)',
  'Fair (F)',
  'Poor (P)',
] as const;
const gradeValue = z.union([z.enum(GRADES), z.literal('')]);
export const conditionBody = z
  .object({
    media: gradeValue.optional(),
    sleeve: gradeValue.optional(),
    // Which owned copy to grade; defaults to the first instance server-side.
    instanceId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine((b) => b.media !== undefined || b.sleeve !== undefined, {
    message: 'Provide media and/or sleeve',
  });

// ── preferences ──────────────────────────────────────────────────────────────
// All keys optional (partial updates merge server-side); .strict() rejects
// unknown keys so we never persist junk. Mirrors provinyl-web usePrefs.
export const preferencesBody = z
  .object({
    theme: z.enum(['light', 'dark']),
    density: z.enum(['comfortable', 'cozy', 'compact']),
    cardStyle: z.enum(['gallery', 'flat', 'frame']),
    radius: z.number().int().min(0).max(40),
    showStrip: z.boolean(),
    sort: z.enum(['added', 'artist', 'title', 'year', 'value', 'rating']),
    lastList: z.enum(['collection', 'wantlist']),
  })
  .partial()
  .strict();

// Inferred types handlers read off req.valid.
export type CallbackQuery = z.infer<typeof callbackQuery>;
export type PreferencesBody = z.infer<typeof preferencesBody>;
export type ConditionBody = z.infer<typeof conditionBody>;
export type UsernameParams = z.infer<typeof usernameParams>;
export type ReleaseBody = z.infer<typeof releaseBody>;
export type UsernameReleaseParams = z.infer<typeof usernameReleaseParams>;
export type ReleaseParams = z.infer<typeof releaseParams>;
export type ReleaseQuery = z.infer<typeof releaseQuery>;
export type SearchQuery = z.infer<typeof searchQuery>;
