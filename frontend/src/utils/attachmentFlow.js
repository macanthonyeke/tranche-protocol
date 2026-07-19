// Orchestrates attachment handling for Create Escrow.
//
// Public mode pins immediately on file-select/URL-paste — exact pre-existing
// behavior, unchanged. Private mode defers pinning to onDeposit() time: the
// attachment must be encrypted and pinned BEFORE invoiceHash can be
// computed, since its ciphertext URI is embedded in the envelope that
// invoiceHash covers (see api/_lib/invoiceCrypto.js's file header for the
// full reasoning on why the attachment key can't just reuse invoiceHash the
// way the envelope key does). So selecting a file/URL under private mode
// just records it as pending here; the real pin happens later, in
// preparePrivateInvoiceData, orchestrated from onDeposit().
//
// pin* functions are injected so both of these are testable without any
// network access or React.

/**
 * Called when the user selects a file — a fresh attach, or a Replace over
 * an already-pinned one. Public mode pins right away (unchanged). If this
 * is a Replace (previousAttachmentURI/previousAttachmentUnpinToken set, from
 * an earlier public-mode pin), the OLD attachment is unpinned only AFTER
 * the new one has successfully pinned — never before, and never at all if
 * pinFile throws, so a failed Replace can't destroy the still-good original
 * (it stays pinned, just orphaned from this draft's state, which is the
 * safer failure mode). Private mode defers — returns the File itself for
 * the caller to hold until deposit time; nothing was ever pinned for a
 * deferred attachment, so there's nothing to unpin on replace there either.
 * @param {{
 *   file: File, privateMode: boolean,
 *   pinFile: (file: File) => Promise<{ipfsUri: string, sha256: string, unpinToken?: string}>,
 *   previousAttachmentURI?: string, previousAttachmentUnpinToken?: string,
 *   unpinAttachment?: (ipfsUri: string, token: string) => void
 * }} params
 */
export async function resolveFileAttachment({
  file, privateMode, pinFile, previousAttachmentURI, previousAttachmentUnpinToken, unpinAttachment
}) {
  if (!privateMode) {
    const { ipfsUri, sha256, unpinToken } = await pinFile(file)
    if (previousAttachmentURI && previousAttachmentUnpinToken) {
      unpinAttachment?.(previousAttachmentURI, previousAttachmentUnpinToken)
    }
    return { deferred: false, attachmentURI: ipfsUri, attachmentHash: sha256, unpinToken }
  }
  return { deferred: true, pendingFile: file }
}

/**
 * Called when the user submits a pasted URL. Same public/private split and
 * same replace-only-after-success sequencing as resolveFileAttachment.
 * @param {{
 *   url: string, privateMode: boolean,
 *   pinUrl: (url: string) => Promise<{ipfsUri: string, sha256: string, unpinToken?: string}>,
 *   previousAttachmentURI?: string, previousAttachmentUnpinToken?: string,
 *   unpinAttachment?: (ipfsUri: string, token: string) => void
 * }} params
 */
export async function resolveUrlAttachment({
  url, privateMode, pinUrl, previousAttachmentURI, previousAttachmentUnpinToken, unpinAttachment
}) {
  if (!privateMode) {
    const { ipfsUri, sha256, unpinToken } = await pinUrl(url)
    if (previousAttachmentURI && previousAttachmentUnpinToken) {
      unpinAttachment?.(previousAttachmentURI, previousAttachmentUnpinToken)
    }
    return { deferred: false, attachmentURI: ipfsUri, attachmentHash: sha256, unpinToken }
  }
  return { deferred: true, pendingUrl: url }
}

/**
 * Called when the user explicitly removes the current attachment (the
 * Remove button — nothing new is being pinned, unlike Replace). No-ops
 * (via unpinAttachment's own no-op-on-falsy-input guard) when there was
 * nothing actually pinned yet — e.g. a private-mode attachment still only
 * pending, never sent to the server, or no attachment at all.
 * @param {{ attachmentURI?: string, attachmentUnpinToken?: string, unpinAttachment: (ipfsUri: string, token: string) => void }} params
 */
export function resolveRemoveAttachment({ attachmentURI, attachmentUnpinToken, unpinAttachment }) {
  if (attachmentURI && attachmentUnpinToken) {
    unpinAttachment(attachmentURI, attachmentUnpinToken)
  }
}

/**
 * Deposit-time orchestration for private-mode escrows: encrypt+pin the
 * attachment first (if any), fold its ciphertext URI/hash/mime into the
 * invoice envelope, compute invoiceHash over the now-final envelope, then
 * encrypt+pin the envelope (embedding the attachment's salt in its header
 * so a single signed request can unlock both later).
 *
 * Throws — without ever calling deposit() — on any pin failure. The caller
 * (CreateEscrow.jsx's onDeposit) is expected to catch this and halt before
 * prompting a wallet signature, never submitting a transaction with a
 * partial or missing attachment reference.
 *
 * @param {{
 *   invoiceObjectBase: object,
 *   pendingAttachmentFile: File|null,
 *   pendingAttachmentUrl: string|null,
 *   pinPrivateAttachmentFile: (file: File) => Promise<{ipfsUri: string, sha256: string, salt: string, mime: string}>,
 *   pinPrivateAttachmentUrl: (url: string) => Promise<{ipfsUri: string, sha256: string, salt: string, mime: string}>,
 *   pinPrivateInvoice: (invoiceJson: string, invoiceHash: string, attachmentSalt?: string) => Promise<{ipfsUri: string}>,
 *   computeInvoiceHash: (invoiceJson: string) => string
 * }} params
 * @returns {Promise<{ invoiceHash: string, invoiceDataArg: string }>}
 */
export async function preparePrivateInvoiceData({
  invoiceObjectBase,
  pendingAttachmentFile,
  pendingAttachmentUrl,
  pinPrivateAttachmentFile,
  pinPrivateAttachmentUrl,
  pinPrivateInvoice,
  computeInvoiceHash
}) {
  let attachments = []
  let attachmentSalt

  if (pendingAttachmentFile) {
    const r = await pinPrivateAttachmentFile(pendingAttachmentFile)
    attachments = [{ uri: r.ipfsUri, sha256: r.sha256, mime: r.mime }]
    attachmentSalt = r.salt
  } else if (pendingAttachmentUrl) {
    const r = await pinPrivateAttachmentUrl(pendingAttachmentUrl)
    attachments = [{ uri: r.ipfsUri, sha256: r.sha256, mime: r.mime }]
    attachmentSalt = r.salt
  }

  const invoiceObject = { ...invoiceObjectBase, attachments }
  const invoiceJson = JSON.stringify(invoiceObject)
  const invoiceHash = computeInvoiceHash(invoiceJson)

  const { ipfsUri } = await pinPrivateInvoice(invoiceJson, invoiceHash, attachmentSalt)
  return { invoiceHash, invoiceDataArg: ipfsUri }
}
