import React, { useRef } from "react"
import { useScroll, useTransform, motion } from "framer-motion"

export const ContainerScroll = ({ titleComponent, children }) => {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  )

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  if (isMobile) {
    return (
      <div className="flex flex-col items-center gap-8 px-4 py-12 w-full">
        <div className="max-w-5xl mx-auto text-center">{titleComponent}</div>
        <div className="w-full">{children}</div>
      </div>
    )
  }

  return <DesktopScroll titleComponent={titleComponent}>{children}</DesktopScroll>
}

function DesktopScroll({ titleComponent, children }) {
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: containerRef })

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1])
  const translate = useTransform(scrollYProgress, [0, 1], [0, -100])

  return (
    <div
      className="h-[56rem] flex items-center justify-center relative p-10"
      ref={containerRef}
    >
      <div className="py-16 w-full relative" style={{ perspective: "1000px" }}>
        <motion.div
          style={{ translateY: translate }}
          className="max-w-5xl mx-auto text-center mb-12"
        >
          {titleComponent}
        </motion.div>
        <motion.div
          style={{ rotateX: rotate, scale }}
          className="max-w-4xl -mt-12 mx-auto"
        >
          {children}
        </motion.div>
      </div>
    </div>
  )
}
