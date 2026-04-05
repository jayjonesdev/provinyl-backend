import mongoose, { Schema } from 'mongoose';
import { IRefreshToken } from '../types';

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true, unique: true, index: true },
    family: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    deviceId: { type: String },
    deviceName: { type: String },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Auto-delete expired tokens
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
