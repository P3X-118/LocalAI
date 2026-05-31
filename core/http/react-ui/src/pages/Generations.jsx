import { useState, useEffect, useCallback, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { generationsApi } from '../utils/api'
import LoadingSpinner from '../components/LoadingSpinner'
import ConfirmDialog from '../components/ConfirmDialog'

const TABS = [
  { key: '',            label: 'All',    icon: 'fa-th' },
  { key: 'image',       label: 'Images', icon: 'fa-image' },
  { key: 'video',       label: 'Videos', icon: 'fa-film' },
  { key: 'audio_tts',   label: 'Speech', icon: 'fa-microphone' },
  { key: 'audio_sound', label: 'Sound',  icon: 'fa-music' },
]

function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!t) return ''
  const diff = Math.floor((Date.now() - t) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatDuration(ms) {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function ArtifactPreview({ item }) {
  // Build a usable URL: artifact.output_url is path-form ("/generated-*/x.png");
  // strip any host prefix the backend added (we are same-origin).
  const url = (item.output_url || '').replace(/^https?:\/\/[^/]+/, '') || null
  if (!url) return <div className="gen-card-preview gen-card-preview-blank">no preview</div>

  switch (item.type) {
    case 'image':
      return <img className="gen-card-image" src={url} alt={item.prompt?.slice(0, 80) || 'image'} loading="lazy" />
    case 'video':
      return (
        <video className="gen-card-video" controls preload="metadata">
          <source src={url} />
        </video>
      )
    case 'audio_tts':
    case 'audio_sound':
      return <audio className="gen-card-audio" controls preload="metadata" src={url} />
    default:
      return <div className="gen-card-preview gen-card-preview-blank">{item.type}</div>
  }
}

export default function Generations() {
  const { addToast } = useOutletContext()
  const [tab, setTab] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [detailItem, setDetailItem] = useState(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await generationsApi.list({ type: tab || undefined, limit: 200 })
      setItems(data?.items || [])
    } catch (err) {
      addToast(`Failed to load generations: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [tab, addToast])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Honor deep-link from JobsDock: /generations#<artifact-id> opens the modal
  useEffect(() => {
    const id = (window.location.hash || '').slice(1)
    if (!id || !items.length) return
    const it = items.find(i => i.id === id)
    if (it) setDetailItem(it)
  }, [items])

  const handleDelete = async (id) => {
    try {
      await generationsApi.remove(id)
      setItems(prev => prev.filter(i => i.id !== id))
      addToast('Removed', 'success')
    } catch (err) {
      addToast(`Delete failed: ${err.message}`, 'error')
    } finally {
      setConfirmDelete(null)
    }
  }

  const counts = useMemo(() => {
    const out = { '': items.length }
    items.forEach(i => { out[i.type] = (out[i.type] || 0) + 1 })
    return out
  }, [items])

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">
          <i className="fas fa-photo-film" style={{ marginRight: 8, color: 'var(--color-accent)' }} />
          Generations
        </h1>
        <p className="page-subtitle">Every image, video, and audio output you've generated — searchable by prompt, replayable, deletable.</p>
      </div>

      <div className="gen-tabs">
        {TABS.map(t => (
          <button
            key={t.key || 'all'}
            className={`gen-tab ${tab === t.key ? 'gen-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <i className={`fas ${t.icon}`} />
            <span>{t.label}</span>
            {counts[t.key] !== undefined && <span className="gen-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
        <button className="gen-tab gen-tab-refresh" onClick={fetchItems} title="Refresh">
          <i className="fas fa-rotate" />
        </button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <i className="fas fa-photo-film" style={{ fontSize: 48, opacity: 0.3 }} />
          <p>No generations yet. Head to <a href="/app/studio">Studio</a> to create one.</p>
        </div>
      ) : (
        <div className="gen-grid">
          {items.map(item => (
            <div key={item.id} className="gen-card" onClick={() => setDetailItem(item)} role="button" tabIndex={0}>
              <ArtifactPreview item={item} />
              <div className="gen-card-body">
                <div className="gen-card-prompt" title={item.prompt}>{item.prompt || '(no prompt)'}</div>
                <div className="gen-card-meta">
                  <span title={item.model}>{item.model}</span>
                  <span>{relativeTime(item.created_at)}</span>
                </div>
              </div>
              <button
                className="gen-card-delete"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(item) }}
              >
                <i className="fas fa-trash" />
              </button>
            </div>
          ))}
        </div>
      )}

      {detailItem && (
        <div className="modal-backdrop" onClick={() => setDetailItem(null)}>
          <div className="modal-content gen-detail" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><i className={`fas ${TABS.find(t => t.key === detailItem.type)?.icon || 'fa-file'}`} /> {detailItem.model}</h2>
              <button className="modal-close" onClick={() => setDetailItem(null)}>×</button>
            </div>
            <div className="modal-body">
              <ArtifactPreview item={detailItem} />
              <div className="gen-detail-section">
                <label>Prompt</label>
                <pre>{detailItem.prompt || '(none)'}</pre>
              </div>
              {detailItem.negative_prompt && (
                <div className="gen-detail-section">
                  <label>Negative prompt</label>
                  <pre>{detailItem.negative_prompt}</pre>
                </div>
              )}
              {detailItem.params && Object.keys(detailItem.params).length > 0 && (
                <div className="gen-detail-section">
                  <label>Parameters</label>
                  <pre>{JSON.stringify(detailItem.params, null, 2)}</pre>
                </div>
              )}
              <div className="gen-detail-meta">
                <span>{new Date(detailItem.created_at).toLocaleString()}</span>
                <span>·</span>
                <span>{formatDuration(detailItem.duration_ms)}</span>
                {detailItem.job_id && (<><span>·</span><span title="Background job ID">job {detailItem.job_id.slice(0, 8)}</span></>)}
              </div>
              {detailItem.output_url && (
                <div className="gen-detail-actions">
                  <a className="btn btn-primary" href={detailItem.output_url} target="_blank" rel="noreferrer">Open in new tab</a>
                  <a className="btn" href={detailItem.output_url} download>Download</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete generation?"
        message={confirmDelete ? `This will remove the ${confirmDelete.type} and its metadata. This cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
