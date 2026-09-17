/**
 * Renders a quotation or invoice to a complete HTML page.
 *
 * Pure: design + document + business in, string out. The designer's live
 * preview, the public link and the PDF all call this, so what someone arranges
 * on screen is exactly what prints.
 *
 * Every value that came from a person is escaped. A customer named
 * `<img onerror=…>` prints as that text.
 */
import { BUILTIN_DESIGNS, FONTS, ITEM_COLUMNS, PAGE_SIZES } from './designs.mjs';
import { stateName } from './india.mjs';
import { amountInWords, formatMoney } from './money.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
const nl2br = (value) => esc(value).replace(/\n/g, '<br>');

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), min), max) : fallback);

/** Only these style properties, with these value shapes, reach the page. */
function styleAttr(style = {}) {
  const css = [];
  if (['left', 'center', 'right'].includes(style.align)) css.push(`text-align:${style.align}`);
  if (style.fontSize) css.push(`font-size:${clamp(style.fontSize, 5, 40, 9)}pt`);
  if (HEX.test(style.color ?? '')) css.push(`color:${style.color}`);
  if (HEX.test(style.background ?? '')) css.push(`background:${style.background}`);
  if (style.bold) css.push('font-weight:700');
  if (style.uppercase) css.push('text-transform:uppercase;letter-spacing:.06em');
  if (style.paddingX) css.push(`padding-left:${clamp(style.paddingX, 0, 40, 0)}mm;padding-right:${clamp(style.paddingX, 0, 40, 0)}mm`);
  if (style.paddingY) css.push(`padding-top:${clamp(style.paddingY, 0, 40, 0)}mm;padding-bottom:${clamp(style.paddingY, 0, 40, 0)}mm`);
  if (style.marginTop) css.push(`margin-top:${clamp(style.marginTop, 0, 60, 0)}mm`);
  const line = style.dashed ? 'dashed' : 'solid';
  if (style.borderTop) css.push(`border-top:1px ${line} var(--border)`);
  if (style.borderBottom) css.push(`border-bottom:1px ${line} var(--border)`);
  return css.length ? ` style="${css.join(';')}"` : '';
}

// ── context ───────────────────────────────────────────────────────────────────

function formatDate(value, locale) {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function formatAddress(address = {}) {
  const state = stateName(address.stateCode);
  return [address.line1, address.line2, [address.city, state, address.pincode].filter(Boolean).join(', ')].filter(Boolean);
}

function fieldValue(field, value, ctx) {
  if (value == null || value === '') return '';
  switch (field.type) {
    case 'currency': return formatMoney(value, ctx.currency, ctx.locale);
    case 'date': return formatDate(value, ctx.locale);
    case 'datetime': return new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
    case 'checkbox': return value ? 'Yes' : 'No';
    case 'select': return field.options?.find((o) => o.value === value)?.label ?? value;
    case 'multiselect': return (Array.isArray(value) ? value : [value]).join(', ');
    case 'reference': return ctx.refs?.[value]?.title ?? '';
    case 'state': return stateName(value);
    default: return String(value);
  }
}

export function buildContext({ kind, document: doc, business, module, lines, refs = {}, assets = {}, design }) {
  const seller = doc.seller?.name ? { ...business, ...doc.seller, branding: { ...business.branding, logo: doc.seller.logo ?? business.branding?.logo, signature: doc.seller.signature ?? business.branding?.signature }, bank: { ...business.bank, ...doc.seller.bank } } : business;
  const currency = doc.currency ?? business.currency ?? 'INR';
  const locale = business.locale ?? 'en-IN';
  const isInvoice = kind === 'invoices';
  const taxed = doc.taxMode !== 'none' && (doc.totals?.taxMinor ?? 0) > 0;
  const amountDue = isInvoice ? Math.max((doc.totals?.totalMinor ?? 0) - (doc.amountPaidMinor ?? 0), 0) : doc.totals?.totalMinor ?? 0;
  const accent = HEX.test(design.page?.accent ?? '') ? design.page.accent : HEX.test(business.branding?.accent ?? '') ? business.branding.accent : '#12a57f';

  const title = isInvoice
    ? (doc.taxMode === 'gst' && seller.gstin ? 'Tax Invoice' : module.labelSingular)
    : module.labelSingular;

  const ctx = {
    kind, doc, seller, module, lines, refs, currency, locale, isInvoice, taxed, amountDue, accent, assets,
    money: (minor) => formatMoney(minor, currency, locale),
    date: (value) => formatDate(value, locale),
  };

  const printable = (module.fields ?? []).filter((f) => f.custom && f.printable);
  ctx.tags = {
    'business.name': seller.name,
    'business.legalName': seller.legalName || seller.name,
    'business.gstin': seller.gstin,
    'business.phone': seller.phone,
    'business.email': seller.email,
    'business.website': business.website,
    'customer.name': doc.billTo?.name,
    'customer.gstin': doc.billTo?.gstin,
    'customer.phone': doc.billTo?.phone,
    'customer.email': doc.billTo?.email,
    'document.title': title,
    'document.label': module.labelSingular,
    'document.number': doc.number ?? 'Draft',
    'document.date': formatDate(doc.date, locale),
    'document.dueDate': formatDate(doc.dueDate, locale),
    'document.validUntil': formatDate(doc.validUntil, locale),
    'document.total': formatMoney(doc.totals?.totalMinor ?? 0, currency, locale),
    'document.amountDue': formatMoney(amountDue, currency, locale),
    'document.reference': doc.reference,
    'document.copy': isInvoice && doc.taxMode === 'gst' ? 'Original for recipient' : '',
    ...Object.fromEntries(printable.map((f) => [`custom.${f.key}`, fieldValue(f, doc.custom?.[f.key], ctx)])),
  };
  ctx.printable = printable;
  return ctx;
}

/** `{{customer.name}}` → escaped value. Unknown tags render as nothing rather than as braces. */
export const interpolate = (text, ctx) => esc(String(text ?? '')).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => esc(ctx.tags[key] ?? ''));

