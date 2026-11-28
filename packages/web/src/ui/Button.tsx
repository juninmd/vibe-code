import { type ButtonProps, Button as SonidoButton } from "@juninmd/sonido";

/** The app's own vocabulary for the weights it used in `workspace.css`. */
export type AppButtonVariant = "primary" | "default" | "subtle" | "danger";

export interface AppButtonProps extends Omit<ButtonProps, "variant" | "size" | "appearance"> {
  variant?: AppButtonVariant;
}

const VARIANT = {
  primary: "primary",
  default: "secondary",
  subtle: "ghost",
  danger: "danger",
} as const;

/**
 * The workspace's compact outlined button, now Sonido's `appearance="outline" size="xs"`.
 * The app keeps only its names for the three weights (`default`, `subtle`) that were CSS classes.
 */
export function Button({ variant = "default", ...rest }: AppButtonProps) {
  return <SonidoButton appearance="outline" size="xs" variant={VARIANT[variant]} {...rest} />;
}
