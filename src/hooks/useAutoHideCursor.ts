import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * Auto-hide cursor after a period of inactivity
 *
 * @param delay - Time in milliseconds before hiding cursor (default: 3000ms)
 * @returns showCursor - Whether cursor should be visible
 * @returns containerRef - Ref to attach to the container element
 *
 * @example
 * ```tsx
 * const { showCursor, containerRef } = useAutoHideCursor(3000)
 *
 * return (
 *   <div
 *     ref={containerRef}
 *     css={css({ cursor: showCursor ? 'default' : 'none' })}
 *   >
 *     Content
 *   </div>
 * )
 * ```
 */
export const useAutoHideCursor = (delay: number = 3000) => {
  const [showCursor, setShowCursor] = useState(true)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle mouse move - memoized to prevent unnecessary re-registrations
  const handleMouseMove = useCallback(() => {
    // Show cursor immediately
    setShowCursor(true)

    // Clear existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }

    // Set new timeout to hide cursor
    hideTimeoutRef.current = setTimeout(() => {
      setShowCursor(false)
    }, delay)
  }, [delay])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Register mousemove listener
    container.addEventListener('mousemove', handleMouseMove)

    // Initial timeout to hide cursor
    hideTimeoutRef.current = setTimeout(() => {
      setShowCursor(false)
    }, delay)

    // Cleanup
    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [handleMouseMove, delay])

  return { showCursor, containerRef }
}
