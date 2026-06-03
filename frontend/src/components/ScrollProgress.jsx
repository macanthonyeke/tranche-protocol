import { useScroll, useSpring, motion, useReducedMotion } from 'framer-motion'

export default function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const reduce = useReducedMotion()
  const scaleX = useSpring(scrollYProgress, { stiffness: 400, damping: 40, restDelta: 0.001 })
  if (reduce) return null
  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-[2px] bg-clay origin-left z-[60] pointer-events-none"
      style={{ scaleX }}
    />
  )
}
