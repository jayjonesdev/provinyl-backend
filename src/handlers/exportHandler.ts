import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor } from '../services/discogsService';
import { collectionItemToRelease, gradeFieldIdsFrom } from '../utils/toRelease';
import { CollectionItemMeta } from '../models/CollectionItemMeta';
import { Photo } from '../models/Photo';
import { isStorageConfigured, getObject } from '../services/storageService';
import { buildAppraisalPdf, AppraisalItem } from '../services/pdfService';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { ExportQuery } from '../validators';

/** One primary thumbnail per release (Buffer), for embedding in the PDF. */
async function loadPrimaryThumbs(userId: string, releaseIds: number[]): Promise<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  if (releaseIds.length === 0) return out;
  const photos = await Photo.find({
    userId,
    releaseId: { $in: releaseIds },
    status: 'ready',
    thumbKey: { $ne: null },
  })
    .sort({ createdAt: 1 })
    .lean();
  const firstKey = new Map<number, string>();
  for (const p of photos) {
    if (p.thumbKey && !firstKey.has(p.releaseId)) firstKey.set(p.releaseId, p.thumbKey);
  }
  await Promise.all(
    [...firstKey].map(async ([releaseId, key]) => {
      try {
        out.set(releaseId, await getObject(key));
      } catch {
        // Missing/unreadable object — just omit the image for this row.
      }
    }),
  );
  return out;
}

// GET /api/v1/export/appraisal.pdf?scope=all|over:<amount>
// Streams a branded appraisal PDF of the authed user's collection. Owner-only by
// construction (uses req.user); contains user values + CC0 catalog only.
export async function exportAppraisal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    const username = user.username;
    const { scope, images } = req.valid!.query as ExportQuery;

    const client = createUserClientFor(user);
    const [raw, fields, profile] = await Promise.all([
      client.getAllCollection(username),
      client.getCollectionFields(username).catch(() => ({ fields: [] })),
      // Real name / email for the cover — non-fatal (Discogs may omit them).
      client.getProfile(username).catch(() => null),
    ]);
    const ids = gradeFieldIdsFrom(fields.fields);
    const releases = raw.map((r) => collectionItemToRelease(r, ids));

    // Owner-authored figures, keyed by release id.
    const metas = await CollectionItemMeta.find({ userId: req.userId! }).lean();
    const byRelease = new Map(metas.map((m) => [m.releaseId, m]));

    // Optional: each item's primary photo thumbnail.
    const thumbs =
      images === '1' && isStorageConfigured()
        ? await loadPrimaryThumbs(req.userId!, releases.map((r) => r.id))
        : new Map<number, Buffer>();

    let items: AppraisalItem[] = releases.map((r) => {
      const meta = byRelease.get(r.id);
      const format = [r.formatMain, ...(r.formats[0]?.descriptions ?? [])]
        .filter(Boolean)
        .join(', ');
      return {
        artist: r.artist,
        title: r.title,
        year: r.year,
        format,
        label: r.labels[0]?.name ?? '',
        catno: r.labels[0]?.catno ?? '',
        media: r.condition.media,
        sleeve: r.condition.sleeve,
        value: meta?.value?.amount ?? (r.value || 0),
        purchasePrice: meta?.purchasePrice?.amount,
        note: meta?.note,
        image: thumbs.get(r.id),
      };
    });

    // scope=over:<amount> keeps only items at/above a stated value.
    if (scope.startsWith('over:')) {
      const min = parseFloat(scope.slice(5));
      if (!Number.isNaN(min)) items = items.filter((i) => i.value >= min);
    }

    // Highest-value items first.
    items.sort((a, b) => b.value - a.value);

    const filename = `provinyl-appraisal-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    buildAppraisalPdf(res, {
      owner: username,
      name: profile?.name?.trim() || undefined,
      email: profile?.email?.trim() || undefined,
      generatedAt: new Date(),
      items,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to generate appraisal PDF');
    // If streaming already started, headers are sent — can't switch to JSON.
    if (!res.headersSent) fail(res, 502, 'export_error', 'Failed to generate appraisal');
    else res.end();
  }
}
