# e2e

End-to-end verification scripts that drive a real browser against the dev server.

## responsive.mjs

Walks every public route at three viewport widths (360 / 800 / 1440), screenshots
each one, and reports any element whose bounding rect extends past the viewport.

### One-time setup

`playwright` is in `devDependencies` so a normal `npm ci` / `npm install`
pulls it in. Browser binaries are downloaded separately:

```sh
npx playwright install --with-deps chromium
```

The `--with-deps` flag installs OS shared libraries (nss, xkb, gbm, drm, etc.)
via apt on Debian/Ubuntu containers, which headless Chromium needs to launch.
Drop it if your environment already has those libraries.

### CI

The repo runs this driver in CI on every push / PR via the `frontend-e2e`
job in `.github/workflows/test.yml`. The job boots the dev server, waits
for it to respond on `localhost:5173`, runs `npm run e2e:responsive`, and
uploads `e2e/shots/` as an artifact on failure so the screenshot that
caught the regression is one click away in the Actions UI.

### Running

In one shell:

```sh
npm run dev
```

In another:

```sh
npm run e2e:responsive
```

Screenshots land in `e2e/shots/`. The script exits 0 when nothing overflows and
no JS errors fire on cold load, non-zero otherwise.

### How the auth bypass works

Most app-shell routes sit behind `ConnectGate`, which renders a wallet-connect
panel when no wallet is attached. To screenshot the actual content, the script
injects `globalThis.__MOCK_WALLET__` via Playwright's `addInitScript` before
page boot. `src/config/wagmi.js` reads that flag in dev builds (and only in dev
builds, since the branch is gated on `import.meta.env.DEV` so it's tree-shaken
out of production output) and prepends the wagmi mock connector with the given
address. A follow-up explicit `connect()` call flips wagmi into the connected
state.

The mock wallet defaults to `0x1111111111111111111111111111111111111111`.
Override with `MOCK_WALLET=0x...`. On-chain reads (USDC balance, escrow lists)
hit the real Arc Testnet RPC against that address, so results will be sparse
unless the mock address actually has on-chain state.

### Why per-element overflow instead of doc.scrollWidth

`src/styles/globals.css` applies `overflow-x: hidden` on `html`/`body`/`#root`,
which clamps the document's `scrollWidth` to the viewport. Real layout
overflows (grid tracks too wide for the container, fixed-width children of
fluid parents) are visually clipped but never reported in `scrollWidth`.
Walking every element with `getBoundingClientRect` catches what scrollWidth
masks. The probe skips elements whose ancestor has `overflow-x: hidden|scroll|auto|clip`
so intentional patterns (the marquee ticker on Home, the scrolling tab strip
on Dashboard) don't show up as false positives.
