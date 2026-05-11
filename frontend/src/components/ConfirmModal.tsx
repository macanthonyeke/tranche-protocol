import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "warn" | "danger" | "gold";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Yes, continue",
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
  busy,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  const btnClass =
    tone === "danger"
      ? "btn btn-danger"
      : tone === "warn"
        ? "btn btn-warn"
        : tone === "gold"
          ? "btn btn-gold"
          : "btn btn-primary";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 backdrop-blur-md"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={busy ? undefined : onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="popover-surface relative w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cm-title"
          >
            <div
              id="cm-title"
              className="font-display text-lg text-fg-strong mb-3"
            >
              {title}
            </div>
            <div className="text-sm text-muted-soft mb-6">{body}</div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="btn btn-ghost"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={btnClass}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
