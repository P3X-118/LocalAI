import { apiUrl } from '../utils/basePath'

const textStyle = {
  fontFamily: "'Orbitron', sans-serif",
  fontWeight: '900',
  letterSpacing: '0.12em',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  fontSize: '1.1rem',
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
      <span style={textStyle}>HAL 9001</span>
    </div>
  )
}
