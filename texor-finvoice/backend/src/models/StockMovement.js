/**
 * The stock ledger. `Item.stock` is a cache of the sum of these rows for the
 * item, updated in the same transaction that writes the row.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const stockMovementSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, required: true },
    reason: { type: String, enum: ['opening', 'sale', 'void', 'adjustment', 'purchase', 'return'], required: true },
    note: { type: String, default: '' },
    serials: { type: [String], default: [] },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    balance: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

stockMovementSchema.index({ workspace: 1, item: 1, createdAt: -1 });

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
