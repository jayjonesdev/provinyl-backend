import mongoose, { Schema } from 'mongoose';
import { IUser } from '../types';

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    avatarUrl: { type: String, default: '' },
    discogsAccessToken: { type: String, required: true },
    discogsAccessTokenSecret: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
