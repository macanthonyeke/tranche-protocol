import { useState, useMemo, useCallback, useRef } from 'react'
import { keccak256, toHex } from 'viem'
import { useAccount, useReadContract, useSignMessage } from 'wagmi'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { formatTimestamp, NO_ATTACHMENT_URI } from '../utils/format.js'
import { toGatewayUrl } from '../utils/ipfsGateway.js'
import { unpackEnvelopeBlob } from '../utils/envelopeBlob.js'
import InvoiceViewer from './InvoiceViewer.jsx'

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

function parseInvoice(str) {
  if (!str) return null
  try { return JSON.parse(str) } catch { return null }
}

// Independent on-chain hash read — the point is to cross-check the subgraph's
// invoiceData against what the depositor actually committed to the contract.
function useOnChainHash(escrowId) {
  const enabled = escrowId != null && !Number.isNaN(Number(escrowId))
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getEscrow',
    args: enabled ? [BigInt(escrowId)] : undefined,
    query: { enabled, staleTime: Infinity }
  })
  return data?.invoiceHash ?? null
}

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return bytes
}

function bytesToHex(bytes) {
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Drives the fetch -> signature -> request-invoice-key -> decrypt flow for a
// private-mode invoice (and, if one exists, its attachment). The envelope
// blob is fetched FIRST — before signing anything — because its own public
// header may carry the attachment's derivation salt (see envelopeBlob.js);
// reading that up front lets a single signed request return both the
// envelope key and the attachment key, instead of needing a second
// signature once the attachment's existence is discovered by decrypting the
// envelope. Never auto-fires: signing is only ever triggered by an explicit
// click, since prompting a wallet signature with no user action is both bad
// UX and blocked by some wallets.
function usePrivateInvoiceUnlock(escrowId, ipfsUri) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [state, setState] = useState({ status: 'idle', data: null, attachmentKey: null, error: null })

  const unlock = useCallback(async () => {
    if (!address || !ipfsUri) return
    setState({ status: 'unlocking', data: null, attachmentKey: null, error: null })
    try {
      const blobRes = await fetch(toGatewayUrl(ipfsUri))
      if (!blobRes.ok) throw new Error('Could not fetch the encrypted invoice.')
      const { iv, ciphertextAndTag, attachmentSalt } = unpackEnvelopeBlob(new Uint8Array(await blobRes.arrayBuffer()))

      const message = `Access invoice for escrow ${escrowId} at ${Date.now()}`
      const signature = await signMessageAsync({ message })

      const keyRes = await fetch('/api/request-invoice-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrowId: String(escrowId), walletAddress: address, signature, message,
          ...(attachmentSalt ? { attachmentSalt: bytesToHex(attachmentSalt) } : {})
        })
      })
      if (!keyRes.ok) {
        const body = await keyRes.json().catch(() => ({}))
        throw new Error(body.error || 'Not authorized to unlock this invoice.')
      }
      const { key, attachmentKey } = await keyRes.json()

      const cryptoKey = await crypto.subtle.importKey('raw', hexToBytes(key), 'AES-GCM', false, ['decrypt'])
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertextAndTag)

      setState({
        status: 'unlocked',
        data: new TextDecoder().decode(plainBuf),
        attachmentKey: attachmentKey ?? null,
        error: null
      })
    } catch (err) {
      setState({ status: 'error', data: null, attachmentKey: null, error: err.message || 'Could not unlock this invoice.' })
    }
  }, [address, escrowId, ipfsUri, signMessageAsync])

  return { ...state, unlock }
}

