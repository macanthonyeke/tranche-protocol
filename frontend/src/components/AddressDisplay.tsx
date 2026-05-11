import { CopyButton } from "./CopyButton";
import { shortAddress } from "../lib/format";

export function AddressDisplay({
  address,
  className = "",
  withCopy = true,
}: {
  address: string | undefined;
  className?: string;
  withCopy?: boolean;
}) {
  if (!address) return <span className="text-muted">Not set</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}>
      <span>{shortAddress(address)}</span>
      {withCopy && <CopyButton value={address} label="address" />}
    </span>
  );
}
