import { Link } from 'react-router-dom'
import { useMediaJobs, MEDIA_JOB_TERMINAL_STATUSES } from '../hooks/useMediaJobs'

const STATUS_LABEL = {
  queued:    { label: 'Queued',    cls: 'badge-pending' },
  running:   { label: 'Running',   cls: 'badge-running' },
  completed: { label: 'Done',      cls: 'badge-success' },
  failed:    { label: 'Failed',    cls: 'badge-error' },
  cancelled: { label: 'Cancelled', cls: 'badge-muted' },
}

const TYPE_ICON = {
  image:       'fa-image',
  video:       'fa-film',
  audio_tts:   'fa-microphone',
  audio_sound: 'fa-music',
}

const TYPE_LABEL = {
  image:       'Image',
  video:       'Video',
  audio_tts:   'Speech',
  audio_sound: 'Sound',
}

// JobsDock — fixed-position corner card that surfaces background media-generation
// jobs. Hidden when no jobs are tracked. Auto-hides terminal jobs after 30s.
export default function JobsDock() {
  const { jobs, dismiss, cancel } = useMediaJobs()
  if (!jobs.length) return null

  return (
    <div className="jobs-dock">
      <div className="jobs-dock-header">
        <i className="fas fa-tasks" />
        <span>Background generations ({jobs.filter(j => !MEDIA_JOB_TERMINAL_STATUSES.has(j.status)).length})</span>
      </div>
      <div className="jobs-dock-list">
        {jobs.slice(0, 6).map(j => {
          const s = STATUS_LABEL[j.status] || STATUS_LABEL.queued
          const isTerm = MEDIA_JOB_TERMINAL_STATUSES.has(j.status)
          const isDone = j.status === 'completed'
          return (
            <div key={j.id} className="jobs-dock-item">
              <div className="jobs-dock-line">
                <i className={`fas ${TYPE_ICON[j.type] || 'fa-cog'}`} style={{ width: 14 }} />
                <span className="jobs-dock-model" title={j.model}>{j.model || TYPE_LABEL[j.type] || j.type}</span>
                <span className={`jobs-dock-badge ${s.cls}`}>{s.label}</span>
              </div>
              {j.status === 'running' && (
                <div className="jobs-dock-progress">
                  <div className="jobs-dock-progress-fill" style={{ width: `${Math.max(5, (j.progress || 0) * 100)}%` }} />
                </div>
              )}
              {j.error && <div className="jobs-dock-error" title={j.error}>{j.error}</div>}
              <div className="jobs-dock-actions">
                {isDone && j.artifact_id && (
                  <Link to={`/generations#${j.artifact_id}`} className="jobs-dock-link" onClick={() => dismiss(j.id)}>
                    View result
                  </Link>
                )}
                {!isTerm && (
                  <button className="jobs-dock-cancel" onClick={() => cancel(j.id)} title="Cancel job">
                    Cancel
                  </button>
                )}
                {isTerm && (
                  <button className="jobs-dock-cancel" onClick={() => dismiss(j.id)} title="Dismiss">
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {jobs.length > 6 && (
          <Link to="/generations" className="jobs-dock-more">+ {jobs.length - 6} more</Link>
        )}
      </div>
    </div>
  )
}
