import { useState, useEffect, useRef } from 'react'

// usePersistedState — useState + localStorage. State survives navigation,
// refresh, and tab close. Pages that hold long-form input (Studio Image/
// Video/TTS/Sound prompts and params) should use this so a user doesn't
// lose typed work when clicking Generations, dock View result, etc.
//
// Key namespace convention: 'localai.<page>.<field>' so global wipes are
// easy and collisions are impossible.
//
// Skip persisting for transient/sensitive fields (file blobs, errors,
// loading flags). Only stable user input (prompt, size, seed, etc).
export function usePersistedState(key, initial) {
  const initialRef = useRef(initial)
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialRef.current
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initialRef.current
      return JSON.parse(raw)
    } catch {
      return initialRef.current
    }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      // Drop empty strings + null + undefined so the key reverts to initial on next load.
      if (value === '' || value == null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(value))
      }
    } catch {
      // localStorage may be unavailable (private mode, quota); fail silent.
    }
  }, [key, value])
  return [value, setValue]
}
