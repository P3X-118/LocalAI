import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { mediaJobsApi } from '../utils/api'

// Persists active-job IDs across page reloads so an in-flight generation
// doesn't vanish from the dock if the user refreshes the tab.
const STORAGE_KEY = 'localai.media-jobs.active'

const MediaJobsContext = createContext(null)

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function loadActiveIDs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveActiveIDs(ids) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

export function MediaJobsProvider({ children }) {
  const [jobs, setJobs] = useState({}) // { [id]: MediaJob }
  const sources = useRef({}) // { [id]: EventSource } — one SSE per non-terminal job

  // Re-hydrate active jobs on mount
  useEffect(() => {
    const ids = loadActiveIDs()
    if (!ids.length) return
    Promise.all(
      ids.map(id => mediaJobsApi.get(id).catch(() => null))
    ).then(results => {
      setJobs(prev => {
        const next = { ...prev }
        results.forEach(j => { if (j && j.id) next[j.id] = j })
        return next
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist active job IDs whenever the in-memory map changes
  useEffect(() => {
    const active = Object.values(jobs).filter(j => !TERMINAL.has(j.status)).map(j => j.id)
    saveActiveIDs(active)
  }, [jobs])

  // Manage SSE subscriptions: open one per non-terminal job, close when terminal
  useEffect(() => {
    Object.values(jobs).forEach(j => {
      if (TERMINAL.has(j.status)) {
        if (sources.current[j.id]) {
          sources.current[j.id].close()
          delete sources.current[j.id]
        }
        return
      }
      if (sources.current[j.id]) return
      try {
        const es = new EventSource(mediaJobsApi.sseUrl(j.id), { withCredentials: true })
        es.addEventListener('status', (ev) => {
          try {
            const data = JSON.parse(ev.data)
            setJobs(prev => ({ ...prev, [data.id]: data }))
          } catch { /* ignore parse error */ }
        })
        es.addEventListener('error', () => {
          // EventSource auto-reconnects; we don't tear down on first error.
          // If the connection is truly dead, the next GET polls below will recover.
        })
        sources.current[j.id] = es
      } catch {
        // EventSource unsupported — fall through to polling below
      }
    })
    return () => {
      // No-op on unmount — sources persist across re-renders. Cleanup happens
      // when a job goes terminal (handled at top of this effect on next pass).
    }
  }, [jobs])

  // Cleanup all sources when the provider unmounts (app navigates away,
  // SPA-level which rarely happens, but be tidy).
  useEffect(() => {
    return () => {
      Object.values(sources.current).forEach(es => es.close())
      sources.current = {}
    }
  }, [])

  // Imperative API
  const submit = useCallback(async (mediaType, body) => {
    // Returns the job record immediately. Caller can show a toast.
    const job = await mediaJobsApi.enqueue(mediaType, body)
    setJobs(prev => ({ ...prev, [job.id]: job }))
    return job
  }, [])

  const dismiss = useCallback((id) => {
    setJobs(prev => {
      const next = { ...prev }
      delete next[id]
      if (sources.current[id]) { sources.current[id].close(); delete sources.current[id] }
      return next
    })
  }, [])

  const cancel = useCallback(async (id) => {
    try { await mediaJobsApi.cancel(id) } catch { /* ignore */ }
    // The SSE will deliver the terminal state; nothing else to do here.
  }, [])

  const value = useMemo(() => ({
    jobs: Object.values(jobs).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    submit,
    dismiss,
    cancel,
  }), [jobs, submit, dismiss, cancel])

  return (
    <MediaJobsContext.Provider value={value}>{children}</MediaJobsContext.Provider>
  )
}

export function useMediaJobs() {
  const ctx = useContext(MediaJobsContext)
  if (!ctx) throw new Error('useMediaJobs must be used inside <MediaJobsProvider>')
  return ctx
}

export { TERMINAL as MEDIA_JOB_TERMINAL_STATUSES }
