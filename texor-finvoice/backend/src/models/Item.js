/**
 * A product or a service — one collection, because an invoice line does not
 * care which it is, and a warranty policy or a variant price means the same on
 * both. The sidebar shows them as two modules with their own fields.
 */
import mongoose from 'mongoose';
import { recordPlugin } from './record.plugin.js';

const { Schema } = mongoose;

const variantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    sku: { type: String, default: '' },
  },
  { _id: true },
);

const itemSchema = new Schema({
  kind: { type: String, enum: ['product', 'service'], required: true, index: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, default: '' },
  sku: { type: String, default: '' },
  barcode: { type: String, default: '' },
  description: { type: String, default: '' },
  image: { type: String, default: null },
  duration: { type: Number, default: null },
  unit: { type: String, default: '' },
  priceMinor: { type: Number, default: 0, min: 0 },
  costMinor: { type: Number, default: null },
  taxRate: { type: Number, default: 0, min: 0, max: 100 },
  cessRate: { type: Number, default: 0, min: 0, max: 100 },
  priceIncludesTax: { type: Boolean, default: false },
  hsn: { type: String, default: '' },
  variants: { type: [variantSchema], default: [] },

  trackStock: { type: Boolean, default: false },
  stock: { type: Number, default: 0 },
  lowStock: { type: Number, default: null },
  trackSerials: { type: Boolean, default: false },

  warranty: {
    type: new Schema(
      {
        duration: { type: Number, required: true, min: 1 },
        unit: { type: String, enum: ['days', 'months', 'years'], default: 'months' },
        coverage: { type: String, default: '' },
      },
      { _id: false },
    ),
    default: null,
  },
});

itemSchema.plugin(recordPlugin);
itemSchema.index({ workspace: 1, kind: 1, name: 1 });
itemSchema.index({ workspace: 1, barcode: 1 });

export const Item = mongoose.model('Item', itemSchema);
export default Item;
