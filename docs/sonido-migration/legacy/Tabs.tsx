/**
 * The pre-migration settings switch, copied from `SettingsPage` in
 * `packages/web/src/features/remote-workspace/ManagementViews.tsx` on origin/main.
 */
export default function LegacyTabs({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <nav className="rw-settings-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.key}
          className={value === tab.key ? "selected" : ""}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
