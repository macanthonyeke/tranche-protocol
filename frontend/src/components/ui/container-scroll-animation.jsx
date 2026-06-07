import React, { useRef } from "react"
import { useScroll, useTransform, motion } from "framer-motion"

export const ContainerScroll = ({ titleComponent, children }) => {
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: containerRef })
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0])
  const scale = useTransform(scrollYProgress, [0, 1], isMobile ? [0.7, 0.9] : [1.05, 1])
  const translate = useTransform(scrollYProgress, [0, 1], [0, -100])

  return (
    <div
      className="h-[44rem] md:h-[56rem] flex items-center justify-center relative p-2 md:p-10"
      ref={containerRef}
    >
      <div className="py-8 md:py-16 w-full relative" style={{ perspective: "1000px" }}>
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} scale={scale}>
          {children}
        </Card>
      </div>
    </div>
  )
}

const Header = ({ translate, titleComponent }) => (
  <motion.div
    style={{ translateY: translate }}
    className="max-w-5xl mx-auto text-center mb-12"
  >
    {titleComponent}
  </motion.div>
)

const Card = ({ rotate, scale, children }) => (
  <motion.div
    style={{ rotateX: rotate, scale }}
    className="max-w-4xl -mt-12 mx-auto"
  >
    {children}
  </motion.div>
)
