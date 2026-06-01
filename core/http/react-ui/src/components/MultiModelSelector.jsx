import { useMemo } from 'react'
import { useModels } from '../hooks/useModels'
import SearchableSelect from './SearchableSelect'

// MultiModelSelector — pick one or more models for the same prompt. Selected
// models show as removable chips; the searchable control below adds another.
// Callers enqueue one background job per selected model, so a single prompt
// can fan out across several models at once.
//
// Props:
//   value       string[]  currently-selected model names
//   onChange    (string[]) => void
//   capability  capability flag to filter installed models (e.g. CAP_IMAGE)
export default function MultiModelSelector({ value = [], onChange, capability }) {
  const { models, loading } = useModels(capability)
  const allNames = useMemo(() => models.map(m => m.id), [models])
  const available = useMemo(() => allNames.filter(n => !value.includes(n)), [allNames, value])

  const add = (name) => { if (name && !value.includes(name)) onChange([...value, name]) }
  const remove = (name) => onChange(value.filter(n => n !== name))

  const placeholder = loading
    ? 'Loading models…'
    : available.length === 0
      ? (value.length ? 'All models added' : 'No image models installed')
      : (value.length ? 'Add another model…' : 'Select a model…')

  return (
    <div className="multi-model">
      {value.length > 0 && (
        <div className="multi-model-chips">
          {value.map(name => (
            <span key={name} className="multi-model-chip" title={name}>
              <span className="multi-model-chip-label">{name}</span>
              <button
                type="button"
                className="multi-model-chip-x"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <SearchableSelect
        value=""
        onChange={add}
        options={available}
        placeholder={placeholder}
        searchPlaceholder="Search models…"
        disabled={loading || available.length === 0}
      />
      {value.length > 1 && (
        <div className="multi-model-hint">{value.length} models — one background job each</div>
      )}
    </div>
  )
}
