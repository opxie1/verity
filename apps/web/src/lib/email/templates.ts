import 'server-only';
import { ORG_ROLE_LABELS, type OrgRoleValue } from '@verity/schemas';
import { serverEnv } from '../env';
import { sendEmail } from './mailer';

/**
 * Every interpolated value in an email body is escaped. Organization names,
 * email subjects and sender addresses are attacker-controllable in the threat
 * model, so none of them may reach an HTML template raw (PRD section 25).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_STYLE =
  'font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #0f172a;';

function layout(bodyHtml: string): string {
  return `<div style="${BASE_STYLE} max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-weight: 600; letter-spacing: 0.02em; color: #475569; margin: 0 0 24px;">VERITY</p>
  ${bodyHtml}
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
  <p style="font-size: 13px; color: #64748b; margin: 0;">
    Verity confirms that a named person authorized a specific action. It does not move money
    and it does not judge whether an action is a good idea.
  </p>
</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin: 24px 0;">
    <a href="${escapeHtml(href)}"
       style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none;
              padding: 12px 20px; border-radius: 6px; font-weight: 600;">${escapeHtml(label)}</a>
  </p>`;
}

export async function sendMagicLinkEmail(params: { to: string; url: string }): Promise<void> {
  const text = [
    'Sign in to Verity',
    '',
    'Open this link to sign in. It works once and expires in 15 minutes.',
    '',
    params.url,
    '',
    'If you did not ask to sign in, you can ignore this message.',
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: 'Sign in to Verity',
    text,
    html: layout(
      `<h1 style="font-size: 20px; margin: 0 0 12px;">Sign in to Verity</h1>
       <p style="margin: 0;">This link works once and expires in 15 minutes.</p>
       ${button(params.url, 'Sign in')}
       <p style="font-size: 13px; color: #64748b; margin: 0;">
         If you did not ask to sign in, you can ignore this message.
       </p>`,
    ),
  });
}

/**
 * Tells an approver a decision is waiting (PRD FR-009).
 *
 * Carries the action type, a one-line summary and the deadline, but not the
 * protected fields: those belong on the approval page, loaded from the server,
 * where they cannot have been rewritten in transit. Opening this email is not
 * how anyone approves anything — that still needs the passkey (PRD 18.2).
 */
export async function sendApprovalRequestEmail(params: {
  to: string;
  approverName: string | null;
  requesterName: string;
  organizationName: string;
  actionTypeLabel: string;
  summary: string;
  requestId: string;
  expiresAt: Date;
}): Promise<void> {
  const url = `${serverEnv.NEXT_PUBLIC_APP_URL}/approve/${encodeURIComponent(params.requestId)}`;
  const expires = params.expiresAt.toUTCString();

  const text = [
    `${params.requesterName} at ${params.organizationName} is asking you to confirm an action.`,
    '',
    `Type: ${params.actionTypeLabel}`,
    `Summary: ${params.summary}`,
    `Expires: ${expires}`,
    '',
    'Review the exact details and decide:',
    url,
    '',
    'You will be asked for your passkey. Nobody can approve this on your behalf,',
    'and reading this email is not enough to approve it.',
    '',
    'If you did not expect this request, deny it and speak to your colleague',
    'through a channel you already trust.',
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: `Approval needed: ${params.actionTypeLabel} at ${params.organizationName}`,
    text,
    html: layout(
      `<h1 style="font-size: 20px; margin: 0 0 12px;">A decision is waiting for you</h1>
       <p style="margin: 0 0 12px;">
         ${escapeHtml(params.requesterName)} at ${escapeHtml(params.organizationName)} is asking
         you to confirm a <strong>${escapeHtml(params.actionTypeLabel)}</strong>.
       </p>
       <p style="margin: 0 0 12px; padding: 12px; background: #f8fafc; border-radius: 6px;">
         ${escapeHtml(params.summary)}
       </p>
       <p style="margin: 0;">Expires ${escapeHtml(expires)}.</p>
       ${button(url, 'Review and decide')}
       <p style="font-size: 13px; color: #64748b; margin: 0;">
         You will be asked for your passkey. Nobody can approve this on your behalf, and reading
         this email is not enough to approve it. If you did not expect this request, deny it and
         speak to your colleague through a channel you already trust.
       </p>`,
    ),
  });
}

