import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm text-primary placeholder:text-primary0 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent ${className}`}
      {...props}
    />
  )
);
Input.displayName = "Input";
