import { Router, Request, Response } from 'express';
import { login, callback, me, refresh, logout } from '../handlers/authHandler';
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

// Phase 3+: collection, wantlist, release, search routes mounted here

export default router;
