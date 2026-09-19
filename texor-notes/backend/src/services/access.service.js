/**
 * Who may do what to a note.
 *
 * One file, and every controller asks it. The rules are small enough to hold in
 * your head, and that is the point: the moment "can this person see this" is
 * decided in three different places, two of them are wrong.
 *
 * A role comes from the strongest of three things:
 *
 *   · **owner** — you made it, or an app made it for you.
 *   · **a share on the note** — somebody gave you this one note.
 *   · **a share on a label** — somebody shared a whole label, and this note is
 *     filed under it. Sharing a label is how a team works together on a body of
 *     notes rather than on one note at a time, so a note gains and loses
 *     collaborators as it is filed and unfiled.
 *
 * Being **mentioned** grants nothing. That rule is inherited from Texor Talk
 * and it is worth restating: tagging somebody in a private note is a reference,
 * not an invitation, and a rule that said otherwise would mean typing a name
 * could publish a note you thought was yours.
 */

const RANK = { viewer: 1, editor: 2, owner: 3 };

/** The stronger of two roles, either of which may be null. */
const stronger = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a ?? null);

/**
 * `labelShares` is a Map of label id → role, built once per request by
 * `labelRolesFor` below, so a list of fifty notes does not become fifty label
 * lookups.
 */
export function roleOf(note, actor, { labelRoles } = {}) {
  if (!note || !actor?.texorId) return null;

  if (note.ownerTexorId === actor.texorId) return 'owner';

  /**
   * A key acts as the account it writes into and never inherits that account's
   * invitations. An integration was given the right to put notes somewhere, not
   * the right to read everything its owner has ever been shown.
   */
  if (actor.viaApiKey) return null;

  let role = null;

  const share = (note.shares ?? []).find((entry) => entry.texorId === actor.texorId);
  if (share) role = share.role;

  if (labelRoles) {
    for (const labelId of note.labels ?? []) {
      const viaLabel = labelRoles.get(String(labelId));
      if (viaLabel) role = stronger(role, viaLabel);
    }
  }

  /**
   * A note in the trash belongs to its owner alone.
   *
   * Otherwise deleting a shared note would leave it sitting in everybody else's
   * list, readable, with no way for them to understand why it had gone quiet —
   * and no way for the owner to take it back.
   */
  if (note.deletedAt && role) return null;

  return role;
}

export const canRead = (note, actor, context) => roleOf(note, actor, context) !== null;
export const canWrite = (note, actor, context) => RANK[roleOf(note, actor, context)] >= RANK.editor;
export const isOwner = (note, actor) => Boolean(actor?.texorId) && note?.ownerTexorId === actor.texorId;

/**
 * The labels shared *with* somebody, as id → role.
 *
 * One query per request. Passing the result into `roleOf` is what keeps the
 * board a single round trip rather than one per note.
 */
export async function labelRolesFor(Label, texorId) {
  if (!texorId) return new Map();

  const labels = await Label.find({ sharedTexorIds: texorId }).select('_id shares').lean().exec();

  return new Map(
    labels.map((label) => {
      const share = (label.shares ?? []).find((entry) => entry.texorId === texorId);
      return [String(label._id), share?.role ?? 'viewer'];
    }),
  );
}

export default { roleOf, canRead, canWrite, isOwner, labelRolesFor };
