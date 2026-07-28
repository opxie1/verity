import * as React from 'react';
import { cn } from './cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'block w-full rounded-md border-0 bg-white px-3 py-2 text-slate-900 shadow-sm',
          'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400',
          'focus:ring-2 focus:ring-inset focus:ring-sky-600',
          'disabled:bg-slate-50 disabled:text-slate-500',
          'aria-[invalid=true]:ring-red-600',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'block w-full rounded-md border-0 bg-white px-3 py-2 text-slate-900 shadow-sm',
        'ring-1 ring-inset ring-slate-300',
        'focus:ring-2 focus:ring-inset focus:ring-sky-600',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'block w-full rounded-md border-0 bg-white px-3 py-2 text-slate-900 shadow-sm',
        'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400',
        'focus:ring-2 focus:ring-inset focus:ring-sky-600',
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-sm font-medium leading-6 text-slate-900', className)}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-slate-500">{children}</p>;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="mt-1">{children}</div>
      {hint ? <Hint>{hint}</Hint> : null}
      <FieldError>{error}</FieldError>
    </div>
  );
}
