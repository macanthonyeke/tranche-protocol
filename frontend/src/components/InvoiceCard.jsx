import { useState, useMemo, useCallback, useRef } from 'react'
import { keccak256, toHex } from 'viem'
import { useReadContract } from 'wagmi'
import { CONTRACT_ADDRESS, ESCROW_ABI } from '../config/contract.js'
import { formatTimestamp, NO_ATTACHMENT_URI } from '../utils/format.js'

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

/* ---------- Main component ---------- */
export default function InvoiceCard({
  escrowId,
  invoiceHash: _propHash,  // from parent's contract read — accepted but verification uses its own read
  invoiceData,
  invoiceURI,
  invoiceAcknowledgedAt,
  role
}) {
  // Private mode: invoiceData === '' means the depositor passed no data (private).
  // Drop a file to reveal contents by comparing against the on-chain hash.
  const isPrivate = invoiceData === '' || invoiceData == null
  const showAckChip = invoiceAcknowledgedAt !== undefined

  const [revealedData, setRevealedData] = useState(null)
  const [invoiceDropError, setInvoiceDropError] = useState(null)
  const [attachStatus, setAttachStatus] = useState(null) // null | 'verified' | error-string

  const effectiveData = revealedData ?? (!isPrivate ? invoiceData : null)
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

  /* --- Private mode (no data, drop to verify) --- */
  if (isPrivate && !revealedData) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Invoice</p>
        <FileDrop
          label="This invoice is private. Drop the invoice file to verify it."
          onFile={handleInvoiceFile}
          error={invoiceDropError}
          fullCard
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

  const attachment = parsed.attachments?.[0]

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
function AttachmentRow({ attachment, status, onFile }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-3 font-medium">Attachment</p>
      <div className="flex flex-col gap-2">
        <a
          href={attachment.uri}
          target="_blank"
          rel="noreferrer"
          className="text-clay hover:opacity-80 underline-offset-2 hover:underline text-[12.5px] break-all inline-flex items-center gap-1"
        >
          {attachment.uri}
          <ExternalLinkIcon size={11} />
        </a>
        {attachment.sha256 && onFile && (
          <>
            {status === 'verified' ? (
              <div className="flex items-center gap-1.5 text-[12px] text-ok">
                <CheckIcon size={11} />
                <span>File verified — SHA-256 matches</span>
              </div>
            ) : status ? (
              <p className="text-[12px] text-bad">{status}</p>
            ) : (
              <FileDrop
                label="Drop original file to verify"
                onFile={onFile}
                compact
              />
            )}
          </>
        )}
      </div>
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

/* ---------- Verify badge ---------- */
function VerifyBadge({ status }) {
  if (status === 'loading' || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-ink-3/40 border-t-ink-2 animate-spin" aria-hidden />
        Verifying…
      </span>
    )
  }
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ok font-medium">
        <CheckIcon size={10} />
        Verified against chain
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-bad font-medium">
        <span aria-hidden>⚠</span>
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
    ? 'rounded-lg border border-dashed px-3 py-2 text-[11.5px] text-center cursor-pointer transition-colors'
    : fullCard
    ? 'rounded-xl border border-dashed px-4 py-8 text-sm text-center cursor-pointer transition-colors'
    : 'rounded-xl border border-dashed px-3 py-3 text-[11.5px] text-center cursor-pointer transition-colors'

  const colorCls = dragging
    ? 'border-clay bg-clay/5 text-clay'
    : 'border-rule/60 text-ink-3 hover:border-clay/50 hover:text-ink-2'

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
        <span>{label}</span>
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
