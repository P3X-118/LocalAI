import { apiUrl } from '../utils/basePath'

const textStyle = {
  fontFamily: 'monospace',
  fontWeight: '700',
  letterSpacing: '0.15em',
  color: 'var(--text-primary)',
}

export default function HalLogo({ collapsed = false }) {
  if (collapsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <img src={apiUrl('/static/hal9001.webp')} alt="HAL 9001" style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <img src={apiUrl('/static/hal9001.webp')} alt="HAL 9001" style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '50%' }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ ...textStyle, fontSize: '1.5rem' }}>HAL</span>
        <span style={{ ...textStyle, fontSize: '0.75rem', opacity: 0.7 }}>9001</span>
      </div>
    </div>
  )
}
