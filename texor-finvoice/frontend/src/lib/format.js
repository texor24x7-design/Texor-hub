import { formatMoney, fromMinor, toMinor } from './shared/money.mjs';
import { stateName } from './shared/india.mjs';

export { formatMoney, fromMinor, toMinor, stateName };

export const money = (minor, currency = 'INR') => formatMoney(minor ?? 0, currency);

export function date(value, options = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...options }).format(new Date(value));
}

export function dateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function relative(value) {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return date(value);
}

/** "2026-09-17" for an <input type=date>, in local time. */
export const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const toDateTimeInput = (value) => (value ? `${toDateInput(value)}T${String(new Date(value).getHours()).padStart(2, '0')}:${String(new Date(value).getMinutes()).padStart(2, '0')}` : '');

export const initials = (name = '') => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

export function addressLines(address = {}) {
  return [address.line1, address.line2, [address.city, stateName(address.stateCode), address.pincode].filter(Boolean).join(', ')].filter(Boolean);
}

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
