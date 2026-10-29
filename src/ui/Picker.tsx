import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Chevron } from './Icons';

export interface PickerOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/// A field that opens a menu of choices, in place of the browser's own
/// select box: the phone's pickers, with icons, on the card colour. Arrow
/// keys move, Enter picks, Escape closes.
export function Picker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    list.current?.focus();
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, options, value]);

  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };

  return (
    <div className={open ? 'picker open' : 'picker'} ref={root}>
      <span className="picker-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {current.icon && <span className="picker-icon">{current.icon}</span>}
        <span id={`${id}-value`} className="picker-value">
          {current.label}
        </span>
        <Chevron size={14} className="picker-chevron" />
      </button>
      {open && (
        <ul
          ref={list}
          className="picker-menu"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            else if (e.key === 'Enter' || e.key === ' ') pick(active);
            else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'picker-option active' : 'picker-option'}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              {o.icon && <span className="picker-icon">{o.icon}</span>}
              <span className="picker-value">{o.label}</span>
              {o.value === value && <Check size={16} className="acc-ink push" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
