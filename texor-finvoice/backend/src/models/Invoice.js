/**
 * An invoice.
 *
 * Totals are stored, not computed on read, so a historical invoice keeps the
 * numbers it was actually sent with even if tax rates or rounding rules change
 * later. `recalculate()` is the single place those numbers are derived.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const lineItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    taxRate: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    texorId: { type: String, required: true, index: true },

    number: { type: String, required: true, trim: true },

    client: {
      name: { type: String, required: true, trim: true },
      email: { type: String, default: '', trim: true, lowercase: true },
      address: { type: String, default: '' },
    },

    lineItems: { type: [lineItemSchema], default: [] },

    currency: { type: String, default: 'USD', uppercase: true },
    notes: { type: String, default: '' },

    issueDate: { type: Date, default: () => new Date() },
    dueDate: { type: Date, default: null },

    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue', 'void'],
      default: 'draft',
      index: true,
    },
    paidAt: { type: Date, default: null },

    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Invoice numbers are unique per user, not globally — two customers can both
// have an "INV-001".
invoiceSchema.index({ owner: 1, number: 1 }, { unique: true });

/** Rounds to cents; avoids the classic 0.1 + 0.2 drift across many line items. */
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

invoiceSchema.methods.recalculate = function recalculate() {
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of this.lineItems) {
    const lineTotal = money(item.quantity * item.unitPrice);
    subtotal = money(subtotal + lineTotal);
    taxTotal = money(taxTotal + money(lineTotal * (item.taxRate / 100)));
  }

  this.subtotal = subtotal;
  this.taxTotal = taxTotal;
  this.total = money(subtotal + taxTotal);

  return this;
};

// Mongoose 9 hooks are promise-based; there is no `next` callback to call.
invoiceSchema.pre('validate', function beforeValidate() {
  this.recalculate();
});

/** True once the due date has passed on an invoice that was sent but not paid. */
invoiceSchema.virtual('isOverdue').get(function isOverdue() {
  return this.status === 'sent' && Boolean(this.dueDate) && this.dueDate < new Date();
});

invoiceSchema.set('toJSON', { virtuals: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
