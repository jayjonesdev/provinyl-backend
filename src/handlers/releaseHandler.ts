import { Request, Response } from 'express';
import { createAppClient } from '../services/discogsService';
import { releaseToRelease } from '../utils/toRelease';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { ReleaseParams, ReleaseQuery } from '../validators';

// GET /api/v1/release/:id?list=collection|wantlist — no auth required.
// Returns the full Release (rating, tracklist, videos, credits, prices). The
// `list` query just tags which library the client opened it from; the frontend
// merges these detail fields into its existing Release and keeps its own `list`.
export async function getRelease(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.valid!.params as ReleaseParams;
    const { list } = req.valid!.query as ReleaseQuery;

    const client = createAppClient();
    const data = await client.getRelease(id);

    res.json(releaseToRelease(data, list));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch release');
    fail(res, 502, 'discogs_error', 'Failed to fetch release from Discogs');
  }
}
