import * as React from 'react';

/**
 * A handful of primitives, written locally rather than shared with the web
 * application. The panel is a different surface with a much narrower job, and
 * pulling the whole design system into an extension bundle for four components
 * would cost more than it saves.
 */

function cx(...values: (string | false | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
    secondary:
      'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  } as const;

  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
        'disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

const TONES = {
  info: 'bg-sky-50 text-sky-900 ring-sky-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-900 ring-red-200',
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
} as const;

export function Banner({
  tone = 'info',
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cx('rounded-md px-3 py-2 text-xs ring-1 ring-inset', TONES[tone], className)}
    >
      {children}
    </div>
  );
}

/** Status is carried by a glyph and a word, not by colour alone (NFR-005). */
const STATUS_STYLES = {
  DRAFT: { className: 'bg-slate-100 text-slate-800 ring-slate-300', glyph: '•', label: 'Draft' },
  PENDING: {
    className: 'bg-amber-100 text-amber-900 ring-amber-300',
    glyph: '◔',
    label: 'Pending approval',
  },
  APPROVED: {
    className: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
    glyph: '✓',
    label: 'Approved',
  },
  DENIED: { className: 'bg-red-100 text-red-900 ring-red-300', glyph: '✕', label: 'Denied' },
  EXPIRED: { className: 'bg-slate-100 text-slate-700 ring-slate-300', glyph: '⌛', label: 'Expired' },
  CANCELED: {
    className: 'bg-slate-100 text-slate-700 ring-slate-300',
    glyph: '⌫',
    label: 'Canceled',
  },
  REVOKED: { className: 'bg-red-100 text-red-900 ring-red-300', glyph: '⊘', label: 'Revoked' },
} as const;

export function StatusPill({ status }: { status: keyof typeof STATUS_STYLES }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        style.className,
      )}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="text-sm text-slate-600" role="status">
      {label}…
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-900">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-[11px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'block w-full rounded-md border-0 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm ' +
  'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 ' +
  'focus:ring-2 focus:ring-inset focus:ring-sky-600';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL_CLASS, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL_CLASS, props.className)} />;
}
