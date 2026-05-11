import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chainForDomain, type ChainOption } from "../lib/config";
import { ChainIcon } from "./ChainBadge";
import { useSupportedDomains } from "../hooks/useSupportedDomains";

interface Props {
  value: number;
  onChange: (domain: number) => void;
  /** Override the domain list (e.g. for admin panels that need the full catalog). */
  domains?: ChainOption[];
}

export function ChainSelect({ value, onChange, domains: domainsProp }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = chainForDomain(value);

  const { domains: liveDomains, isLoading } = useSupportedDomains();
  const domains = domainsProp ?? liveDomains;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between text-left"
        disabled={isLoading && !domainsProp}
      >
        <span className="flex items-center gap-2.5">
          <ChainIcon chain={current} size="sm" />
          <span className="text-fg-strong">{current.name}</span>
        </span>
        {isLoading && !domainsProp ? (
          <span className="text-xs text-muted animate-pulse">Loading…</span>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 mt-2 popover-surface z-30 p-1.5 max-h-72 overflow-y-auto"
          >
            {domains.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-soft text-center">
                No supported chains configured
              </div>
            ) : (
              domains.map((c) => {
                const isSelected = c.id === value;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected
                        ? "bg-accent/10 text-accent"
                        : "text-fg hover:bg-surface/70"
                    }`}
                  >
                    <ChainIcon chain={c} size="sm" />
                    <span className="flex-1">{c.name}</span>
                    {isSelected && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
