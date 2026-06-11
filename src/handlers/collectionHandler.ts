import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor, createAppClient } from '../services/discogsService';
import { collectionItemToRelease, gradeFieldIdsFrom, releaseToRelease } from '../utils/toRelease';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import { CollectionItemMeta } from '../models/CollectionItemMeta';
import type { Release } from '../types/release';
import type { UsernameParams, ReleaseBody, UsernameReleaseParams, ConditionBody } from '../validators';

// Overlay the owner's stated value onto the (Discogs-sourced) releases. Discogs
// has no per-item value, so Release.value defaults to 0; this layers in the
// user-authored figure from CollectionItemMeta in a single batched query.
async function applyItemMeta(userId: string, releases: Release[]): Promise<void> {
  if (releases.length === 0) return;
  const metas = await CollectionItemMeta.find({
    userId,
    releaseId: { $in: releases.map((r) => r.id) },
  })
    .select('releaseId value')
    .lean();
  if (metas.length === 0) return;
  const valueByRelease = new Map<number, number>();
  for (const m of metas) if (m.value) valueByRelease.set(m.releaseId, m.value.amount);
  for (const r of releases) {
    const v = valueByRelease.get(r.id);
    if (v !== undefined) r.value = v;
  }
}

// GET /api/v1/collection/:username → Release[] (all pages, aggregated server-side)
export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username } = req.valid!.params as UsernameParams;
    const isOwner = req.user?.username === username;

    if (isOwner && req.user) {
      const client = createUserClientFor(req.user);
      // Fetch the collection and the user's grade field defs together; the fields
      // call is non-fatal (no grading set up → conditions just stay ungraded).
      const [raw, fields] = await Promise.all([
        client.getAllCollection(username),
        client.getCollectionFields(username).catch(() => ({ fields: [] })),
      ]);
      const ids = gradeFieldIdsFrom(fields.fields);
      const releases = raw.map((r) => collectionItemToRelease(r, ids));
      await applyItemMeta(req.userId!, releases);
      res.json(releases);
      return;
    }

    // Public collection — app-level creds, no per-instance grades.
    const releases = await createAppClient().getAllPublicCollection(username);
    res.json(releases.map((r) => collectionItemToRelease(r)));
  } catch (err) {
    logger.error({ err }, 'Failed to fetch collection');
    fail(res, 502, 'discogs_error', 'Failed to fetch collection from Discogs');
  }
}

// POST /api/v1/collection/:username/:releaseId/condition  body: { media?, sleeve?, instanceId? }
// Sets Media/Sleeve grading on an owned copy via Discogs collection custom fields.
export async function setCondition(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { username, releaseId } = req.valid!.params as UsernameReleaseParams;
    const { media, sleeve, instanceId } = req.valid!.body as ConditionBody;

    if (req.user?.username !== username) {
      fail(res, 403, 'forbidden', 'Forbidden');
      return;
    }

    const client = createUserClientFor(req.user);

    // Resolve the target copy (instance + folder) and the grade field ids.
    const [{ releases: instances }, { fields }] = await Promise.all([
      client.getReleaseInstances(username, releaseId),
      client.getCollectionFields(username),
    ]);
    if (!instances || instances.length === 0) {
      fail(res, 404, 'not_found', 'Release not in collection');
      return;
    }
    const target = (instanceId && instances.find((i) => i.instance_id === instanceId)) || instances[0];
    const ids = gradeFieldIdsFrom(fields);

    if ((media !== undefined && ids.media == null) || (sleeve !== undefined && ids.sleeve == null)) {
      fail(res, 422, 'grading_unavailable', 'No Media/Sleeve Condition field in your Discogs collection');
      return;
    }

    const writes: Promise<unknown>[] = [];
    if (media !== undefined) {
      writes.push(
        client.setInstanceField(username, target.folder_id, releaseId, target.instance_id, ids.media!, media),
      );
    }
    if (sleeve !== undefined) {
      writes.push(
        client.setInstanceField(username, target.folder_id, releaseId, target.instance_id, ids.sleeve!, sleeve),
      );
    }
    await Promise.all(writes);

    // Echo back what changed ('' → "—" for display); the client merges into its row.
    const condition: { media?: string; sleeve?: string } = {};
    if (media !== undefined) condition.media = media || '—';
    if (sleeve !== undefined) condition.sleeve = sleeve || '—';
    res.json({ condition });
  } catch (err) {
    logger.error({ err }, 'Failed to set condition');
    fail(res, 502, 'discogs_error', 'Failed to update grading on Discogs');
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
