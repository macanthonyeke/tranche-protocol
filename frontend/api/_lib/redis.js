// Upstash Redis client — the one piece of durable storage reachable from
// these Vercel serverless functions.
//
// @upstash/redis, not @vercel/kv: the latter is deprecated.
//
// Vercel's Upstash integration injects this project's credentials as
// KV_REST_API_URL / KV_REST_API_TOKEN — names carried over from the
// deprecated @vercel/kv, so the KV_ prefix here is not a leftover.
//
// Configured explicitly rather than via Redis.fromEnv(). To be accurate about
// why, since it is not that fromEnv() cannot see these: it reads
// `UPSTASH_REDIS_REST_URL || KV_REST_API_URL` (and the same for the token, see
// @upstash/redis/nodejs.mjs), so it would in fact work today. Explicit config
// is still preferred for two reasons. First, that fallback is undocumented
// compatibility behaviour that a future major version could reasonably drop.
// Second, and more concretely: fromEnv() PREFERS the UPSTASH_-prefixed pair
// when both exist. If anyone later adds UPSTASH_REDIS_REST_* pointing at a
// different database — a staging store, a local instance — fromEnv() would
// silently bind to that one instead of the store Vercel provisioned, and the
// email directory would read empty rather than error. Naming the variables
// here makes that class of drift impossible.
//
// Constructed lazily and memoized per warm instance rather than at import
// time. The constructor does NOT throw on missing credentials — it logs a
// warning and hands back a client that fails later, mid-request, with an
// error that points at Upstash rather than at the missing configuration. Any
// route importing a module that touches Redis would pay that noise on every
// cold start, including routes that never read a key. Deferring it means a
// misconfigured deployment surfaces as our own 503 ("...not configured on the
// server"), consistent with getCircleClient() and the PINATA_JWT guard.

import { Redis } from '@upstash/redis'

export class RedisError extends Error {
  constructor(message, status = 503) {
    super(message)
    this.status = status
  }
}

let client = null

export function getRedis() {
  if (client) return client

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    throw new RedisError('Email sign-in is not configured on the server.')
  }

  client = new Redis({ url, token })
  return client
}

/* Thin get/set/del passthrough so callers read the same as they did under
   @vercel/kv. Upstash serializes and parses JSON automatically, so objects
   round-trip without explicit stringify/parse, and `{ ex: seconds }` is the
   same TTL option.

   Each method is async so that a missing-configuration failure arrives as a
   rejected promise rather than a synchronous throw. Otherwise getRedis()
   would throw before any promise exists, and a caller reaching for
   `.catch()` — a perfectly reasonable thing to write against something that
   returns a promise on every other code path — would take an unhandled
   exception instead. */
export const kv = {
  async get(key) {
    return getRedis().get(key)
  },
  async set(key, value, opts) {
    return getRedis().set(key, value, opts)
  },
  async del(key) {
    return getRedis().del(key)
  }
}
