import { useState } from 'react'

/**
 * Small inline "copy to clipboard" button. Self-contained: shows a transient
 * checkmark on success and falls back to execCommand for non-secure-context
 * webviews (some mobile in-app browsers don't expose navigator.clipboard).
 */
export default function CopyButton({ text, title = 'Copy to clipboard', className = '' }) {
  const [copied, setCopied] = useState(false)
  const disabled = !text || !String(text).trim()

  const handleCopy = async () => {
    if (disabled) return
    const value = String(text)
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Fallback for non-secure contexts / older mobile webviews
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* best effort */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'copied' : ''} ${className}`.trim()}
      onClick={handleCopy}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
    </button>
  )
}
