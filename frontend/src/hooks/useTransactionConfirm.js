import { createElement, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import TransactionConfirmModal from '../components/TransactionConfirmModal.jsx'
import { getConfirmMode, CONFIRM_MODE_COMPARE } from '../confirm/mode.js'

const LEASE_MARKER = Symbol('tranche-circle-execution-lease')
let active = null
let activeSnapshot = null
let nextOwnerId = 1
const listeners = new Set()

function notify() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot() {
  return activeSnapshot
}

export class ConcurrentCircleActionError extends Error {
  constructor() {
    super('Another Circle transaction is already awaiting confirmation. Finish it before starting another.')
    this.name = 'ConcurrentCircleActionError'
  }
}

export class TransactionCancelledError extends Error {
  constructor() {
    super('Transaction cancelled.')
    this.name = 'TransactionCancelledError'
  }
}

function clear(record) {
  if (!active || active.ownerId !== record.ownerId) return
  active = null
  activeSnapshot = null
  notify()
}

function makeLease(record) {
  return Object.freeze({
    [LEASE_MARKER]: true,
    ownerId: record.ownerId,
    actionDigest: record.action.digest
  })
}

/* Only useAuth imports this verifier. The marker is module-private, so the
   bounded claim is: no normal production React call-site bypass exists. A
   raw executeContractCall call cannot get a valid lease without going through
   this coordinator. This is an in-process UI boundary, not a server-verifiable
   authorization: the current API still trusts browser-supplied transaction
   fields after this boundary. Native mode must not rely on the lease alone. */
export function isCircleExecutionLease(lease, action) {
  return !!lease && lease[LEASE_MARKER] === true &&
    lease.actionDigest === action?.digest &&
    lease.ownerId === active?.ownerId
}

async function execute(record) {
  const lease = makeLease(record)
  try {
    const result = await record.executor(lease)
    record.resolve(result)
  } catch (error) {
    record.reject(error)
  } finally {
    clear(record)
  }
}

function start(action, executor, mode) {
  if (active) return Promise.reject(new ConcurrentCircleActionError())

  const ownerId = nextOwnerId++
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  const record = {
    action,
    executor,
    mode,
    ownerId,
    phase: mode === CONFIRM_MODE_COMPARE ? 'reviewing' : 'executing',
    resolve,
    reject
  }
  active = record
  activeSnapshot = record
  notify()

  if (mode !== CONFIRM_MODE_COMPARE) void execute(record)
  return promise
}

export function continueActiveConfirmation() {
  const record = active
  if (!record || record.phase !== 'reviewing') return false
  active = { ...record, phase: 'executing' }
  activeSnapshot = active
  notify()
  void execute(active)
  return true
}

export function cancelActiveConfirmation() {
  const record = active
  if (!record || record.phase !== 'reviewing') return false
  record.reject(new TransactionCancelledError())
  clear(record)
  return true
}

/* Test-only reset. It rejects an intentionally held action so no promise or
   lease survives between tests. Production code never calls this. */
export function __resetConfirmationForTests() {
  const record = active
  if (!record) return
  record.reject(new TransactionCancelledError())
  clear(record)
}

export function useTransactionConfirm() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const run = useCallback((action, executor, { mode } = {}) => {
    return start(action, executor, getConfirmMode(mode))
  }, [])
  return {
    active: current,
    run,
    continueConfirmation: continueActiveConfirmation,
    cancelConfirmation: cancelActiveConfirmation
  }
}

export function TransactionConfirmHost() {
  const { active: current, continueConfirmation, cancelConfirmation } = useTransactionConfirm()
  if (!current || current.phase !== 'reviewing') return null
  return createElement(TransactionConfirmModal, {
    action: current.action,
    onContinue: continueConfirmation,
    onCancel: cancelConfirmation
  })
}

/* The host intentionally lives above the route tree, so a route component
   unmount cannot accidentally submit or own the review. This companion sits
   just inside BrowserRouter and cancels a still-reviewing action whenever the
   route changes; navigation is therefore another guaranteed no-submit exit. */
export function TransactionConfirmNavigationGuard() {
  const location = useLocation()
  const previousKey = useRef(location.key)

  useLayoutEffect(() => {
    if (previousKey.current === location.key) return
    previousKey.current = location.key
    cancelActiveConfirmation()
  }, [location.key])

  return null
}
