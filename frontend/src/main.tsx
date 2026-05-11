import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import "./index.css";
import { wagmiConfig } from "./lib/wagmi";
import { App } from "./App";
import { ThemeProvider, useTheme } from "./lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
});

const rkDark = darkTheme({
  accentColor: "#00e5ff",
  accentColorForeground: "#04121a",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

const rkLight = lightTheme({
  accentColor: "#0d9488",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

function ThemedRainbowKit({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <RainbowKitProvider
      theme={theme === "dark" ? rkDark : rkLight}
      modalSize="compact"
    >
      {children}
    </RainbowKitProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ThemedRainbowKit>
            <BrowserRouter>
              <App />
            </BrowserRouter>
            <Toaster
              position="top-right"
              toastOptions={{
                className: "popover-surface",
                style: {
                  fontFamily: "Satoshi, system-ui, sans-serif",
                  fontSize: "14px",
                  padding: "12px 14px",
                },
              }}
            />
          </ThemedRainbowKit>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  </StrictMode>,
);
