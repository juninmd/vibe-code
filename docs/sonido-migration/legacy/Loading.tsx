/**
 * The pre-migration loading state: a single `role="status"` sentence. The app had no
 * placeholder; this is the markup the slow lists rendered on origin/main.
 */
export default function LegacyLoading({ label }: { label: string }) {
  return (
    <p role="status" className="rw-inline-state">
      {label}
    </p>
  );
}
