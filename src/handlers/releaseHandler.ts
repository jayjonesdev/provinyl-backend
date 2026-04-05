import { Request, Response } from 'express';
import { createAppClient } from '../services/discogsService';
import { normalizeRelease } from '../utils/normalize';
import logger from '../utils/logger';

// GET /api/v1/release/:id — no auth required
export async function getRelease(req: Request, res: Response): Promise<void> {
  try {
    const releaseId = parseInt(req.params['id'] as string, 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid release ID' });
      return;
    }

    const client = createAppClient();
    const data = await client.getRelease(releaseId);

    res.json(normalizeRelease(data));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch release');
    res.status(502).json({ error: 'Failed to fetch release from Discogs' });
  }
}
