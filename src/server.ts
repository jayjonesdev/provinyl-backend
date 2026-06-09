import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env } from './config/env';
import logger from './utils/logger';
import router from './routes';
import { csrfMiddleware } from './middleware/csrfMiddleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/errorMiddleware';

const app: Express = express();

// Security
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);

// Logging
app.use(morgan('dev'));

// Cookies + body parsing
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CSRF (double-submit): issues the token on safe requests, enforces it on mutations
app.use(csrfMiddleware);

// Routes
app.use('/api/v1', router);

// 404 + error handling
app.use(notFoundMiddleware);
app.use(errorMiddleware);

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