/* ---------- Main component ---------- */
export default function InvoiceCard({
  escrowId,
  invoiceHash: _propHash,  // from parent's contract read — accepted but verification uses its own read
  invoiceData,
  invoiceURI,
  invoiceAcknowledgedAt,
  role
}) {
  // Private mode: invoiceData === '' (legacy escrows, predating encrypted
  // storage) means the depositor passed no data at all. An ipfs:// value is
  // the newer case — an encrypted envelope, unlockable via signature by the
  // recipient (always) or the arbiter (only during an open dispute). Either
  // way, a manual "drop file to verify" is also always available below.
  const isEncryptedPointer = typeof invoiceData === 'string' && invoiceData.startsWith('ipfs://')
  const isPrivate = invoiceData === '' || invoiceData == null || isEncryptedPointer
  const showAckChip = invoiceAcknowledgedAt !== undefined

  const [revealedData, setRevealedData] = useState(null)
  const [invoiceDropError, setInvoiceDropError] = useState(null)
  const [attachStatus, setAttachStatus] = useState(null) // null | 'verified' | error-string
  const unlock = usePrivateInvoiceUnlock(escrowId, isEncryptedPointer ? invoiceData : null)

  // Hash verification below (verifyStatus) runs against effectiveData
  // unconditionally, so an unlocked private invoice is checked exactly the
  // same way a public one is — against the DECRYPTED bytes, since
  // invoiceHash was always computed over the plaintext envelope.
  const effectiveData = revealedData ?? unlock.data ?? (!isPrivate ? invoiceData : null)
  const onChainHash = useOnChainHash(escrowId)

  // Verification: compare keccak256(effectiveData) to on-chain hash.
  // Same hash function CreateEscrow uses (keccak256(toHex(jsonString))).
  const verifyStatus = useMemo(() => {
    if (!onChainHash) return 'loading'
    if (onChainHash === ZERO_BYTES32) return 'no-hash'
    if (!effectiveData) return isPrivate ? 'private' : 'loading'
    const computed = keccak256(toHex(effectiveData))
    return computed.toLowerCase() === onChainHash.toLowerCase() ? 'verified' : 'failed'
  }, [onChainHash, effectiveData, isPrivate])

  const parsed = useMemo(() => parseInvoice(effectiveData), [effectiveData])

  /* --- Drop handlers --- */
  const handleInvoiceFile = useCallback(async (file) => {
    setInvoiceDropError(null)
    try {
      const text = await file.text()
      if (!onChainHash || onChainHash === ZERO_BYTES32) {
        setInvoiceDropError('On-chain hash not yet loaded. Try again in a moment.')
        return
      }
      const computed = keccak256(toHex(text))
      if (computed.toLowerCase() === onChainHash.toLowerCase()) {
        setRevealedData(text)
      } else {
        setInvoiceDropError('This file does not match the on-chain commitment.')
      }
    } catch {
      setInvoiceDropError('Could not read the file.')
    }
  }, [onChainHash])

  const handleAttachFile = useCallback(async (file, expectedSha256) => {
    setAttachStatus(null)
    try {
      const buf = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buf)
      const hex = '0x' + Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      setAttachStatus(
        hex.toLowerCase() === expectedSha256.toLowerCase()
          ? 'verified'
          : 'File SHA-256 does not match the commitment.'
      )
    } catch {
      setAttachStatus('Could not read the file.')
    }
  }, [])

  /* --- Private mode (no data, or an encrypted pointer not yet unlocked) --- */
  if (isPrivate && !revealedData && !unlock.data) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Invoice</p>
        {isEncryptedPointer && (
          <PrivateUnlock status={unlock.status} error={unlock.error} onUnlock={unlock.unlock} />
        )}
        <FileDrop
          label={isEncryptedPointer
            ? 'Or drop the original invoice file to verify it manually.'
            : 'This invoice is private. Drop the invoice file to verify it.'}
          onFile={handleInvoiceFile}
          error={invoiceDropError}
          fullCard={!isEncryptedPointer}
        />
      </div>
    )
  }

  /* --- Unparseable data --- */
  if (!parsed) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Invoice</p>
        <div className="rounded-xl bg-sunk px-3 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs text-ink-2">Invoice data could not be parsed.</span>
          <VerifyBadge status={verifyStatus} />
        </div>
      </div>
    )
  }

  // parsed comes from user/depositor-controlled JSON (the invoice envelope) —
  // don't trust attachments[0]'s field types. uri feeds toGatewayUrl()
  // (calls .startsWith) and sha256 feeds .slice()/.toLowerCase() downstream;
  // a crafted non-string value there would throw and crash this render.
  // mime is only ever set for private-mode attachments (see
  // attachmentFlow.js) — InvoiceViewer needs it post-decrypt, since the
  // gateway only ever reports "application/octet-stream" for ciphertext.
  const rawAttachment = parsed.attachments?.[0]
  const attachment = typeof rawAttachment?.uri === 'string'
    ? {
        uri: rawAttachment.uri,
        sha256: typeof rawAttachment.sha256 === 'string' ? rawAttachment.sha256 : null,
        mime: typeof rawAttachment.mime === 'string' ? rawAttachment.mime : null
      }
    : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Invoice</p>

      {/* Header: number + issued date + verify badge */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">
            {parsed.invoiceNumber || 'Invoice'}
          </span>
          {parsed.issuedAt && (
            <span className="text-xs text-ink-3">
              Issued {new Date(parsed.issuedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
              })}
            </span>
          )}
        </div>
        <VerifyBadge status={verifyStatus} />
      </div>

      {showAckChip && <AckChip acknowledgedAt={invoiceAcknowledgedAt} />}

      {/* Line items */}
      {parsed.lineItems?.length > 0 && <LineItemsTable items={parsed.lineItems} />}

      {/* Notes */}
      {parsed.notes && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium mb-1">Notes</p>
          <p className="text-[13px] text-ink-2 leading-relaxed">{parsed.notes}</p>
        </div>
      )}

      {/* Attachment row */}
      {attachment?.uri && (
        <AttachmentRow
          attachment={attachment}
          status={attachStatus}
          decryptKey={isEncryptedPointer ? unlock.attachmentKey : null}
          onFile={attachment.sha256
            ? (f) => handleAttachFile(f, attachment.sha256)
            : null
          }
        />
      )}

      {/* Invoice URI disclosure */}
      {invoiceURI && invoiceURI !== NO_ATTACHMENT_URI && <URIRow uri={invoiceURI} />}
    </div>
  )
}

