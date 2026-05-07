import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

const variants = {
  default: "bg-zinc-100 text-primary hover:bg-zinc-200",
  primary: "bg-violet-600 text-white hover:bg-violet-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-secondary hover:text-primary hover:bg-surface-hover",
  outline: "border border-strong text-secondary hover:bg-surface-hover",
};

const sizes = {
  xs: "px-2 py-0.5 text-[10px]",
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
  lg: "px-5 py-2.5 text-base",
  icon: "p-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      className = "",
      loading = false,
      icon,
      children,
      disabled,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {!loading && icon}
      {children}
    </button>
  )
);
Button.displayName = "Button";
