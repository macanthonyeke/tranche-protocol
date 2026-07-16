import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { toGatewayUrl } from '../utils/ipfsGateway.js'

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const PDF_TYPE = 'application/pdf'
const isImageType = (type) => typeof type === 'string' && type.startsWith('image/')

// Opens on a lazy fetch of the attachment via the IPFS gateway (browsers
// can't resolve ipfs:// directly — see ipfsGateway.js), then reuses those
// exact bytes for both the SHA-256 verify check and the inline preview
// (an object URL built from the same ArrayBuffer) — never a second,
// independent fetch, so what's displayed is guaranteed to be what got
// hash-checked.
export default function InvoiceViewer({ open, onClose, attachment }) {
  const [state, setState] = useState({ status: 'idle' })
  const [objectUrl, setObjectUrl] = useState(null)

  useEffect(() => {
    if (!open || !attachment?.uri) return
    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const res = await fetch(toGatewayUrl(attachment.uri))
        if (!res.ok) throw new Error(`fetch failed with status ${res.status}`)
        const contentType = (res.headers.get('content-type') || '').split(';')[0].trim()
        const buf = await res.arrayBuffer()
        if (cancelled) return

        let verify = 'unavailable'
        if (attachment.sha256) {
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
  }, [open, attachment?.uri, attachment?.sha256])

  // Revoke whichever object URL is current whenever it's replaced or the
  // modal unmounts, so repeated opens don't leak blob: URLs.
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }, [objectUrl])

  if (!open) return null

  const gatewayUrl = toGatewayUrl(attachment?.uri)
  const canPreviewImage = state.status === 'ready' && isImageType(state.contentType)
  const canPreviewPdf = state.status === 'ready' && state.contentType === PDF_TYPE

  return (
    <Modal open={open} onClose={onClose} title="Invoice attachment" size="lg">
      <div className="flex flex-col gap-3">
        {state.status === 'loading' && (
          <div className="flex items-center justify-center gap-2 text-[13px] text-ink-3 py-16">
            <SpinnerIcon size={14} />
            Loading and verifying…
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 flex items-start gap-1.5 text-[12.5px] text-bad">
            <WarnIcon size={12} />
            <span>
              Could not load this file. <a href={gatewayUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open in a new tab</a> instead.
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
                <a
                  href={gatewayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] text-clay hover:opacity-80 underline-offset-2 hover:underline"
                >
                  Open in a new tab
                </a>
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
    <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M5 2h5l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
