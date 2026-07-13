// SSRF guard for server-side URL fetches (invoice attachment pinning).
//
// The check-then-fetch gap is the classic bypass: if we resolved the hostname
// once to validate it, then let a plain `fetch()` resolve it AGAIN to connect,
// an attacker controlling DNS could return a public IP for the check and a
// private one (169.254.169.254, etc.) for the real connection ("DNS
// rebinding"). We close that gap by resolving once, validating every
// returned address, and pinning the actual socket to the address we already
// checked via a custom `lookup` — so nothing re-resolves the hostname later.
//
// IP classification uses Node's built-in `net.BlockList` rather than
// hand-rolled CIDR math, since bugs in this specific arithmetic are exactly
// the kind of thing that turns into a real SSRF finding.

import { BlockList, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'

export class SsrfError extends Error {}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const blockList = new BlockList()
// IPv4: loopback, RFC1918 private, link-local, CGNAT, documentation/test-net,
// benchmarking, multicast, reserved, broadcast.
blockList.addSubnet('0.0.0.0', 8, 'ipv4')
blockList.addSubnet('10.0.0.0', 8, 'ipv4')
blockList.addSubnet('100.64.0.0', 10, 'ipv4')
blockList.addSubnet('127.0.0.0', 8, 'ipv4')
blockList.addSubnet('169.254.0.0', 16, 'ipv4')
blockList.addSubnet('172.16.0.0', 12, 'ipv4')
blockList.addSubnet('192.0.0.0', 24, 'ipv4')
blockList.addSubnet('192.0.2.0', 24, 'ipv4')
blockList.addSubnet('192.168.0.0', 16, 'ipv4')
blockList.addSubnet('198.18.0.0', 15, 'ipv4')
blockList.addSubnet('198.51.100.0', 24, 'ipv4')
blockList.addSubnet('203.0.113.0', 24, 'ipv4')
blockList.addSubnet('224.0.0.0', 4, 'ipv4')
blockList.addSubnet('240.0.0.0', 4, 'ipv4')
blockList.addAddress('255.255.255.255', 'ipv4')
// IPv6: unspecified, loopback, unique-local, link-local, multicast.
blockList.addAddress('::', 'ipv6')
blockList.addAddress('::1', 'ipv6')
blockList.addSubnet('fc00::', 7, 'ipv6')
blockList.addSubnet('fe80::', 10, 'ipv6')
blockList.addSubnet('ff00::', 8, 'ipv6')

// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are unwrapped and re-checked
// against the IPv4 rules above rather than matched as a v6 subnet: adding
// `::ffff:0:0/96` directly to the same BlockList collides with the plain
// IPv4 subnets internally and blocks every IPv4 address, mapped or not
// (verified empirically against Node's net.BlockList — not documented).
const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i

function assertAllowedAddress(address, family) {
  if (family === 6) {
    const mapped = address.match(IPV4_MAPPED_RE)
    if (mapped) {
      assertAllowedAddress(mapped[1], 4)
      return
    }
  }
  const type = family === 6 ? 'ipv6' : 'ipv4'
  if (blockList.check(address, type)) {
    throw new SsrfError(`Refusing to fetch from a private or reserved address (${address})`)
  }
}

// Resolves `hostname` and validates every returned address, so a
// multi-A-record answer can't sneak a private IP past the check by putting a
// public one first. Returns the address the caller should pin its connection
// to.
async function resolvePinnedAddress(hostname) {
  // WHATWG URL keeps brackets around IPv6 literals in `.hostname` (`[::1]`);
  // strip them for IP-literal detection and DNS lookup.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const literalFamily = isIP(bare)
  if (literalFamily) {
    assertAllowedAddress(bare, literalFamily)
    return { address: bare, family: literalFamily }
  }
  let records
  try {
    records = await dnsLookup(bare, { all: true, verbatim: true })
  } catch {
    throw new SsrfError(`Could not resolve host: ${hostname}`)
  }
  if (!records.length) throw new SsrfError(`Could not resolve host: ${hostname}`)
  for (const r of records) assertAllowedAddress(r.address, r.family)
  return records[0]
}

/**
 * Fetch a URL server-side with SSRF protections: http/https only, no
 * embedded credentials, private/internal IP ranges rejected (DNS-rebinding
 * safe), a hard byte cap, a hard timeout, and no redirect following.
 *
 * @param {string} rawUrl
 * @param {{ maxBytes?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ bytes: Buffer, contentType: string | undefined }>}
 */
export async function fetchUrlSafely(rawUrl, { maxBytes = 10 * 1024 * 1024, timeoutMs = 10_000 } = {}) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SsrfError('That is not a valid URL.')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfError('Only http and https URLs are allowed.')
  }
  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed.')
  }

  const pinned = await resolvePinnedAddress(parsed.hostname)
  const mod = parsed.protocol === 'https:' ? https : http

  return await new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    }
    const succeed = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: { 'User-Agent': 'tranche-invoice-pinner/1.0' },
        // Pin the connection to the address we already validated, instead of
        // letting the request re-resolve the hostname (see file header).
        // Node's Happy-Eyeballs (autoSelectFamily) calls a custom `lookup`
        // with `options.all: true` and expects an array of records back —
        // returning a bare (address, family) pair there makes net.connect
        // throw "Invalid IP address: undefined". Disabling autoSelectFamily
        // sidesteps that path entirely; the `options.all` branch is kept as
        // a defensive fallback in case a future Node version calls it anyway.
        autoSelectFamily: false,
        lookup: (_hostname, options, callback) => {
          if (options && options.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }])
          } else {
            callback(null, pinned.address, pinned.family)
          }
        },
        signal: controller.signal
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume()
          fail(new SsrfError('That URL redirects; redirects are not followed for security reasons.'))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          fail(new SsrfError(`Fetching that URL failed with status ${res.statusCode}.`))
          return
        }
        const declaredLength = Number(res.headers['content-length'] || 0)
        if (declaredLength > maxBytes) {
          res.destroy()
          fail(new SsrfError(`File is too large (limit is ${Math.floor(maxBytes / 1024 / 1024)}MB).`))
          return
        }

        const chunks = []
        let total = 0
        res.on('data', (chunk) => {
          total += chunk.length
          if (total > maxBytes) {
            res.destroy()
            fail(new SsrfError(`File is too large (limit is ${Math.floor(maxBytes / 1024 / 1024)}MB).`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => succeed({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] }))
        res.on('error', fail)
      }
    )

    req.on('error', (err) => {
      fail(err?.name === 'AbortError' ? new SsrfError('Fetching that URL timed out.') : err)
    })
    req.end()
  })
}
