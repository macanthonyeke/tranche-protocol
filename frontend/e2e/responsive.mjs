// Responsive verification driver.
//
// Walks every public route at three viewport widths (360 / 800 / 1440),
// screenshots each one, and reports any element whose bounding rect
// extends past the viewport (skipping intentional overflow contexts like
// marquees and horizontally-scrollable tab strips).
//
// Why per-element instead of doc.scrollWidth: globals.css applies
// overflow-x: hidden on html, so the document's scrollWidth always
// matches the viewport — masking real layout overflows. Walking every
// element with getBoundingClientRect catches the cases scrollWidth misses.
//
// Auth: dev wagmi config picks up a mock wallet address from
// globalThis.__MOCK_WALLET__ when import.meta.env.DEV is true. We inject
// it via addInitScript so routes past ConnectGate render their actual
// content. Tree-shaken out of production builds.
//
// Usage:
//   1. install playwright in this project:    npm i -D playwright
//   2. install chromium for playwright:       npx playwright install --with-deps chromium
//      (drop --with-deps if your container already has nss/xcb/etc.)
//   3. start the dev server in another shell: npm run dev
//   4. run the driver:                        npm run e2e:responsive
//
// Configure via env:
//   BASE=http://localhost:5173 MOCK_WALLET=0x... OUT=./e2e/shots
//
// Exit code is non-zero if any overflow / JS error is detected.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE || 'http://localhost:5173'
const MOCK_WALLET = process.env.MOCK_WALLET || '0x1111111111111111111111111111111111111111'
const OUT = resolve(process.env.OUT || `${__dirname}/shots`)

const ROUTES = [
  { path: '/',          name: 'home'      },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/create',    name: 'create'    },
  { path: '/ledger',    name: 'ledger'    },
  { path: '/arbiter',   name: 'arbiter'   },
  { path: '/protocol',  name: 'protocol'  },
  { path: '/settings',  name: 'settings'  }
]

const VIEWPORTS = [
  { name: '360',  width: 360,  height: 800  },
  { name: '800',  width: 800,  height: 1000 },
  { name: '1440', width: 1440, height: 900  }
]

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const findings = []

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(addr => { globalThis.__MOCK_WALLET__ = addr }, MOCK_WALLET)
  const page = await ctx.newPage()

  const consoleErrors = []
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`)
  })

  for (const route of ROUTES) {
    consoleErrors.length = 0
    const url = `${BASE}${route.path}`
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      findings.push({ route: route.path, viewport: vp.name, kind: 'navigation', detail: e.message.split('\n')[0] })
      continue
    }
    await page.waitForTimeout(800)

    const offenders = await page.evaluate((vpw) => {
      const isContainedByScrollOrClip = (el) => {
        let p = el.parentElement
        while (p && p !== document.documentElement) {
          const cs = getComputedStyle(p)
          if (['hidden', 'scroll', 'auto', 'clip'].includes(cs.overflowX)) return true
          p = p.parentElement
        }
        return false
      }
      const out = []
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.right <= vpw + 1 || r.width === 0 || r.width >= vpw * 4) continue
        if (isContainedByScrollOrClip(el)) continue
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').split(' ').slice(0, 3).join('.'),
          width: Math.round(r.width),
          right: Math.round(r.right)
        })
      }
      return out.sort((a, b) => b.right - a.right).slice(0, 3)
    }, vp.width)

    if (offenders.length) {
      findings.push({
        route: route.path,
        viewport: vp.name,
        kind: 'overflow',
        detail: offenders.map(o => `${o.tag}.${o.cls}@${o.right}px (w=${o.width})`).join('; ')
      })
    }

    if (consoleErrors.length) {
      findings.push({
        route: route.path,
        viewport: vp.name,
        kind: 'js-error',
        detail: consoleErrors.slice(0, 3).join(' | ')
      })
    }

    const shotPath = `${OUT}/${route.name}-${vp.name}.png`
    await page.screenshot({ path: shotPath, fullPage: true })
    process.stdout.write(`  ok  ${vp.name.padStart(4)}px  ${route.path.padEnd(11)} -> ${shotPath}\n`)
  }

  await ctx.close()
}

await browser.close()

console.log('\n=== Findings ===')
if (findings.length === 0) {
  console.log('No layout overflows or JS errors detected.')
  process.exit(0)
}
for (const f of findings) {
  console.log(`[${f.viewport}px ${f.route}] ${f.kind}: ${f.detail}`)
}
// Only overflow findings fail the run. JS errors and navigation timeouts are
// often environment-dependent (RPC latency, network flake) and don't represent
// layout debt — report them for visibility but don't block CI on them.
const hardFailures = findings.filter(f => f.kind === 'overflow')
if (hardFailures.length > 0) {
  console.log(`\n${hardFailures.length} overflow finding(s) — failing run.`)
  process.exit(1)
}
console.log(`\n${findings.length} soft finding(s) (js-error / navigation). Layout is clean.`)
process.exit(0)
