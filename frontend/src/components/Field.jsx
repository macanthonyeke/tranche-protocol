import React, { useId } from 'react'

/* Field accepts children as either:
   - a render function (preferred): receives { id, aria-labelledby, aria-describedby, aria-invalid }
     and the caller wires them to the actual control. Required when the control
     is wrapped in a positioning <div> where cloneElement would land the id on
     the wrapper instead of the input.
   - a single element: id + aria-* are cloned onto it. Convenient for direct
     <input> / <textarea> children. */
export default function Field({ label, hint, children, error, helper }) {
  const reactId = useId()
  const fieldId = reactId
  const labelId = `${reactId}-label`
  const helperId = `${reactId}-helper`
  const errorId = `${reactId}-error`
  const describedBy = error ? errorId : helper ? helperId : undefined
  const fieldProps = {
    id: fieldId,
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined
  }

  let content
  if (typeof children === 'function') {
    content = children(fieldProps)
  } else if (Array.isArray(children) || !children) {
    content = children
  } else if (React.isValidElement(children)) {
    content = React.cloneElement(children, {
      id: children.props.id ?? fieldId,
      'aria-labelledby': children.props['aria-labelledby'] ?? labelId,
      'aria-describedby': children.props['aria-describedby'] ?? describedBy,
      'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined)
    })
  } else {
    content = children
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          id={labelId}
          htmlFor={fieldId}
          className="field-label"
        >
          {label}
        </label>
        {hint && <div className="text-ink-3">{hint}</div>}
      </div>
      {content}
      {error ? (
        <FieldError id={errorId} text={error} />
      ) : helper ? (
        <div id={helperId} className="text-[12.5px] text-ink-3">{helper}</div>
      ) : null}
    </div>
  )
}

export function FieldError({ text, id }) {
  return (
    <div id={id} role="alert" className="flex items-center gap-1.5 text-[12.5px] text-bad">
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 4.2v3.2M7 9.5v0.05" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>{text}</span>
    </div>
  )
}
