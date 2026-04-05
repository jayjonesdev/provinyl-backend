import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClient } from '../services/discogsService';
import { normalizeWantlistItem, normalizeCollectionItem, normalizePagination } from '../utils/normalize';
import logger from '../utils/logger';

// GET /api/v1/wantlist/:username?page=1&per_page=100
export async function getWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };
    const page = parseInt((req.query['page'] as string) ?? '1', 10);
    const perPage = Math.min(parseInt((req.query['per_page'] as string) ?? '100', 10), 100);

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);
    const data = await client.getWantlist(username, page, perPage);

    res.json({
      items: (data.wants ?? []).map(normalizeWantlistItem),
      pagination: normalizePagination(data.pagination),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch wantlist');
    res.status(502).json({ error: 'Failed to fetch wantlist from Discogs' });
  }
}

// POST /api/v1/wantlist/:username  body: { release_id }
export async function addToWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const releaseId = parseInt(req.body['release_id'], 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid release_id' });
      return;
    }

    const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);
    const result = await client.addToWantlist(username, releaseId);

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to add to wantlist');
    res.status(502).json({ error: 'Failed to add to wantlist' });
  }
}

// DELETE /api/v1/wantlist/:username/:releaseId
export async function removeFromWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId: releaseIdParam } = req.params as { username: string; releaseId: string };

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const releaseId = parseInt(releaseIdParam, 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid release_id' });
      return;
    }

    const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);
    await client.removeFromWantlist(username, releaseId);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from wantlist');
    res.status(502).json({ error: 'Failed to remove from wantlist' });
  }
}

// POST /api/v1/wantlist/:username/:releaseId/move  — atomic move to collection
export async function moveToCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId: releaseIdParam } = req.params as { username: string; releaseId: string };

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const releaseId = parseInt(releaseIdParam, 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid release_id' });
      return;
    }

    const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);

    // Add to collection first, then remove from wantlist
    const addResult = await client.addToCollection(username, releaseId);
    await client.removeFromWantlist(username, releaseId);

    res.status(201).json(addResult);
  } catch (err) {
    logger.error({ err }, 'Failed to move to collection');
    res.status(502).json({ error: 'Failed to move to collection' });
  }
}
