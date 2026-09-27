import * as gst from '../services/gst.service.js';
import { toWorkbook } from '../services/sheet.service.js';

export const gstr1 = async (req, res) => res.json(await gst.gstr1(req, req.query.month));

export async function gstr1Export(req, res) {
  const data = await gst.gstr1(req, req.query.month);
  const buffer = await toWorkbook(gst.gstr1Workbook(data, req.workspace));
  res.set('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('content-disposition', `attachment; filename="gstr1-${data.gstin}-${data.month}.xlsx"`);
  res.send(buffer);
}
