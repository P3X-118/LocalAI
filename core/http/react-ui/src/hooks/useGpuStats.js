import { useState, useEffect, useRef, useCallback } from 'react'
import { gpuApi } from '../utils/api'

// useGpuStats polls the lightweight /api/gpu endpoint for live GPU/memory
// stats. It pauses while the browser tab is hidden (no point polling an unseen
// gauge) and backs off after repeated failures so a missing or forbidden
// endpoint doesn't spam the network.
export function useGpuStats(pollInterval = 2500) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const failuresRef = useRef(0)

  const fetchStats = useCallback(async () => {
    try {
      const data = await gpuApi.get()
      setStats(data)
      setError(null)
      failuresRef.current = 0
    } catch (err) {
      failuresRef.current += 1
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    function schedule(delay) {
      timerRef.current = setTimeout(tick, delay)
    }

    async function tick() {
      if (cancelled) return
      // Skip work while the tab is in the background.
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(pollInterval)
        return
      }
      await fetchStats()
      if (cancelled) return
      const delay = failuresRef.current > 3 ? Math.min(pollInterval * 8, 30000) : pollInterval
      schedule(delay)
    }

    function onVisible() {
      if (!document.hidden) {
        clearTimeout(timerRef.current)
        tick()
      }
    }

    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchStats, pollInterval])

  return { stats, error }
}
