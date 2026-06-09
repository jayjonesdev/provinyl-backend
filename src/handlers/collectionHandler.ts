import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor, createAppClient } from '../services/discogsService';
import { collectionItemToRelease, releaseToRelease } from '../utils/toRelease';
import logger from '../utils/logger';

// GET /api/v1/collection/:username?page=1&per_page=100 → Release[]
// (Single page for now; Phase 3 aggregates all pages server-side.)
export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };
    const page = parseInt((req.query['page'] as string) ?? '1', 10);
    const perPage = Math.min(parseInt((req.query['per_page'] as string) ?? '100', 10), 100);

    const isOwner = req.user?.username === username;

    let data;
    if (isOwner && req.user) {
      const client = createUserClientFor(req.user);
      data = await client.getCollection(username, page, perPage);
    } else {
      // Public collection — use app-level credentials.
      const client = createAppClient();
      data = await client.getPublicCollection(username, page, perPage);
    }

    res.json((data.releases ?? []).map(collectionItemToRelease));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch collection');
    res.status(502).json({ error: 'Failed to fetch collection from Discogs' });
  }
}

// POST /api/v1/collection/:username  body: { releaseId } → Release
export async function addToCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const releaseId = parseInt(req.body['releaseId'], 10);
    if (isNaN(releaseId)) {
      res.status(400).json({ error: 'Invalid releaseId' });
      return;
    }

    const client = createUserClientFor(req.user);
    const addResult = (await client.addToCollection(username, releaseId)) as { instance_id?: number };
    const detail = await client.getRelease(releaseId);

    res.status(201).json({ ...releaseToRelease(detail, 'collection'), instanceId: addResult.instance_id });
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

    const client = createUserClientFor(req.user);
    await client.removeFromCollection(username, releaseId, instanceId);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from collection');
    res.status(502).json({ error: 'Failed to remove from collection' });
  }
}
