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
import { csrfMiddleware } from './middleware/csrfMiddleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/errorMiddleware';

export function createApp(): Express {
  const app = express();

  // Security
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  // Structured request logging (bound to the app's pino logger)
  app.use(pinoHttp({ logger }));

  // Cookies + body parsing
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CSRF (double-submit): issues the token on safe requests, enforces on mutations
  app.use(csrfMiddleware);

  // Routes
  app.use('/api/v1', router);

  // 404 + error handling
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export default createApp;
