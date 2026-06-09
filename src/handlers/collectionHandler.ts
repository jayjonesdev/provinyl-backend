import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor, createAppClient } from '../services/discogsService';
import { collectionItemToRelease, releaseToRelease } from '../utils/toRelease';
import logger from '../utils/logger';

// GET /api/v1/collection/:username → Release[] (all pages, aggregated server-side)
export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.params as { username: string };
    const isOwner = req.user?.username === username;

    const releases =
      isOwner && req.user
        ? await createUserClientFor(req.user).getAllCollection(username)
        : await createAppClient().getAllPublicCollection(username); // public — app-level creds

    res.json(releases.map(collectionItemToRelease));
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

// DELETE /api/v1/collection/:username/:releaseId
// Resolves the instance(s) + folder server-side, so the client only sends the
// release id (no body). Removes every owned copy of that release.
export async function removeFromCollection(req: AuthRequest, res: Response): Promise<void> {
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
    const { releases: instances } = await client.getReleaseInstances(username, releaseId);

    if (!instances || instances.length === 0) {
      res.status(404).json({ error: 'Release not in collection' });
      return;
    }

    for (const inst of instances) {
      await client.removeFromCollection(username, releaseId, inst.instance_id, inst.folder_id);
    }

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from collection');
    res.status(502).json({ error: 'Failed to remove from collection' });
  }
}
