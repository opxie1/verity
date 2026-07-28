'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: '/signin' })}
      className="rounded px-2 py-1 text-slate-600 underline hover:text-slate-900"
    >
      Sign out
    </button>
  );
}
