import { Types } from 'mongoose';
import { RefreshToken } from '../models/RefreshToken';
import { IRefreshToken } from '../types';

const tokenService = {
  async storeRefreshToken(
    userId: Types.ObjectId | string,
    token: string,
    family: string,
    expirySeconds: number,
    deviceId?: string,
    deviceName?: string,
  ): Promise<IRefreshToken> {
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);
    return RefreshToken.create({
      token,
      family,
      userId: userId.toString(),
      expiresAt,
      lastUsedAt: new Date(),
      deviceId,
      deviceName,
    });
  },

  async findRefreshToken(token: string): Promise<IRefreshToken | null> {
    return RefreshToken.findOne({ token, expiresAt: { $gt: new Date() } });
  },

  async deleteRefreshToken(token: string): Promise<void> {
    await RefreshToken.deleteOne({ token });
  },

  async revokeFamilyTokens(family: string): Promise<void> {
    await RefreshToken.deleteMany({ family });
  },

  async revokeAllUserTokens(userId: string): Promise<void> {
    await RefreshToken.deleteMany({ userId });
  },
};

export default tokenService;