/* ---------- Line items table ---------- */
function LineItemsTable({ items }) {
  return (
    <div className="rounded-xl overflow-hidden border border-rule/60">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-sunk border-b border-rule/60">
            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-ink-3 font-medium w-10">#</th>
            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-ink-3 font-medium">Milestone</th>
            <th className="text-right px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-ink-3 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className={i < items.length - 1 ? 'border-b border-rule/40' : ''}>
              <td className="px-3 py-2 font-mono text-ink-3">
                {(item.milestone ?? i) + 1}
              </td>
              <td className="px-3 py-2 text-ink-2">{item.title || `Milestone ${(item.milestone ?? i) + 1}`}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                {item.amount} <span className="text-ink-3">USDC</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Attachment row ---------- */
function AttachmentRow({ attachment, status, decryptKey, onFile }) {
  const [viewerOpen, setViewerOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Attachment</p>
      <div className="rounded-xl border border-rule bg-paper px-4 py-3.5 flex flex-col gap-2.5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md border border-rule bg-sunk text-ink-2">
            <DocIcon />
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {/* href is the gateway URL as a right-click/middle-click fallback
                (never the raw ipfs:// form, which no browser can open) — a
                plain left-click opens the in-app viewer instead, but a
                modifier click (Cmd/Ctrl/Shift, or a non-primary button) is
                left alone so "open in new tab" keeps working natively. */}
            <a
              href={toGatewayUrl(attachment.uri)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                e.preventDefault()
                setViewerOpen(true)
              }}
              className="text-clay hover:opacity-80 underline-offset-2 hover:underline text-[12.5px] break-all inline-flex items-center gap-1"
            >
              {attachment.uri}
              <ExternalLinkIcon size={11} />
            </a>
            {attachment.sha256 && (
              <span className="hash text-[11px] self-start" title="Content fingerprint">
                {attachment.sha256.slice(0, 14)}…
              </span>
            )}
          </div>
        </div>

        {attachment.sha256 && onFile && (
          status === 'verified' ? (
            <div className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 flex items-center gap-1.5 text-[12px] text-ok">
              <CheckIcon size={11} />
              File verified — SHA-256 matches
            </div>
          ) : status ? (
            <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 flex items-start gap-1.5 text-[12px] text-bad">
              <WarnIcon size={12} />
              <span>{status}</span>
            </div>
          ) : (
            <FileDrop
              label="Drop original file to verify"
              onFile={onFile}
              compact
            />
          )
        )}
      </div>

      <InvoiceViewer open={viewerOpen} onClose={() => setViewerOpen(false)} attachment={attachment} decryptKey={decryptKey} />
    </div>
  )
}

/* ---------- URI row ---------- */
function URIRow({ uri }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="self-start text-[12px] text-clay hover:opacity-80 transition-opacity"
      >
        {open ? 'Hide invoice link' : 'View invoice link'}
      </button>
      {open && (
        <div className="rounded-xl bg-sunk px-3 py-2.5 flex flex-col gap-1.5">
          <p className="text-[11.5px] text-ink-3 leading-relaxed">
            Invoice links are user-provided and not verified by the protocol. Check before opening.
          </p>
          <a
            href={uri}
            target="_blank"
            rel="noreferrer"
            className="text-clay hover:opacity-80 underline-offset-2 hover:underline text-[12.5px] break-all inline-flex items-start gap-1"
          >
            {uri} ↗
          </a>
        </div>
      )}
    </div>
  )
}

