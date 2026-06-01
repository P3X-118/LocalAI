// FormFieldDefinition — render a dynamic form from a server-returned field
// schema. Each field is { name, type, label, helpText, required, options?,
// defaultValue? }. Types we support: text (default), textarea, number,
// checkbox, select.
//
// Ported (minimal subset) from upstream LocalAGI webui FormFieldDefinition,
// adapted to use our existing form/input CSS classes (.input, .textarea,
// .model-selector for selects).
//
// Props:
//   fields    array of field descriptors
//   values    object — current values keyed by field.name
//   onChange  (e: SyntheticEvent) => void
//             called with a synthetic-event-shaped object: {target: {name, value | checked}}
//   idPrefix  string — prefix for the <input id> attribute (config_ vs param_)
export default function FormFieldDefinition({ fields = [], values = {}, onChange, idPrefix = '' }) {
  if (!fields.length) return null
  return (
    <div className="form-field-defs">
      {fields.map((f) => {
        const id = `${idPrefix}${f.name}`
        const value = values[f.name] ?? f.defaultValue ?? (f.type === 'checkbox' ? false : '')
        const label = f.label || f.name
        return (
          <div className="form-group" key={f.name}>
            {f.type !== 'checkbox' && (
              <label className="form-label" htmlFor={id}>
                {label}
                {f.required && <span style={{ color: 'var(--color-error, #ff7a7a)', marginLeft: 4 }}>*</span>}
              </label>
            )}

            {f.type === 'textarea' && (
              <textarea
                id={id}
                name={f.name}
                className="textarea"
                rows={4}
                value={value}
                onChange={onChange}
                placeholder={f.placeholder || ''}
              />
            )}

            {(f.type === 'text' || !f.type || (f.type !== 'textarea' && f.type !== 'number' && f.type !== 'checkbox' && f.type !== 'select')) && (
              <input
                id={id}
                name={f.name}
                className="input"
                type="text"
                value={value}
                onChange={onChange}
                placeholder={f.placeholder || ''}
              />
            )}

            {f.type === 'number' && (
              <input
                id={id}
                name={f.name}
                className="input"
                type="number"
                value={value}
                onChange={onChange}
                placeholder={f.placeholder || ''}
              />
            )}

            {f.type === 'checkbox' && (
              <label className="form-label" htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  id={id}
                  name={f.name}
                  type="checkbox"
                  checked={!!value}
                  onChange={onChange}
                />
                <span>{label}</span>
              </label>
            )}

            {f.type === 'select' && (
              <select
                id={id}
                name={f.name}
                className="model-selector"
                value={value}
                onChange={onChange}
              >
                <option value="">{f.placeholder || '— select —'}</option>
                {(f.options || []).map((opt) => {
                  const optValue = typeof opt === 'string' ? opt : opt.value
                  const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.value)
                  return <option key={optValue} value={optValue}>{optLabel}</option>
                })}
              </select>
            )}

            {f.helpText && (
              <small style={{ display: 'block', marginTop: 4, color: 'var(--color-text-muted, #888)', fontSize: '0.78rem' }}>
                {f.helpText}
              </small>
            )}
          </div>
        )
      })}
    </div>
  )
}
