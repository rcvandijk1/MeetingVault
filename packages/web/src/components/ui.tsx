import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Card({ title, actions, children, className = '', testId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`card ${className}`} data-testid={testId}>
      {(title || actions) && (
        <div className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="stat" data-testid={testId}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step, hint, testId }: { label: string; value: number | null; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string; testId?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" value={value ?? ''} min={min} max={max} step={step ?? 1} data-testid={testId} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </Field>
  );
}

export function TextField({ label, value, onChange, type = 'text', hint, testId, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; testId?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type={type} value={value} placeholder={placeholder} data-testid={testId} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, testId }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; testId?: string }) {
  return (
    <Field label={label}>
      <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} data-testid={testId} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Chips<T extends string>({ options, selected, onToggle, labels }: { options: T[]; selected: T[]; onToggle: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} type="button" className={`chip ${selected.includes(o) ? 'on' : ''}`} data-testid={`chip-${o}`} onClick={() => onToggle(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className="overlay center" onClick={onClose}>
      <div className="modal" data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <div className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <div className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          <button className="btn ghost sm" onClick={onClose} aria-label="Close" data-testid="drawer-close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: Array<{ key: T; label: string }>; active: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} type="button" className={`tab ${active === t.key ? 'active' : ''}`} data-testid={`tab-${t.key}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row muted" style={{ padding: 20 }}>
      <span className="spinner" /> {label}
    </div>
  );
}
