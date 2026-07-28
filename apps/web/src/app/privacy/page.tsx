import { Card, CardBody } from '@verity/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy' };

/**
 * Privacy notice (PRD 32, NFR-002).
 *
 * Written to be read rather than agreed to. It says what is collected, what is
 * deliberately not collected, and why — particularly around Gmail, where the
 * natural assumption is that an email extension reads your email.
 */
export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-sm font-semibold tracking-wide text-slate-500">VERITY</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Privacy</h1>
      <p className="mt-3 text-slate-700">
        Verity records that a named person authorized a specific action. Doing that well needs
        surprisingly little information, so we collect surprisingly little.
      </p>

      <Section title="What we never collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Your fingerprint or face.</strong> Your device checks those and tells us only
            that it was satisfied. The biometric data never leaves your device and we have no way to
            ask for it.
          </li>
          <li>
            <strong>Your passkey&apos;s private key.</strong> It is created by your device or
            security key and cannot be extracted. We hold only the public half, which cannot be used
            to impersonate you.
          </li>
          <li>
            <strong>The contents of your email.</strong> The Gmail extension does not read message
            bodies or attachments, and there is no code path that would let it.
          </li>
          <li>
            <strong>Full bank account numbers.</strong> Requests carry the last four digits.
          </li>
          <li>
            <strong>Passwords.</strong> There are none to collect.
          </li>
        </ul>
      </Section>

      <Section title="What the Gmail extension does read">
        <p>When you open the panel on a message, it reads exactly five things:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>the message ID and thread ID Gmail assigns;</li>
          <li>the sender&apos;s email address;</li>
          <li>the subject line;</li>
          <li>the page URL;</li>
          <li>the time it looked.</li>
        </ul>
        <p className="mt-2">
          These are stored with a request so you can find your way back to the message it came from.
          They are context, not evidence: a message claiming to be from your CEO proves nothing,
          which is the reason Verity exists.
        </p>
        <p className="mt-2">
          Nothing is sent anywhere until you fill in a request and submit it. Opening the panel on
          its own transmits nothing.
        </p>
      </Section>

      <Section title="What we store when you use Verity">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your name, email address, and which organizations you belong to.</li>
          <li>
            The details of each request — amounts, recipients, the last four digits of accounts —
            because those are precisely what an approver is confirming.
          </li>
          <li>
            A record of every consequential action: who approved what, when, from which registered
            passkey. These records cannot be edited or deleted by anyone, including us. That is the
            point of them.
          </li>
          <li>
            A keyed, truncated fingerprint of your IP address rather than the address itself. It is
            enough to tell whether two actions came from the same place, and not enough to work
            backwards to where you were.
          </li>
        </ul>
      </Section>

      <Section title="What we do with it">
        <p>
          We use it to run Verity, and for nothing else. We do not sell it, we do not share it with
          advertisers, and we do not use customer request data to train models.
        </p>
        <p className="mt-2">
          Records inside an organization are visible only to that organization&apos;s members, and
          only according to their role. An auditor can read; only an assigned approver can decide.
        </p>
      </Section>

      <Section title="What we cannot do">
        <p>
          Verity does not move money, hold banking credentials, or carry out the actions it records
          approval for. A person reads a receipt and acts elsewhere. If something has already gone
          wrong outside Verity, the record may tell you what was authorized, but it cannot reverse
          anything.
        </p>
      </Section>

      <Card className="mt-8">
        <CardBody className="text-sm text-slate-600">
          <p>
            The full security model, including its known limitations, is documented in the
            repository under <code className="font-mono">docs/SECURITY.md</code> and{' '}
            <code className="font-mono">docs/THREAT_MODEL.md</code>. We would rather you read the
            limitations than take our word for the strengths.
          </p>
        </CardBody>
      </Card>

      <p className="mt-8 text-sm">
        <Link href="/" className="text-sky-700 underline">
          Back to Verity
        </Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-slate-700">{children}</div>
    </section>
  );
}
