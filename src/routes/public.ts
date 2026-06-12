/* Root-level public share routes (no auth, no cookies, CDN-cacheable):
 *   GET /card/:username.png  → OG-unfurl image
 *   GET /u/:username         → read-only public collection page
 * Mounted before the cookie/CSRF layer so responses stay cookie-free. */

import { Router } from 'express';
import { getCard, getProfilePage } from '../handlers/publicHandler';
import { publicLimiter } from '../middleware/rateLimitMiddleware';

const publicRouter: Router = Router();

// publicLimiter is attached per-route (not via router.use) so it only counts
// requests that actually match a public share surface — this router is mounted
// at `/`, so a router-level .use() would throttle every app request too.
// `:username` captures the trailing `.png` (e.g. "jonesy.png"); the handler strips it.
publicRouter.get('/card/:username', publicLimiter, getCard);
publicRouter.get('/u/:username', publicLimiter, getProfilePage);

export default publicRouter;
