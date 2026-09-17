/**
 * A business using Finvoice — the tenant every other document belongs to.
 *
 * `modules` and `roles` are stored here rather than in their own collections:
 * they are read on every request, they are small, and keeping them in one
 * document means a settings change is one atomic write. `metadataVersion` bumps
 * on any change to them so compiled validators know to rebuild.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const addressSchema = new Schema(
  {
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    pincode: { type: String, default: '' },
    country: { type: String, default: 'IN' },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, default: '', trim: true },
    industry: { type: String, required: true },
    edition: { type: String, enum: ['lite', 'pro'], default: 'lite' },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    currency: { type: String, default: 'INR' },
    locale: { type: String, default: 'en-IN' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    fyStartMonth: { type: Number, default: 4, min: 1, max: 12 },

    gstin: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    pan: { type: String, default: '' },
    address: { type: addressSchema, default: () => ({}) },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: '' },

    branding: {
      logo: { type: String, default: null },
      photo: { type: String, default: null },
      signature: { type: String, default: null },
      accent: { type: String, default: '#12a57f' },
    },

    bank: {
      accountName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifsc: { type: String, default: '' },
      bankName: { type: String, default: '' },
      branch: { type: String, default: '' },
      upiId: { type: String, default: '' },
    },

    /** Per-module settings; see services/metadata.service.js for the shape. */
    modules: { type: [Schema.Types.Mixed], default: [] },
    roles: { type: [Schema.Types.Mixed], default: [] },
    metadataVersion: { type: Number, default: 1 },

    /** Everyday defaults, seeded from the industry pack. */
    preferences: { type: Schema.Types.Mixed, default: {} },

    onboardedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

export const Workspace = mongoose.model('Workspace', workspaceSchema);
export default Workspace;
