/**
 * The workspace activity log.
 *
 * Call `record` after the change it describes has happened. It never throws: a
 * failed audit write is logged, not turned into a failed invoice.
 */
import AuditEvent from '../models/AuditEvent.js';
import logger from '../utils/logger.js';

export async function record(req, { action, module = '', recordId = null, summary = '', metadata = {} }, { session } = {}) {
  try {
    await AuditEvent.create([{
      workspace: req.workspace._id,
      action,
      module,
      recordId,
      summary,
      metadata,
      actor: req.user?._id ?? null,
      actorName: req.member?.name || req.user?.displayName || '',
      ip: req.ip ?? '',
    }], { session });
  } catch (error) {
    logger.error('audit write failed', { action, message: error.message });
  }
}

export default { record };
