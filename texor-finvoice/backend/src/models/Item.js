/**
 * A product, a service, or a package of them — one collection, because an
 * invoice line does not care which it is, and a warranty policy or a variant
 * price means the same on both. The sidebar shows them as separate modules.
 *
 * A package is never billed as itself: picking one drops its components in as
 * ordinary lines, each keeping its own GST rate. That is not a UI choice — a
 * bundle sold at a single price is a mixed supply under section 8 of the CGST
 * Act and would have to be taxed at the highest rate of any component.
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

/** Mirrors what the `items` field type already stores, so its editor can be reused. */
const componentSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
    variant: { type: String, default: '' },
    description: { type: String, default: '' },
    quantity: { type: Number, default: 1, min: 0 },
    priceMinor: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const itemSchema = new Schema({
  kind: { type: String, enum: ['product', 'service', 'package'], required: true, index: true },
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

  /** Packages only: what is in it, and how the saving is priced. */
  components: { type: [componentSchema], default: [] },
  packagePricing: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  packageDiscountPct: { type: Number, default: 0, min: 0, max: 100 },

  trackStock: { type: Boolean, default: false },
  stock: { type: Number, default: 0 },
  lowStock: { type: Number, default: null },
  trackSerials: { type: Boolean, default: false },

  warranty: {
    type: new Schema(
      {
        duration: { type: Number, required: true, min: 1 },
        unit: { type: String, enum: ['days', 'months', 'years'], default: 'months' },
        scope: { type: String, enum: ['parts_labour', 'parts', 'labour', 'replacement', 'service'], default: 'parts_labour' },
        includes: { type: [String], default: [] },
        excludes: { type: [String], default: [] },
        transferable: { type: Boolean, default: false },
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
