import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMediaJobs, MEDIA_JOB_TERMINAL_STATUSES } from '../hooks/useMediaJobs'
import { generationsApi } from '../utils/api'
import GpuGauge from './GpuGauge'

const STATUS_LABEL = {
  queued:    { label: 'Queued',    cls: 'badge-pending' },
  running:   { label: 'Running',   cls: 'badge-running' },
  completed: { label: 'Done',      cls: 'badge-success' },
  failed:    { label: 'Failed',    cls: 'badge-error' },
  cancelled: { label: 'Cancelled', cls: 'badge-muted' },
}

const TYPE_ICON = { image: 'fa-image', video: 'fa-film', audio_tts: 'fa-microphone', audio_sound: 'fa-music' }
const TYPE_LABEL = { image: 'Image', video: 'Video', audio_tts: 'Speech', audio_sound: 'Sound' }

// Same-origin path for an artifact URL the backend may have host-prefixed.
const samePath = (u) => (u || '').replace(/^https?:\/\/[^/]+/, '') || null

// JobsQueue — the Studio "Queue" tab. A full-panel view of every background
// media-generation job (replaces the old floating JobsDock). Lets the user
// start several prompts/batches and watch them progress in one place.
export default function JobsQueue() {
  const { jobs, dismiss, cancel } = useMediaJobs()
  const [thumbs, setThumbs] = useState({}) // { [jobId]: url|null } — only fetched when the job lacks artifact_url

  useEffect(() => {
    jobs.forEach(j => {
      if (j.status === 'completed' && j.type === 'image' && j.artifact_id && !j.artifact_url && !(j.id in thumbs)) {
        generationsApi.get(j.artifact_id)
          .then(a => setThumbs(prev => ({ ...prev, [j.id]: samePath(a?.output_url) })))
          .catch(() => setThumbs(prev => ({ ...prev, [j.id]: null })))
      }
    })
  }, [jobs, thumbs])

  const activeCount = jobs.filter(j => !MEDIA_JOB_TERMINAL_STATUSES.has(j.status)).length
  const finishedCount = jobs.length - activeCount

  const clearFinished = () =>
    jobs.filter(j => MEDIA_JOB_TERMINAL_STATUSES.has(j.status)).forEach(j => dismiss(j.id))

  const promptOf = (j) => {
    const p = j.request && typeof j.request.prompt === 'string' ? j.request.prompt : ''
    return p.split('|')[0] // drop the "|negative" suffix for display
  }

  return (
    <div className="jobs-queue">
      <div className="jobs-queue-header">
        <div className="jobs-queue-title">
          <i className="fas fa-layer-group" style={{ color: 'var(--color-accent)' }} />
          <span>Generation queue</span>
          {activeCount > 0 && <span className="jobs-queue-count">{activeCount} active</span>}
        </div>
        <div className="jobs-queue-toolbar">
          <GpuGauge />
          {finishedCount > 0 && (
            <button className="btn" onClick={clearFinished} title="Remove finished jobs from this list">
              <i className="fas fa-broom" /> Clear finished
            </button>
          )}
          <Link to="/app/generations" className="btn"><i className="fas fa-photo-film" /> History</Link>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="jobs-queue-empty">
          <i className="fas fa-layer-group" />
          <p>No background jobs yet. Start a generation from the Images, Video, TTS, or Sound tab and it&apos;ll show up here — queue as many as you like.</p>
        </div>
      ) : (
        <div className="jobs-queue-grid">
          {jobs.map(j => {
            const s = STATUS_LABEL[j.status] || STATUS_LABEL.queued
            const isTerm = MEDIA_JOB_TERMINAL_STATUSES.has(j.status)
            const isDone = j.status === 'completed'
            const thumb = samePath(j.artifact_url) || thumbs[j.id]
            const prompt = promptOf(j)
            return (
              <div key={j.id} className="jobs-queue-card">
                <div className="jobs-queue-thumb">
                  {isDone && thumb
                    ? <img src={thumb} alt="result" />
                    : <i className={`fas ${TYPE_ICON[j.type] || 'fa-cog'}`} />}
                </div>
                <div className="jobs-queue-body">
                  <div className="jobs-queue-row">
                    <span className="jobs-queue-model" title={j.model}>{j.model || TYPE_LABEL[j.type] || j.type}</span>
                    <span className={`jobs-dock-badge ${s.cls}`}>{s.label}</span>
                  </div>
                  {prompt && <div className="jobs-queue-prompt" title={prompt}>{prompt}</div>}
                  {j.status === 'running' && (
                    <div className="jobs-dock-progress">
                      <div className="jobs-dock-progress-fill" style={{ width: `${Math.max(5, (j.progress || 0) * 100)}%` }} />
                    </div>
                  )}
                  {j.error && <div className="jobs-dock-error" title={j.error}>{j.error}</div>}
                  <div className="jobs-queue-actions">
                    {isDone && j.artifact_id && (
                      <Link to={`/app/generations#${j.artifact_id}`} className="jobs-dock-link">View result</Link>
                    )}
                    {!isTerm && (
                      <button className="jobs-dock-cancel" onClick={() => cancel(j.id)}>Cancel</button>
                    )}
                    {isTerm && (
                      <button className="jobs-dock-cancel" onClick={() => dismiss(j.id)}>Dismiss</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
