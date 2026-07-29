// @vitest-environment node
//
// Integration test for the redis.js wrapper against the REAL @upstash/redis
// client, pointed at a stub of Upstash's REST endpoint.
//
// Everything else that touches storage mocks this module, which is right for
// testing binding logic but means nothing else would notice if the client
// were driven incorrectly — a wrong TTL option name, or objects not
// round-tripping, would pass every other test and then quietly break in
// production. Specifically: an ignored `ex` would leave verification codes
// and OTP sessions alive forever instead of expiring in 15 minutes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'

let server
let requests
let auth

// Minimal stand-in for Upstash's REST contract. The client auto-pipelines by
// default, so commands arrive at /pipeline as an ARRAY of command arrays and
// must come back as an array of {result} envelopes — a single-command POST is
// the exception, not the rule. Modelling that faithfully is the whole point:
// a stub that only spoke the single-command shape would pass while telling us
// nothing about how the client actually behaves in production.
beforeEach(async () => {
  requests = []
  const stored = new Map()

  const runCommand = (command) => {
    requests.push(command)
    const verb = String(command[0]).toLowerCase()
    if (verb === 'set') {
      stored.set(command[1], command[2])
      return 'OK'
    }
    if (verb === 'del') {
      stored.delete(command[1])
      return 1
    }
    if (verb === 'get') return stored.has(command[1]) ? stored.get(command[1]) : null
    return null
  }

  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      auth = req.headers.authorization

      // A pipeline body is an array of command arrays; a single command is a
      // flat array of scalars.
      const isPipeline = Array.isArray(parsed) && Array.isArray(parsed[0])
      const body = isPipeline
        ? parsed.map((command) => ({ result: runCommand(command) }))
        : { result: runCommand(parsed) }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise((resolve) => server.listen(0, resolve))

  vi.resetModules()
  process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`
  process.env.KV_REST_API_TOKEN = 'test-token'
})

afterEach(async () => {
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  await new Promise((resolve) => server.close(resolve))
})

describe('redis.js against the real @upstash/redis client', () => {
  it('sends the TTL as an EX argument in seconds', async () => {
    const { kv } = await import('./redis.js')

    await kv.set('wallet:otp:abc', { email: 'alice@example.com' }, { ex: 900 })

    const [command] = requests
    expect(String(command[0]).toLowerCase()).toBe('set')
    expect(command[1]).toBe('wallet:otp:abc')
    // The TTL must actually reach Redis. Without this, an option name Upstash
    // doesn't recognise would be silently dropped and every verification code
    // and OTP session would live forever instead of expiring.
    const tokens = command.map((t) => String(t).toLowerCase())
    const exIndex = tokens.indexOf('ex')
    expect(exIndex).toBeGreaterThan(-1)
    expect(Number(command[exIndex + 1])).toBe(900)
  })

  it('round-trips an object without manual stringify/parse', async () => {
    const { kv } = await import('./redis.js')
    const binding = { address: '0xALICE', userId: 'user-a', boundAt: 1234567890 }

    await kv.set('wallet:email:alice@example.com', binding)
    const read = await kv.get('wallet:email:alice@example.com')

    expect(read).toEqual(binding)
  })

  it('authenticates with the token from the environment', async () => {
    const { kv } = await import('./redis.js')
    await kv.get('anything')
    expect(auth).toBe('Bearer test-token')
  })

  it('deletes by key', async () => {
    const { kv } = await import('./redis.js')
    await kv.del('wallet:otp:abc')
    expect(String(requests[0][0]).toLowerCase()).toBe('del')
  })

  // The reason redis.js configures the client explicitly instead of calling
  // Redis.fromEnv(). fromEnv() resolves `UPSTASH_REDIS_REST_URL ||
  // KV_REST_API_URL`, so with both present it binds to the UPSTASH_ one —
  // which, if that pair ever points at a staging or local store, means the
  // email directory quietly reads empty instead of erroring. Naming the
  // variables makes the Vercel-injected store the only one we can reach.
  it('uses the KV_-prefixed store even when UPSTASH_-prefixed vars also exist', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1/wrong-database'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'wrong-token'
    vi.resetModules()

    try {
      const { kv } = await import('./redis.js')
      await kv.set('wallet:email:alice@example.com', { address: '0xALICE' })

      // Reached the stub (the KV_ store), not the unroutable UPSTASH_ one.
      expect(requests).toHaveLength(1)
      expect(auth).toBe('Bearer test-token')
    } finally {
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN
    }
  })

  it('reports missing configuration as a clear 503 rather than failing mid-request', async () => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.resetModules()

    const { kv, RedisError } = await import('./redis.js')

    await expect(kv.get('anything')).rejects.toBeInstanceOf(RedisError)
    await expect(kv.get('anything')).rejects.toMatchObject({ status: 503 })
  })
})
