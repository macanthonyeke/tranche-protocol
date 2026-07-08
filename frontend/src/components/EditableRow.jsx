import { useId, useLayoutEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CustomSelect from './CustomSelect.jsx'
import IconButton from './IconButton.jsx'

/* Shared inline-edit primitive behind every editable escrow parameter:
   extend-deadline, edit-invoice-link, update-receiving-address, update-split-address.
   One row shows label + current value + Edit; clicking expands an inline form.
   Save/Cancel and the actual tx submission stay owned by the caller (each
   parameter has its own useTx with different escrowWrite args and onConfirmed
   side effects) — this component only owns the draft/editing UI shell.

   `editing` is internal state, closed by the caller by passing a `key` that
   changes on tx confirm (e.g. a save counter) so this component remounts
   with editing=false, the same instant `successMessage` becomes non-null. */
export default function EditableRow({
  label, ownerTag, currentDisplay, help,
  fields, validate, onSubmit, busy, successMessage, last
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const pencilId = useId()

  useLayoutEffect(() => {
    if (editing) setDraft(Object.fromEntries(fields.map((f) => [f.key, f.value ?? ''])))
  }, [editing]) // eslint-disable-line

  const valid = validate ? validate(draft) : true

  const submit = () => {
    if (!valid || busy) return
    onSubmit(draft)
  }

  return (
    <div className={`py-3 ${last ? '' : 'border-b border-rule/50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-ink-2">{label}</span>
            {ownerTag && (
              <span className="rounded-sm px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] bg-sunk text-ink-3">
                {ownerTag}
              </span>
            )}
          </div>
          {!editing && (
            <div className={`text-[13.5px] font-mono truncate ${currentDisplay ? 'text-ink' : 'text-ink-3'}`}>
              {currentDisplay || '— none set —'}
            </div>
          )}
        </div>
        {!editing && (
          <IconButton
            label={`Edit ${label}`}
            size="sm"
            tone="ghost"
            className="text-clay hover:text-clay-hover shrink-0"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </IconButton>
        )}
      </div>

      {successMessage && !editing && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] bg-ok/10 text-ok">
          <CheckIcon /> {successMessage}
        </div>
      )}

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key={pencilId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3 overflow-hidden mt-3"
          >
            {help && <p className="text-xs text-ink-2 leading-relaxed">{help}</p>}
            {fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-2">{f.label}</label>
                {f.type === 'select' ? (
                  <CustomSelect
                    value={draft[f.key]}
                    onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                    options={f.options}
                    placeholder="Select…"
                  />
                ) : (
                  <input
                    type={f.type === 'datetime' ? 'datetime-local' : 'text'}
                    className={`input-field text-sm ${f.mono ? 'font-mono' : ''}`}
                    placeholder={f.placeholder}
                    min={f.min}
                    autoComplete="off"
                    spellCheck={false}
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                className="btn-primary text-sm py-2 flex-1"
                disabled={!valid || busy}
                onClick={submit}
              >
                {busy ? 'Working…' : 'Save changes'}
              </button>
              <button
                type="button"
                className="btn-secondary text-sm py-2"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.5 3.5 16.5 6.5 7 16H4v-3z" />
      <path d="M11.5 5.5 14.5 8.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
