import { useState, useEffect } from 'react'
import { useParams, useOutletContext, useLocation } from 'react-router-dom'
import ModelSelector from '../components/ModelSelector'
import { CAP_IMAGE } from '../utils/capabilities'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorWithTraceLink from '../components/ErrorWithTraceLink'
import GpuGauge from '../components/GpuGauge'
import ImagePicker from '../components/ImagePicker'
import { generationsApi } from '../utils/api'
import { useMediaJobs } from '../hooks/useMediaJobs'
import { usePersistedState } from '../hooks/usePersistedState'

const SIZES = ['256x256', '512x512', '768x768', '1024x1024']

export default function ImageGen() {
  const { model: urlModel } = useParams()
  const { addToast } = useOutletContext()
  const { jobs, submit } = useMediaJobs()
  const location = useLocation()
  const [model, setModel] = usePersistedState('localai.studio.image.model', urlModel || '')
  const [prompt, setPrompt] = usePersistedState('localai.studio.image.prompt', '')
  const [negativePrompt, setNegativePrompt] = usePersistedState('localai.studio.image.negative', '')
  const [size, setSize] = usePersistedState('localai.studio.image.size', '512x512')
  const [count, setCount] = usePersistedState('localai.studio.image.count', 1)
  const [steps, setSteps] = usePersistedState('localai.studio.image.steps', '')
  const [seed, setSeed] = usePersistedState('localai.studio.image.seed', '')
  const [error, setError] = useState(null)
  const [images, setImages] = useState([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showImageInputs, setShowImageInputs] = useState(false)
  const [sourceImage, setSourceImage] = useState(null)
  const [refImages, setRefImages] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const [sourcePicker, setSourcePicker] = useState(false)
  const [refPicker, setRefPicker] = useState(false)

  // Honor pre-fills from the Generations page ("Use as source / references")
  useEffect(() => {
    const s = location.state || {}
    if (s.sourceImage) {
      setSourceImage(s.sourceImage)
      setShowImageInputs(true)
    }
    if (Array.isArray(s.refImages) && s.refImages.length) {
      setRefImages(s.refImages)
      setShowImageInputs(true)
    }
    // One-shot: clear the state so a page refresh doesn't re-apply it.
    if (s.sourceImage || s.refImages) {
      window.history.replaceState({}, '')
    }
  }, [location.state])

  // Mirror this page's pending job from the global jobs map.
  const activeJob = activeJobId ? jobs.find(j => j.id === activeJobId) : null
  const loading = activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')

  // When our job completes, look up the resulting artifact and show it inline.
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'completed' || !activeJob.artifact_id) return
    let cancelled = false
    generationsApi.get(activeJob.artifact_id).then(a => {
      if (cancelled) return
      if (a?.output_url) setImages([{ url: a.output_url }])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeJob?.status, activeJob?.artifact_id])

  // Surface failures from the job into the page error display.
  useEffect(() => {
    if (activeJob && activeJob.status === 'failed') setError(activeJob.error || 'generation failed')
  }, [activeJob?.status, activeJob?.error])

  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) { addToast('Please enter a prompt', 'warning'); return }
    if (!model) { addToast('Please select a model', 'warning'); return }

    setError(null)
    setImages([])

    let combinedPrompt = prompt.trim()
    if (negativePrompt.trim()) combinedPrompt += '|' + negativePrompt.trim()

    const body = { model, prompt: combinedPrompt, n: count, size }
    if (steps) body.step = parseInt(steps)
    if (seed) body.seed = parseInt(seed)
    if (sourceImage) body.file = sourceImage
    if (refImages.length > 0) body.ref_images = refImages

    try {
      const job = await submit('image', body)
      setActiveJobId(job.id)
      addToast('Generation queued — track progress in the dock', 'info')
    } catch (err) {
      setError(err.message)
    }
  }

  // Short preview label for an image value (URL or base64).
  const previewLabel = (val) => {
    if (!val) return ''
    if (val.startsWith('http')) {
      const tail = val.split('/').pop() || val
      return tail.length > 30 ? tail.slice(0, 30) + '…' : tail
    }
    if (val.startsWith('/')) return val.split('/').pop() || val
    return `${(val.length / 1024).toFixed(0)} KB image`
  }
  // Thumbnail src — pass URLs straight through, base64 with data prefix.
  const previewSrc = (val) => {
    if (!val) return ''
    if (val.startsWith('http') || val.startsWith('/')) return val
    return `data:image/png;base64,${val}`
  }

  return (
    <div className="media-layout">
      <div className="media-controls">
        <div className="page-header media-page-header">
          <h1 className="page-title"><i className="fas fa-image" style={{ marginRight: 8, color: 'var(--color-accent)' }} />Image Generation</h1>
          <GpuGauge />
        </div>

        <form onSubmit={handleGenerate}>
          <div className="form-group">
            <label className="form-label">Model</label>
            <ModelSelector value={model} onChange={setModel} capability={CAP_IMAGE} />
          </div>
          <div className="form-group">
            <label className="form-label">Prompt</label>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image you want to generate..." rows={3} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(e) } }} />
          </div>
          <div className="form-group">
            <label className="form-label">Negative Prompt</label>
            <textarea className="textarea" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="What to avoid..." rows={2} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)' }}>
            <div className="form-group">
              <label className="form-label">Size</label>
              <select className="model-selector" value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '100%' }}>
                {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Count (1-4)</label>
              <input className="input" type="number" min="1" max="4" value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} />
            </div>
          </div>

          <div className={`collapsible-header ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)}>
            <i className="fas fa-chevron-right" /> Advanced Settings
          </div>
          {showAdvanced && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
              <div className="form-group"><label className="form-label">Steps</label><input className="input" type="number" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="20" /></div>
              <div className="form-group"><label className="form-label">Seed</label><input className="input" type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /></div>
            </div>
          )}

          <div className={`collapsible-header ${showImageInputs ? 'open' : ''}`} onClick={() => setShowImageInputs(!showImageInputs)}>
            <i className="fas fa-chevron-right" /> Image Inputs
          </div>
          {showImageInputs && (
            <div className="image-inputs" style={{ marginBottom: 'var(--spacing-md)' }}>
              <div className="form-group">
                <label className="form-label">Source Image (img2img)</label>
                {sourceImage ? (
                  <div className="image-input-chip">
                    <img src={previewSrc(sourceImage)} alt="source" />
                    <span className="image-input-chip-label" title={sourceImage}>{previewLabel(sourceImage)}</span>
                    <button type="button" className="image-input-chip-x" onClick={() => setSourceImage(null)} title="Remove">×</button>
                  </div>
                ) : (
                  <button type="button" className="btn image-input-choose" onClick={() => setSourcePicker(true)}>
                    <i className="fas fa-plus" /> Choose source image
                  </button>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">
                  Reference Images
                  {refImages.length > 0 && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginLeft: 8 }}>({refImages.length} added)</span>}
                </label>
                <div className="image-input-chips">
                  {refImages.map((r, i) => (
                    <div key={i} className="image-input-chip image-input-chip-small">
                      <img src={previewSrc(r)} alt="ref" />
                      <button type="button" className="image-input-chip-x" onClick={() => setRefImages(refImages.filter((_, k) => k !== i))} title="Remove">×</button>
                    </div>
                  ))}
                  <button type="button" className="btn image-input-choose" onClick={() => setRefPicker(true)}>
                    <i className="fas fa-plus" /> Add references
                  </button>
                </div>
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? <><LoadingSpinner size="sm" /> Generating...</> : <><i className="fas fa-wand-magic-sparkles" /> Generate</>}
          </button>
        </form>
      </div>

      <div className="media-preview">
        <div className="media-result">
          {loading ? (
            <LoadingSpinner size="lg" />
          ) : error ? (
            <ErrorWithTraceLink message={error} />
          ) : images.length > 0 ? (
            <div className="media-result-grid">
              {images.map((img, i) => (
                <div key={i}>
                  <img src={img.url || `data:image/png;base64,${img.b64_json}`} alt={prompt} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <i className="fas fa-image" style={{ fontSize: '3rem', marginBottom: 'var(--spacing-md)', opacity: 0.4 }} />
              <p>Generated images will appear here</p>
            </div>
          )}
        </div>
      </div>

      <ImagePicker
        open={sourcePicker}
        multi={false}
        title="Choose source image (img2img)"
        onClose={() => setSourcePicker(false)}
        onPick={(arr) => { if (arr?.[0]) setSourceImage(arr[0]); setSourcePicker(false) }}
      />
      <ImagePicker
        open={refPicker}
        multi={true}
        title="Add reference images"
        onClose={() => setRefPicker(false)}
        onPick={(arr) => { setRefImages(prev => [...prev, ...(arr || [])]); }}
      />
    </div>
  )
}
