import { useEffect, useState } from 'react'
import { useMediaJobs } from '../hooks/useMediaJobs'

const SIZES = ['256x256', '512x512', '768x768', '1024x1024']

// RemixDialog — edit the prompt + params of an existing image generation and
// re-fire it as either text-to-image (don't pass the source) or img2img
// (pass this artifact's URL as the source). Submits through useMediaJobs so
// the new run shows up in the JobsDock immediately.
//
// Props:
//   open    bool
//   item    MediaArtifact (image only)
//   onClose () => void
export default function RemixDialog({ open, item, onClose }) {
  const { submit } = useMediaJobs()
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [size, setSize] = useState('512x512')
  const [steps, setSteps] = useState('')
  const [seed, setSeed] = useState('')
  const [n, setN] = useState(1)
  const [mode, setMode] = useState('text2img') // 'text2img' | 'img2img'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !item) return
    setPrompt(item.prompt || '')
    setNegativePrompt(item.negative_prompt || '')
    const p = item.params || {}
    const w = p.width, h = p.height
    if (w && h) setSize(`${w}x${h}`)
    else setSize('512x512')
    setSteps(p.step ? String(p.step) : '')
    setSeed(p.seed && p.seed !== -1 ? String(p.seed) : '')
    setN(p.n || 1)
    setMode('text2img')
    setError('')
  }, [open, item])

  if (!open || !item) return null

  const previewUrl = (item.output_url || '').replace(/^https?:\/\/[^/]+/, '') || item.output_url

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError('Prompt is required'); return }
    setError('')
    setSubmitting(true)

    let combined = prompt.trim()
    if (negativePrompt.trim()) combined += '|' + negativePrompt.trim()
    const body = {
      model: item.model,
      prompt: combined,
      size,
      n: Number(n) || 1,
    }
    if (steps) body.step = parseInt(steps, 10)
    if (seed) body.seed = parseInt(seed, 10)
    if (mode === 'img2img' && previewUrl) body.file = previewUrl

    try {
      await submit('image', body)
      onClose?.()
    } catch (e) {
      setError(e.message || 'Failed to queue generation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content remix-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><i className="fas fa-wand-magic-sparkles" /> Remix</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body remix-body">
          <div className="remix-preview">
            <img src={previewUrl} alt={item.prompt?.slice(0, 60) || 'source'} />
            <div className="remix-preview-meta">
              <span title={item.model}>{item.model}</span>
            </div>
          </div>

          <div className="remix-mode-toggle" role="radiogroup" aria-label="Remix mode">
            <button
              type="button"
              className={`remix-mode-option ${mode === 'text2img' ? 'remix-mode-option-active' : ''}`}
              onClick={() => setMode('text2img')}
              role="radio"
              aria-checked={mode === 'text2img'}
            >
              <i className="fas fa-font" />
              <span>Text → Image</span>
              <small>Start fresh from the prompt</small>
            </button>
            <button
              type="button"
              className={`remix-mode-option ${mode === 'img2img' ? 'remix-mode-option-active' : ''}`}
              onClick={() => setMode('img2img')}
              role="radio"
              aria-checked={mode === 'img2img'}
            >
              <i className="fas fa-arrow-right-arrow-left" />
              <span>Image → Image</span>
              <small>Use this image as the source</small>
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Prompt</label>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe the new image…"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Negative prompt</label>
            <textarea
              className="textarea"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="(optional) what to avoid"
            />
          </div>

          <div className="remix-params">
            <div className="form-group">
              <label className="form-label">Size</label>
              <select className="model-selector" value={size} onChange={(e) => setSize(e.target.value)}>
                {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Count</label>
              <input className="input" type="number" min={1} max={4} value={n} onChange={(e) => setN(parseInt(e.target.value, 10) || 1)} />
            </div>
            <div className="form-group">
              <label className="form-label">Steps</label>
              <input className="input" type="number" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="20" />
            </div>
            <div className="form-group">
              <label className="form-label">Seed</label>
              <input className="input" type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" />
            </div>
          </div>

          {error && <div className="remix-error">{error}</div>}
        </div>
        <div className="remix-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={submitting}>
            {submitting ? 'Queueing…' : <><i className="fas fa-wand-magic-sparkles" /> Generate</>}
          </button>
        </div>
      </div>
    </div>
  )
}
