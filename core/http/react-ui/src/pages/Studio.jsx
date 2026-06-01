import { useSearchParams } from 'react-router-dom'
import ImageGen from './ImageGen'
import VideoGen from './VideoGen'
import TTS from './TTS'
import Sound from './Sound'
import JobsQueue from '../components/JobsQueue'
import { useMediaJobs, MEDIA_JOB_TERMINAL_STATUSES } from '../hooks/useMediaJobs'

const TABS = [
  { key: 'images', label: 'Images', icon: 'fas fa-image' },
  { key: 'video', label: 'Video', icon: 'fas fa-video' },
  { key: 'tts', label: 'TTS', icon: 'fas fa-headphones' },
  { key: 'sound', label: 'Sound', icon: 'fas fa-music' },
  { key: 'queue', label: 'Queue', icon: 'fas fa-layer-group' },
]

const TAB_COMPONENTS = {
  images: ImageGen,
  video: VideoGen,
  tts: TTS,
  sound: Sound,
  queue: JobsQueue,
}

export default function Studio() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'images'
  const { jobs } = useMediaJobs()
  const activeCount = jobs.filter(j => !MEDIA_JOB_TERMINAL_STATUSES.has(j.status)).length

  const setTab = (key) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  const ActiveComponent = TAB_COMPONENTS[activeTab] || ImageGen

  return (
    <div>
      <div className="studio-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`studio-tab${activeTab === tab.key ? ' studio-tab-active' : ''}`}
            onClick={() => setTab(tab.key)}
          >
            <i className={tab.icon} />
            <span>{tab.label}</span>
            {tab.key === 'queue' && activeCount > 0 && (
              <span className="studio-tab-badge">{activeCount}</span>
            )}
          </button>
        ))}
      </div>
      <ActiveComponent />
    </div>
  )
}
