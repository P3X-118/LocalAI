import { apiUrl } from '../utils/basePath'

export default function HalLogo({ collapsed = false }) {
  if (collapsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <img src={apiUrl('/static/hal.svg')} alt="HAL" style={{ width: '36px', height: '36px' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <img src={apiUrl('/static/hal.svg')} alt="HAL" style={{ width: '40px', height: '40px', flexShrink: 0 }} />
      <span style={{
        fontSize: '1.5rem',
        fontWeight: '700',
        letterSpacing: '0.15em',
        color: 'var(--text-primary)',
        fontFamily: 'monospace',
      }}>
        HAL
      </span>
    </div>
  )
}
