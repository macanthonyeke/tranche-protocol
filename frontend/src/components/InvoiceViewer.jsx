import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { toGatewayUrl } from '../utils/ipfsGateway.js'

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return bytes
}

const PDF_TYPE = 'application/pdf'
const isImageType = (type) => typeof type === 'string' && type.startsWith('image/')

// Opens on a lazy fetch of the attachment via the IPFS gateway (browsers
// can't resolve ipfs:// directly — see ipfsGateway.js), then reuses those
// exact bytes for both the SHA-256 verify check and the inline preview
// (an object URL built from the same ArrayBuffer) — never a second,
// independent fetch, so what's displayed is guaranteed to be what got
// hash-checked.
//
// Two alternate byte sources, mutually exclusive with the gateway fetch and
// with each other:
//   - `localFile`: a File/Blob not yet pinned anywhere (private-mode
//     attachment during Create Escrow, before onDeposit() has run). No
//     network fetch, no sha256 to verify against yet (nothing's been
//     committed to), just an immediate local preview.
//   - `decryptKey`: attachment.uri points at ciphertext (private-mode,
//     already pinned). Fetched bytes are iv(12)||ciphertext+tag — decrypted
//     via Web Crypto before the hash-verify/preview steps below run, so
//     verification is always against the plaintext, matching invoiceHash
//     verification's own decrypted-bytes-only rule. attachment.mime carries
//     the original content-type, since the gateway only ever reports
//     "application/octet-stream" for the ciphertext itself.
export default function InvoiceViewer({ open, onClose, attachment, localFile, decryptKey, attachmentKeyStatus = 'none' }) {
  const [state, setState] = useState({ status: 'idle' })
  const [objectUrl, setObjectUrl] = useState(null)

  useEffect(() => {
    if (!open || (!attachment?.uri && !localFile)) return

    // The attachment is encrypted and the key fetch specifically failed
    // (distinct from "nothing to decrypt") — bail out before any fetch, so
    // ciphertext never gets hashed against attachment.sha256 (a guaranteed
    // mismatch that would read as tampering, not a key-retrieval hiccup)
    // and never gets offered as a raw "open in a new tab" link.
    if (attachmentKeyStatus === 'failed') {
      setState({ status: 'key-failed' })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      try {
        let buf, contentType

        if (localFile) {
          buf = await localFile.arrayBuffer()
          contentType = localFile.type
        } else {
          const res = await fetch(toGatewayUrl(attachment.uri))
          if (!res.ok) throw new Error(`fetch failed with status ${res.status}`)
          const fetched = await res.arrayBuffer()

          if (decryptKey) {
            const bytes = new Uint8Array(fetched)
            const iv = bytes.slice(0, 12)
            const ciphertext = bytes.slice(12)
            const cryptoKey = await crypto.subtle.importKey('raw', hexToBytes(decryptKey), 'AES-GCM', false, ['decrypt'])
            buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
            contentType = attachment.mime || ''
          } else {
            buf = fetched
            contentType = (res.headers.get('content-type') || '').split(';')[0].trim()
          }
        }
        if (cancelled) return

        let verify = 'unavailable'
        if (attachment?.sha256) {
          const computed = await sha256Hex(buf)
          verify = computed.toLowerCase() === attachment.sha256.toLowerCase() ? 'verified' : 'failed'
        }

        const url = URL.createObjectURL(new Blob([buf], { type: contentType || 'application/octet-stream' }))
        if (cancelled) { URL.revokeObjectURL(url); return }
        setObjectUrl(url)
        setState({ status: 'ready', contentType, verify })
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err.message })
      }
    })()

    return () => { cancelled = true }
  }, [open, attachment?.uri, attachment?.sha256, attachment?.mime, decryptKey, localFile, attachmentKeyStatus])

  // Revoke whichever object URL is current whenever it's replaced or the
  // modal unmounts, so repeated opens don't leak blob: URLs.
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }, [objectUrl])

  if (!open) return null

  // A raw "open in a new tab" link only makes sense against plaintext the
  // browser can fetch on its own — not a not-yet-pinned local file, and not
  // ciphertext (whether or not the key ended up available — a link to the
  // encrypted blob is never useful, and offering one in the key-failed case
  // specifically would hand the user a dead end that looks like a preview).
  // Driven by attachmentKeyStatus explicitly rather than decryptKey alone,
  // so "key fetch failed" can't be silently mistaken for "no decryption
  // needed."
  const canOfferGatewayLink = !localFile && attachmentKeyStatus === 'none' && !!attachment?.uri
  const gatewayUrl = canOfferGatewayLink ? toGatewayUrl(attachment.uri) : null
  const canPreviewImage = state.status === 'ready' && isImageType(state.contentType)
  const canPreviewPdf = state.status === 'ready' && state.contentType === PDF_TYPE

  return (
    <Modal open={open} onClose={onClose} title="Invoice attachment" size="lg">
      <div className="flex flex-col gap-3">
        {state.status === 'loading' && (
          <div className="flex items-center justify-center gap-2 text-[13px] text-ink-3 py-16">
            <SpinnerIcon size={14} />
            {decryptKey ? 'Loading and decrypting…' : 'Loading and verifying…'}
          </div>
        )}

        {state.status === 'key-failed' && (
          <div className="rounded-lg border border-rule bg-sunk px-3 py-2.5 flex items-start gap-1.5 text-[12.5px] text-ink-2">
            <WarnIcon size={12} />
            <span>Could not retrieve the decryption key for this attachment right now. Try again in a moment.</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 flex items-start gap-1.5 text-[12.5px] text-bad">
            <WarnIcon size={12} />
            <span>
              Could not load this file.
              {canOfferGatewayLink && (
                <> <a href={gatewayUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open in a new tab</a> instead.</>
              )}
            </span>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {state.verify === 'verified' && (
              <div className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 flex items-center gap-1.5 text-[12px] text-ok">
                <CheckIcon size={11} />
                File verified — SHA-256 matches
              </div>
            )}
            {state.verify === 'failed' && (
              <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 flex items-start gap-1.5 text-[12px] text-bad">
                <WarnIcon size={12} />
                <span>File SHA-256 does not match the commitment.</span>
              </div>
            )}

            {canPreviewImage && (
              <img
                src={objectUrl}
                alt="Invoice attachment preview"
                className="w-full max-h-[70vh] object-contain rounded-lg border border-rule bg-sunk"
              />
            )}
            {canPreviewPdf && (
              <iframe
                src={objectUrl}
                title="Invoice attachment preview"
                className="w-full h-[70vh] rounded-lg border border-rule bg-sunk"
              />
            )}
            {!canPreviewImage && !canPreviewPdf && (
              <div className="rounded-xl border border-rule bg-sunk px-4 py-10 flex flex-col items-center gap-2 text-center">
                <DocIcon />
                <p className="text-[13px] text-ink-2">Preview not available for this file type.</p>
                {canOfferGatewayLink && (
                  <a
                    href={gatewayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12.5px] text-clay hover:opacity-80 underline-offset-2 hover:underline"
                  >
                    Open in a new tab
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function SpinnerIcon({ size = 12 }) {
  return <span className="inline-block rounded-full border-2 border-ink-3/30 border-t-ink-2 animate-spin" style={{ width: size, height: size }} aria-hidden />
}
function WarnIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1.5l6 10.5H1L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.5v3M7 10.5v0.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M5 2h5l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
