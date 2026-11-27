import { type ButtonProps, Button as SonidoButton } from "@juninmd/sonido";

/** The app's own vocabulary for the three weights it used in `workspace.css`. */
export type AppButtonVariant = "primary" | "default" | "subtle" | "danger";

export interface AppButtonProps extends Omit<ButtonProps, "variant" | "size"> {
  variant?: AppButtonVariant;
}

const VARIANT = {
  primary: "primary",
  default: "secondary",
  subtle: "ghost",
  danger: "danger",
} as const;

/**
 * A thin bridge over Sonido's Button: same props as the design system, with the app keeping
 * its names for the three weights (`default`, `subtle`) that were CSS classes before.
 */
export function Button({ variant = "default", ...rest }: AppButtonProps) {
  return <SonidoButton size="sm" variant={VARIANT[variant]} {...rest} />;
}
