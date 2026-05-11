import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  content: string;
}

/// Small "i" badge that opens a popover on hover (desktop) or tap (mobile).
/// Used inline next to every input/select label across the app.
export function InfoTooltip({ content }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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
    <span
      ref={ref}
      className="relative inline-flex items-center align-middle ml-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-3.5 h-3.5 rounded-full bg-surface/70 text-muted-soft hover:bg-surface text-[10px] leading-none flex items-center justify-center select-none focus:outline-none focus:ring-1 focus:ring-accent"
      >
        i
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            role="tooltip"
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[260px] max-w-[80vw] rounded-lg border border-line bg-surface shadow-lg p-2.5 text-xs text-fg leading-snug z-50 pointer-events-none whitespace-normal"
            style={{ fontFamily: "Satoshi, system-ui, sans-serif", fontSize: 12 }}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/// Convenience: <LabelWithTip>Label here</LabelWithTip>
export function LabelWithTip({
  children,
  tooltip,
  className = "",
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
}) {
  return (
    <label className={`label flex items-center ${className}`}>
      <span>{children}</span>
      <InfoTooltip content={tooltip} />
    </label>
  );
}
