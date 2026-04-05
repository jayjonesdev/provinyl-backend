import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClient, createAppClient } from '../services/discogsService';
import { normalizeCollectionItem, normalizePagination } from '../utils/normalize';
import logger from '../utils/logger';

// POST /api/v1/collection/:username  body: { release_id }
export async function addToCollection(req: AuthRequest, res: Response): Promise<void> {
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
    const result = await client.addToCollection(username, releaseId);

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to add to collection');
    res.status(502).json({ error: 'Failed to add to collection' });
  }
}

// DELETE /api/v1/collection/:username/:releaseId  body: { instance_id }
export async function removeFromCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId: releaseIdParam } = req.params as { username: string; releaseId: string };

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const releaseId = parseInt(releaseIdParam, 10);
    const instanceId = parseInt(req.body['instance_id'], 10);

    if (isNaN(releaseId) || isNaN(instanceId)) {
      res.status(400).json({ error: 'Invalid release_id or instance_id' });
      return;
    }

    const client = createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret);
    await client.removeFromCollection(username, releaseId, instanceId);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from collection');
    res.status(502).json({ error: 'Failed to remove from collection' });
  }
}

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
