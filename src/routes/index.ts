import { Router, Request, Response } from 'express';
import { login, callback, me, refresh, logout } from '../handlers/authHandler';
import { getCollection, addToCollection, removeFromCollection } from '../handlers/collectionHandler';
import { getRelease } from '../handlers/releaseHandler';
import { search } from '../handlers/searchHandler';
import { getWantlist, addToWantlist, removeFromWantlist, moveToCollection } from '../handlers/wantlistHandler';
import { requireAuth } from '../middleware/authMiddleware';

const router: Router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Auth
router.get('/auth/login', login);
router.get('/auth/callback', callback);
router.get('/auth/me', requireAuth, me);
router.post('/auth/refresh', refresh);
router.post('/auth/logout', logout);

// Collection
router.get('/collection/:username', requireAuth, getCollection);
router.post('/collection/:username', requireAuth, addToCollection);
router.delete('/collection/:username/:releaseId', requireAuth, removeFromCollection);

// Wantlist
router.get('/wantlist/:username', requireAuth, getWantlist);
router.post('/wantlist/:username', requireAuth, addToWantlist);
router.delete('/wantlist/:username/:releaseId', requireAuth, removeFromWantlist);
router.post('/wantlist/:username/:releaseId/move', requireAuth, moveToCollection);

// Release detail — no auth required (uses app-level credentials)
router.get('/release/:id', getRelease);

// Search
router.get('/search', requireAuth, search);

export default router;
