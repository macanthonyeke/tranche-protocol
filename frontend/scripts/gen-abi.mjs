// Regenerates src/abi/TrancheProtocol.json from the compiled Foundry artifact.
//
// The JSON is the single source of truth for every contract interaction in the
// frontend, so it must always match the deployed contract. Run `forge build`
// at the repo root first, then `npm run gen-abi` here.
//
// Usage: node scripts/gen-abi.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const artifactPath = resolve(repoRoot, 'out/TrancheProtocol.sol/TrancheProtocol.json')
const outPath = resolve(here, '..', 'src/abi/TrancheProtocol.json')

let artifact
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
} catch (err) {
  console.error(`Could not read compiled artifact at ${artifactPath}.`)
  console.error('Run `forge build` at the repo root first.')
  process.exitCode = 1
  throw err
}

if (!Array.isArray(artifact.abi)) {
  throw new Error('Artifact has no `abi` array — is this the right file?')
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2) + '\n')
console.log(`Wrote ${artifact.abi.length} ABI entries to src/abi/TrancheProtocol.json`)
