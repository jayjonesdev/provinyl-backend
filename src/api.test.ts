import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// ── mock the data layer (Discogs + Mongo); keep jwt/middleware/mappers real ──
const mocks = vi.hoisted(() => ({
  userClient: {
    getAllCollection: vi.fn(),
    getAllWantlist: vi.fn(),
    getWantlist: vi.fn(),
    addToCollection: vi.fn(),
    getRelease: vi.fn(),
    getReleaseInstances: vi.fn(),
    removeFromCollection: vi.fn(),
    addToWantlist: vi.fn(),
    removeFromWantlist: vi.fn(),
    getCollectionValue: vi.fn(),
    getCollectionFields: vi.fn(),
    setInstanceField: vi.fn(),
  },
  appClient: { getAllPublicCollection: vi.fn(), getRelease: vi.fn(), searchDatabase: vi.fn() },
  User: { findById: vi.fn(), findOneAndUpdate: vi.fn() },
  CollectionItemMeta: {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteMany: vi.fn(),
  },
  Photo: {
    countDocuments: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
  },
  storage: {
    isStorageConfigured: vi.fn(),
    presignPut: vi.fn(),
    presignGet: vi.fn(),
    getObject: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
  },
  image: {
    sniffImageType: vi.fn(),
    processImage: vi.fn(),
  },
  tokenService: {
    findRefreshToken: vi.fn(),
    storeRefreshToken: vi.fn(),
    deleteRefreshToken: vi.fn(),
    revokeFamilyTokens: vi.fn(),
  },
}));

vi.mock('./services/discogsService', () => ({
  createUserClientFor: () => mocks.userClient,
  createUserClient: () => mocks.userClient,
  createAppClient: () => mocks.appClient,
}));
vi.mock('./models/User', () => ({ User: mocks.User }));
vi.mock('./models/CollectionItemMeta', () => ({ CollectionItemMeta: mocks.CollectionItemMeta }));
vi.mock('./models/Photo', () => ({ Photo: mocks.Photo }));
vi.mock('./services/storageService', () => mocks.storage);
vi.mock('./services/imageService', () => mocks.image);
vi.mock('./services/tokenService', () => ({ default: mocks.tokenService }));

import { createApp } from './app';
import jwtService from './auth/jwtService';

const app = createApp();

const fakeUser = {
  _id: 'user-1',
  username: 'me',
  avatarUrl: '',
  isActive: true,
  discogsAccessToken: 'enc-token',
  discogsAccessTokenSecret: 'enc-secret',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tokens = () => jwtService.generateTokenPair(fakeUser as any);
const CSRF = 'test-csrf-token';

function authedGet(path: string) {
  return request(app).get(path).set('Cookie', [`pv_access=${tokens().accessToken}`, `pv_csrf=${CSRF}`]);
}
function authedMutate(method: 'post' | 'delete', path: string) {
  return request(app)[method](path)
    .set('Cookie', [`pv_access=${tokens().accessToken}`, `pv_csrf=${CSRF}`])
    .set('X-CSRF-Token', CSRF);
}

const collectionItem = {
  id: 305571,
  instance_id: 7,
  date_added: '2024-05-12T10:00:00-07:00',
  folder_id: 1,
  rating: 5,
  basic_information: {
    id: 305571,
    title: 'Blue Train',
    year: 1957,
    cover_image: 'cover.jpg',
    thumb: 't.jpg',
    formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP'] }],
    labels: [{ name: 'Blue Note', catno: 'BLP 1577' }],
    artists: [{ name: 'John Coltrane', anv: '', join: '' }],
    genres: ['Jazz'],
    styles: ['Hard Bop'],
  },
};

const discogsRelease = {
  id: 305571,
  title: 'Blue Train',
  artists: [{ name: 'John Coltrane', anv: '', join: '' }],
  labels: [{ name: 'Blue Note', catno: 'BLP 1577' }],
  formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP'] }],
  genres: ['Jazz'],
  styles: ['Hard Bop'],
  year: 1957,
  country: 'US',
  notes: '',
  images: [{ uri: 'big.jpg' }],
  tracklist: [],
  videos: [],
  uri: '/release/305571',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.User.findById.mockResolvedValue(fakeUser);
  // Default: no custom grade fields (most tests don't care); overridden where needed.
  mocks.userClient.getCollectionFields.mockResolvedValue({ fields: [] });
  // Default: no per-item meta. Self-referential chain supports both
  // find(...).lean() and find(...).select(...).lean().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { select: () => chain, lean: () => Promise.resolve([]) };
  mocks.CollectionItemMeta.find.mockReturnValue(chain);

  // Storage + image defaults (overridden per test).
  mocks.storage.isStorageConfigured.mockReturnValue(true);
  mocks.storage.presignPut.mockResolvedValue('https://bucket.example/put?sig');
  mocks.storage.presignGet.mockResolvedValue('https://bucket.example/get?sig');
  mocks.storage.getObject.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]));
  mocks.storage.putObject.mockResolvedValue(undefined);
  mocks.storage.deleteObject.mockResolvedValue(undefined);
  mocks.image.sniffImageType.mockReturnValue('image/jpeg');
  mocks.image.processImage.mockResolvedValue({
    full: Buffer.from('full'), thumb: Buffer.from('thumb'), width: 800, height: 800, contentType: 'image/jpeg',
  });
});

