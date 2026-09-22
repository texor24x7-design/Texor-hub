'use client';

import { useEffect, useState } from 'react';
import { exponent, fromMinor, toMinor } from '@/lib/shared/money.mjs';

/**
 * Typed in rupees, emitted in paise. Keeps the raw text while focused so
 * "12." does not snap to "12" mid-keystroke.
 */
export function MoneyInput({ value, onChange, currency = 'INR', id, invalid, placeholder = '0.00', size, autoFocus, onBlur, 'aria-label': ariaLabel }) {
  const format = (minor) => (minor == null ? '' : fromMinor(minor, currency).toFixed(exponent(currency)));
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => { if (!focused) setText(format(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const symbol = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;

  return (
    <div className="input-group">
      <span className={`addon${size === 'sm' ? ' input-sm' : ''}`} style={size === 'sm' ? { height: 32 } : undefined}>{symbol}</span>
      <input
        id={id}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={`input num${size === 'sm' ? ' input-sm' : ''}${invalid ? ' invalid' : ''}`}
        style={{ textAlign: 'right', ...(size === 'sm' ? { height: 32 } : {}) }}
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setText(format(toMinor(text, currency))); onBlur?.(); }}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,]/g, '');
          setText(next);
          onChange(toMinor(next, currency));
        }}
      />
    </div>
  );
}
