import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { CopyButton } from "./CopyButton";
import { shortAddress } from "../lib/format";

export function WalletButton({ tone = "cyan" }: { tone?: "cyan" | "gold" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const ringClass =
    tone === "gold"
      ? "from-gold via-gold-soft to-gold"
      : "from-accent via-accent-soft to-accent";

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div ref={ref} className="relative" style={{ opacity: ready ? 1 : 0 }}>
            {!connected ? (
              <button
                onClick={openConnectModal}
                className="relative group rounded-full p-[1.5px]"
              >
                <span
                  className={`absolute inset-0 rounded-full bg-gradient-to-r ${ringClass} opacity-90 group-hover:opacity-100 transition-opacity`}
                />
                <span className="relative flex items-center gap-2 px-5 py-2.5 rounded-full bg-bg text-sm font-medium text-fg-strong">
                  <span className="w-2 h-2 rounded-full bg-bad/80" />
                  Connect Wallet
                </span>
              </button>
            ) : chain.unsupported ? (
              <button onClick={openChainModal} className="btn btn-warn">
                Wrong network
              </button>
            ) : (
              <>
                <button
                  onClick={() => setOpen((o) => !o)}
                  className="relative group rounded-full p-[1.5px]"
                >
                  <span
                    className={`absolute inset-0 rounded-full bg-gradient-to-r ${ringClass} opacity-70 group-hover:opacity-100 transition-opacity`}
                  />
                  <span className="relative flex items-center gap-2.5 px-4 py-2 rounded-full bg-bg text-sm">
                    <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
                    <span className="font-mono text-fg-strong">
                      {shortAddress(account.address)}
                    </span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>

                <AnimatePresence>
                  {open && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-[320px] popover-surface p-4 z-50"
                    >
                      <div className="text-xs uppercase tracking-widest text-muted mb-2">
                        Connected wallet
                      </div>
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <span className="font-mono text-sm text-fg-strong break-all">
                          {account.address}
                        </span>
                        <CopyButton value={account.address ?? ""} label="address" />
                      </div>
                      <div className="text-xs text-muted-soft mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                        <span>
                          Network:{" "}
                          <span className="text-fg-strong">{chain.name}</span>
                        </span>
                      </div>
                      <div className="divider-soft mb-3" />
                      <button
                        onClick={() => {
                          disconnect();
                          // Clear cached connector so the next "Connect" reopens
                          // the wallet picker rather than auto-reconnecting.
                          try {
                            localStorage.removeItem("wagmi.recentConnectorId");
                            localStorage.removeItem("wagmi.store");
                            for (const k of Object.keys(localStorage)) {
                              if (k.startsWith("wagmi.")) localStorage.removeItem(k);
                            }
                          } catch {
                            /* ignore */
                          }
                          setOpen(false);
                          toast.success("Wallet disconnected");
                        }}
                        className="w-full btn btn-danger"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        Disconnect
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
