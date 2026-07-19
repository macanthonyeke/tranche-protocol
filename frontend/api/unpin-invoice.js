// POST /api/unpin-invoice — best-effort cleanup for a plaintext attachment
// that was pinned during Create Escrow's public-mode immediate-pin flow and
// then abandoned before deposit() ever referenced it on-chain (currently:
// switching from public to private mode, which forces a re-attach under the
// correct mode — see CreateEscrow.jsx's setPrivateMode). See
// _lib/pinata.js's unpinFromIPFS for what "unpin" actually guarantees (not
// much — it stops OUR account hosting it, nothing more).
//
// Requires {ipfsUri, token} — token must be the exact capability
// pin-invoice.js issued for THIS ipfsUri's CID at pin time (see
// _lib/unpinToken.js). This is NOT optional: read access to a CID and
// permission to delete it are different things, and since Tranche is the
// sole host of these files, an unauthenticated unpin-by-CID endpoint would
// let anyone who obtains or guesses a live escrow's attachment CID
// permanently destroy it — exactly the link-rot problem invoice permanence
// (PR #13) exists to prevent. A missing, wrong, expired, or
// wrong-CID token is rejected the same way: 403, nothing unpinned.

import { unpinFromIPFS, PinataError } from './_lib/pinata.js'
import { verifyUnpinToken } from './_lib/unpinToken.js'

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const CID_RE = /^ipfs:\/\/([a-zA-Z0-9]+)$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const match = typeof body?.ipfsUri === 'string' ? body.ipfsUri.match(CID_RE) : null
    if (!match) throw new RequestError('A valid ipfs:// URI is required.')
    const cid = match[1]

    if (typeof body?.token !== 'string' || !body.token) {
      throw new RequestError('A token is required.')
    }
    if (!verifyUnpinToken(cid, body.token)) {
      throw new RequestError('Invalid, expired, or mismatched token.', 403)
    }

    await unpinFromIPFS(cid)
    res.status(200).json({ ok: true })
  } catch (err) {
    if (err instanceof RequestError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    if (err instanceof PinataError) {
      res.status(502).json({ error: err.message })
      return
    }
    console.error('unpin-invoice failed:', err)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
