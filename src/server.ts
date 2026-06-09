/* ProVinyl — server bootstrap: connect Mongo, then listen. */

import mongoose from 'mongoose';
import { env } from './config/env';
import logger from './utils/logger';
import { createApp } from './app';

const app = createApp();

async function start() {
  try {
    await mongoose.connect(env.MONGO_URI);
    logger.info('MongoDB connected');

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
