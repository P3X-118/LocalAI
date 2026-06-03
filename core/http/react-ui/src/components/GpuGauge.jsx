import { useGpuStats } from '../hooks/useGpuStats'
import { percentColor, formatBytes } from '../utils/format'

// GpuGauge is a compact, always-on indicator for the chat token bar. It shows
// GPU compute load as the headline metric plus memory usage (VRAM, or unified
// system RAM on Jetson/integrated GPUs), each color-coded by level. It renders
// nothing until the first sample arrives or if stats are unavailable.
export default function GpuGauge() {
  const { stats } = useGpuStats()

  if (!stats) return null

  const isGpu = stats.type === 'gpu' && Array.isArray(stats.gpus) && stats.gpus.length > 0
  const agg = stats.aggregate || {}
  const g0 = isGpu ? stats.gpus[0] : null

  // Compute load: prefer the aggregate, fall back to the first GPU. May be
  // absent when the driver doesn't expose utilization.
  let util = typeof agg.utilization_percent === 'number' ? agg.utilization_percent : null
  if (util === null && g0 && typeof g0.utilization_percent === 'number') {
    util = g0.utilization_percent
  }

  // Memory: GPU VRAM if present, otherwise system RAM.
  const memLabel = isGpu ? 'VRAM' : 'RAM'
  const memPct = isGpu ? (g0.usage_percent || 0) : (stats.ram?.usage_percent || 0)
  const memUsed = isGpu ? (g0.used_vram || 0) : (stats.ram?.used || 0)
  const memTotal = isGpu ? (g0.total_vram || 0) : (stats.ram?.total || 0)

  // Nothing meaningful to show yet.
  if (util === null && memTotal === 0) return null

  const name = isGpu ? (g0.name || 'GPU') : 'System RAM'
  const memText = memTotal
    ? `${memLabel} ${formatBytes(memUsed)} / ${formatBytes(memTotal)} (${memPct.toFixed(0)}%)`
    : `${memLabel} ${memPct.toFixed(0)}%`
  const title = util !== null
    ? `${name} — compute ${util.toFixed(0)}%, ${memText}`
    : `${name} — ${memText}`

  return (
    <span className="gpu-gauge" title={title}>
      {util !== null && (
        <span className="gpu-gauge-metric">
          <i className="fas fa-microchip" style={{ color: percentColor(util) }} />
          <span className="gpu-gauge-key">GPU</span>
          <span className="gpu-gauge-bar">
            <span className="gpu-gauge-fill" style={{ width: `${util}%`, background: percentColor(util) }} />
          </span>
          <span className="gpu-gauge-pct" style={{ color: percentColor(util) }}>{util.toFixed(0)}%</span>
        </span>
      )}
      <span className="gpu-gauge-metric">
        <span className="gpu-gauge-key">{memLabel}</span>
        <span className="gpu-gauge-bar">
          <span className="gpu-gauge-fill" style={{ width: `${memPct}%`, background: percentColor(memPct) }} />
        </span>
        <span className="gpu-gauge-pct" style={{ color: percentColor(memPct) }}>{memPct.toFixed(0)}%</span>
      </span>
    </span>
  )
}
