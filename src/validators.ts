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

// `platform=ios` switches /auth/login to the native flow: it 302-redirects to
// Discogs (instead of returning JSON) and the callback returns tokens via a
// deep link. Defaults to the web flow.
export const loginQuery = z.object({
  platform: z.enum(['web', 'ios']).optional().default('web'),
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

// ── collection item meta (owner value / cost basis / note) ───────────────────
const money = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().trim().length(3).toUpperCase(),
});
export const itemMetaBody = z
  .object({
    value: money.optional(),
    purchasePrice: money.optional(),
    purchaseDate: z.coerce.date().optional(),
    note: z.string().max(280).optional(),
    // Which owned copy this applies to; release-level when omitted.
    instanceId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.value !== undefined ||
      b.purchasePrice !== undefined ||
      b.purchaseDate !== undefined ||
      b.note !== undefined,
    { message: 'Provide at least one of value, purchasePrice, purchaseDate, note' },
  );

// ── photos (custom item images) ───────────────────────────────────────────────
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
export const photoKind = z.enum(['sleeve', 'vinyl', 'signature', 'receipt', 'other']);
export const uploadUrlBody = z
  .object({
    releaseId,
    instanceId: z.coerce.number().int().positive().optional(),
    kind: photoKind.optional().default('other'),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/heic']),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();
export const photoIdParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, 'invalid id') });
export const photoListQuery = z.object({ releaseId });

// ── export (appraisal PDF) ────────────────────────────────────────────────────
// scope=all (default) or over:<amount> to include only items at/above a value.
export const exportQuery = z.object({
  scope: z
    .string()
    .regex(/^(all|over:\d+(\.\d+)?)$/, 'scope must be "all" or "over:<amount>"')
    .optional()
    .default('all'),
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
export type LoginQuery = z.infer<typeof loginQuery>;
export type PreferencesBody = z.infer<typeof preferencesBody>;
export type ConditionBody = z.infer<typeof conditionBody>;
export type ItemMetaBody = z.infer<typeof itemMetaBody>;
export type ExportQuery = z.infer<typeof exportQuery>;
export type UploadUrlBody = z.infer<typeof uploadUrlBody>;
export type PhotoIdParams = z.infer<typeof photoIdParams>;
export type PhotoListQuery = z.infer<typeof photoListQuery>;
export type UsernameParams = z.infer<typeof usernameParams>;
export type ReleaseBody = z.infer<typeof releaseBody>;
export type UsernameReleaseParams = z.infer<typeof usernameReleaseParams>;
export type ReleaseParams = z.infer<typeof releaseParams>;
export type ReleaseQuery = z.infer<typeof releaseQuery>;
export type SearchQuery = z.infer<typeof searchQuery>;
