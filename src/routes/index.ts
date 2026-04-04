import { Router, Request, Response } from 'express';

const router: Router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Phase 2+: auth, collection, wantlist, release, search routes mounted here

export default router;
