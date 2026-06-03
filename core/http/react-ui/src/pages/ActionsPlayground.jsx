import { useState, useEffect, useMemo } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { actionsApi } from '../utils/api'
import FormFieldDefinition from '../components/FormFieldDefinition'
import LoadingSpinner from '../components/LoadingSpinner'

// ActionsPlayground — pick any LocalAGI action, fill its config + parameter
// fields (rendered from the server's field schema), execute, and view the
// JSON response. Ported from upstream LocalAGI webui ActionsPlayground.jsx.
// Adapted to our /api/agents/actions/* namespace + outlet-toast convention.
export default function ActionsPlayground() {
  const { addToast } = useOutletContext()
  const [searchParams] = useSearchParams()

  const [actions, setActions] = useState([])
  const [selectedAction, setSelectedAction] = useState('')
  const [configJson, setConfigJson] = useState('{}')
  const [paramsJson, setParamsJson] = useState('{}')
  const [agentMetadata, setAgentMetadata] = useState(null)
  const [configFields, setConfigFields] = useState([])
  const [paramFields, setParamFields] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingActions, setLoadingActions] = useState(true)

  // Load action list + agent metadata once
  useEffect(() => {
    let cancelled = false
    actionsApi.list().then((r) => {
      if (cancelled) return
      // Server may return either ["action1","action2"] or {actions: [...]}
      const arr = Array.isArray(r) ? r : Array.isArray(r?.actions) ? r.actions : []
      setActions(arr)
    }).catch(() => addToast('Failed to load actions', 'error')).finally(() => {
      if (!cancelled) setLoadingActions(false)
    })
    actionsApi.getConfigMetadata().then((m) => {
      if (!cancelled) setAgentMetadata(m)
    }).catch(() => addToast('Failed to load agent metadata', 'error'))
    return () => { cancelled = true }
  }, [addToast])

  // Pre-select from ?action= query
  useEffect(() => {
    if (loadingActions) return
    const queryAction = searchParams.get('action')
    if (queryAction && !selectedAction && actions.includes(queryAction)) {
      setSelectedAction(queryAction)
    }
    const queryConfig = searchParams.get('config')
    if (queryConfig) {
      try {
        const parsed = JSON.parse(queryConfig)
        setConfigJson(JSON.stringify(parsed, null, 2))
      } catch {
        addToast('Invalid config query parameter (expected JSON)', 'error')
      }
    }
  }, [loadingActions, actions, searchParams, selectedAction, addToast])

  // Fetch parameter definition whenever the selected action or its config changes
  useEffect(() => {
    if (!selectedAction) {
      setConfigFields([])
      setParamFields([])
      return
    }
    // Config fields come from agent metadata (descriptor of how the action is configured)
    const actionMeta = agentMetadata?.actions?.find((a) => a.name === selectedAction)
    setConfigFields(actionMeta?.fields || [])

    let currentConfig = {}
    try { currentConfig = JSON.parse(configJson) } catch { /* leave empty */ }

    let cancelled = false
    actionsApi.getDefinition(selectedAction, currentConfig).then((fields) => {
      if (cancelled) return
      setParamFields(Array.isArray(fields) ? fields : [])
    }).catch(() => addToast('Failed to load action definition', 'error'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAction, agentMetadata])

  const parsedConfig = useMemo(() => {
    try { return JSON.parse(configJson) } catch { return {} }
  }, [configJson])
  const parsedParams = useMemo(() => {
    try { return JSON.parse(paramsJson) } catch { return {} }
  }, [paramsJson])

  const makeChangeHandler = (fields, updateJson) => (e) => {
    if (!e?.target) return
    const fieldName = e.target.name
    const fieldDef = fields.find((f) => f.name === fieldName)
    const fieldType = fieldDef?.type
    let value
    if (fieldType === 'checkbox') value = e.target.checked
    else if (fieldType === 'number') value = e.target.value === '' ? '' : e.target.value
    else value = e.target.value
    updateJson((prev) => {
      let next
      try { next = JSON.parse(prev) } catch { next = {} }
      next[fieldName] = value
      return JSON.stringify(next, null, 2)
    })
  }

  const onConfigFieldChange = makeChangeHandler(configFields, setConfigJson)
  const onParamFieldChange = makeChangeHandler(paramFields, setParamsJson)

  const handleActionChange = (e) => {
    setSelectedAction(e.target.value)
    setConfigJson('{}')
    setParamsJson('{}')
    setResult(null)
  }

  const handleExecute = async (e) => {
    e.preventDefault()
    if (!selectedAction) { addToast('Pick an action first', 'warning'); return }
    setLoading(true)
    setResult(null)
    try {
      let config = {}, params = {}
      try { config = JSON.parse(configJson) } catch { addToast('Config JSON is invalid', 'error'); setLoading(false); return }
      try { params = JSON.parse(paramsJson) } catch { addToast('Params JSON is invalid', 'error'); setLoading(false); return }
      const data = await actionsApi.execute(selectedAction, { action: selectedAction, config, params })
      setResult(data)
      addToast('Action executed', 'success')
    } catch (err) {
      addToast(`Execute failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">
          <i className="fas fa-play" style={{ marginRight: 8, color: 'var(--color-accent)' }} />
          Actions Playground
        </h1>
        <p className="page-subtitle">Test any LocalAGI action directly — pick one, fill its config + parameters, execute.</p>
      </div>

      <div className="actions-playground">
        <div className="section-box">
          <div className="form-group">
            <label className="form-label" htmlFor="action-select">Available actions</label>
            <select
              id="action-select"
              value={selectedAction}
              onChange={handleActionChange}
              disabled={loadingActions}
              className="model-selector"
              style={{ width: '100%' }}
            >
              <option value="">{loadingActions ? 'Loading…' : '— select an action —'}</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {selectedAction && (
          <form className="section-box" onSubmit={handleExecute}>
            {configFields.length > 0 && (
              <>
                <h2 className="section-title">Configuration</h2>
                <FormFieldDefinition
                  fields={configFields}
                  values={parsedConfig}
                  onChange={onConfigFieldChange}
                  idPrefix="config_"
                />
              </>
            )}
            {paramFields.length > 0 && (
              <>
                <h2 className="section-title">Parameters</h2>
                <FormFieldDefinition
                  fields={paramFields}
                  values={parsedParams}
                  onChange={onParamFieldChange}
                  idPrefix="param_"
                />
              </>
            )}
            <div className="actions-playground-submit">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading
                  ? <><LoadingSpinner size="sm" /> Executing…</>
                  : <><i className="fas fa-play" /> Execute</>}
              </button>
            </div>
          </form>
        )}

        {result !== null && (
          <div className="section-box">
            <h2 className="section-title">Result</h2>
            <pre className="actions-playground-result">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
