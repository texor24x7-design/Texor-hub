'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { FieldInput, WIDE_TYPES } from '@/components/fields/FieldInput';
import { stateFromGstin } from '@/lib/shared/india.mjs';
import { useWorkspace } from '@/lib/workspace';

const readValue = (field, values) => (field.custom ? values.custom?.[field.key] : values[field.key]);

function initialValues(module, record) {
  const values = { custom: { ...(record?.custom ?? {}) } };
  for (const field of module.fields) {
    const bag = field.custom ? values.custom : values;
    if (record) {
      if (!field.custom) bag[field.key] = record[field.key];
    } else if (field.default !== undefined) {
      bag[field.key] = field.default;
    }
  }
  return values;
}

/**
 * A form for any record module, laid out from its fields: grouped by section,
 * in the order the workspace arranged them, skipping what is hidden for the
 * workspace or for this person's role.
 */
export function RecordForm({ module, record, refs, onSubmit, onCancel, submitLabel = 'Save', extra, extraValues }) {
  const { hidden } = useWorkspace();
  const [values, setValues] = useState(() => initialValues(module, record));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const roleHidden = hidden(module.key);

  const sections = useMemo(() => {
    const groups = new Map();
    for (const field of module.fields) {
      if (field.hidden || roleHidden.includes(field.key) || field.readOnly) continue;
      const name = field.section || 'Details';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(field);
    }
    return [...groups.entries()];
  }, [module, roleHidden]);

  const set = (field) => (value) => {
    setValues((prev) => {
      const next = field.custom ? { ...prev, custom: { ...prev.custom, [field.key]: value } } : { ...prev, [field.key]: value };
      // A valid GSTIN tells us the state, so fill place of supply if it is empty.
      if (field.type === 'gstin' && value?.length === 15 && !prev.stateCode && module.fields.some((f) => f.key === 'stateCode')) {
        const state = stateFromGstin(value);
        if (state) next.stateCode = state;
      }
      return next;
    });
    const path = field.custom ? `custom.${field.key}` : field.key;
    if (errors[path]) setErrors((prev) => ({ ...prev, [path]: undefined }));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...values, ...(extraValues ?? {}) });
    } catch (submitError) {
      setError(submitError.message);
      setErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      {error && !Object.keys(errors).length ? <Alert kind="error">{error}</Alert> : null}
      {error && Object.keys(errors).length ? <Alert kind="error" title={error}>{Object.values(errors).filter(Boolean).slice(0, 3).join(' ')}</Alert> : null}

      {sections.map(([name, fields]) => (
        <section className="card" key={name}>
          <div className="card-header"><h2>{name}</h2></div>
          <div className="card-body fields-grid">
            {fields.map((field) => {
              const path = field.custom ? `custom.${field.key}` : field.key;
              const id = `f-${module.key}-${field.key}`;
              const checkboxInline = field.type === 'checkbox' && !field.help;
              return (
                <Field
                  key={field.key}
                  className={WIDE_TYPES.has(field.type) ? 'full' : ''}
                  label={checkboxInline ? undefined : field.label}
                  required={field.required && field.type !== 'checkbox'}
                  hint={field.help}
                  error={errors[path]}
                  htmlFor={id}
                >
                  <FieldInput field={field} moduleKey={module.key} value={readValue(field, values)} onChange={set(field)} error={errors[path]} id={id} refs={refs} />
                </Field>
              );
            })}
          </div>
        </section>
      ))}

      {extra}

      <div className="row row-end" style={{ position: 'sticky', bottom: 0, padding: '0.75rem 0', background: 'linear-gradient(to top, var(--bg) 70%, transparent)' }}>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
