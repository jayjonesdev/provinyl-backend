import mongoose, { Schema } from 'mongoose';
import { IPhoto } from '../types';

const photoSchema = new Schema<IPhoto>(
  {
    userId: { type: String, required: true, index: true },
    releaseId: { type: Number, required: true },
    instanceId: { type: Number },
    kind: {
      type: String,
      enum: ['sleeve', 'vinyl', 'signature', 'receipt', 'other'],
      default: 'other',
    },
    // Object-storage keys are namespaced by userId so ownership is structural.
    storageKey: { type: String, required: true, unique: true },
    thumbKey: { type: String },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    // pending until post-upload processing (validate + re-encode + thumbnail).
    status: { type: String, enum: ['pending', 'ready'], default: 'pending' },
  },
  { timestamps: true },
);

photoSchema.index({ userId: 1, releaseId: 1 });

export const Photo = mongoose.model<IPhoto>('Photo', photoSchema);
