/**
 * What an edition allows, and the one place that says no.
 *
 * Finvoice Lite is free forever and metered on *scale*, never on use: there is
 * deliberately no cap on invoices, customers or anything else a business does,
 * because every competitor gives unlimited invoicing away and a document cap
 * loses the argument before pricing is reached. What Lite meters is how big the
 * business itself gets — the people in it and the number of businesses.
 *
 * Both limits are enforced here rather than at each call site, because a seat is
 * taken by two different actions (inviting someone, and switching a disabled
 * person back on) and a rule written twice is a rule that will disagree with
 * itself.
 */
import Member from '../models/Member.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';

/** `null` is no ceiling. Pro sells scale, so Pro has none. */
export const LIMITS = {
  lite: { members: 3, businesses: 1 },
  pro: { members: null, businesses: null },
};

export const limitsFor = (edition) => LIMITS[edition] ?? LIMITS.lite;

/**
 * Seats in use. An invitation that has not been accepted still holds its seat —
 * otherwise a workspace could invite its way past the limit and only discover it
 * when people started signing in.
 */
export const seatsUsed = (workspaceId) => Member.countDocuments({
  workspace: workspaceId,
  status: { $in: ['active', 'invited'] },
});

/** Called before anything that gives a person access to a workspace. */
export async function assertSeat(workspace) {
  const limit = limitsFor(workspace.edition).members;
  if (limit == null) return;

  const used = await seatsUsed(workspace._id);
  if (used >= limit) {
    throw ApiError.upgradeRequired(
      `Finvoice Lite covers ${limit} people and all ${limit} seats are taken. Switch off someone who has left, or move to Pro.`,
    );
  }
}

/**
 * Called before a person starts another business.
 *
 * Only their Lite workspaces count: the free allowance is one business, and a
 * business that has moved to Pro is no longer being given away.
 */
export async function assertBusiness(user) {
  const limit = LIMITS.lite.businesses;
  const owned = await Workspace.countDocuments({ owner: user._id, edition: 'lite' });
  if (owned >= limit) {
    throw ApiError.upgradeRequired(
      `Finvoice Lite covers ${limit === 1 ? 'one business' : `${limit} businesses`}. Move the one you have to Pro, and you can start another.`,
    );
  }
}

export default { LIMITS, limitsFor, seatsUsed, assertSeat, assertBusiness };
