/* ProVinyl — server bootstrap: connect Mongo, then listen. */

import mongoose from 'mongoose';
import { env } from './config/env';
import logger from './utils/logger';
import { createApp } from './app';

const app = createApp();

// Survive a misbehaving dependency. The `disconnect` Discogs client parses every
// non-`<!`-prefixed body as JSON inside its own stream callback, so a transient
// non-JSON 5xx from Discogs (e.g. "Internal Server Error") throws asynchronously,
// outside any handler try/catch — which would otherwise crash the whole process
// and 502 every client. Log and stay up; the offending request still fails fast
// via the per-call Discogs timeout (see services/discogsResilience.ts).
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — server staying up');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — server staying up');
});

async function start() {
  try {
    await mongoose.connect(env.MONGO_URI, { dbName: env.MONGO_DB });
    logger.info({ db: env.MONGO_DB }, 'MongoDB connected');

    app.listen(env.PORT, () => {
      logger.info(`provinyl-backend running on port ${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();

export default app;