describe('infrastructure', () => {
  it('GET /health → 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health (root) → 200 with version + uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('unknown route → 404 envelope', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('auth + csrf guards', () => {
  it('protected route without a token → 401', async () => {
    const res = await request(app).get('/api/v1/collection/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('mutation without a CSRF token → 403', async () => {
    const res = await request(app).post('/api/v1/collection/me').send({ releaseId: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_invalid');
  });

  it('ownership mismatch → 403', async () => {
    const res = await authedGet('/api/v1/wantlist/someone-else');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('validation', () => {
  it('search without q → 400 validation_error', async () => {
    const res = await authedGet('/api/v1/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('non-numeric release id → 400', async () => {
    const res = await request(app).get('/api/v1/release/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('collection', () => {
  it('GET returns the mapped Release[]', async () => {
    mocks.userClient.getAllCollection.mockResolvedValue([collectionItem]);
    const res = await authedGet('/api/v1/collection/me');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 305571, title: 'Blue Train', artist: 'John Coltrane', list: 'collection' });
  });

  it('POST adds and returns the Release with instanceId', async () => {
    mocks.userClient.addToCollection.mockResolvedValue({ instance_id: 7 });
    mocks.userClient.getRelease.mockResolvedValue(discogsRelease);
    const res = await authedMutate('post', '/api/v1/collection/me').send({ releaseId: 305571 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 305571, list: 'collection', instanceId: 7 });
    expect(mocks.userClient.addToCollection).toHaveBeenCalledWith('me', 305571);
  });

  it('DELETE resolves instances server-side and removes each', async () => {
    mocks.userClient.getReleaseInstances.mockResolvedValue({
      releases: [{ id: 305571, instance_id: 7, folder_id: 1 }],
    });
    mocks.userClient.removeFromCollection.mockResolvedValue({});
    const res = await authedMutate('delete', '/api/v1/collection/me/305571');
    expect(res.status).toBe(204);
    expect(mocks.userClient.removeFromCollection).toHaveBeenCalledWith('me', 305571, 7, 1);
  });

  it('DELETE for a release not owned → 404', async () => {
    mocks.userClient.getReleaseInstances.mockResolvedValue({ releases: [] });
    const res = await authedMutate('delete', '/api/v1/collection/me/999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('GET /value returns the Discogs collection value', async () => {
    mocks.userClient.getCollectionValue.mockResolvedValue({ minimum: '$10.00', median: '$20.00', maximum: '$30.00' });
    const res = await authedGet('/api/v1/collection/me/value');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minimum: '$10.00', median: '$20.00', maximum: '$30.00' });
  });

  it('GET maps Media/Sleeve grades from instance custom fields', async () => {
    mocks.userClient.getCollectionFields.mockResolvedValue({
      fields: [
        { id: 1, name: 'Media Condition', type: 'dropdown' },
        { id: 2, name: 'Sleeve Condition', type: 'dropdown' },
      ],
    });
    mocks.userClient.getAllCollection.mockResolvedValue([
      { ...collectionItem, notes: [{ field_id: 1, value: 'Near Mint (NM or M-)' }, { field_id: 2, value: 'Very Good (VG)' }] },
    ]);
    const res = await authedGet('/api/v1/collection/me');
    expect(res.status).toBe(200);
    expect(res.body[0].condition).toEqual({ media: 'Near Mint (NM or M-)', sleeve: 'Very Good (VG)' });
  });

  it('GET overlays the owner stated value onto Release.value', async () => {
    mocks.userClient.getAllCollection.mockResolvedValue([collectionItem]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.CollectionItemMeta.find.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve([{ releaseId: 305571, value: { amount: 250, currency: 'USD' } }]) }),
    } as any);
    const res = await authedGet('/api/v1/collection/me');
    expect(res.status).toBe(200);
    expect(res.body[0].value).toBe(250);
  });
});

describe('collection item meta (value / cost basis)', () => {
  it('GET returns the stored meta', async () => {
    const doc = { userId: 'user-1', releaseId: 305571, value: { amount: 250, currency: 'USD' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.CollectionItemMeta.findOne.mockReturnValue({ lean: () => Promise.resolve(doc) } as any);
    const res = await authedGet('/api/v1/collection/me/305571/meta');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ releaseId: 305571, value: { amount: 250, currency: 'USD' } });
  });

  it('GET returns null when no meta is set', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.CollectionItemMeta.findOne.mockReturnValue({ lean: () => Promise.resolve(null) } as any);
    const res = await authedGet('/api/v1/collection/me/305571/meta');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('POST upserts and returns the meta', async () => {
    const doc = { userId: 'user-1', releaseId: 305571, value: { amount: 250, currency: 'USD' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.CollectionItemMeta.findOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(doc) } as any);
    const res = await authedMutate('post', '/api/v1/collection/me/305571/meta').send({ value: { amount: 250, currency: 'usd' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ value: { amount: 250, currency: 'USD' } });
    const [filter] = mocks.CollectionItemMeta.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ userId: 'user-1', releaseId: 305571, instanceId: null });
  });

  it('POST with an empty body → 400', async () => {
    const res = await authedMutate('post', '/api/v1/collection/me/305571/meta').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('DELETE clears the meta → 204', async () => {
    mocks.CollectionItemMeta.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const res = await authedMutate('delete', '/api/v1/collection/me/305571/meta');
    expect(res.status).toBe(204);
    expect(mocks.CollectionItemMeta.deleteMany).toHaveBeenCalledWith({ userId: 'user-1', releaseId: 305571 });
  });

  it('POST to another user\'s collection → 403', async () => {
    const res = await authedMutate('post', '/api/v1/collection/someone-else/305571/meta').send({ value: { amount: 10, currency: 'USD' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('export (appraisal PDF)', () => {
  it('GET /export/appraisal.pdf streams a PDF', async () => {
    mocks.userClient.getAllCollection.mockResolvedValue([collectionItem]);
    const res = await authedGet('/api/v1/export/appraisal.pdf').buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejects a malformed scope → 400', async () => {
    const res = await authedGet('/api/v1/export/appraisal.pdf?scope=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('GET ?images=1 embeds thumbnails and still streams a PDF', async () => {
    mocks.userClient.getAllCollection.mockResolvedValue([collectionItem]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.Photo.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([
      { releaseId: 305571, thumbKey: 'users/user-1/photos/x_thumb.jpg' },
    ]) }) } as any);
    const res = await authedGet('/api/v1/export/appraisal.pdf?images=1').buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(mocks.storage.getObject).toHaveBeenCalledWith('users/user-1/photos/x_thumb.jpg');
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('requires auth → 401', async () => {
    const res = await request(app).get('/api/v1/export/appraisal.pdf');
    expect(res.status).toBe(401);
  });
});

describe('photos (custom item images)', () => {
  it('POST /photos/upload-url → 201 with a presigned URL', async () => {
    mocks.Photo.countDocuments.mockResolvedValue(0);
    mocks.Photo.create.mockResolvedValue({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', storageKey: 'users/user-1/photos/x.jpg' });
    const res = await authedMutate('post', '/api/v1/photos/upload-url')
      .send({ releaseId: 305571, kind: 'sleeve', contentType: 'image/jpeg', sizeBytes: 12345 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ photoId: 'aaaaaaaaaaaaaaaaaaaaaaaa', uploadUrl: expect.stringContaining('http') });
  });

  it('POST /photos/upload-url over the per-item cap → 422', async () => {
    mocks.Photo.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(8); // user, item
    const res = await authedMutate('post', '/api/v1/photos/upload-url')
      .send({ releaseId: 305571, contentType: 'image/jpeg', sizeBytes: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('photo_limit');
  });

  it('POST /photos/upload-url with an unsupported type → 400', async () => {
    const res = await authedMutate('post', '/api/v1/photos/upload-url')
      .send({ releaseId: 305571, contentType: 'image/gif', sizeBytes: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('upload-url returns 503 when storage is not configured', async () => {
    mocks.storage.isStorageConfigured.mockReturnValue(false);
    const res = await authedMutate('post', '/api/v1/photos/upload-url')
      .send({ releaseId: 305571, contentType: 'image/jpeg', sizeBytes: 100 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('storage_unavailable');
  });

  it('POST /photos/:id/confirm validates, re-encodes, and marks ready', async () => {
    const doc: Record<string, unknown> = {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1', status: 'pending',
      storageKey: 'users/user-1/photos/x.jpg', thumbKey: 'users/user-1/photos/x_thumb.jpg',
      save: vi.fn().mockResolvedValue(undefined), deleteOne: vi.fn(),
    };
    mocks.Photo.findById.mockResolvedValue(doc);
    const res = await authedMutate('post', '/api/v1/photos/aaaaaaaaaaaaaaaaaaaaaaaa/confirm');
    expect(res.status).toBe(200);
    expect(mocks.image.processImage).toHaveBeenCalled();
    expect(mocks.storage.putObject).toHaveBeenCalledTimes(2); // full + thumb
    expect(doc.status).toBe('ready');
  });

  it('confirm rejects a non-image (bad magic bytes) → 422 and cleans up', async () => {
    mocks.image.sniffImageType.mockReturnValue(null);
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    mocks.Photo.findById.mockResolvedValue({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1', status: 'pending',
      storageKey: 'users/user-1/photos/x.jpg', thumbKey: 'users/user-1/photos/x_thumb.jpg', deleteOne,
    });
    const res = await authedMutate('post', '/api/v1/photos/aaaaaaaaaaaaaaaaaaaaaaaa/confirm');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_image');
    expect(deleteOne).toHaveBeenCalled();
  });

  it('GET /photos returns ready photos with signed URLs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.Photo.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([
      { _id: 'p1', userId: 'user-1', releaseId: 305571, storageKey: 'k.jpg', thumbKey: 't.jpg', status: 'ready' },
    ]) }) } as any);
    const res = await authedGet('/api/v1/photos?releaseId=305571');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ url: expect.stringContaining('http'), thumbUrl: expect.stringContaining('http') });
  });

  it('DELETE /photos/:id removes objects + doc → 204', async () => {
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    mocks.Photo.findById.mockResolvedValue({
      userId: 'user-1', storageKey: 'k.jpg', thumbKey: 't.jpg', deleteOne,
    });
    const res = await authedMutate('delete', '/api/v1/photos/aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(res.status).toBe(204);
    expect(mocks.storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteOne).toHaveBeenCalled();
  });

  it('DELETE another user\'s photo → 404', async () => {
    mocks.Photo.findById.mockResolvedValue({ userId: 'someone-else', storageKey: 'k.jpg' });
    const res = await authedMutate('delete', '/api/v1/photos/aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(res.status).toBe(404);
  });
});

describe('collection condition (grading)', () => {
  beforeEach(() => {
    mocks.userClient.getReleaseInstances.mockResolvedValue({
      releases: [{ id: 305571, instance_id: 7, folder_id: 1 }],
    });
    mocks.userClient.getCollectionFields.mockResolvedValue({
      fields: [
        { id: 1, name: 'Media Condition', type: 'dropdown' },
        { id: 2, name: 'Sleeve Condition', type: 'dropdown' },
      ],
    });
    mocks.userClient.setInstanceField.mockResolvedValue({});
  });

  it('POST sets media + sleeve on the resolved instance', async () => {
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({
      media: 'Mint (M)',
      sleeve: 'Very Good Plus (VG+)',
    });
    expect(res.status).toBe(200);
    expect(res.body.condition).toEqual({ media: 'Mint (M)', sleeve: 'Very Good Plus (VG+)' });
    expect(mocks.userClient.setInstanceField).toHaveBeenCalledWith('me', 1, 305571, 7, 1, 'Mint (M)');
    expect(mocks.userClient.setInstanceField).toHaveBeenCalledWith('me', 1, 305571, 7, 2, 'Very Good Plus (VG+)');
  });

  it('clears a grade with empty string → "—"', async () => {
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({ media: '' });
    expect(res.status).toBe(200);
    expect(res.body.condition).toEqual({ media: '—' });
    expect(mocks.userClient.setInstanceField).toHaveBeenCalledWith('me', 1, 305571, 7, 1, '');
  });

  it('ownership mismatch → 403', async () => {
    const res = await authedMutate('post', '/api/v1/collection/someone/305571/condition').send({ media: 'Mint (M)' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('invalid grade → 400', async () => {
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({ media: 'Scratched' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('empty body (no media/sleeve) → 400', async () => {
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('release not in collection → 404', async () => {
    mocks.userClient.getReleaseInstances.mockResolvedValue({ releases: [] });
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({ media: 'Mint (M)' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('no grading field set up in Discogs → 422', async () => {
    mocks.userClient.getCollectionFields.mockResolvedValue({ fields: [] });
    const res = await authedMutate('post', '/api/v1/collection/me/305571/condition').send({ media: 'Mint (M)' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('grading_unavailable');
  });
});

describe('refresh rotation', () => {
  it('rotates a valid refresh token and sets new cookies', async () => {
    mocks.tokenService.findRefreshToken.mockResolvedValue({ deviceId: undefined, deviceName: undefined });
    mocks.tokenService.deleteRefreshToken.mockResolvedValue(undefined);
    mocks.tokenService.storeRefreshToken.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`pv_refresh=${tokens().refreshToken}`, `pv_csrf=${CSRF}`])
      .set('X-CSRF-Token', CSRF);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('me');
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toContain('pv_access=');
    expect(setCookie).toContain('pv_refresh=');
  });

  it('detects reuse (token not stored) and revokes the family → 401', async () => {
    mocks.tokenService.findRefreshToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`pv_refresh=${tokens().refreshToken}`, `pv_csrf=${CSRF}`])
      .set('X-CSRF-Token', CSRF);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_reuse');
    expect(mocks.tokenService.revokeFamilyTokens).toHaveBeenCalled();
  });
});

describe('native (iOS) auth', () => {
  it('cookieless Bearer mutation bypasses CSRF and adds to collection', async () => {
    mocks.userClient.addToCollection.mockResolvedValue({ instance_id: 7 });
    mocks.userClient.getRelease.mockResolvedValue(discogsRelease);

    // No cookies, no X-CSRF-Token — just a Bearer access token.
    const res = await request(app)
      .post('/api/v1/collection/me')
      .set('Authorization', `Bearer ${tokens().accessToken}`)
      .send({ releaseId: 305571 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 305571, list: 'collection', instanceId: 7 });
  });

  it('refresh via Bearer (no cookie) returns the JWT pair in the body and sets no cookies', async () => {
    mocks.tokenService.findRefreshToken.mockResolvedValue({ deviceId: undefined, deviceName: undefined });
    mocks.tokenService.deleteRefreshToken.mockResolvedValue(undefined);
    mocks.tokenService.storeRefreshToken.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${tokens().refreshToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('me');
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('preferences', () => {
  it('GET /auth/me returns preferences (null when unset)', async () => {
    const res = await authedGet('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'me', avatar_url: '', preferences: null });
  });

  it('POST /auth/me/preferences merges the patch into stored prefs and saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = { ...fakeUser, preferences: { theme: 'light', density: 'cozy' }, save };
    mocks.User.findById.mockResolvedValue(user);

    const res = await authedMutate('post', '/api/v1/auth/me/preferences').send({
      theme: 'dark',
      cardStyle: 'frame',
    });

    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ theme: 'dark', density: 'cozy', cardStyle: 'frame' });
    expect(save).toHaveBeenCalledOnce();
    expect(user.preferences).toEqual({ theme: 'dark', density: 'cozy', cardStyle: 'frame' });
  });

  it('rejects an invalid enum value → 400', async () => {
    const res = await authedMutate('post', '/api/v1/auth/me/preferences').send({ theme: 'neon' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects unknown keys (strict) → 400', async () => {
    const res = await authedMutate('post', '/api/v1/auth/me/preferences').send({ hacker: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('requires CSRF → 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/me/preferences')
      .set('Cookie', [`pv_access=${tokens().accessToken}`, `pv_csrf=${CSRF}`])
      .send({ theme: 'dark' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_invalid');
  });
});
