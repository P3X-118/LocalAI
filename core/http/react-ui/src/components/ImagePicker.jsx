import { useEffect, useRef, useState } from 'react'
import { generationsApi, fileToBase64 } from '../utils/api'

// ImagePicker — modal that lets the user provide one or many images from any of:
//   - Upload (local file or directory)
//   - URL (paste any http(s) image URL)
//   - From Generations (browse the user's persistent history grid + select)
//
// Returns an array of strings via onPick. Each string is either:
//   - a URL ("http://...", "https://...", "/generated-images/...")
//   - a base64 data string (no "data:" prefix — what the backend expects)
//
// LocalAI's processImageFile (core/http/endpoints/openai/image.go) accepts
// either, so the consumer just stores the strings as-is in form state and
// hands them to the API.
//
// Props:
//   open      bool       — controls visibility
//   multi     bool       — if true, select-many; if false, first pick closes
//   title     string     — header text
//   onClose   () => void
//   onPick    (strings: string[]) => void
export default function ImagePicker({ open, multi = false, title, onClose, onPick }) {
  const [tab, setTab] = useState('upload')
  const [url, setUrl] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState({}) // {id: artifact} for history selections
  const fileRef = useRef(null)
  const dirRef = useRef(null)

  // Load history when the Generations tab opens
  useEffect(() => {
    if (!open || tab !== 'history') return
    setLoading(true)
    generationsApi.list({ type: 'image', limit: 200 }).then(d => {
      setHistory(d?.items || [])
    }).catch(() => setHistory([])).finally(() => setLoading(false))
  }, [open, tab])

  // Reset state every time the modal opens
  useEffect(() => {
    if (open) {
      setTab('upload')
      setUrl('')
      setSelectedIds({})
    }
  }, [open])

  if (!open) return null

  const finish = (values) => {
    onPick?.(values)
    if (!multi) onClose?.()
  }

  const handleFiles = async (filelist) => {
    const arr = []
    for (const f of filelist || []) {
      if (!f.type || !f.type.startsWith('image/')) continue
      arr.push(await fileToBase64(f))
    }
    if (arr.length) finish(arr)
  }

  const handleAddUrl = () => {
    const u = url.trim()
    if (!u) return
    if (!/^(https?:)?\/\//i.test(u)) {
      // allow same-origin paths like /generated-images/x.png
      if (!u.startsWith('/')) return
    }
    finish([u])
    setUrl('')
  }

  const toggleHistory = (item) => {
    if (multi) {
      setSelectedIds(prev => {
        const next = { ...prev }
        if (next[item.id]) delete next[item.id]
        else next[item.id] = item
        return next
      })
    } else {
      const u = (item.output_url || '').replace(/^https?:\/\/[^/]+/, '')
      finish([u || item.output_url])
    }
  }

  const confirmHistorySelection = () => {
    const urls = Object.values(selectedIds)
      .map(it => (it.output_url || '').replace(/^https?:\/\/[^/]+/, '') || it.output_url)
      .filter(Boolean)
    if (urls.length) finish(urls)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content image-picker" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><i className="fas fa-image" /> {title || (multi ? 'Add Images' : 'Choose Image')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="image-picker-tabs">
          <button
            className={`image-picker-tab ${tab === 'upload' ? 'image-picker-tab-active' : ''}`}
            onClick={() => setTab('upload')}
          ><i className="fas fa-upload" /> Upload</button>
          <button
            className={`image-picker-tab ${tab === 'url' ? 'image-picker-tab-active' : ''}`}
            onClick={() => setTab('url')}
          ><i className="fas fa-link" /> Paste URL</button>
          <button
            className={`image-picker-tab ${tab === 'history' ? 'image-picker-tab-active' : ''}`}
            onClick={() => setTab('history')}
          ><i className="fas fa-photo-film" /> From Generations</button>
        </div>

        <div className="image-picker-body">
          {tab === 'upload' && (
            <div className="image-picker-upload">
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                <i className="fas fa-file-image" /> Choose {multi ? 'image(s)' : 'an image'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple={multi}
                style={{ display: 'none' }}
                onChange={(e) => handleFiles(e.target.files)}
              />
              {multi && (
                <>
                  <button className="btn" onClick={() => dirRef.current?.click()}>
                    <i className="fas fa-folder-open" /> Choose folder
                  </button>
                  <input
                    ref={dirRef}
                    type="file"
                    accept="image/*"
                    webkitdirectory=""
                    directory=""
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </>
              )}
              <p className="image-picker-hint">
                PNG, JPG, WebP. {multi ? 'Select multiple files or pick a folder.' : 'Single image.'}
              </p>
            </div>
          )}

          {tab === 'url' && (
            <div className="image-picker-url">
              <input
                className="input"
                type="url"
                placeholder="https://example.com/image.png"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                autoFocus
              />
              <button className="btn btn-primary" onClick={handleAddUrl} disabled={!url.trim()}>
                Add URL
              </button>
              <p className="image-picker-hint">
                Any http(s) URL — LocalAI will download it server-side. Also accepts
                same-origin paths like <code>/generated-images/x.png</code>.
              </p>
            </div>
          )}

          {tab === 'history' && (
            <div className="image-picker-history">
              {loading ? (
                <div className="image-picker-hint">Loading…</div>
              ) : history.length === 0 ? (
                <div className="image-picker-hint">No image generations yet.</div>
              ) : (
                <>
                  <div className="image-picker-history-grid">
                    {history.map(item => {
                      const u = (item.output_url || '').replace(/^https?:\/\/[^/]+/, '') || item.output_url
                      const picked = !!selectedIds[item.id]
                      return (
                        <button
                          key={item.id}
                          className={`image-picker-history-card ${picked ? 'image-picker-history-card-picked' : ''}`}
                          onClick={() => toggleHistory(item)}
                          title={item.prompt}
                        >
                          <img src={u} alt={item.prompt?.slice(0, 60) || 'image'} loading="lazy" />
                          {multi && (
                            <span className="image-picker-history-check">
                              <i className={`fas ${picked ? 'fa-check-circle' : 'fa-circle'}`} />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {multi && (
                    <div className="image-picker-history-actions">
                      <span>{Object.keys(selectedIds).length} selected</span>
                      <button
                        className="btn btn-primary"
                        disabled={!Object.keys(selectedIds).length}
                        onClick={confirmHistorySelection}
                      >
                        Use selected
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
