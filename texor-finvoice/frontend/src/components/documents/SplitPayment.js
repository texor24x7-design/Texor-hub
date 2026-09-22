'use client';

/**
 * One bill settled in more than one way — half cash, half UPI, the rest on the
 * card machine.
 *
 * Each mode stays its own row here and its own payment on the server. That is
 * deliberate: the cash drawer, the by-mode totals and the customer's statement
 * all read payments by mode, and they stay true without any of them having to
 * learn what a split is. Undoing half a split is just deleting one of them.
 */
import { Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { MoneyInput } from '@/components/fields/MoneyInput';
import { money } from '@/lib/format';

export const receivedOf = (rows) => rows.reduce((sum, row) => sum + (Number(row.amountMinor) || 0), 0);

/** A mode nobody has used yet, so a second row does not repeat the first. */
const nextMode = (modes, rows) => modes.find((m) => !rows.some((r) => r.mode === m)) ?? modes[0] ?? 'Cash';

export function SplitPayment({ rows, onChange, modes, currency, dueMinor }) {
  const received = receivedOf(rows);
  const balance = dueMinor - received;
  const set = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="stack-sm">
      {rows.map((row, index) => (
        // The index is the identity: rows have no ids and are only ever added or
        // removed at the end, so nothing reorders under a typing cursor.
        <div className="row" key={index}>
          <select className="input" style={{ width: 'min(160px, 40%)' }} value={row.mode} onChange={(e) => set(index, { mode: e.target.value })} aria-label={`Mode of payment ${index + 1}`}>
            {[...new Set([...modes, row.mode])].filter(Boolean).map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
          <div className="grow">
            <MoneyInput value={row.amountMinor} currency={currency} onChange={(amountMinor) => set(index, { amountMinor: amountMinor ?? 0 })} aria-label={`Amount paid by ${row.mode}`} />
          </div>
          {rows.length > 1 ? <IconButton size="sm" icon={<X />} label={`Remove the ${row.mode} payment`} onClick={() => onChange(rows.filter((_, i) => i !== index))} /> : null}
        </div>
      ))}

      <div className="row wrap">
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onChange([...rows, { mode: nextMode(modes, rows), amountMinor: Math.max(balance, 0) }])}>
          Add another mode
        </Button>
        <div className="grow" />
        <span className="small">
          <span className="muted">Received</span> <span className="num strong">{money(received, currency)}</span>
          {balance !== 0 ? (
            <>
              {' · '}
              <span className="muted">{balance > 0 ? 'Balance' : 'Over by'}</span>{' '}
              <span className="num strong" style={balance < 0 ? { color: 'var(--danger)' } : undefined}>{money(Math.abs(balance), currency)}</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
