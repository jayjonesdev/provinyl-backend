import { Router, Request, Response } from 'express';
import { login, callback, me, refresh, logout, updatePreferences } from '../handlers/authHandler';
import { getCollection, getPublicCollection, addToCollection, removeFromCollection, getCollectionValue, setCondition } from '../handlers/collectionHandler';
import { getItemMeta, setItemMeta, deleteItemMeta } from '../handlers/itemMetaHandler';
import { exportAppraisal } from '../handlers/exportHandler';
import { createUploadUrl, confirmUpload, listPhotos, getPhotoUrl, deletePhoto } from '../handlers/photoHandler';
import { getRelease } from '../handlers/releaseHandler';
import { proxyImage } from '../handlers/imageProxyHandler';
import { search } from '../handlers/searchHandler';
import { getWantlist, addToWantlist, removeFromWantlist, moveToCollection } from '../handlers/wantlistHandler';
import { requireAuth } from '../middleware/authMiddleware';
import { authLimiter, publicLimiter } from '../middleware/rateLimitMiddleware';
import { validate } from '../middleware/validate';
import { ensureCsrfCookie } from '../auth/cookies';
import { VERSION } from '../version';
import {
  callbackQuery,
  loginQuery,
  usernameParams,
  releaseBody,
  usernameReleaseParams,
  releaseParams,
  releaseQuery,
  imageProxyQuery,
  searchQuery,
  preferencesBody,
  conditionBody,
  itemMetaBody,
  exportQuery,
  uploadUrlBody,
  photoIdParams,
  photoListQuery,
} from '../validators';

const router: Router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: VERSION, uptime: process.uptime(), timestamp: Date.now() });
});

// CSRF bootstrap — SPA calls this once to obtain the double-submit token.
router.get('/auth/csrf', (req: Request, res: Response) => {
  res.json({ csrfToken: ensureCsrfCookie(req, res) });
});

// Auth — authLimiter guards the OAuth entry/return and token endpoints against
// credential-stuffing / token churn. /auth/me(+preferences) stay on the baseline
// apiLimiter since the SPA polls them during normal authenticated use.
router.get('/auth/login', authLimiter, validate({ query: loginQuery }), login);
router.get('/auth/callback', authLimiter, validate({ query: callbackQuery }), callback);
router.get('/auth/me', requireAuth, me);
router.post('/auth/me/preferences', requireAuth, validate({ body: preferencesBody }), updatePreferences);
router.post('/auth/refresh', authLimiter, refresh);
router.post('/auth/logout', authLimiter, logout);

// Public collection — read-only, no auth (powers /u/:username in the SPA).
// publicLimiter shares its counter with the root share surfaces, so a scraper's
// page hits and API hits draw from one budget.
router.get('/public/:username/collection', publicLimiter, validate({ params: usernameParams }), getPublicCollection);

// Collection
router.get('/collection/:username', requireAuth, validate({ params: usernameParams }), getCollection);
router.get('/collection/:username/value', requireAuth, validate({ params: usernameParams }), getCollectionValue);
router.post('/collection/:username', requireAuth, validate({ params: usernameParams, body: releaseBody }), addToCollection);
router.post('/collection/:username/:releaseId/condition', requireAuth, validate({ params: usernameReleaseParams, body: conditionBody }), setCondition);
// Owner-authored item metadata: stated value, cost basis, note.
router.get('/collection/:username/:releaseId/meta', requireAuth, validate({ params: usernameReleaseParams }), getItemMeta);
router.post('/collection/:username/:releaseId/meta', requireAuth, validate({ params: usernameReleaseParams, body: itemMetaBody }), setItemMeta);
router.delete('/collection/:username/:releaseId/meta', requireAuth, validate({ params: usernameReleaseParams }), deleteItemMeta);
router.delete('/collection/:username/:releaseId', requireAuth, validate({ params: usernameReleaseParams }), removeFromCollection);

// Wantlist
router.get('/wantlist/:username', requireAuth, validate({ params: usernameParams }), getWantlist);
router.post('/wantlist/:username', requireAuth, validate({ params: usernameParams, body: releaseBody }), addToWantlist);
router.delete('/wantlist/:username/:releaseId', requireAuth, validate({ params: usernameReleaseParams }), removeFromWantlist);
router.post('/wantlist/:username/:releaseId/move', requireAuth, validate({ params: usernameReleaseParams }), moveToCollection);

// Release detail — no auth required (uses app-level credentials)
router.get('/release/:id', validate({ params: releaseParams, query: releaseQuery }), getRelease);

// Image proxy — same-origin Discogs cover art so the web app can draw covers
// onto a <canvas> for share cards (public; Discogs' CDN sends no CORS headers).
router.get('/images/proxy', validate({ query: imageProxyQuery }), proxyImage);

// Search
router.get('/search', requireAuth, validate({ query: searchQuery }), search);

// Export — branded appraisal PDF of the authed user's collection
router.get('/export/appraisal.pdf', requireAuth, validate({ query: exportQuery }), exportAppraisal);

// Photos — custom item images (object storage; ownership-checked)
router.post('/photos/upload-url', requireAuth, validate({ body: uploadUrlBody }), createUploadUrl);
router.post('/photos/:id/confirm', requireAuth, validate({ params: photoIdParams }), confirmUpload);
router.get('/photos', requireAuth, validate({ query: photoListQuery }), listPhotos);
router.get('/photos/:id/url', requireAuth, validate({ params: photoIdParams }), getPhotoUrl);
router.delete('/photos/:id', requireAuth, validate({ params: photoIdParams }), deletePhoto);

export default router;
