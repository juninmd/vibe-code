import { type ButtonHTMLAttributes, forwardRef } from "react";

const variants = {
  default: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
  primary: "bg-violet-600 text-white hover:bg-violet-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
  outline: "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
};

const sizes = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
  lg: "px-5 py-2.5 text-base",
  icon: "p-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";
