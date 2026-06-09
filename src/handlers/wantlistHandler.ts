import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor } from '../services/discogsService';
import { wantlistItemToRelease, releaseToRelease } from '../utils/toRelease';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { UsernameParams, ReleaseBody, UsernameReleaseParams } from '../validators';

// GET /api/v1/wantlist/:username → Release[] (all pages, aggregated server-side)
export async function getWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const wants = await createUserClientFor(req.user).getAllWantlist(username);

    res.json(wants.map(wantlistItemToRelease));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch wantlist');
    fail(res, 502, 'discogs_error', 'Failed to fetch wantlist from Discogs');
  }
}

// POST /api/v1/wantlist/:username  body: { releaseId } → Release
export async function addToWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;
    const { releaseId } = req.valid!.body as ReleaseBody;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const client = createUserClientFor(req.user);
    await client.addToWantlist(username, releaseId);
    const detail = await client.getRelease(releaseId);

    res.status(201).json(releaseToRelease(detail, 'wantlist'));
  } catch (err) {
    logger.error({ err }, 'Failed to add to wantlist');
    fail(res, 502, 'discogs_error', 'Failed to add to wantlist');
  }
}

// DELETE /api/v1/wantlist/:username/:releaseId
export async function removeFromWantlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const client = createUserClientFor(req.user);
    await client.removeFromWantlist(username, releaseId);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to remove from wantlist');
    fail(res, 502, 'discogs_error', 'Failed to remove from wantlist');
  }
}

// POST /api/v1/wantlist/:username/:releaseId/move → Release (now in collection)
export async function moveToCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
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
    fail(res, 502, 'discogs_error', 'Failed to move to collection');
  }
}