/* ---------- Acknowledgment chip ---------- */
function AckChip({ acknowledgedAt }) {
  if (acknowledgedAt) {
    const date = new Date(Number(acknowledgedAt) * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-ok font-medium">
        <CheckIcon size={10} />
        Accepted by recipient on {date}
      </div>
    )
  }
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-3/50" aria-hidden />
      Awaiting recipient acknowledgment
    </div>
  )
}

/* ---------- Private invoice unlock ---------- */
function PrivateUnlock({ status, error, onUnlock }) {
  if (status === 'unlocking') {
    return (
      <div className="rounded-xl bg-sunk border border-rule-2 px-4 py-3 flex items-center gap-2.5 text-[13px] text-ink-2 leading-relaxed" role="status">
        <SpinnerIcon size={13} />
        Check your wallet to unlock this invoice…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-rule bg-paper px-4 py-3.5 flex flex-col gap-2.5">
      <p className="text-[12.5px] text-ink-2 leading-relaxed">
        This invoice is private. Sign a message with your wallet to decrypt it.
      </p>
      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 flex items-start gap-1.5 text-[12px] text-bad">
          <WarnIcon size={12} />
          <span>{error}</span>
        </div>
      )}
      <button type="button" className="btn-secondary text-[12.5px] py-1.5 self-start" onClick={onUnlock}>
        Unlock private invoice
      </button>
    </div>
  )
}

/* ---------- Verify badge ---------- */
function VerifyBadge({ status }) {
  if (status === 'loading' || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-sunk px-2 py-0.5 text-[11px] text-ink-3">
        <SpinnerIcon size={10} />
        Verifying…
      </span>
    )
  }
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-ok/30 bg-ok/10 px-2 py-0.5 text-[11px] text-ok font-medium">
        <CheckIcon size={10} />
        Verified against chain
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-bad/30 bg-bad/10 px-2 py-0.5 text-[11px] text-bad font-medium">
        <WarnIcon size={11} />
        Verification failed — subgraph data does not match on-chain commitment
      </span>
    )
  }
  // 'private', 'no-hash', or null: nothing to show
  return null
}

/* ---------- File drop zone ---------- */
function FileDrop({ label, onFile, error, fullCard = false, compact = false }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = () => setDragging(false)
  const handleInputChange = (e) => {
    const file = e.target.files?.[0]
    if (file) { onFile(file); e.target.value = '' }
  }

  const baseCls = compact
    ? 'rounded-lg border-[1.5px] border-dashed px-3 py-2 text-[11.5px] text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5'
    : fullCard
    ? 'rounded-xl border-[1.5px] border-dashed px-5 py-6 text-sm text-center cursor-pointer transition-colors flex flex-col items-center'
    : 'rounded-xl border-[1.5px] border-dashed px-3 py-3 text-[11.5px] text-center cursor-pointer transition-colors flex flex-col items-center gap-1'

  const colorCls = dragging
    ? 'border-clay bg-clay/5 text-clay'
    : 'border-rule-2 text-ink-3 hover:border-clay/50 hover:text-ink-2'

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`${baseCls} ${colorCls}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        {!compact && <UploadIcon size={fullCard ? 20 : 16} />}
        <span className={!compact ? 'mt-1.5' : ''}>{label}</span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>
      {error && <p className="text-[11.5px] text-bad">{error}</p>}
    </div>
  )
}

/* ---------- Icons ---------- */
function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7.5l3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalLinkIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
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

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M5 2h5l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function UploadIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 14V4M7 8l4-4 4 4M4 15v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
