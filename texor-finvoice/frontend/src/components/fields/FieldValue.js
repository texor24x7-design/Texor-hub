'use client';

import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { fileUrl } from '@/lib/api';
import { addressLines, date, dateTime, money } from '@/lib/format';
import { stateName } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';
import { WARRANTY_SCOPES } from './FieldInput';

const EMPTY = <span className="fv-empty">—</span>;

export function FieldValue({ field, value, refs = {}, compact }) {
  const { currency, href } = useWorkspace();
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return EMPTY;

  switch (field.type) {
    case 'currency': return <span className="num">{money(value, currency)}</span>;
    case 'percent': return <span className="num">{value}%</span>;
    case 'number': return <span className="num">{Number(value).toLocaleString('en-IN')}</span>;
    case 'date': return date(value);
    case 'datetime': return dateTime(value);
    case 'checkbox': return value ? <Check size={16} color="var(--success)" aria-label="Yes" /> : <Minus size={16} color="var(--text-subtle)" aria-label="No" />;
    case 'select': return field.options?.find((o) => o.value === value)?.label ?? value;
    case 'multiselect': return <span className="row wrap" style={{ gap: 4 }}>{value.map((v) => <span className="tag" key={v}>{field.options?.find((o) => o.value === v)?.label ?? v}</span>)}</span>;
    case 'email': return compact ? value : <a href={`mailto:${value}`}>{value}</a>;
    case 'phone': return compact ? value : <a href={`tel:${value.replace(/\s/g, '')}`}>{value}</a>;
    case 'url': return <a href={value} target="_blank" rel="noreferrer noopener">{value.replace(/^https?:\/\//, '')}</a>;
    case 'image':
    case 'file': return <img src={fileUrl(value)} alt="" style={{ maxHeight: compact ? 32 : 160, borderRadius: 8, border: '1px solid var(--border)' }} />;
    case 'reference': {
      const ref = refs[value];
      if (!ref) return EMPTY;
      return compact ? ref.title : <Link href={href(`/${ref.module}/${value}`)}>{ref.title}</Link>;
    }
    case 'gstin': return <span className="mono">{value}</span>;
    case 'state': return `${stateName(value)} (${value})`;
    case 'address': {
      const lines = addressLines(value);
      return lines.length ? (compact ? lines.join(', ') : lines.map((l) => <div key={l}>{l}</div>)) : EMPTY;
    }
    case 'items':
      return compact
        ? value.map((l) => l.description).filter(Boolean).join(', ')
        : <div className="stack-sm">{value.map((l, i) => <div key={i} className="row row-between"><span>{l.quantity} × {l.description || refs[l.item]?.title}</span><span className="num muted">{money((l.priceMinor ?? 0) * (l.quantity ?? 1), currency)}</span></div>)}</div>;
    case 'variants':
      return compact ? `${value.length} variants` : <div className="row wrap" style={{ gap: 6 }}>{value.map((v) => <span className="tag" key={v._id ?? v.name}>{v.name} · {money(v.priceMinor, currency)}</span>)}</div>;
    case 'points':
      return compact
        ? <span className="ellipsis" style={{ display: 'inline-block', maxWidth: 260 }}>{value.join(' · ')}</span>
        : <ul className="points-list">{value.map((point, i) => <li key={i}>{point}</li>)}</ul>;
    case 'warranty': {
      const scope = WARRANTY_SCOPES.find((o) => o.value === (value.scope ?? 'parts_labour'))?.label;
      const head = `${value.duration} ${value.unit}${scope ? ` · ${scope}` : ''}`;
      if (compact) return head;
      const points = [...(value.includes ?? []), ...(value.excludes ?? [])];
      return (
        <span>
          {head}{value.transferable ? ' · transferable' : ''}
          {points.length ? ` · ${points.length} ${points.length === 1 ? 'term' : 'terms'}` : ''}
          {value.coverage ? ` — ${value.coverage}` : ''}
        </span>
      );
    }
    case 'longtext':
      return compact ? <span className="ellipsis" style={{ display: 'inline-block', maxWidth: 260 }}>{value}</span> : <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>;
    default: return String(value);
  }
}

export const readField = (field, record) => (field.custom ? record?.custom?.[field.key] : record?.[field.key]);
