/**
 * GSTR-1 — the monthly return of outward supplies.
 *
 * India-specific, and under `compliance/in/` for that reason: another country's
 * filing lives beside it rather than inside it.
 *
 * Nothing is recomputed here. Every invoice already stores the tax it was issued
 * with, because a document is a record of what was sent — so a return assembled
 * months later says exactly what the customer was charged, even if a rate, a
 * price or the tax engine has changed since. This file only decides which
 * bucket each document falls into, which is the part the law actually specifies:
 *
 *   B2B    · the customer had a GSTIN — listed invoice by invoice
 *   B2CL   · unregistered, another state, above ₹2.5 lakh — also invoice by invoice
 *   B2CS   · every other unregistered sale — summarised by state and rate
 *   CDNR   · credit and debit notes against registered customers
 *   CDNUR  · credit and debit notes against large unregistered sales
 *   HSN    · every line grouped by HSN code and rate
 *   DOCS   · the number series issued in the period, and what was cancelled
 */

/** Above this, an inter-state sale to an unregistered person is reported on its own. */
export const B2CL_THRESHOLD_MINOR = 250000_00;

/** What GSTR-1 counts as filed: a draft was never issued, and a void was withdrawn. */
const LIVE = new Set(['issued', 'partial', 'paid']);

const money = (minor) => Number((minor / 100).toFixed(2));

/** The tax on a line, split the way the return wants it. */
const taxesOf = (l) => ({
  rate: Number(l.taxRate) || 0,
  taxableMinor: l.taxableMinor ?? 0,
  igstMinor: l.igstMinor ?? 0,
  cgstMinor: l.cgstMinor ?? 0,
  sgstMinor: l.sgstMinor ?? 0,
  cessMinor: l.cessMinor ?? 0,
});

/** Lines of one document, grouped by the rate they were taxed at. */
function byRate(doc) {
  const rows = new Map();
  for (const line of doc.lines ?? []) {
    const t = taxesOf(line);
    const row = rows.get(t.rate) ?? { rate: t.rate, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0 };
    row.taxableMinor += t.taxableMinor;
    row.igstMinor += t.igstMinor;
    row.cgstMinor += t.cgstMinor;
    row.sgstMinor += t.sgstMinor;
    row.cessMinor += t.cessMinor;
    rows.set(t.rate, row);
  }
  return [...rows.values()].sort((a, b) => a.rate - b.rate);
}

const placeOf = (doc, workspace) => doc.placeOfSupply || doc.billTo?.stateCode || workspace.stateCode || '';

/**
 * `invoices` and `notes` are the documents dated inside the period, already
 * scoped to the workspace. Both arrive as plain objects.
 */
export function buildGstr1(invoices, notes, workspace) {
  const filed = invoices.filter((d) => LIVE.has(d.status));
  const cancelled = invoices.filter((d) => d.status === 'void');

  const b2b = [];
  const b2cl = [];
  const b2csRows = new Map();

  for (const doc of filed) {
    const gstin = (doc.billTo?.gstin ?? '').trim();
    const place = placeOf(doc, workspace);
    const rates = byRate(doc);

    if (gstin) {
      b2b.push({
        gstin,
        name: doc.billTo?.name ?? '',
        number: doc.number,
        date: doc.date,
        placeOfSupply: place,
        totalMinor: doc.totals?.totalMinor ?? 0,
        interState: Boolean(doc.interState),
        rates,
      });
      continue;
    }

    if (doc.interState && (doc.totals?.totalMinor ?? 0) > B2CL_THRESHOLD_MINOR) {
      b2cl.push({
        name: doc.billTo?.name ?? '',
        number: doc.number,
        date: doc.date,
        placeOfSupply: place,
        totalMinor: doc.totals?.totalMinor ?? 0,
        rates,
      });
      continue;
    }

    // Everything else is reported as a total per state and rate, not per sale.
    for (const rate of rates) {
      const key = `${place}|${rate.rate}|${doc.interState ? 'inter' : 'intra'}`;
      const row = b2csRows.get(key) ?? {
        placeOfSupply: place, rate: rate.rate, interState: Boolean(doc.interState),
        taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0,
      };
      row.taxableMinor += rate.taxableMinor;
      row.igstMinor += rate.igstMinor;
      row.cgstMinor += rate.cgstMinor;
      row.sgstMinor += rate.sgstMinor;
      row.cessMinor += rate.cessMinor;
      b2csRows.set(key, row);
    }
  }

  // A note carries the sign of what it does to the supply; the return keeps them
  // apart by who the customer was, exactly as it does for invoices.
  const issuedNotes = notes.filter((n) => n.status === 'issued');
  const cdnr = [];
  const cdnur = [];
  for (const note of issuedNotes) {
    const row = {
      gstin: (note.billTo?.gstin ?? '').trim(),
      name: note.billTo?.name ?? '',
      number: note.number,
      date: note.date,
      noteKind: note.noteKind,
      against: note.invoiceNumber ?? '',
      placeOfSupply: placeOf(note, workspace),
      totalMinor: note.totals?.totalMinor ?? 0,
      rates: byRate(note),
    };
    if (row.gstin) cdnr.push(row);
    else if (note.interState && row.totalMinor > B2CL_THRESHOLD_MINOR) cdnur.push(row);
    // A note against a small B2C sale nets off inside B2CS at filing time; it is
    // not a section of its own, so it is reported below as an adjustment total.
  }

  // HSN covers everything supplied in the period, notes included — the summary
  // is of goods moved, not of invoices raised.
  const hsnRows = new Map();
  for (const doc of [...filed, ...issuedNotes]) {
    const sign = doc.noteKind === 'credit' ? -1 : 1;
    for (const line of doc.lines ?? []) {
      const t = taxesOf(line);
      const key = `${line.hsn || ''}|${t.rate}`;
      const row = hsnRows.get(key) ?? {
        hsn: line.hsn || '', description: line.description ?? '', uqc: (line.unit || 'OTH').toUpperCase(), rate: t.rate,
        quantity: 0, taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, cessMinor: 0,
      };
      row.quantity += sign * (Number(line.quantity) || 0);
      row.taxableMinor += sign * t.taxableMinor;
      row.igstMinor += sign * t.igstMinor;
      row.cgstMinor += sign * t.cgstMinor;
      row.sgstMinor += sign * t.sgstMinor;
      row.cessMinor += sign * t.cessMinor;
      hsnRows.set(key, row);
    }
  }

  const numbered = [...filed, ...cancelled].map((d) => d.number).filter(Boolean).sort();
  const b2cs = [...b2csRows.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate);
  const hsn = [...hsnRows.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);

  const sum = (rows, key) => rows.reduce((total, r) => total + (r[key] ?? 0), 0);
  const taxableMinor = sum(b2b.flatMap((r) => r.rates), 'taxableMinor')
    + sum(b2cl.flatMap((r) => r.rates), 'taxableMinor')
    + sum(b2cs, 'taxableMinor');

  return {
    b2b,
    b2cl,
    b2cs,
    cdnr,
    cdnur,
    hsn,
    docs: {
      from: numbered[0] ?? '',
      to: numbered.at(-1) ?? '',
      issued: filed.length,
      cancelled: cancelled.length,
      cancelledNumbers: cancelled.map((d) => d.number).filter(Boolean),
    },
    totals: {
      invoices: filed.length,
      notes: issuedNotes.length,
      taxableMinor,
      igstMinor: sum(b2b.flatMap((r) => r.rates), 'igstMinor') + sum(b2cl.flatMap((r) => r.rates), 'igstMinor') + sum(b2cs, 'igstMinor'),
      cgstMinor: sum(b2b.flatMap((r) => r.rates), 'cgstMinor') + sum(b2cs, 'cgstMinor'),
      sgstMinor: sum(b2b.flatMap((r) => r.rates), 'sgstMinor') + sum(b2cs, 'sgstMinor'),
      cessMinor: sum(b2b.flatMap((r) => r.rates), 'cessMinor') + sum(b2cl.flatMap((r) => r.rates), 'cessMinor') + sum(b2cs, 'cessMinor'),
      creditedMinor: issuedNotes.filter((n) => n.noteKind === 'credit').reduce((t, n) => t + (n.totals?.totalMinor ?? 0), 0),
      debitedMinor: issuedNotes.filter((n) => n.noteKind === 'debit').reduce((t, n) => t + (n.totals?.totalMinor ?? 0), 0),
    },
  };
}

