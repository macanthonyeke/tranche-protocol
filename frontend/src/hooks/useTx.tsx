import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useWaitForTransactionReceipt } from "wagmi";
import type { Hex } from "viem";
import { decodeError } from "../lib/errors";
import { EXPLORER } from "../lib/config";

interface Options {
  successMessage?: string;
  onSuccess?: () => void;
}

export function useTrackedTx(hash: Hex | undefined, opts: Options = {}) {
  const { successMessage = "Transaction confirmed", onSuccess } = opts;
  const receipt = useWaitForTransactionReceipt({ hash });
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    if (handled.current === hash) return;

    if (receipt.isSuccess) {
      handled.current = hash;
      toast.success(
        (t) => (
          <span>
            {successMessage} ·{" "}
            <a
              href={`${EXPLORER}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
              onClick={() => toast.dismiss(t.id)}
            >
              view tx
            </a>
          </span>
        ),
        { duration: 7000 },
      );
      onSuccess?.();
    } else if (receipt.isError) {
      handled.current = hash;
      toast.error(decodeError(receipt.error));
    }
  }, [hash, receipt.isSuccess, receipt.isError, receipt.error, successMessage, onSuccess]);

  return receipt;
}

export function notifyTxError(err: unknown) {
  toast.error(decodeError(err));
}
