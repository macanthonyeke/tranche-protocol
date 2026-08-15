export const CONFIRM_MODE_CIRCLE = 'circle'
export const CONFIRM_MODE_COMPARE = 'compare'

/* Native is deliberately not a valid Phase 1 value. Unknown values, including
   the future "native" value, fail closed to Circle's hosted confirmation. */
export function getConfirmMode(value = import.meta.env.VITE_UCW_CONFIRM_MODE) {
  return value === CONFIRM_MODE_COMPARE ? CONFIRM_MODE_COMPARE : CONFIRM_MODE_CIRCLE
}
