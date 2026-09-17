/**
 * What every workspace-owned record has in common.
 *
 *   workspace   the tenant — every query filters on it
 *   custom      values for fields a person added (validated by metadata.service)
 *   searchText  lower-cased text of the searchable fields, rebuilt on save
 *   createdBy   the user, for "own records only" roles
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

export function recordPlugin(schema) {
  schema.add({
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    custom: { type: Schema.Types.Mixed, default: {} },
    searchText: { type: String, default: '', select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  });
  schema.set('timestamps', true);
  schema.set('minimize', false);
  schema.index({ workspace: 1, deletedAt: 1, updatedAt: -1 });
}

export const addressSchema = new Schema(
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
