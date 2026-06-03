import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { actionsApi, agentGroupsApi } from '../utils/api'
import { usePersistedState } from '../hooks/usePersistedState'
import ModelSelector from '../components/ModelSelector'
import LoadingSpinner from '../components/LoadingSpinner'

// GroupCreate — 3-step wizard for creating a coordinated agent team:
//   1. Describe the team (free text) → LLM generates N agent profiles
//   2. Review / select / deselect profiles
//   3. Configure shared model + connectors + actions → bulk POST /api/agents/group/create
//
// Ported from upstream LocalAGI webui/react-ui/src/pages/GroupCreate.jsx,
// adapted to our /api/agents/group/* namespace + our existing form + nav
// patterns. Description text persists across navigation via usePersistedState.
export default function GroupCreate() {
  const navigate = useNavigate()
  const { addToast } = useOutletContext()

  const [step, setStep] = useState(1)
  const [description, setDescription] = usePersistedState('localai.agentgroup.description', '')
  const [profiles, setProfiles] = useState([])      // [{ name, description, system_prompt }]
  const [selected, setSelected] = useState([])      // indices into profiles
  const [model, setModel] = useState('')
  const [apiURL, setApiURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [connectorChoices, setConnectorChoices] = useState([])  // [{name,...}]
  const [actionChoices, setActionChoices] = useState([])
  const [connectors, setConnectors] = useState([])  // selected connector names
  const [actions, setActions] = useState([])        // selected action names

  const [generating, setGenerating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load agent config metadata once — for action/connector pickers in step 3
  useEffect(() => {
    actionsApi.getConfigMetadata().then((m) => {
      // Upstream returns { actions: [{name, fields}], connectors: [{name, fields}], ... }
      if (m?.actions) setActionChoices(m.actions.map(a => a.name).filter(Boolean))
      if (m?.connectors) setConnectorChoices(m.connectors.map(c => c.name).filter(Boolean))
    }).catch(() => { /* non-fatal */ })
  }, [])

  const generateProfiles = async () => {
    if (!description.trim()) {
      addToast('Describe the team first', 'warning')
      return
    }
    setGenerating(true)
    try {
      const r = await agentGroupsApi.generateProfiles(description.trim())
      const arr = Array.isArray(r) ? r : (Array.isArray(r?.agents) ? r.agents : [])
      if (!arr.length) {
        addToast('The model returned no profiles. Try a more specific description.', 'warning')
        return
      }
      setProfiles(arr)
      setSelected(arr.map((_, i) => i)) // auto-select all
      setStep(2)
      addToast(`Generated ${arr.length} profile${arr.length > 1 ? 's' : ''}`, 'success')
    } catch (err) {
      addToast(`Generation failed: ${err.message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const toggleProfile = (i) => {
    setSelected((prev) => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }
  const toggleAll = (e) => {
    if (e.target.checked) setSelected(profiles.map((_, i) => i))
    else setSelected([])
  }

  const toggleMulti = (list, setList, value) => {
    if (list.includes(value)) setList(list.filter(v => v !== value))
    else setList([...list, value])
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!selected.length) { addToast('Pick at least one profile', 'warning'); return }
    if (!model) { addToast('Pick a shared model', 'warning'); return }

    const agents = selected.map(i => profiles[i])
    const body = {
      agents,
      agent_config: {
        model,
        api_url: apiURL,
        api_key: apiKey,
        connectors,
        actions,
      },
    }
    setSubmitting(true)
    try {
      const r = await agentGroupsApi.create(body)
      addToast(`Created ${r.created || agents.length} agent${(r.created || agents.length) > 1 ? 's' : ''}`, 'success')
      // Clear the persisted description so the next visit starts fresh
      setDescription('')
      navigate('/app/agents')
    } catch (err) {
      addToast(`Create failed: ${err.message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">
          <i className="fas fa-users" style={{ marginRight: 8, color: 'var(--color-accent)' }} />
          Create Agent Group
        </h1>
        <p className="page-subtitle">Describe a team, review the generated profiles, configure shared settings, create them all in one shot.</p>
      </div>

      <ol className="group-steps">
        {[
          { n: 1, label: 'Describe' },
          { n: 2, label: 'Review' },
          { n: 3, label: 'Configure' },
        ].map(s => (
          <li key={s.n} className={`group-step ${step === s.n ? 'group-step-active' : ''} ${step > s.n ? 'group-step-done' : ''}`}>
            <span className="group-step-dot">{step > s.n ? <i className="fas fa-check" /> : s.n}</span>
            <span className="group-step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="section-box group-step-body">
          <h2 className="section-title">Step 1 · Describe the team</h2>
          <p className="section-hint">Be specific about roles, relationships, and purpose. The model will use this to invent N agents.</p>
          <textarea
            className="textarea"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Example: A 3-agent research team for a SaaS-launch market analysis — a market researcher, a competitive analyst, and a synthesis writer. They collaborate to produce briefs."
          />
          <div className="group-step-actions">
            <button type="button" className="btn btn-primary" onClick={generateProfiles} disabled={generating || !description.trim()}>
              {generating
                ? <><LoadingSpinner size="sm" /> Generating…</>
                : <><i className="fas fa-wand-magic-sparkles" /> Generate Profiles</>}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="section-box group-step-body">
          <h2 className="section-title">Step 2 · Review profiles</h2>
          <p className="section-hint">Select the agents to keep. They'll all share the settings you configure in step 3.</p>
          <label className="group-select-all">
            <input
              type="checkbox"
              checked={selected.length === profiles.length && profiles.length > 0}
              onChange={toggleAll}
            />
            <span>Select all ({selected.length}/{profiles.length})</span>
          </label>
          <div className="group-profiles">
            {profiles.map((p, i) => (
              <button
                key={i}
                type="button"
                className={`group-profile ${selected.includes(i) ? 'group-profile-picked' : ''}`}
                onClick={() => toggleProfile(i)}
              >
                <div className="group-profile-pick">
                  <i className={`fas ${selected.includes(i) ? 'fa-check-square' : 'fa-square'}`} />
                </div>
                <h3>{p.name || `Agent ${i + 1}`}</h3>
                <p className="group-profile-desc">{p.description || '(no description)'}</p>
                <pre className="group-profile-prompt">{p.system_prompt || '(no system prompt)'}</pre>
              </button>
            ))}
          </div>
          <div className="group-step-actions">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)} disabled={!selected.length}>
              Continue <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <form className="section-box group-step-body" onSubmit={handleCreate}>
          <h2 className="section-title">Step 3 · Shared settings</h2>
          <p className="section-hint">All {selected.length} agent{selected.length > 1 ? 's' : ''} will be created with these settings; per-agent name / description / system_prompt come from the picked profiles.</p>
          <div className="form-group">
            <label className="form-label">Model</label>
            <ModelSelector value={model} onChange={setModel} />
          </div>
          <div className="form-group">
            <label className="form-label">API URL <small style={{ color: 'var(--color-text-muted)' }}>(blank = use the agent-pool default)</small></label>
            <input className="input" value={apiURL} onChange={(e) => setApiURL(e.target.value)} placeholder="http://127.0.0.1:8081" />
          </div>
          <div className="form-group">
            <label className="form-label">API Key <small style={{ color: 'var(--color-text-muted)' }}>(blank = use the agent-pool default)</small></label>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="(optional override)" />
          </div>
          {connectorChoices.length > 0 && (
            <div className="form-group">
              <label className="form-label">Connectors</label>
              <div className="group-chip-row">
                {connectorChoices.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={`group-chip ${connectors.includes(name) ? 'group-chip-on' : ''}`}
                    onClick={() => toggleMulti(connectors, setConnectors, name)}
                  >{name}</button>
                ))}
              </div>
            </div>
          )}
          {actionChoices.length > 0 && (
            <div className="form-group">
              <label className="form-label">Actions</label>
              <div className="group-chip-row">
                {actionChoices.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={`group-chip ${actions.includes(name) ? 'group-chip-on' : ''}`}
                    onClick={() => toggleMulti(actions, setActions, name)}
                  >{name}</button>
                ))}
              </div>
            </div>
          )}
          <div className="group-step-actions">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !model}>
              {submitting
                ? <><LoadingSpinner size="sm" /> Creating…</>
                : <><i className="fas fa-users" /> Create {selected.length} Agent{selected.length > 1 ? 's' : ''}</>}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
