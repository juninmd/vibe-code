import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The pre-migration button: a plain `<button>` with the `.rw-button` classes from
 * `packages/web/src/features/remote-workspace/workspace.css` on origin/main.
 */
export default function LegacyButton({
  variant = "default",
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "subtle";
  icon?: ReactNode;
}) {
  const weight = variant === "default" ? "" : variant;
  return (
    <button type="button" className={`rw-button ${weight}`.trim()} {...rest}>
      {icon}
      {children}
    </button>
  );
}
