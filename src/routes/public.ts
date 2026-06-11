/* Root-level public share routes (no auth, no cookies, CDN-cacheable):
 *   GET /card/:username.png  → OG-unfurl image
 *   GET /u/:username         → read-only public collection page
 * Mounted before the cookie/CSRF layer so responses stay cookie-free. */

import { Router } from 'express';
import { getCard, getProfilePage } from '../handlers/publicHandler';

const publicRouter: Router = Router();

// `:username` captures the trailing `.png` (e.g. "jonesy.png"); the handler strips it.
publicRouter.get('/card/:username', getCard);
publicRouter.get('/u/:username', getProfilePage);

export default publicRouter;