/** Tells the requester what the approver decided (PRD 14.4 step 8). */
export async function sendDecisionNotificationEmail(params: {
  to: string;
  requesterName: string | null;
  organizationName: string;
  approverName: string;
  requestTitle: string;
  requestId: string;
  decision: 'APPROVED' | 'DENIED';
  reason: string | null;
}): Promise<void> {
  const url = `${serverEnv.NEXT_PUBLIC_APP_URL}/r/${encodeURIComponent(params.requestId)}`;
  const verb = params.decision === 'APPROVED' ? 'approved' : 'denied';

  const text = [
    `${params.approverName} ${verb} your request.`,
    '',
    params.requestTitle,
    ...(params.reason ? ['', `Reason given: ${params.reason}`] : []),
    '',
    'See the signed receipt:',
    url,
    ...(params.decision === 'APPROVED'
      ? [
          '',
          'Before you act, check that the details you are about to use match the receipt exactly.',
          'An approval covers the details shown on it and nothing else.',
        ]
      : []),
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: `${params.approverName} ${verb} your request`,
    text,
    html: layout(
      `<h1 style="font-size: 20px; margin: 0 0 12px;">
         ${escapeHtml(params.approverName)} ${verb} your request
       </h1>
       <p style="margin: 0 0 12px; padding: 12px; background: #f8fafc; border-radius: 6px;">
         ${escapeHtml(params.requestTitle)}
       </p>
       ${params.reason ? `<p style="margin: 0 0 12px;">Reason given: ${escapeHtml(params.reason)}</p>` : ''}
       ${button(url, 'View the receipt')}
       ${
         params.decision === 'APPROVED'
           ? `<p style="font-size: 13px; color: #64748b; margin: 0;">
                Before you act, check that the details you are about to use match the receipt
                exactly. An approval covers the details shown on it and nothing else.
              </p>`
           : ''
       }`,
    ),
  });
}

/** Warns everyone concerned that an approval has been withdrawn (PRD FR-018). */
export async function sendRevocationNotificationEmail(params: {
  to: string;
  organizationName: string;
  revokedByName: string;
  requestTitle: string;
  requestId: string;
  reason: string;
}): Promise<void> {
  const url = `${serverEnv.NEXT_PUBLIC_APP_URL}/r/${encodeURIComponent(params.requestId)}`;

  const text = [
    `${params.revokedByName} has revoked an approval at ${params.organizationName}.`,
    '',
    params.requestTitle,
    '',
    `Reason: ${params.reason}`,
    '',
    'If anyone is about to act on this approval, stop them.',
    '',
    url,
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: `Approval revoked: ${params.requestTitle}`,
    text,
    html: layout(
      `<h1 style="font-size: 20px; margin: 0 0 12px;">An approval has been revoked</h1>
       <p style="margin: 0 0 12px;">
         ${escapeHtml(params.revokedByName)} withdrew an approval at
         ${escapeHtml(params.organizationName)}.
       </p>
       <p style="margin: 0 0 12px; padding: 12px; background: #fef2f2; border-radius: 6px;">
         ${escapeHtml(params.requestTitle)}
       </p>
       <p style="margin: 0 0 12px;">Reason: ${escapeHtml(params.reason)}</p>
       <p style="margin: 0; font-weight: 600;">
         If anyone is about to act on this approval, stop them.
       </p>
       ${button(url, 'Open the request')}`,
    ),
  });
}

export async function sendInvitationEmail(params: {
  to: string;
  token: string;
  organizationName: string;
  role: OrgRoleValue;
  invitedByName: string;
  expiresAt: Date;
}): Promise<void> {
  const url = `${serverEnv.NEXT_PUBLIC_APP_URL}/invite/${encodeURIComponent(params.token)}`;
  const roleLabel = ORG_ROLE_LABELS[params.role];
  const expires = params.expiresAt.toUTCString();

  const text = [
    `${params.invitedByName} invited you to join ${params.organizationName} on Verity.`,
    '',
    `Your role: ${roleLabel}`,
    '',
    'Verity is where your organization confirms high-risk requests, such as payments and',
    'bank-account changes, before anyone acts on them.',
    '',
    'Accept the invitation:',
    url,
    '',
    `This invitation expires on ${expires} and can only be used once.`,
    `It only works when you are signed in as ${params.to}.`,
  ].join('\n');

  await sendEmail({
    to: params.to,
    subject: `Join ${params.organizationName} on Verity`,
    text,
    html: layout(
      `<h1 style="font-size: 20px; margin: 0 0 12px;">
         Join ${escapeHtml(params.organizationName)} on Verity
       </h1>
       <p style="margin: 0 0 12px;">
         ${escapeHtml(params.invitedByName)} invited you to join as
         <strong>${escapeHtml(roleLabel)}</strong>.
       </p>
       <p style="margin: 0;">
         Verity is where your organization confirms high-risk requests, such as payments and
         bank-account changes, before anyone acts on them.
       </p>
       ${button(url, 'Accept invitation')}
       <p style="font-size: 13px; color: #64748b; margin: 0;">
         This invitation expires on ${escapeHtml(expires)} and can only be used once.
         It only works when you are signed in as ${escapeHtml(params.to)}.
       </p>`,
    ),
  });
}
