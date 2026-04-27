import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = "", ...props }, ref) => (
    <select
      ref={ref}
      className={`w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent ${className}`}
      {...props}
    />
  )
);
Select.displayName = "Select";
