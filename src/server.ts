import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import logger from './utils/logger';
import router from './routes';
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

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/v1', router);

// 404 + error handling
app.use(notFoundMiddleware);
app.use(errorMiddleware);

app.listen(env.PORT, () => {
  logger.info(`provinyl-backend running on port ${env.PORT} [${env.NODE_ENV}]`);
});

export default app;
