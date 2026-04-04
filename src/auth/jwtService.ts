import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { IUser, JwtClaims, TokenPair } from '../types';

const jwtService = {
  generateTokenPair(user: IUser, family?: string): TokenPair {
    const tokenFamily = family ?? uuidv4();
    const accessExpirySeconds = this.parseExpiryToSeconds(env.JWT_ACCESS_EXPIRY);
    const refreshExpirySeconds = this.parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);

    const accessToken = jwt.sign(
      {
        user_id: user._id.toString(),
        username: user.username,
        token_type: 'access',
      } satisfies Omit<JwtClaims, 'family'>,
      env.JWT_SECRET,
      { expiresIn: accessExpirySeconds },
    );

    const refreshToken = jwt.sign(
      {
        user_id: user._id.toString(),
        username: user.username,
        token_type: 'refresh',
        family: tokenFamily,
      } satisfies JwtClaims,
      env.JWT_SECRET,
      { expiresIn: refreshExpirySeconds },
    );

    return { accessToken, refreshToken, expiresIn: accessExpirySeconds };
  },

  validateToken(token: string): JwtClaims {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    return decoded as JwtClaims;
  },

  parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] ?? 1);
  },
};

export default jwtService;
