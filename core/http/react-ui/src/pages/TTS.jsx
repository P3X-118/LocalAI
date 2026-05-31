import { useState, useRef, useEffect } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import ModelSelector from '../components/ModelSelector'
import { CAP_TTS } from '../utils/capabilities'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorWithTraceLink from '../components/ErrorWithTraceLink'
import GpuGauge from '../components/GpuGauge'
import { generationsApi } from '../utils/api'
import { useMediaJobs } from '../hooks/useMediaJobs'
import { usePersistedState } from '../hooks/usePersistedState'

export default function TTS() {
  const { model: urlModel } = useParams()
  const { addToast } = useOutletContext()
  const { jobs, submit } = useMediaJobs()
  const [model, setModel] = usePersistedState('localai.studio.tts.model', urlModel || '')
  const [text, setText] = usePersistedState('localai.studio.tts.text', '')
  const [error, setError] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [activeJobId, setActiveJobId] = useState(null)
  const audioRef = useRef(null)

  const activeJob = activeJobId ? jobs.find(j => j.id === activeJobId) : null
  const loading = activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'completed' || !activeJob.artifact_id) return
    let cancelled = false
    generationsApi.get(activeJob.artifact_id).then(a => {
      if (cancelled) return
      if (a?.output_url) {
        const u = a.output_url.replace(/^https?:\/\/[^/]+/, '')
        setAudioUrl(u)
        setTimeout(() => audioRef.current?.play().catch(() => {}), 200)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeJob?.status, activeJob?.artifact_id])

  useEffect(() => {
    if (activeJob && activeJob.status === 'failed') setError(activeJob.error || 'TTS failed')
  }, [activeJob?.status, activeJob?.error])

  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!text.trim()) { addToast('Please enter text', 'warning'); return }
    if (!model) { addToast('Please select a model', 'warning'); return }

    setError(null)
    setAudioUrl(null)

    try {
      const job = await submit('tts', { model, input: text.trim() })
      setActiveJobId(job.id)
      addToast('TTS queued', 'info')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="media-layout">
      <div className="media-controls">
        <div className="page-header media-page-header">
          <h1 className="page-title"><i className="fas fa-headphones" style={{ marginRight: 8, color: 'var(--color-accent)' }} />Text to Speech</h1>
          <GpuGauge />
        </div>

        <form onSubmit={handleGenerate}>
          <div className="form-group">
            <label className="form-label">Model</label>
            <ModelSelector value={model} onChange={setModel} capability={CAP_TTS} />
          </div>
          <div className="form-group">
            <label className="form-label">Text</label>
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text to convert to speech..."
              rows={5}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? <><LoadingSpinner size="sm" /> Generating...</> : <><i className="fas fa-headphones" /> Generate Audio</>}
          </button>
        </form>
      </div>

      <div className="media-preview">
        <div className="media-result">
          {loading ? (
            <LoadingSpinner size="lg" />
          ) : error ? (
            <ErrorWithTraceLink message={error} />
          ) : audioUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--spacing-md)', width: '100%' }}>
              <audio ref={audioRef} controls src={audioUrl} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <a href={audioUrl} download={`tts-${model}-${new Date().toISOString().slice(0, 10)}.mp3`} className="btn btn-primary btn-sm">
                  <i className="fas fa-download" /> Download
                </a>
                <button className="btn btn-secondary btn-sm" onClick={() => audioRef.current?.play()}>
                  <i className="fas fa-rotate-right" /> Replay
                </button>
              </div>
              <div style={{ padding: 'var(--spacing-sm)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                "{text}"
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <i className="fas fa-headphones" style={{ fontSize: '3rem', marginBottom: 'var(--spacing-md)', opacity: 0.4 }} />
              <p>Generated audio will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
