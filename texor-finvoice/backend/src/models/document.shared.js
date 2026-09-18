/**
 * What quotations and invoices share: the parties, the lines, the totals.
 *
 * Every computed amount is stored. A document is a record of what was sent, so
 * it keeps its own numbers even if the tax engine, an item's price or the
 * business address changes afterwards — which is also why the customer and the
 * seller are copied onto it (`billTo`, `seller`) rather than looked up.
 */
import mongoose from 'mongoose';
import { addressSchema } from './record.plugin.js';

const { Schema } = mongoose;

export const lineSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
    kind: { type: String, enum: ['product', 'service', 'custom'], default: 'custom' },
    variant: { type: String, default: '' },
    description: { type: String, required: true, trim: true },
    hsn: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: '' },
    priceMinor: { type: Number, required: true, min: 0 },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    /**
     * An exact amount off this line, overriding the percentage when set.
     * Distinct from the computed `discountMinor` below, which is what was
     * actually taken off once the document discount is shared out too.
     */
    discountAmountMinor: { type: Number, default: null, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    cessRate: { type: Number, default: 0, min: 0, max: 100 },
    priceIncludesTax: { type: Boolean, default: false },
    serials: { type: [String], default: [] },
    custom: { type: Schema.Types.Mixed, default: {} },

    grossMinor: { type: Number, default: 0 },
    discountMinor: { type: Number, default: 0 },
    taxableMinor: { type: Number, default: 0 },
    cgstMinor: { type: Number, default: 0 },
    sgstMinor: { type: Number, default: 0 },
    igstMinor: { type: Number, default: 0 },
    cessMinor: { type: Number, default: 0 },
    totalMinor: { type: Number, default: 0 },
  },
  { _id: true, minimize: false },
);

const partySchema = new Schema(
  {
    name: { type: String, default: '' },
    legalName: { type: String, default: '' },
    gstin: { type: String, default: '' },
    pan: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: addressSchema, default: () => ({}) },
    shippingAddress: { type: addressSchema, default: () => ({}) },
    logo: { type: String, default: null },
    signature: { type: String, default: null },
    bank: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const totalsSchema = new Schema(
  {
    grossMinor: { type: Number, default: 0 },
    discountMinor: { type: Number, default: 0 },
    taxableMinor: { type: Number, default: 0 },
    cgstMinor: { type: Number, default: 0 },
    sgstMinor: { type: Number, default: 0 },
    igstMinor: { type: Number, default: 0 },
    cessMinor: { type: Number, default: 0 },
    taxMinor: { type: Number, default: 0 },
    roundOffMinor: { type: Number, default: 0 },
    totalMinor: { type: Number, default: 0 },
  },
  { _id: false },
);

export function documentFields() {
  return {
    number: { type: String, default: null },
    fy: { type: String, default: '' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    billTo: { type: partySchema, default: () => ({}) },
    seller: { type: partySchema, default: () => ({}) },
    date: { type: Date, required: true },
    placeOfSupply: { type: String, default: '' },
    reference: { type: String, default: '' },
    notes: { type: String, default: '' },
    terms: { type: String, default: '' },
    currency: { type: String, default: 'INR' },
    taxMode: { type: String, enum: ['gst', 'none'], default: 'gst' },
    interState: { type: Boolean, default: false },
    discount: {
      type: new Schema({ type: { type: String, enum: ['percent', 'amount'], default: 'percent' }, value: { type: Number, default: 0, min: 0 } }, { _id: false }),
      default: null,
    },
    roundOff: { type: Boolean, default: false },
    lines: { type: [lineSchema], default: [] },
    totals: { type: totalsSchema, default: () => ({}) },
    taxSummary: { type: [Schema.Types.Mixed], default: [] },
    design: { type: String, default: '' },
    publicToken: { type: String, default: null },
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    source: {
      type: new Schema({ module: String, record: Schema.Types.ObjectId, title: String }, { _id: false }),
      default: null,
    },
  };
}
