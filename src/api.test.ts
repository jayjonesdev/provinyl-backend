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
  },
  appClient: { getAllPublicCollection: vi.fn(), getRelease: vi.fn(), searchDatabase: vi.fn() },
  User: { findById: vi.fn(), findOneAndUpdate: vi.fn() },
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
});

describe('infrastructure', () => {
  it('GET /health → 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
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
