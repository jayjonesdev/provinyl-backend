/* ProVinyl — Express app construction (no network / DB side effects).
 * Kept separate from server.ts so tests can import the app directly. */

import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import logger from './utils/logger';
import router from './routes';
import publicRouter from './routes/public';
import { csrfMiddleware } from './middleware/csrfMiddleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/errorMiddleware';
import { apiLimiter, publicLimiter } from './middleware/rateLimitMiddleware';

export function createApp(): Express {
  const app = express();

  // Behind Render's edge proxy: trust one hop so req.ip is the real client
  // (from X-Forwarded-For), which the IP-keyed rate limiters depend on. A
  // numeric hop count (not `true`) keeps the limiter's spoofing guard happy.
  app.set('trust proxy', 1);

  // Security
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  // Structured request logging (bound to the app's pino logger)
  app.use(pinoHttp({ logger }));

  // Public share surfaces (/u/:username, /card/:username.png) — mounted before
  // the cookie/CSRF layer so these cacheable, crawler-facing responses carry no
  // Set-Cookie. Read-only; mutations remain owner-only under /api/v1.
  // publicLimiter throttles these unauthenticated, scrapeable endpoints.
  app.use('/', publicLimiter, publicRouter);

  // Cookies + body parsing
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CSRF (double-submit): issues the token on safe requests, enforces on mutations
  app.use(csrfMiddleware);

  // Routes — apiLimiter is the baseline safety net over the whole API surface;
  // auth + public sub-routes layer stricter limiters on top (see routes/index).
  app.use('/api/v1', apiLimiter, router);

  // 404 + error handling
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export default createApp;
