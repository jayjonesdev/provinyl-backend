import { Request, Response } from 'express';
import { createAppClient } from '../services/discogsService';
import { releaseToRelease } from '../utils/toRelease';
import type { ListKind } from '../types/release';
import logger from '../utils/logger';

// GET /api/v1/release/:id?list=collection|wantlist — no auth required.
// Returns the full Release (rating, tracklist, videos, credits, prices). The
// `list` query just tags which library the client opened it from; the frontend
// merges these detail fields into its existing Release and keeps its own `list`.
export async function getRelease(req: Request, res: Response): Promise<void> {
  try {
    const releaseId = parseInt(req.params['id'] as string, 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid release ID' });
      return;
    }

    const listParam = (req.query['list'] as string) ?? 'catalog';
    const list: ListKind =
      listParam === 'collection' || listParam === 'wantlist' ? listParam : 'catalog';

    const client = createAppClient();
    const data = await client.getRelease(releaseId);

    res.json(releaseToRelease(data, list));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch release');
    res.status(502).json({ error: 'Failed to fetch release from Discogs' });
  }
}
