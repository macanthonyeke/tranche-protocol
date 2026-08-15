import Modal from './Modal.jsx'
import { formatUSDC } from '../utils/format.js'

function Detail({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-ink-3">{label}</dt>
      <dd className="text-sm text-ink break-words">{children}</dd>
    </div>
  )
}

export default function TransactionConfirmModal({ action, onContinue, onCancel }) {
  const descriptor = action.descriptor
  const busy = false

  return (
    <Modal
      open
      onClose={onCancel}
      title={descriptor.title}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onContinue} disabled={busy}>
            Continue to Circle confirmation
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-sm text-ink-2 leading-relaxed">{descriptor.subtitle}</p>
          <p className="text-xs text-ink-3 mt-2">Review the exact blockchain action before continuing.</p>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Detail label="Chain">{action.chain.name} ({action.chain.id})</Detail>
          {action.walletAddress && <Detail label="Wallet">{action.walletAddress}</Detail>}
          {descriptor.amount !== undefined && (
            <Detail label={descriptor.amountLabel || 'Amount'}>{formatUSDC(descriptor.amount)}</Detail>
          )}
          <Detail label="Contract">
            <span className="block">{descriptor.contractName}</span>
            <span className="block font-mono text-xs text-ink-2">{descriptor.contractAddress}</span>
          </Detail>
          <Detail label="Function">{descriptor.functionName}</Detail>
        </dl>

        {descriptor.parameters.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-3 mb-2">Parameters</p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-2">
              {descriptor.parameters.map((parameter, index) => <li key={`${index}-${parameter}`}>{parameter}</li>)}
            </ul>
          </div>
        )}

        <p className="text-xs text-ink-2 leading-relaxed border-l-2 border-clay pl-3">
          By continuing, you acknowledge that you are authorizing the blockchain action displayed above.
          Circle will show its confirmation screen next.
        </p>
      </div>
    </Modal>
  )
}
