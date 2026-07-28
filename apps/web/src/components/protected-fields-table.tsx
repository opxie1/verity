import { formatFieldValue, type CanonicalObject, type CanonicalValue } from '@verity/domain';
import { FIELD_LABELS, HIGH_RISK_FIELDS } from '@verity/schemas';

/**
 * The protected fields, in full (PRD 23.3: "Do not bury the protected fields").
 *
 * Every field that was hashed is shown. Nothing is collapsed behind a
 * disclosure control, because an approver who does not read a field has not
 * meaningfully approved it.
 */
export function ProtectedFieldsTable({
  payload,
  emphasiseHighRisk = true,
}: {
  payload: CanonicalObject;
  emphasiseHighRisk?: boolean;
}) {
  const entries = Object.entries(payload).filter(([, value]) => value !== null);

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Details being approved</caption>
      <tbody>
        {entries.map(([field, value]) => {
          const highRisk = emphasiseHighRisk && HIGH_RISK_FIELDS.has(field);
          return (
            <tr key={field} className="border-b border-slate-100 last:border-0">
              <th
                scope="row"
                className="w-2/5 py-2 pr-4 text-left align-top font-medium text-slate-600"
              >
                {FIELD_LABELS[field] ?? field}
              </th>
              <td
                className={
                  highRisk
                    ? 'py-2 align-top font-semibold text-slate-900'
                    : 'py-2 align-top text-slate-900'
                }
              >
                {formatFieldValue(field, value as CanonicalValue, payload)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
