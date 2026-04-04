import { Request } from 'express';
import { Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  avatarUrl: string;
  discogsAccessToken: string;
  discogsAccessTokenSecret: string;
  isActive: boolean;
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
