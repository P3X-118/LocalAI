import { useState, useEffect, useMemo } from 'react'
import { useParams, useOutletContext, useLocation } from 'react-router-dom'
import MultiModelSelector from '../components/MultiModelSelector'
import { CAP_IMAGE } from '../utils/capabilities'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorWithTraceLink from '../components/ErrorWithTraceLink'
import GpuGauge from '../components/GpuGauge'
import ImagePicker from '../components/ImagePicker'
import CopyButton from '../components/CopyButton'
import { generationsApi } from '../utils/api'
import { useMediaJobs } from '../hooks/useMediaJobs'
import { usePersistedState } from '../hooks/usePersistedState'

const SIZES = ['256x256', '512x512', '768x768', '1024x1024']
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'dpmpp_2m_sde', 'heun', 'lms', 'ddim', 'lcm', 'uni_pc']
const SCHEDULERS = ['normal', 'karras', 'exponential', 'simple', 'sgm_uniform', 'ddim_uniform', 'beta']

export default function ImageGen() {
  const { model: urlModel } = useParams()
  const { addToast } = useOutletContext()
  const { jobs, submit } = useMediaJobs()
  const location = useLocation()
  const [models, setModels] = usePersistedState('localai.studio.image.models', urlModel ? [urlModel] : [])
  const [prompt, setPrompt] = usePersistedState('localai.studio.image.prompt', '')
  const [negativePrompt, setNegativePrompt] = usePersistedState('localai.studio.image.negative', '')
  const [size, setSize] = usePersistedState('localai.studio.image.size', '512x512')
  const [count, setCount] = usePersistedState('localai.studio.image.count', 1)
  const [steps, setSteps] = usePersistedState('localai.studio.image.steps', '')
  const [seed, setSeed] = usePersistedState('localai.studio.image.seed', '')
  const [cfgScale, setCfgScale] = usePersistedState('localai.studio.image.cfg', '')
  const [sampler, setSampler] = usePersistedState('localai.studio.image.sampler', '')
  const [scheduler, setScheduler] = usePersistedState('localai.studio.image.scheduler', '')
  const [clipSkip, setClipSkip] = usePersistedState('localai.studio.image.clipskip', '')
  const [hiresFix, setHiresFix] = usePersistedState('localai.studio.image.hiresfix', false)
  const [hiresUpscale, setHiresUpscale] = usePersistedState('localai.studio.image.hiresupscale', '1.5')
  const [hiresSteps, setHiresSteps] = usePersistedState('localai.studio.image.hiressteps', '')
  const [error, setError] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showImageInputs, setShowImageInputs] = useState(false)
  const [sourceImage, setSourceImage] = useState(null)
  const [refImages, setRefImages] = useState([])
  const [batchIds, setBatchIds] = useState([])      // job IDs from the latest Generate
  const [batchImages, setBatchImages] = useState({}) // { [jobId]: { url } } as they complete
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

  // This Generate's jobs, mirrored from the global jobs map.
  const batchJobs = useMemo(() => jobs.filter(j => batchIds.includes(j.id)), [jobs, batchIds])
  const completedCount = batchJobs.filter(j => j.status === 'completed').length
  const anyActive = batchJobs.some(j => j.status === 'queued' || j.status === 'running')
  const loading = anyActive

  // As each batch job completes, pull its artifact URL into the inline preview.
  useEffect(() => {
    batchJobs.forEach(j => {
      if (j.status === 'completed' && j.artifact_id && !batchImages[j.id]) {
        generationsApi.get(j.artifact_id).then(a => {
          if (a?.output_url) {
            const u = a.output_url.replace(/^https?:\/\/[^/]+/, '') || a.output_url
            setBatchImages(prev => ({ ...prev, [j.id]: { url: u } }))
          }
        }).catch(() => {})
      }
    })
  }, [batchJobs, batchImages])

  // Surface the first failure from the batch into the page error display.
  useEffect(() => {
    const failed = batchJobs.find(j => j.status === 'failed')
    if (failed) setError(failed.error || 'generation failed')
  }, [batchJobs])

  const previewImages = Object.values(batchImages)

  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) { addToast('Please enter a prompt', 'warning'); return }
    if (!models.length) { addToast('Please select at least one model', 'warning'); return }

    setError(null)
    setBatchImages({})

    let combinedPrompt = prompt.trim()
    if (negativePrompt.trim()) combinedPrompt += '|' + negativePrompt.trim()

    const base = { prompt: combinedPrompt, n: 1, size }
    if (steps) base.step = parseInt(steps)
    if (seed) base.seed = parseInt(seed)
    if (cfgScale) base.cfg_scale = parseFloat(cfgScale)
    if (sampler) base.sampler = sampler
    if (scheduler) base.scheduler = scheduler
    if (clipSkip) base.clip_skip = parseInt(clipSkip)
    if (hiresFix) {
      base.hires_fix = true
      if (hiresUpscale) base.hires_upscale = parseFloat(hiresUpscale)
      if (hiresSteps) base.hires_steps = parseInt(hiresSteps)
    }
    if (sourceImage) base.file = sourceImage
    if (refImages.length > 0) base.ref_images = refImages

    // One background job per model, repeated `count` times.
    const bodies = []
    for (const model of models) {
      for (let i = 0; i < count; i++) bodies.push({ ...base, model })
    }

    try {
      const created = await Promise.all(bodies.map(b => submit('image', b)))
      setBatchIds(created.map(j => j.id))
      const total = created.length
      addToast(
        `Queued ${total} generation${total > 1 ? 's' : ''}${models.length > 1 ? ` across ${models.length} models` : ''} — track them in the Queue tab`,
        'info'
      )
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
            <label className="form-label">Models <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>— add several to fan out</span></label>
            <MultiModelSelector value={models} onChange={setModels} capability={CAP_IMAGE} />
          </div>
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label">Prompt</label>
              <CopyButton text={prompt} title="Copy prompt" />
            </div>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image you want to generate..." rows={3} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(e) } }} />
          </div>
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label">Negative Prompt</label>
              <CopyButton text={negativePrompt} title="Copy negative prompt" />
            </div>
            <textarea className="textarea" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="What to avoid..." rows={2} />
          </div>

          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label">Size</label>
              <select className="model-selector" value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '100%' }}>
                {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Count (per model)</label>
              <select className="model-selector" value={count} onChange={(e) => setCount(parseInt(e.target.value, 10))} style={{ width: '100%' }}>
                {COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className={`collapsible-header ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)}>
            <i className="fas fa-chevron-right" /> Advanced Settings
          </div>
          {showAdvanced && (
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <div className="form-row-2col">
                <div className="form-group"><label className="form-label">Steps</label><input className="input" type="number" value={steps} onFocus={(e) => e.target.select()} onChange={(e) => setSteps(e.target.value)} placeholder="20" /></div>
                <div className="form-group"><label className="form-label">Seed</label><input className="input" type="number" value={seed} onFocus={(e) => e.target.select()} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /></div>
              </div>
              <div className="form-row-2col">
                <div className="form-group">
                  <label className="form-label">CFG Scale <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: '0.7rem' }}>1–20</span></label>
                  <input className="input" type="number" step="0.5" min="1" max="20" value={cfgScale} onFocus={(e) => e.target.select()} onChange={(e) => setCfgScale(e.target.value)} placeholder="7" />
                </div>
                <div className="form-group">
                  <label className="form-label">CLIP Skip</label>
                  <input className="input" type="number" min="0" max="12" value={clipSkip} onFocus={(e) => e.target.select()} onChange={(e) => setClipSkip(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="form-row-2col">
                <div className="form-group">
                  <label className="form-label">Sampler</label>
                  <select className="model-selector" value={sampler} onChange={(e) => setSampler(e.target.value)} style={{ width: '100%' }}>
                    <option value="">model default</option>
                    {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Scheduler</label>
                  <select className="model-selector" value={scheduler} onChange={(e) => setScheduler(e.target.value)} style={{ width: '100%' }}>
                    <option value="">model default</option>
                    {SCHEDULERS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 'var(--spacing-sm)' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hiresFix} onChange={(e) => setHiresFix(e.target.checked)} />
                  Hires fix <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: '0.7rem' }}>— upscale + second pass</span>
                </label>
              </div>
              {hiresFix && (
                <div className="form-row-2col">
                  <div className="form-group">
                    <label className="form-label">Upscale</label>
                    <input className="input" type="number" step="0.1" min="1.0" max="4.0" value={hiresUpscale} onFocus={(e) => e.target.select()} onChange={(e) => setHiresUpscale(e.target.value)} placeholder="1.5" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hires steps</label>
                    <input className="input" type="number" min="0" value={hiresSteps} onFocus={(e) => e.target.select()} onChange={(e) => setHiresSteps(e.target.value)} placeholder="same" />
                  </div>
                </div>
              )}
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
            {loading ? <><LoadingSpinner size="sm" /> Generating {completedCount}/{batchJobs.length}…</> : <><i className="fas fa-wand-magic-sparkles" /> Generate{models.length * count > 1 ? ` ${models.length * count}` : ''}</>}
          </button>
        </form>
      </div>

      <div className="media-preview">
        <div className="media-result">
          {batchJobs.length > 0 ? (
            <div className="media-result-stack">
              <div className="media-batch-status">
                {anyActive ? <LoadingSpinner size="sm" /> : <i className="fas fa-circle-check" style={{ color: 'var(--color-success, #6dd47d)' }} />}
                <span>{completedCount} / {batchJobs.length} done</span>
              </div>
              {previewImages.length > 0 && (
                <div className="media-result-grid">
                  {previewImages.map((img, i) => (
                    <div key={i}>
                      <img src={img.url} alt={prompt} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : error ? (
            <ErrorWithTraceLink message={error} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <i className="fas fa-image" style={{ fontSize: '3rem', marginBottom: 'var(--spacing-md)', opacity: 0.4 }} />
              <p>Generated images will appear here — and in the Queue tab as they run</p>
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