function passes(when, ctx) {
  switch (when) {
    case 'interState': return Boolean(ctx.doc.interState) && ctx.taxed;
    case 'intraState': return !ctx.doc.interState && ctx.taxed;
    case 'taxed': return ctx.taxed;
    case 'hasDue': return ctx.amountDue > 0;
    case 'hasNotes': return Boolean(ctx.doc.notes?.trim());
    case 'invoice': return ctx.isInvoice;
    case 'quotation': return !ctx.isInvoice;
    default: return true;
  }
}

// ── blocks ────────────────────────────────────────────────────────────────────

const img = (key, ctx, cls) => (key && ctx.assets.fileUrl ? `<img class="${cls}" src="${esc(ctx.assets.fileUrl(key))}" alt="">` : '');

const BLOCKS = {
  header(p, ctx) {
    const s = ctx.seller;
    const logo = p.showLogo ? img(s.branding?.logo, ctx, 'logo') : '';
    const address = p.showAddress ? formatAddress(s.address).map(esc).join('<br>') : '';
    const contact = p.showContact ? [s.phone, s.email, ctx.tags['business.website']].filter(Boolean).map(esc).join(' · ') : '';
    const gstin = p.showGstin && s.gstin ? `<div class="gstin">GSTIN ${esc(s.gstin)}${s.stateCode ? ` · ${esc(stateName(s.stateCode))} (${esc(s.stateCode)})` : ''}</div>` : '';
    const details = `<div class="biz"><div class="biz-name">${esc(s.legalName || s.name)}</div>${s.legalName && s.legalName !== s.name ? `<div class="muted">${esc(s.name)}</div>` : ''}${address ? `<div class="muted">${address}</div>` : ''}${contact ? `<div class="muted">${contact}</div>` : ''}${gstin}</div>`;
    const title = p.showTitle ? `<div class="doc-title">${interpolate(p.title || '{{document.title}}', ctx)}</div>` : '';

    if (p.layout === 'band') return `<header class="h-band">${logo}${details}${title}</header>`;
    if (p.layout === 'centered') return `<header class="h-centered">${logo}${details}</header>`;
    if (p.layout === 'inline') return `<header class="h-inline">${logo}${details}${title}</header>`;
    return `<header class="h-split">${details}${logo}</header>`;
  },

  title(p, ctx) {
    const sub = p.subtitle ? interpolate(p.subtitle, ctx) : '';
    return `<div class="title">${interpolate(p.text || '{{document.title}}', ctx)}${sub ? `<span class="title-sub">${sub}</span>` : ''}</div>`;
  },

  meta(p, ctx) {
    const d = ctx.doc;
    const rows = [
      [`${ctx.module.labelSingular} no.`, d.number ?? 'Draft'],
      [ctx.isInvoice ? `${ctx.module.labelSingular} date` : 'Date', ctx.date(d.date)],
      ctx.isInvoice ? ['Due date', ctx.date(d.dueDate)] : ['Valid until', ctx.date(d.validUntil)],
      ['Place of supply', d.placeOfSupply ? `${stateName(d.placeOfSupply)} (${d.placeOfSupply})` : ''],
      ['Reference', d.reference],
    ];
    if (p.includePrintable !== false) {
      for (const f of ctx.printable) rows.push([f.label, ctx.tags[`custom.${f.key}`]]);
    }
    const shown = rows.filter(([, v]) => v);
    if (p.style === 'cards') return `<div class="meta-cards">${shown.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;
    if (p.style === 'receipt') return `<div class="meta-receipt">${shown.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
    return `<table class="meta">${shown.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  },

  parties(p, ctx) {
    const b = ctx.doc.billTo ?? {};
    const party = (label, name, address, extra) => `<div class="party"><div class="label">${esc(label)}</div><div class="party-name">${esc(name)}</div>${address.length ? `<div>${address.map(esc).join('<br>')}</div>` : ''}${extra}</div>`;
    const extra = [
      b.gstin ? `<div>GSTIN <strong>${esc(b.gstin)}</strong></div>` : '',
      b.stateCode && !p.compact ? `<div class="muted">State: ${esc(stateName(b.stateCode))} (${esc(b.stateCode)})</div>` : '',
      [b.phone, b.email].filter(Boolean).length ? `<div class="muted">${[b.phone, b.email].filter(Boolean).map(esc).join(' · ')}</div>` : '',
    ].join('');
    const billTo = party(p.billToLabel || 'Bill to', b.name, p.compact ? [] : formatAddress(b.address), extra);
    const hasShip = b.shippingAddress?.line1 && JSON.stringify(b.shippingAddress) !== JSON.stringify(b.address);
    if (p.show === 'both' && hasShip) {
      return `<div class="parties">${billTo}${party(p.shipToLabel || 'Ship to', b.name, formatAddress(b.shippingAddress), '')}</div>`;
    }
    return `<div class="parties">${billTo}</div>`;
  },

  items(p, ctx) {
    const lineFields = (ctx.lines?.fields ?? []);
    const labelFor = (key, fallback) => lineFields.find((f) => f.key === key)?.label ?? fallback;
    const printableLine = lineFields.filter((f) => f.custom && f.printable);

    const describe = (line) => {
      const bits = [`<div class="item-name">${esc(line.description)}${p.showVariant !== false && line.variant && !line.description.includes(line.variant) ? ` <span class="muted">(${esc(line.variant)})</span>` : ''}</div>`];
      if (p.showSerials !== false && line.serials?.length) bits.push(`<div class="muted small">S/N: ${line.serials.map(esc).join(', ')}</div>`);
      for (const f of printableLine) {
        const v = fieldValue(f, line.custom?.[f.key], ctx);
        if (v) bits.push(`<div class="muted small">${esc(f.label)}: ${esc(v)}</div>`);
      }
      return bits.join('');
    };

    const lines = ctx.doc.lines ?? [];

    if (p.layout === 'receipt') {
      return `<div class="receipt-items">${lines.map((l) => `<div class="r-line"><div>${describe(l)}</div><div class="r-row"><span>${esc(l.quantity)} × ${esc(ctx.money(l.priceMinor))}</span><span>${esc(ctx.money(l.grossMinor))}</span></div></div>`).join('')}</div>`;
    }

    const configured = (p.columns?.length ? p.columns : ITEM_COLUMNS.map((c) => ({ key: c.key, show: true })));
    const columns = configured.filter((c) => c.show !== false).map((c) => {
      const base = ITEM_COLUMNS.find((b) => b.key === c.key);
      const customField = c.key.startsWith('custom.') ? lineFields.find((f) => f.key === c.key.slice(7)) : null;
      if (!base && !customField) return null;
      const registryLabel = { description: labelFor('description', 'Item'), hsn: labelFor('hsn', 'HSN/SAC'), quantity: labelFor('quantity', 'Qty'), priceMinor: labelFor('priceMinor', 'Rate'), discountPct: labelFor('discountPct', 'Disc.'), taxRate: labelFor('taxRate', 'GST') }[c.key];
      return { key: c.key, label: c.label || registryLabel || base?.label || customField.label, width: clamp(c.width ?? base?.width ?? 10, 3, 60, 10), align: base?.align ?? 'left', field: customField };
    }).filter(Boolean);

    if (!ctx.taxed) {
      for (const hide of ['taxRate', 'taxMinor', 'taxableMinor']) {
        const index = columns.findIndex((c) => c.key === hide);
        if (index >= 0) columns.splice(index, 1);
      }
    }

    const cell = (c, line, i) => {
      switch (c.key) {
        case 'index': return i + 1;
        case 'description': return describe(line);
        case 'hsn': return esc(line.hsn);
        case 'quantity': return `${esc(line.quantity)}${line.unit ? ` <span class="muted">${esc(line.unit)}</span>` : ''}`;
        case 'priceMinor': return esc(ctx.money(line.priceMinor));
        case 'discountPct': return line.discountPct ? `${esc(line.discountPct)}%` : '—';
        case 'taxableMinor': return esc(ctx.money(line.taxableMinor));
        case 'taxRate': return `${esc(line.taxRate)}%${line.cessRate ? `<div class="muted small">+${esc(line.cessRate)}% cess</div>` : ''}`;
        case 'taxMinor': return esc(ctx.money(line.cgstMinor + line.sgstMinor + line.igstMinor + line.cessMinor));
        case 'totalMinor': return esc(ctx.money(line.totalMinor));
        default: return esc(fieldValue(c.field, line.custom?.[c.field.key], ctx));
      }
    };

    const total = columns.reduce((a, c) => a + c.width, 0);
    return `<table class="items${p.striped ? ' striped' : ''}${p.bordered ? ' bordered' : ''}"><colgroup>${columns.map((c) => `<col style="width:${((c.width / total) * 100).toFixed(2)}%">`).join('')}</colgroup><thead><tr>${columns.map((c) => `<th class="a-${c.align}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${lines.map((line, i) => `<tr>${columns.map((c) => `<td class="a-${c.align}${['quantity', 'priceMinor', 'taxableMinor', 'taxMinor', 'totalMinor'].includes(c.key) ? ' nowrap' : ''}">${cell(c, line, i)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  },

  totals(p, ctx) {
    const t = ctx.doc.totals ?? {};
    const rates = [...new Set((ctx.doc.taxSummary ?? []).map((r) => r.rate))];
    const single = rates.length === 1 ? rates[0] : null;
    const rows = [['Subtotal', t.grossMinor]];
    if (t.discountMinor) rows.push(['Discount', -t.discountMinor]);
    if (ctx.taxed) {
      if (t.discountMinor || t.grossMinor !== t.taxableMinor) rows.push(['Taxable amount', t.taxableMinor]);
      if (t.cgstMinor) rows.push([`CGST${single != null ? ` @${single / 2}%` : ''}`, t.cgstMinor]);
      if (t.sgstMinor) rows.push([`SGST${single != null ? ` @${single / 2}%` : ''}`, t.sgstMinor]);
      if (t.igstMinor) rows.push([`IGST${single != null ? ` @${single}%` : ''}`, t.igstMinor]);
      if (t.cessMinor) rows.push(['Cess', t.cessMinor]);
    }
    if (t.roundOffMinor) rows.push(['Round off', t.roundOffMinor]);

    let html = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(ctx.money(v))}</td></tr>`).join('');
    html += `<tr class="grand"><th>Total</th><td>${esc(ctx.money(t.totalMinor ?? 0))}</td></tr>`;
    if (ctx.isInvoice && p.showBalance !== false && ctx.doc.amountPaidMinor > 0) {
      html += `<tr><th>Paid</th><td>${esc(ctx.money(-ctx.doc.amountPaidMinor))}</td></tr><tr class="due"><th>Balance due</th><td>${esc(ctx.money(ctx.amountDue))}</td></tr>`;
    }
    return `<table class="totals${p.highlight ? ' highlight' : ''}">${html}</table>`;
  },

  taxSummary(p, ctx) {
    const rows = ctx.doc.taxSummary ?? [];
    if (!rows.length) return '';
    const inter = ctx.doc.interState;
    const hasCess = rows.some((r) => r.cessMinor);
    const head = ['GST rate', 'Taxable', ...(inter ? ['IGST'] : ['CGST', 'SGST']), ...(hasCess ? ['Cess'] : []), 'Total tax'];
    const body = rows.map((r) => [
      `${r.rate}%`, ctx.money(r.taxableMinor), ...(inter ? [ctx.money(r.igstMinor)] : [ctx.money(r.cgstMinor), ctx.money(r.sgstMinor)]),
      ...(hasCess ? [ctx.money(r.cessMinor)] : []), ctx.money(r.cgstMinor + r.sgstMinor + r.igstMinor + r.cessMinor),
    ]);
    return `<table class="tax-summary${p.compact ? ' compact' : ''}"><thead><tr>${head.map((h, i) => `<th class="${i ? 'a-right' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'a-right' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  },

  words(_p, ctx) {
    return `<div class="words"><span class="label">Amount in words</span><div>${esc(amountInWords(ctx.doc.totals?.totalMinor ?? 0, ctx.currency))}</div></div>`;
  },

  bank(p, ctx) {
    const bank = ctx.seller.bank ?? {};
    const parts = [];
    if (p.showBank !== false && (bank.accountNumber || bank.ifsc)) {
      parts.push(`<div class="bank-details"><div class="label">Bank details</div>${[
        ['Account name', bank.accountName], ['Bank', [bank.bankName, bank.branch].filter(Boolean).join(', ')], ['A/c no.', bank.accountNumber], ['IFSC', bank.ifsc],
      ].filter(([, v]) => v).map(([k, v]) => `<div><span class="muted">${esc(k)}</span> ${esc(v)}</div>`).join('')}</div>`);
    }
    if (p.showQr !== false && ctx.assets.upiQr && ctx.amountDue > 0) {
      parts.push(`<div class="upi"><img src="${esc(ctx.assets.upiQr)}" alt=""><div><div class="label">Scan to pay</div><strong>${esc(ctx.money(ctx.amountDue))}</strong><div class="muted small">${esc(bank.upiId)}</div></div></div>`);
    }
    return parts.length ? `<div class="bank${p.compact ? ' compact' : ''}">${parts.join('')}</div>` : '';
  },

  notes(_p, ctx) {
    return ctx.doc.notes?.trim() ? `<div class="notes"><div class="label">Notes</div><div>${nl2br(ctx.doc.notes)}</div></div>` : '';
  },

  terms(p, ctx) {
    return ctx.doc.terms?.trim() ? `<div class="terms"><div class="label">${esc(p.label || 'Terms & conditions')}</div><div>${nl2br(ctx.doc.terms)}</div></div>` : '';
  },

  signature(p, ctx) {
    const sig = img(ctx.seller.branding?.signature, ctx, 'signature');
    return `<div class="sign"><div>${esc(p.prefix || 'For')} ${esc(ctx.seller.legalName || ctx.seller.name)}</div><div class="sign-space">${sig}</div><div class="sign-label">${esc(p.label || 'Authorised signatory')}</div></div>`;
  },

  text(p, ctx) {
    return `<div class="text">${interpolate(p.text, ctx).replace(/\n/g, '<br>')}</div>`;
  },

  image(p, ctx) {
    return p.file ? `<div class="image" style="width:${clamp(p.width, 5, 100, 30)}%">${img(p.file, ctx, 'free-image')}</div>` : '';
  },

  divider() { return '<hr class="divider">'; },
  spacer(p) { return `<div style="height:${clamp(p.height, 1, 80, 6)}mm"></div>`; },
  footer(p, ctx) { return `<footer class="foot">${interpolate(p.text, ctx)}</footer>`; },
};

function renderBlocks(blocks, ctx, depth = 0) {
  return (blocks ?? []).map((b) => {
    if (!b || !passes(b.when, ctx)) return '';
    if (b.type === 'columns') {
      if (depth > 1) return '';
      const ratio = String(b.props?.ratio ?? '1:1').split(':').map((n) => clamp(n, 1, 9, 1));
      const children = (b.children ?? []).slice(0, ratio.length);
      return `<div class="cols"${styleAttr(b.style)}>${children.map((c, i) => `<div style="flex:${ratio[i] ?? 1}">${renderBlocks(c, ctx, depth + 1)}</div>`).join('')}</div>`;
    }
    const render = BLOCKS[b.type];
    if (!render) return '';
    const html = render(b.props ?? {}, ctx);
    return html ? `<section class="blk blk-${b.type}" data-block="${esc(b.id)}"${styleAttr(b.style)}>${html}</section>` : '';
  }).join('');
}

function fontFaces(base) {
  if (!base) return '';
  const faces = [['Inter', 'inter'], ['Source Serif 4', 'source-serif-4'], ['JetBrains Mono', 'jetbrains-mono']];
  const ranges = {
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  };
  return faces.flatMap(([family, file]) => [400, 700].flatMap((weight) => Object.entries(ranges).map(([subset, range]) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url(${base}/${file}-${subset}-${weight}-normal.woff2) format('woff2');unicode-range:${range}}`))).join('');
}

export function renderDocument(input) {
  const design = input.design?.blocks ? input.design : BUILTIN_DESIGNS.classic;
  const ctx = buildContext({ ...input, design });
  const page = design.page ?? {};
  const size = PAGE_SIZES.find((s) => s.value === page.size) ?? PAGE_SIZES[0];
  const font = FONTS.find((f) => f.value === page.font) ?? FONTS[0];
  const margin = clamp(page.margin, 0, 30, 12);
  const thermal = size.height === null;
  const color = (value, fallback) => (HEX.test(value ?? '') ? value : fallback);

  const stamp = { draft: 'Draft', void: 'Void', paid: 'Paid', declined: 'Declined' }[ctx.doc.status];
  const stampHtml = stamp && input.options?.stamp !== false && !thermal ? `<div class="stamp stamp-${ctx.doc.status}">${stamp}</div>` : '';

  const css = `
${fontFaces(ctx.assets.fontBase)}
:root{--accent:${ctx.accent};--text:${color(page.text, '#1f2328')};--muted:${color(page.muted, '#5c6370')};--border:${color(page.border, '#d0d4db')}}
*{box-sizing:border-box}
@page{size:${thermal ? `${size.width}mm auto` : `${size.width}mm ${size.height}mm`};margin:0}
html,body{margin:0;padding:0}
body{font-family:${font.css};font-size:${clamp(page.fontSize, 6, 14, 9)}pt;line-height:1.4;color:var(--text);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:${size.width}mm;${thermal ? '' : `min-height:${size.height}mm;`}padding:${margin}mm;background:#fff;margin:0 auto;overflow:hidden}
@media screen{html{background:#eceef1}.page{margin:16px auto;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 30px rgba(0,0,0,.08)}}
@media print{.page{margin:0;box-shadow:none}}
.blk{margin-bottom:${thermal ? 2 : 4}mm}.blk:last-child{margin-bottom:0}
.cols{display:flex;gap:${thermal ? 2 : 6}mm;margin-bottom:4mm;align-items:flex-start}.cols>div{min-width:0}.cols .blk{margin-bottom:3mm}
.muted{color:var(--muted)}.small{font-size:.85em}
.label{font-size:.75em;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700;margin-bottom:1mm}
.a-left{text-align:left}.a-right{text-align:right}.a-center{text-align:center}
.logo{max-height:${thermal ? 12 : 18}mm;max-width:${thermal ? 40 : 55}mm;object-fit:contain}
.biz-name{font-size:1.45em;font-weight:700;line-height:1.2;margin-bottom:.6mm}
.gstin{margin-top:.8mm;font-weight:700}
.h-split{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm}
.h-inline{display:flex;align-items:center;gap:4mm}.h-inline .biz{flex:1}.h-inline .doc-title{font-size:1.5em;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}
.h-centered{text-align:center}.h-centered .logo{display:block;margin:0 auto 1mm}
.h-band{display:flex;align-items:center;gap:6mm;padding:10mm 14mm 9mm;background:var(--accent);color:#fff;margin:-${margin}mm -${margin}mm 0}
.h-band .muted{color:rgba(255,255,255,.82)}.h-band .biz{flex:1}.h-band .logo{background:#fff;padding:2mm;border-radius:2mm}
.h-band .doc-title{font-size:2.1em;font-weight:700;letter-spacing:.02em;text-align:right;line-height:1}
.title{font-weight:700;padding:1.5mm 0}.title-sub{display:block;font-size:.62em;font-weight:400;color:var(--muted);letter-spacing:.04em;margin-top:.5mm}
table{width:100%;border-collapse:collapse}
.meta th{text-align:left;font-weight:400;color:var(--muted);padding:.6mm 3mm .6mm 0;white-space:nowrap;vertical-align:top;width:1%}
.meta td{font-weight:700;padding:.6mm 0;text-align:right}
.meta-cards{display:grid;grid-template-columns:1fr 1fr;gap:2mm}.meta-cards div{background:#f6f7f9;border-radius:1.6mm;padding:1.8mm 2.4mm}.meta-cards span{display:block;font-size:.78em;color:var(--muted)}.meta-cards strong{font-size:1.02em}
.meta-receipt div{display:flex;justify-content:space-between;gap:2mm}
.party-name{font-weight:700;font-size:1.12em}.parties{display:flex;gap:6mm}.party{flex:1}
.items thead{display:table-header-group}.items tr{break-inside:avoid}
.items th{font-size:.82em;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;padding:2mm 1.6mm;border-bottom:1.5px solid var(--accent)}
.items td{padding:2mm 1.6mm;vertical-align:top;border-bottom:1px solid var(--border)}
.items.striped tbody tr:nth-child(even) td{background:#f7f8fa}
.items.bordered th,.items.bordered td{border:1px solid var(--border)}.items.bordered th{background:#f3f4f6;border-bottom:1.5px solid var(--border)}
.item-name{font-weight:700}
.totals th{text-align:left;font-weight:400;color:var(--muted);padding:1mm 0}.totals td{text-align:right;padding:1mm 0;white-space:nowrap}
.totals .grand th,.totals .grand td{font-size:1.3em;font-weight:700;color:var(--text);border-top:1.5px solid var(--text);padding-top:1.8mm}
.totals.highlight .grand th,.totals.highlight .grand td{color:var(--accent)}
.totals .due th,.totals .due td{font-weight:700;color:var(--text)}
.tax-summary th{font-size:.78em;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);padding:1mm 1.2mm;text-align:left}
.tax-summary th.a-right{text-align:right}.tax-summary td{padding:1mm 1.2mm;border-bottom:1px solid var(--border)}.nowrap{white-space:nowrap}.tax-summary.compact{font-size:.9em}
.words div{font-weight:700}
.bank{display:flex;flex-wrap:wrap;gap:4mm 6mm;align-items:flex-start}.bank-details{flex:1 1 48mm}.bank-details>div:not(.label){display:flex;gap:2mm}.bank-details .muted{min-width:24mm}.bank.compact{justify-content:center}
.upi{display:flex;gap:2.5mm;align-items:center}.upi img{width:${thermal ? 26 : 24}mm;height:${thermal ? 26 : 24}mm}
.bank.compact .upi{flex-direction:column;text-align:center}
.sign{text-align:right}.sign-space{height:16mm;display:flex;justify-content:flex-end;align-items:flex-end}.signature{max-height:16mm;max-width:50mm;object-fit:contain}
.sign-label{border-top:1px solid var(--border);display:inline-block;padding-top:1mm;min-width:40mm;color:var(--muted)}
.notes div:last-child,.terms div:last-child{white-space:normal}.terms{font-size:.9em}
.divider{border:0;border-top:1px solid var(--border);margin:2mm 0}
.foot{color:var(--muted);font-size:.85em}
.free-image{width:100%;object-fit:contain}
.receipt-items{border-top:1px dashed var(--border);border-bottom:1px dashed var(--border);padding:1mm 0}
.r-line{padding:.8mm 0}.r-row{display:flex;justify-content:space-between}
.stamp{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:64pt;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.08;pointer-events:none;color:#000}
.stamp-paid{color:#0a7a4a;opacity:.14}.stamp-void{color:#b42318;opacity:.14}
${thermal ? '.biz-name{font-size:1.2em}.totals .grand th,.totals .grand td{font-size:1.15em}.items,.meta{font-size:.95em}' : ''}
`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ctx.tags['document.title'])} ${esc(ctx.doc.number ?? '')}</title><style>${css}</style></head><body><main class="page">${stampHtml}${renderBlocks(design.blocks, ctx)}</main></body></html>`;
}

/** The UPI deep link a payment QR encodes. */
export function upiLink({ upiId, payee, amountMinor, reference, currency = 'INR' }) {
  if (!upiId || currency !== 'INR') return null;
  const params = new URLSearchParams({ pa: upiId, pn: payee.slice(0, 50), cu: 'INR' });
  if (amountMinor > 0) params.set('am', (amountMinor / 100).toFixed(2));
  if (reference) params.set('tn', reference.slice(0, 50));
  return `upi://pay?${params.toString()}`;
}
