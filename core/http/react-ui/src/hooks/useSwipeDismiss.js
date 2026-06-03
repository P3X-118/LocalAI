import { useRef, useState, useCallback } from 'react'

// Swipe-down-to-dismiss for the bottom-sheet modals on touch devices.
// Attach `handlers` to the drag region (the grab handle) and spread `style`
// onto the sheet element so it follows the finger; releasing past `threshold`
// pixels calls onClose. Attaching only to the handle keeps body scrolling
// from being hijacked.
export function useSwipeDismiss(onClose, { threshold = 90 } = {}) {
  const startY = useRef(null)
  const [dy, setDy] = useState(0)

  const onTouchStart = useCallback((e) => {
    startY.current = e.touches[0]?.clientY ?? null
    setDy(0)
  }, [])

  const onTouchMove = useCallback((e) => {
    if (startY.current == null) return
    const delta = e.touches[0].clientY - startY.current
    setDy(delta > 0 ? delta : 0) // only track downward drags
  }, [])

  const onTouchEnd = useCallback(() => {
    if (dy > threshold) onClose?.()
    startY.current = null
    setDy(0)
  }, [dy, threshold, onClose])

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    style: dy > 0 ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined,
  }
}
