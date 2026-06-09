import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor } from '../services/discogsService';
import { wantlistItemToRelease, releaseToRelease } from '../utils/toRelease';
import logger from '../utils/logger';

// GET /api/v1/wantlist/:username?page=1&per_page=100 → Release[]
export async function getWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };
    const page = parseInt((req.query['page'] as string) ?? '1', 10);
    const perPage = Math.min(parseInt((req.query['per_page'] as string) ?? '100', 10), 100);

    if (req.user?.username !== username) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const client = createUserClientFor(req.user);
    const data = await client.getWantlist(username, page, perPage);

    res.json((data.wants ?? []).map(wantlistItemToRelease));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch wantlist');
    res.status(502).json({ error: 'Failed to fetch wantlist from Discogs' });
  }
}

// POST /api/v1/wantlist/:username  body: { releaseId } → Release
export async function addToWantlist(req: AuthRequest, res: Response): Promise<void> {
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
    await client.addToWantlist(username, releaseId);
    const detail = await client.getRelease(releaseId);

    res.status(201).json(releaseToRelease(detail, 'wantlist'));
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

    const client = createUserClientFor(req.user);
    await client.removeFromWantlist(username, releaseId);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from wantlist');
    res.status(502).json({ error: 'Failed to remove from wantlist' });
  }
}

// POST /api/v1/wantlist/:username/:releaseId/move → Release (now in collection)
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

    const client = createUserClientFor(req.user);

    // Add to collection first, then remove from wantlist.
    const addResult = (await client.addToCollection(username, releaseId)) as { instance_id?: number };
    await client.removeFromWantlist(username, releaseId);
    const detail = await client.getRelease(releaseId);

    res.status(201).json({ ...releaseToRelease(detail, 'collection'), instanceId: addResult.instance_id });
  } catch (err) {
    logger.error({ err }, 'Failed to move to collection');
    res.status(502).json({ error: 'Failed to move to collection' });
  }
}
