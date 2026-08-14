import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/* RTL only auto-registers its own afterEach cleanup when vitest runs with
   `globals: true`, which this project does not set. Without it, rendered DOM
   accumulates across tests in the same file — "found multiple elements" at
   best, a false pass off a previous test's markup at worst.

   Registered here rather than per-file so a new render test cannot forget it.
   Preferred over flipping `globals: true`, which would change how every test
   file resolves describe/it/expect for the same outcome. The per-file
   afterEach(cleanup) calls that predate this are now redundant but harmless —
   cleanup is idempotent. */
afterEach(cleanup)
