import * as ledger from '../services/ledger.service.js';

export const statement = async (req, res) => res.json(await ledger.statement(req, req.params.id, req.query));

export async function statementCsv(req, res) {
  const data = await ledger.statement(req, req.params.id, req.query);
  const name = `statement-${data.customer.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', `attachment; filename="${name}"`);
  res.send(ledger.statementCsv(data, req.workspace.currency));
}
