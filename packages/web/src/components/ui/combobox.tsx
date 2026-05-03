import { useEffect, useRef, useState } from "react";

interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  inputId?: string;
  className?: string;
  inputClassName?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search...",
  required,
  inputId,
  className,
  inputClassName,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    // Use timeout to avoid the click that opened the dropdown from closing it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setSearch("");
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSearch("");
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div
        className={`flex items-center w-full rounded-md border text-sm transition-colors ${
          open ? "border-violet-500 ring-2 ring-violet-500/20" : "border-strong"
        } ${className?.includes("border-none") ? "!border-none !ring-0" : ""} ${className?.includes("bg-transparent") ? "bg-transparent" : "bg-surface"}`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={open ? search : (selectedOption?.label ?? "")}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          required={required && !value}
          className={`flex-1 bg-transparent px-3 py-2 text-primary placeholder:text-primary0 focus:outline-none ${inputClassName ?? ""}`}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-primary0 hover:text-secondary cursor-pointer"
          >
            &#x2715;
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false);
              setSearch("");
            } else {
              setOpen(true);
              setSearch("");
              inputRef.current?.focus();
            }
          }}
          className="px-2 text-primary0 hover:text-secondary cursor-pointer"
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-[100] mt-1 w-full rounded-md border border-strong bg-surface shadow-xl overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-primary0">
                No repositories found
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (option.disabled) return;
                    handleSelect(option.value);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer flex items-center justify-between ${
                    option.disabled
                      ? "text-primary0 cursor-not-allowed bg-surface/80"
                      : option.value === value
                        ? "bg-accent-muted text-accent-text"
                        : "text-secondary hover:bg-surface-hover"
                  }`}
                  disabled={option.disabled}
                >
                  <span>{option.label}</span>
                  {option.sublabel && (
                    <span className="text-xs text-primary0 ml-2">{option.sublabel}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
