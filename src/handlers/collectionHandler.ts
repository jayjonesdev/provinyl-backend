import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClient, createAppClient } from '../services/discogsService';
import { normalizeCollectionItem, normalizePagination } from '../utils/normalize';
import logger from '../utils/logger';

// GET /api/v1/collection/:username?page=1&per_page=100
export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };
    const page = parseInt((req.query['page'] as string) ?? '1', 10);
    const perPage = Math.min(parseInt((req.query['per_page'] as string) ?? '100', 10), 100);

    const isOwner = req.user?.username === username;

    let data;
    if (isOwner && req.user) {
      const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);
      data = await client.getCollection(username, page, perPage);
    } else {
      // Public collection — use app-level credentials
      const client = createAppClient();
      data = await client.getPublicCollection(username, page, perPage);
    }

    res.json({
      items: (data.releases ?? []).map(normalizeCollectionItem),
      pagination: normalizePagination(data.pagination),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch collection');
    res.status(502).json({ error: 'Failed to fetch collection from Discogs' });
  }
}
