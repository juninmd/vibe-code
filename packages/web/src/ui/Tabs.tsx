import { Tabs as SonidoTabs } from "@juninmd/sonido";

export interface AppTab {
  key: string;
  label: string;
}

/**
 * The segmented switch inside a management page. Sonido owns the tablist, the arrow keys and
 * the ARIA; the app only names the sections.
 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  label: string;
  tabs: AppTab[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <SonidoTabs
      label={label}
      variant="pill"
      items={tabs}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}
