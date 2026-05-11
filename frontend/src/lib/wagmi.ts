import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arcTestnet } from "viem/chains";
import { http } from "wagmi";

export const wagmiConfig = getDefaultConfig({
  appName: "CrossChainEscrow",
  // Public WalletConnect Cloud project ID. Set VITE_WC_PROJECT_ID to override.
  projectId:
    import.meta.env.VITE_WC_PROJECT_ID ?? "8a1d44a26e90df25cf7a2c9fa929b1f0",
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
  ssr: false,
});

export const ACTIVE_CHAIN = arcTestnet;
