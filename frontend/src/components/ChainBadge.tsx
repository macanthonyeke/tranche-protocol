import { chainForDomain, type ChainOption } from "../lib/config";

interface Props {
  domain: number;
  size?: "sm" | "md";
  showName?: boolean;
}

export function ChainBadge({ domain, size = "md", showName = true }: Props) {
  const chain = chainForDomain(domain);
  return (
    <span className="inline-flex items-center gap-2">
      <ChainIcon chain={chain} size={size} />
      {showName && (
        <span className="text-fg font-medium">{chain.name}</span>
      )}
    </span>
  );
}

export function ChainIcon({
  chain,
  size = "md",
}: {
  chain: ChainOption;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? 18 : 22;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-mono font-semibold tracking-tight"
      style={{
        width: px,
        height: px,
        background: `${chain.color}22`,
        color: chain.color,
        border: `1px solid ${chain.color}55`,
        fontSize: size === "sm" ? 8 : 9,
      }}
    >
      {chain.logo}
    </span>
  );
}
