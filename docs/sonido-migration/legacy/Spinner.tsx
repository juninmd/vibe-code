/**
 * The pre-migration busy line: a status dot and a sentence, copied from the conversation
 * (`rw-thinking`) on origin/main.
 */
export default function LegacySpinner({ label }: { label: string }) {
  return (
    <div className="rw-thinking" role="status">
      <span className="rw-status-dot working" />
      {label}
    </div>
  );
}
