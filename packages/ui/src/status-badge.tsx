import * as React from 'react';
import { cn } from './cn';

/**
 * Status is carried by an icon glyph and a word as well as by colour, so it
 * remains legible without colour perception (PRD NFR-005).
 */
type Tone = 'neutral' | 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';

const TONES: Record<Tone, { className: string; glyph: string }> = {
  neutral: { className: 'bg-slate-100 text-slate-800 ring-slate-300', glyph: '•' },
  pending: { className: 'bg-amber-100 text-amber-900 ring-amber-300', glyph: '◔' },
  approved: { className: 'bg-emerald-100 text-emerald-900 ring-emerald-300', glyph: '✓' },
  denied: { className: 'bg-red-100 text-red-900 ring-red-300', glyph: '✕' },
  expired: { className: 'bg-slate-100 text-slate-700 ring-slate-300', glyph: '⌛' },
  revoked: { className: 'bg-red-100 text-red-900 ring-red-300', glyph: '⊘' },
};

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const { className: toneClass, glyph } = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClass,
        className,
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
        className,
      )}
    >
      {children}
    </span>
  );
}
