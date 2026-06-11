import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../types';
import { Photo } from '../models/Photo';
import {
  isStorageConfigured,
  presignPut,
  presignGet,
  getObject,
  putObject,
  deleteObject,
} from '../services/storageService';
import { sniffImageType, processImage } from '../services/imageService';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { UploadUrlBody, PhotoIdParams, PhotoListQuery } from '../validators';

const PER_USER_MAX = 500;
const PER_ITEM_MAX = 8;
const GET_TTL = 300; // 5 min presigned read URLs

function ensureStorage(res: Response): boolean {
  if (isStorageConfigured()) return true;
  fail(res, 503, 'storage_unavailable', 'Image storage is not configured');
  return false;
}

// Attach short-lived presigned read URLs so the client always gets a `url`
// (and `thumbUrl`) — the storage keys alone aren't publicly reachable.
async function serializePhoto<T extends { storageKey: string; thumbKey?: string | null }>(
  p: T,
): Promise<T & { url: string; thumbUrl: string | null }> {
  return {
    ...p,
    url: await presignGet(p.storageKey, GET_TTL),
    thumbUrl: p.thumbKey ? await presignGet(p.thumbKey, GET_TTL) : null,
  };
}

// POST /api/v1/photos/upload-url → { photoId, uploadUrl }
// Mints a short-lived presigned PUT and a pending Photo row. The client PUTs the
// image bytes directly to the bucket, then calls /confirm.
export async function createUploadUrl(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureStorage(res)) return;
    const userId = req.userId!;
    const { releaseId, instanceId, kind, contentType } = req.valid!.body as UploadUrlBody;

    const [userCount, itemCount] = await Promise.all([
      Photo.countDocuments({ userId }),
      Photo.countDocuments({ userId, releaseId }),
    ]);
    if (userCount >= PER_USER_MAX) {
      fail(res, 422, 'photo_limit', `Photo limit reached (${PER_USER_MAX}).`);
      return;
    }
    if (itemCount >= PER_ITEM_MAX) {
      fail(res, 422, 'photo_limit', `Up to ${PER_ITEM_MAX} photos per item.`);
      return;
    }

    const storageKey = `users/${userId}/photos/${uuidv4()}.jpg`;
    const photo = await Photo.create({
      userId,
      releaseId,
      instanceId,
      kind,
      storageKey,
      thumbKey: storageKey.replace(/\.jpg$/, '_thumb.jpg'),
      contentType,
      sizeBytes: 0,
      status: 'pending',
    });

    const uploadUrl = await presignPut(storageKey, contentType);
    res.status(201).json({ photoId: photo.id, uploadUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to create upload URL');
    fail(res, 502, 'storage_error', 'Failed to start upload');
  }
}

// POST /api/v1/photos/:id/confirm
// Validates magic bytes, re-encodes (strips EXIF/GPS) + thumbnails, flips ready.
export async function confirmUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureStorage(res)) return;
    const { id } = req.valid!.params as PhotoIdParams;
    const photo = await Photo.findById(id);
    if (!photo || photo.userId !== req.userId) {
      fail(res, 404, 'not_found', 'Photo not found');
      return;
    }
    if (photo.status === 'ready') {
      res.json(await serializePhoto(photo.toObject()));
      return;
    }

    const original = await getObject(photo.storageKey);
    const sniffed = sniffImageType(original);
    if (!sniffed) {
      await deleteObject(photo.storageKey).catch(() => {});
      await photo.deleteOne();
      fail(res, 422, 'invalid_image', 'File is not a supported image (JPEG/PNG/HEIC)');
      return;
    }

    const processed = await processImage(original);
    await Promise.all([
      putObject(photo.storageKey, processed.full, 'image/jpeg'),
      putObject(photo.thumbKey!, processed.thumb, 'image/jpeg'),
    ]);

    photo.contentType = 'image/jpeg';
    photo.sizeBytes = processed.full.length;
    photo.width = processed.width;
    photo.height = processed.height;
    photo.status = 'ready';
    await photo.save();
    res.json(await serializePhoto(photo.toObject()));
  } catch (err) {
    logger.error({ err }, 'Failed to confirm upload');
    fail(res, 502, 'storage_error', 'Failed to process the image');
  }
}

// GET /api/v1/photos?releaseId= → [{ ...photo, url, thumbUrl }]
export async function listPhotos(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureStorage(res)) return;
    const { releaseId } = req.valid!.query as PhotoListQuery;
    const photos = await Photo.find({ userId: req.userId!, releaseId, status: 'ready' })
      .sort({ createdAt: 1 })
      .lean();
    const withUrls = await Promise.all(photos.map((p) => serializePhoto(p)));
    res.json(withUrls);
  } catch (err) {
    logger.error({ err }, 'Failed to list photos');
    fail(res, 502, 'storage_error', 'Failed to load photos');
  }
}

// GET /api/v1/photos/:id/url → { url } (short-lived presigned read)
export async function getPhotoUrl(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureStorage(res)) return;
    const { id } = req.valid!.params as PhotoIdParams;
    const photo = await Photo.findById(id).lean();
    if (!photo || photo.userId !== req.userId) {
      fail(res, 404, 'not_found', 'Photo not found');
      return;
    }
    res.json({ url: await presignGet(photo.storageKey, GET_TTL) });
  } catch (err) {
    logger.error({ err }, 'Failed to sign photo URL');
    fail(res, 502, 'storage_error', 'Failed to load photo');
  }
}

// DELETE /api/v1/photos/:id → 204 (removes the objects then the doc)
export async function deletePhoto(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!ensureStorage(res)) return;
    const { id } = req.valid!.params as PhotoIdParams;
    const photo = await Photo.findById(id);
    if (!photo || photo.userId !== req.userId) {
      fail(res, 404, 'not_found', 'Photo not found');
      return;
    }
    await Promise.all([
      deleteObject(photo.storageKey).catch(() => {}),
      photo.thumbKey ? deleteObject(photo.thumbKey).catch(() => {}) : Promise.resolve(),
    ]);
    await photo.deleteOne();
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to delete photo');
    fail(res, 502, 'storage_error', 'Failed to delete photo');
  }
}
