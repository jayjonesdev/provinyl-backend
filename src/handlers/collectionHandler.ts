import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor, createAppClient } from '../services/discogsService';
import { collectionItemToRelease, releaseToRelease } from '../utils/toRelease';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { UsernameParams, ReleaseBody, UsernameReleaseParams } from '../validators';

// GET /api/v1/collection/:username → Release[] (all pages, aggregated server-side)
export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;
    const isOwner = req.user?.username === username;

    const releases =
      isOwner && req.user
        ? await createUserClientFor(req.user).getAllCollection(username)
        : await createAppClient().getAllPublicCollection(username); // public — app-level creds

    res.json(releases.map(collectionItemToRelease));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch collection');
    fail(res, 502, 'discogs_error', 'Failed to fetch collection from Discogs');
  }
}

// POST /api/v1/collection/:username  body: { releaseId } → Release
export async function addToCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;
    const { releaseId } = req.valid!.body as ReleaseBody;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const client = createUserClientFor(req.user);
    const addResult = (await client.addToCollection(username, releaseId)) as { instance_id?: number };
    const detail = await client.getRelease(releaseId);

    res.status(201).json({ ...releaseToRelease(detail, 'collection'), instanceId: addResult.instance_id });
  } catch (err) {
    logger.error({ err }, 'Failed to add to collection');
    fail(res, 502, 'discogs_error', 'Failed to add to collection');
  }
}

// DELETE /api/v1/collection/:username/:releaseId
// Resolves the instance(s) + folder server-side, so the client only sends the
// release id (no body). Removes every owned copy of that release.
export async function removeFromCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const client = createUserClientFor(req.user);
    const { releases: instances } = await client.getReleaseInstances(username, releaseId);

    if (!instances || instances.length === 0) {
      fail(res, 404, 'not_found', 'Release not in collection');
      return;
    }

    for (const inst of instances) {
      await client.removeFromCollection(username, releaseId, inst.instance_id, inst.folder_id);
    }

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from collection');
    fail(res, 502, 'discogs_error', 'Failed to remove from collection');
  }
}

// GET /api/v1/collection/:username/value → { minimum, median, maximum }
// Discogs' aggregate collection value (owner-only). The per-item value isn't
// available in list data, so this is the source for the collection-value stat.
export async function getCollectionValue(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const value = await createUserClientFor(req.user).getCollectionValue(username);
    res.json(value);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch collection value');
    fail(res, 502, 'discogs_error', 'Failed to fetch collection value');
  }
}
