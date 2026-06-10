import { Response } from 'express';
import { AuthRequest } from '../types';
import { CollectionItemMeta } from '../models/CollectionItemMeta';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { UsernameReleaseParams, ItemMetaBody } from '../validators';

// GET /api/v1/collection/:username/:releaseId/meta → ICollectionItemMeta | null
export async function getItemMeta(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;
    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }
    const meta = await CollectionItemMeta.findOne({ userId: req.userId!, releaseId }).lean();
    res.json(meta ?? null);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch item meta');
    fail(res, 500, 'server_error', 'Failed to fetch item details');
  }
}

// POST /api/v1/collection/:username/:releaseId/meta  body: itemMetaBody → upsert
// Partial: only the provided fields are written; the rest are left untouched.
export async function setItemMeta(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;
    const { instanceId, ...fields } = req.valid!.body as ItemMetaBody;
    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }
    // instanceId ?? null so release-level and per-instance docs key distinctly
    // and the upsert filter is deterministic.
    const filter = { userId: req.userId!, releaseId, instanceId: instanceId ?? null };
    const meta = await CollectionItemMeta.findOneAndUpdate(
      filter,
      { $set: fields },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    res.status(200).json(meta);
  } catch (err) {
    logger.error({ err }, 'Failed to save item meta');
    fail(res, 500, 'server_error', 'Failed to save item details');
  }
}

// DELETE /api/v1/collection/:username/:releaseId/meta → clears all meta for the release
export async function deleteItemMeta(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;
    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }
    await CollectionItemMeta.deleteMany({ userId: req.userId!, releaseId });
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to delete item meta');
    fail(res, 500, 'server_error', 'Failed to delete item details');
  }
}
