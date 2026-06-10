import { Request } from 'express';
import { Document } from 'mongoose';
import type { ValidatedData } from '../middleware/validate';

// Validated/coerced request input, populated by the validate() middleware.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      valid?: ValidatedData;
    }
  }
}

/** Display/UI preferences synced from the SPA (mirrors provinyl-web usePrefs). */
export interface IUserPreferences {
  theme?: 'light' | 'dark';
  density?: 'comfortable' | 'cozy' | 'compact';
  cardStyle?: 'gallery' | 'flat' | 'frame';
  radius?: number;
  showStrip?: boolean;
  sort?: 'added' | 'artist' | 'title' | 'year' | 'value' | 'rating';
  lastList?: 'collection' | 'wantlist';
}

export interface IUser extends Document {
  username: string;
  avatarUrl: string;
  discogsAccessToken: string;
  discogsAccessTokenSecret: string;
  isActive: boolean;
  preferences?: IUserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRefreshToken extends Document {
  token: string;
  family: string;
  userId: string;
  deviceId?: string;
  deviceName?: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtClaims {
  user_id: string;
  username: string;
  token_type: 'access' | 'refresh';
  family?: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  user?: IUser;
}
