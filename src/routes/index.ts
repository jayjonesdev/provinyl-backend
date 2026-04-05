import { Router, Request, Response } from 'express';
import { login, callback, me, refresh, logout } from '../handlers/authHandler';
import { getCollection } from '../handlers/collectionHandler';
import { getRelease } from '../handlers/releaseHandler';
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

// Release detail — no auth required (uses app-level credentials)
router.get('/release/:id', getRelease);

export default router;