/** The return as the sheets an accountant expects, in the order GSTR-1 lists them. */
export function gstr1Sheets(data, { locale = 'en-IN' } = {}) {
  const day = (d) => new Date(d).toLocaleDateString(locale === 'en-IN' ? 'en-GB' : locale);
  const rateRows = (rows, head) => rows.flatMap((r) => r.rates.map((rate) => [...head(r), rate.rate, money(rate.taxableMinor), money(rate.igstMinor), money(rate.cgstMinor), money(rate.sgstMinor), money(rate.cessMinor)]));

  return [
    {
      name: 'B2B',
      rows: [
        ['GSTIN of recipient', 'Receiver name', 'Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...rateRows(data.b2b, (r) => [r.gstin, r.name, r.number, day(r.date), money(r.totalMinor), r.placeOfSupply]),
      ],
    },
    {
      name: 'B2CL',
      rows: [
        ['Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...rateRows(data.b2cl, (r) => [r.number, day(r.date), money(r.totalMinor), r.placeOfSupply]),
      ],
    },
    {
      name: 'B2CS',
      rows: [
        ['Type', 'Place of supply', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...data.b2cs.map((r) => [r.interState ? 'INTER' : 'INTRA', r.placeOfSupply, r.rate, money(r.taxableMinor), money(r.igstMinor), money(r.cgstMinor), money(r.sgstMinor), money(r.cessMinor)]),
      ],
    },
    {
      name: 'CDNR',
      rows: [
        ['GSTIN of recipient', 'Receiver name', 'Note number', 'Note date', 'Note type', 'Against invoice', 'Note value', 'Place of supply', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...rateRows(data.cdnr, (r) => [r.gstin, r.name, r.number, day(r.date), r.noteKind === 'credit' ? 'C' : 'D', r.against, money(r.totalMinor), r.placeOfSupply]),
      ],
    },
    {
      name: 'CDNUR',
      rows: [
        ['Note number', 'Note date', 'Note type', 'Against invoice', 'Note value', 'Place of supply', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...rateRows(data.cdnur, (r) => [r.number, day(r.date), r.noteKind === 'credit' ? 'C' : 'D', r.against, money(r.totalMinor), r.placeOfSupply]),
      ],
    },
    {
      name: 'HSN',
      rows: [
        ['HSN / SAC', 'Description', 'UQC', 'Total quantity', 'Rate', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...data.hsn.map((r) => [r.hsn, r.description, r.uqc, r.quantity, r.rate, money(r.taxableMinor), money(r.igstMinor), money(r.cgstMinor), money(r.sgstMinor), money(r.cessMinor)]),
      ],
    },
    {
      name: 'DOCS',
      rows: [
        ['Nature of document', 'Series from', 'Series to', 'Total number', 'Cancelled'],
        ['Invoices for outward supply', data.docs.from, data.docs.to, data.docs.issued + data.docs.cancelled, data.docs.cancelled],
      ],
    },
  ];
}

export default { buildGstr1, gstr1Sheets, B2CL_THRESHOLD_MINOR };
