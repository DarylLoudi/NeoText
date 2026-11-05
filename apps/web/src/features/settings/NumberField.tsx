import { useEffect, useState } from 'react';
import { TextField } from '../../ui';
import { type NumberRule, parseNumber, toText } from './numbers';

export interface NumberFieldProps extends NumberRule {
  label: string;
  /** Null means "not set": the box is empty. */
  value: number | null;
  /** Called with a valid number, or null when the box is emptied. */
  onCommit: (value: number | null) => void;
  error: string;
  hint?: string;
  /** The setting must have a value: an emptied box goes back to the saved one. */
  required?: boolean;
  placeholder?: string;
  step?: number;
}

/** A number saved when you leave the box or press Enter, so half-typed numbers are never sent. */
export function NumberField({
  label,
  value,
  onCommit,
  error,
  hint,
  required = false,
  placeholder,
  step,
  min,
  max,
  integer,
  aboveMin,
}: NumberFieldProps) {
  const [text, setText] = useState(toText(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(toText(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseNumber(text, { min, max, integer, aboveMin });
    if (required && parsed.ok && parsed.value === null) {
      setText(toText(value));
      setInvalid(false);
      return;
    }
    setInvalid(!parsed.ok);
    if (parsed.ok && parsed.value !== value) onCommit(parsed.value);
  };

  return (
    <TextField
      label={label}
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? (integer ? 1 : 'any')}
      {...(placeholder ? { placeholder } : {})}
      {...(hint ? { hint } : {})}
      {...(invalid ? { error } : {})}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
