import { Router, Request, Response } from 'express';
import { login, callback, me, refresh, logout } from '../handlers/authHandler';
import { getCollection, addToCollection, removeFromCollection, getCollectionValue } from '../handlers/collectionHandler';
import { getRelease } from '../handlers/releaseHandler';
import { search } from '../handlers/searchHandler';
import { getWantlist, addToWantlist, removeFromWantlist, moveToCollection } from '../handlers/wantlistHandler';
import { requireAuth } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { ensureCsrfCookie } from '../auth/cookies';
import {
  callbackQuery,
  usernameParams,
  releaseBody,
  usernameReleaseParams,
  releaseParams,
  releaseQuery,
  searchQuery,
} from '../validators';

const router: Router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// CSRF bootstrap — SPA calls this once to obtain the double-submit token.
router.get('/auth/csrf', (req: Request, res: Response) => {
  res.json({ csrfToken: ensureCsrfCookie(req, res) });
});

// Auth
router.get('/auth/login', login);
router.get('/auth/callback', validate({ query: callbackQuery }), callback);
router.get('/auth/me', requireAuth, me);
router.post('/auth/refresh', refresh);
router.post('/auth/logout', logout);

// Collection
router.get('/collection/:username', requireAuth, validate({ params: usernameParams }), getCollection);
router.get('/collection/:username/value', requireAuth, validate({ params: usernameParams }), getCollectionValue);
router.post('/collection/:username', requireAuth, validate({ params: usernameParams, body: releaseBody }), addToCollection);
router.delete('/collection/:username/:releaseId', requireAuth, validate({ params: usernameReleaseParams }), removeFromCollection);

// Wantlist
router.get('/wantlist/:username', requireAuth, validate({ params: usernameParams }), getWantlist);
router.post('/wantlist/:username', requireAuth, validate({ params: usernameParams, body: releaseBody }), addToWantlist);
router.delete('/wantlist/:username/:releaseId', requireAuth, validate({ params: usernameReleaseParams }), removeFromWantlist);
router.post('/wantlist/:username/:releaseId/move', requireAuth, validate({ params: usernameReleaseParams }), moveToCollection);

// Release detail — no auth required (uses app-level credentials)
router.get('/release/:id', validate({ params: releaseParams, query: releaseQuery }), getRelease);

// Search
router.get('/search', requireAuth, validate({ query: searchQuery }), search);

export default router;
