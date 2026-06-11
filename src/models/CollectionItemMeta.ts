import mongoose, { Schema } from 'mongoose';
import { ICollectionItemMeta, IMoney } from '../types';

// Embedded money value — no _id; validated (amount/currency) at the route via zod.
const moneySchema = new Schema<IMoney>(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
  },
  { _id: false },
);

const collectionItemMetaSchema = new Schema<ICollectionItemMeta>(
  {
    userId: { type: String, required: true, index: true },
    releaseId: { type: Number, required: true },
    instanceId: { type: Number },
    value: { type: moneySchema, default: undefined },
    purchasePrice: { type: moneySchema, default: undefined },
    purchaseDate: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: true },
);

// One meta document per owned copy. When instanceId is absent the doc is
// release-level (indexed as null), so a release-level doc and per-instance docs
// for the same release don't collide.
collectionItemMetaSchema.index({ userId: 1, releaseId: 1, instanceId: 1 }, { unique: true });

export const CollectionItemMeta = mongoose.model<ICollectionItemMeta>(
  'CollectionItemMeta',
  collectionItemMetaSchema,
);
