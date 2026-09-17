/**
 * Moving stock. Every change writes a ledger row and adjusts the cached count in
 * one atomic update, inside the caller's transaction when there is one.
 */
import Item from '../models/Item.js';
import StockMovement from '../models/StockMovement.js';

export async function move({ workspace, item, quantity, reason, note = '', serials = [], invoice = null, user = null }, { session } = {}) {
  if (!quantity) return null;

  const updated = await Item.findOneAndUpdate(
    { _id: item, workspace, trackStock: true },
    { $inc: { stock: quantity } },
    { returnDocument: 'after', session },
  );
  if (!updated) return null;

  const [movement] = await StockMovement.create([{
    workspace, item, quantity, reason, note, serials, invoice, balance: updated.stock, createdBy: user,
  }], { session });

  return movement;
}

export const history = (workspace, item, limit = 50) =>
  StockMovement.find({ workspace, item }).sort({ createdAt: -1 }).limit(limit).lean();
