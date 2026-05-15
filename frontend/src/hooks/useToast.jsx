import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

let id = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((tid) => {
    setToasts((arr) => arr.filter((t) => t.id !== tid))
  }, [])

  const push = useCallback((toast) => {
    const tid = ++id
    const ttl = toast.ttl ?? 5000
    setToasts((arr) => [...arr, { ...toast, id: tid }])
    if (ttl > 0) setTimeout(() => remove(tid), ttl)
    return tid
  }, [remove])

  const api = {
    success: (msg, opts = {}) => push({ type: 'success', message: msg, ...opts }),
    error:   (msg, opts = {}) => push({ type: 'error',   message: msg, ...opts }),
    info:    (msg, opts = {}) => push({ type: 'info',    message: msg, ...opts }),
    pending: (msg, opts = {}) => push({ type: 'pending', message: msg, ttl: 0, ...opts }),
    remove
  }

  return (
    <ToastContext.Provider value={{ toasts, ...api }}>
      {children}
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
