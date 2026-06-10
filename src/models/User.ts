import mongoose, { Schema } from 'mongoose';
import { IUser, IUserPreferences } from '../types';

// Display/UI preferences synced from the SPA. All optional; the client owns the
// defaults, the server just stores whatever it's given (validated by zod at the
// route). _id:false — it's an embedded value, not its own document.
const preferencesSchema = new Schema<IUserPreferences>(
  {
    theme: { type: String, enum: ['light', 'dark'] },
    density: { type: String, enum: ['comfortable', 'cozy', 'compact'] },
    cardStyle: { type: String, enum: ['gallery', 'flat', 'frame'] },
    radius: { type: Number },
    showStrip: { type: Boolean },
    sort: { type: String, enum: ['added', 'artist', 'title', 'year', 'value', 'rating'] },
    lastList: { type: String, enum: ['collection', 'wantlist'] },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    avatarUrl: { type: String, default: '' },
    discogsAccessToken: { type: String, required: true },
    discogsAccessTokenSecret: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    preferences: { type: preferencesSchema, default: undefined },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
