import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'

type ThemeMode = 'system' | 'light' | 'dark'
type ShellView = 'browser' | 'settings'

type AppSettings = {
  theme: ThemeMode
  closeToTray: boolean
  minimizeToTray: boolean
  startPage: string
}

type QuickLink = {
  id: string
  label: string
  description: string
  url: string
}

type AccountMenuItem = {
  id: string
  label: string
  url: string
  icon: 'profile' | 'likes' | 'stations' | 'follow' | 'tracks' | 'insights' | 'distribute'
}

type QueueItem = {
  id: string
  title: string
  artist: string
  duration: string
  artworkUrl: string
  isCurrent: boolean
}

type PlayerState = {
  title: string
  artist: string
  artworkUrl: string
  currentTime: string
  duration: string
  progress: number
  volume: number
  isMuted: boolean
  isPlaying: boolean
  shuffleEnabled: boolean
  repeatMode: 'off' | 'all' | 'one'
  queueItems: QueueItem[]
}

type SurfaceState = 'booting' | 'ready' | 'error'
type PlayerAction = 'previous' | 'toggle' | 'next' | 'shuffle' | 'repeat' | 'like' | 'volume'

const SHELL_EVENT = 'navigate-shell'
const SOUND_CLOUD_LINK_EVENT = 'soundcloud-link'
const SOUND_CLOUD_ACCOUNT_EVENT = 'soundcloud-account'
const SOUND_CLOUD_PLAYER_EVENT = 'soundcloud-player-state'
const SETTINGS_STORAGE_KEY = 'soundcloud-app.settings.v3'
const ACCOUNT_STORAGE_KEY = 'soundcloud-app.account.v1'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  closeToTray: true,
  minimizeToTray: true,
  startPage: 'https://soundcloud.com/discover',
}

const DEFAULT_PLAYER_STATE: PlayerState = {
  title: 'SoundCloud Web Player',
  artist: 'Waiting for playback',
  artworkUrl: '',
  currentTime: '0:00',
  duration: '--:--',
  progress: 0,
  volume: 38,
  isMuted: false,
  isPlaying: false,
  shuffleEnabled: false,
  repeatMode: 'off',
  queueItems: [],
}

const QUICK_LINKS: QuickLink[] = [
  {
    id: 'discover',
    label: 'Discover',
    description: 'SoundCloud home and recommendations',
    url: 'https://soundcloud.com/discover',
  },
  {
    id: 'stream',
    label: 'Stream',
    description: 'Your signed-in listening stream',
    url: 'https://soundcloud.com/stream',
  },
  {
    id: 'likes',
    label: 'Likes',
    description: 'Tracks and sets you liked',
    url: 'https://soundcloud.com/you/likes',
  },
  {
    id: 'playlists',
    label: 'Playlists',
    description: 'Your playlists and longer sessions',
    url: 'https://soundcloud.com/you/playlists',
  },
  {
    id: 'library',
    label: 'Library',
    description: 'Your SoundCloud library',
    url: 'https://soundcloud.com/you/library',
  },
]

const PRIMARY_NAV_LINKS = [
  { label: 'Home', url: 'https://soundcloud.com/discover' },
  { label: 'Feed', url: 'https://soundcloud.com/stream' },
  { label: 'Library', url: 'https://soundcloud.com/you/library' },
]

const ACCOUNT_MENU_ITEMS: AccountMenuItem[] = [
  { id: 'profile', label: 'Profile', url: 'https://soundcloud.com/you', icon: 'profile' },
  { id: 'likes', label: 'Likes', url: 'https://soundcloud.com/you/likes', icon: 'likes' },
  { id: 'stations', label: 'Stations', url: 'https://soundcloud.com/stations', icon: 'stations' },
  { id: 'follow', label: 'Who to follow', url: 'https://soundcloud.com/you/following', icon: 'follow' },
  { id: 'tracks', label: 'Tracks', url: 'https://soundcloud.com/you/tracks', icon: 'tracks' },
  { id: 'insights', label: 'Insights', url: 'https://soundcloud.com/you/insights', icon: 'insights' },
  { id: 'distribute', label: 'Distribute', url: 'https://soundcloud.com/distribute', icon: 'distribute' },
]

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function loadSettings(): AppSettings {
  const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY)

  if (!stored) {
    return DEFAULT_SETTINGS
  }

  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function loadAccountState() {
  return window.localStorage.getItem(ACCOUNT_STORAGE_KEY) === 'signed-in'
}

function isSoundCloudUrl(value: string) {
  return /^https?:\/\/(www\.)?(soundcloud\.com|on\.soundcloud\.com)\//i.test(value.trim())
}

function buildSearchUrl(value: string) {
  return `https://soundcloud.com/search?q=${encodeURIComponent(value.trim())}`
}

function toDisplayUrl(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}${parsed.search}`
  } catch {
    return value
  }
}

function titleBarButtonLabel(action: 'minimize' | 'maximize' | 'close') {
  if (action === 'minimize') {
    return 'Minimize window'
  }

  if (action === 'maximize') {
    return 'Toggle maximize window'
  }

  return 'Close window'
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M20 12a8 8 0 0 1-14.1 5.1" />
      <path d="M4 12A8 8 0 0 1 18.1 6.9" />
      <path d="M18 3v4h-4" />
      <path d="M6 21v-4h4" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="m21 21-4.3-4.3" />
      <circle cx="11" cy="11" r="7" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function AccountMenuIcon({ icon }: { icon: AccountMenuItem['icon'] }) {
  if (icon === 'likes') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    )
  }

  if (icon === 'stations') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <path d="M6 9a8 8 0 0 0 0 6" />
        <path d="M18 9a8 8 0 0 1 0 6" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }

  if (icon === 'follow') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M18 8v6" />
        <path d="M15 11h6" />
      </svg>
    )
  }

  if (icon === 'tracks') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <path d="M5 12v4" />
        <path d="M9 8v8" />
        <path d="M13 5v11" />
        <path d="M17 10v6" />
        <path d="M21 7v9" />
      </svg>
    )
  }

  if (icon === 'insights') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <path d="M4 20h16" />
        <path d="M7 16V8" />
        <path d="M12 16V4" />
        <path d="M17 16v-6" />
      </svg>
    )
  }

  if (icon === 'distribute') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
        <path d="M5 12h14" />
        <path d="m15 8 4 4-4 4" />
        <path d="M9 8 5 12l4 4" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="menu-icon">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
      <path d="M4 7h12" />
      <path d="M4 12h12" />
      <path d="M4 17h8" />
      <path d="m18 15 3 2-3 2v-4Z" />
    </svg>
  )
}

async function applySoundCloudAppMode() {
  if (!isTauriRuntime()) {
    return
  }

  await invoke('apply_soundcloud_app_mode')
}

async function createSoundCloudWebview(url: string, bounds: DOMRect) {
  await invoke('create_soundcloud_webview', {
    url,
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  })
}

async function setSoundCloudWebviewBounds(bounds: DOMRect) {
  await invoke('set_soundcloud_webview_bounds', {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  })
}

async function closeSoundCloudWebview() {
  await invoke('close_soundcloud_webview')
}

async function controlSoundCloudPlayer(action: PlayerAction) {
  if (!isTauriRuntime()) {
    return
  }

  await invoke('control_soundcloud_player', { action })
}

async function seekSoundCloudPlayer(progress: number) {
  if (!isTauriRuntime()) {
    return
  }

  await invoke('seek_soundcloud_player', { progress })
}

async function setSoundCloudVolume(volume: number) {
  if (!isTauriRuntime()) {
    return
  }

  await invoke('set_soundcloud_volume', { volume })
}

function scheduleSoundCloudAppMode() {
  const delays = [500, 1500, 3000, 6000, 10000]
  const timers = delays.map((delay) =>
    window.setTimeout(() => {
      void applySoundCloudAppMode().catch(() => undefined)
    }, delay),
  )

  return () => {
    timers.forEach((timer) => window.clearTimeout(timer))
  }
}

function pageTitle(url: string) {
  const match = QUICK_LINKS.find((item) => item.url === url)
  if (match) {
    return match.label
  }

  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return 'Home'
    }

    const slug = parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'Page'
    return slug
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
  } catch {
    return 'Custom page'
  }
}

function timeToSeconds(value: string) {
  const parts = value.split(':').map((part) => Number(part))
  if (!parts.length || parts.some((part) => Number.isNaN(part))) {
    return 0
  }

  return parts.reduce((total, part) => total * 60 + part, 0)
}

function secondsToTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function cleanTrackTitle(value: string, artist = '') {
  let title = value.replace(/^current track:\s*/i, '').replace(/\s+/g, ' ').trim()
  const normalizedArtist = artist.trim()

  for (let index = Math.floor(title.length / 2); index > 2; index -= 1) {
    const first = title.slice(0, index).trim()
    const second = title.slice(index).trim()
    if (first && first === second) {
      title = first
      break
    }
  }

  if (normalizedArtist && title.endsWith(normalizedArtist)) {
    title = title.slice(0, -normalizedArtist.length).trim()
  }

  return title || DEFAULT_PLAYER_STATE.title
}

function PlayerIcon({
  action,
  repeatMode = 'off',
  isPlaying = false,
  isMuted = false,
}: {
  action: PlayerAction
  repeatMode?: PlayerState['repeatMode']
  isPlaying?: boolean
  isMuted?: boolean
}) {
  if (action === 'previous') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
        <path d="M6 5v14" />
        <path d="m19 6-10 6 10 6V6Z" />
      </svg>
    )
  }

  if (action === 'next') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
        <path d="M18 5v14" />
        <path d="m5 6 10 6-10 6V6Z" />
      </svg>
    )
  }

  if (action === 'shuffle') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
        <path d="M16 3h5v5" />
        <path d="M4 20 21 3" />
        <path d="M21 16v5h-5" />
        <path d="m15 15 6 6" />
        <path d="m4 4 5 5" />
      </svg>
    )
  }

  if (action === 'repeat') {
    return (
      <span className="player-icon-stack">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
          <path d="M17 2 21 6l-4 4" />
          <path d="M3 11V9a3 3 0 0 1 3-3h15" />
          <path d="M7 22 3 18l4-4" />
          <path d="M21 13v2a3 3 0 0 1-3 3H3" />
        </svg>
        {repeatMode === 'one' ? <span className="player-icon-stack__badge">1</span> : null}
      </span>
    )
  }

  if (action === 'like') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon player-icon--fill">
        <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    )
  }

  if (action === 'volume') {
    if (isMuted) {
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          <path d="M19 9 15 13" />
          <path d="m15 9 4 4" />
        </svg>
      )
    }

    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M16 9.5a4 4 0 0 1 0 5" />
        <path d="M19 7a8 8 0 0 1 0 10" />
      </svg>
    )
  }

  if (action === 'toggle' && isPlaying) {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon player-icon--fill">
        <path d="M7 5h4v14H7V5Z" />
        <path d="M13 5h4v14h-4V5Z" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="player-icon player-icon--fill">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  )
}

function NextUpPanel({
  state,
  onClose,
}: {
  state: PlayerState
  onClose: () => void
}) {
  const displayTitle = cleanTrackTitle(state.title, state.artist)
  const queueItems = state.queueItems.length
    ? state.queueItems
    : [
        {
          id: 'current-track',
          title: displayTitle,
          artist: state.artist,
          duration: state.duration,
          artworkUrl: state.artworkUrl,
          isCurrent: true,
        },
      ]

  return (
    <aside className="nextup-panel" aria-label="Next up">
      <div className="nextup-panel__header">
        <h2>Next up</h2>
        <button type="button" className="nextup-panel__clear" disabled>
          Clear
        </button>
        <button type="button" className="nextup-panel__close" aria-label="Close next up" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="nextup-panel__list">
        {queueItems.map((item) => (
          <div key={item.id} className={item.isCurrent ? 'nextup-item nextup-item--current' : 'nextup-item'}>
            <div
              className="nextup-item__art"
              style={item.artworkUrl ? { backgroundImage: `url(${item.artworkUrl})` } : undefined}
              aria-hidden="true"
            >
              {item.isCurrent ? <span>II</span> : null}
            </div>
            <div className="nextup-item__copy">
              <span>{item.artist || 'SoundCloud'}</span>
              <strong>{cleanTrackTitle(item.title, item.artist) || 'Waiting for playback'}</strong>
            </div>
            <time>{item.duration && item.duration !== '--:--' ? item.duration : ''}</time>
          </div>
        ))}
      </div>
    </aside>
  )
}

function PlayerBar({
  state,
  isQueueOpen,
  onToggleQueue,
}: {
  state: PlayerState
  isQueueOpen: boolean
  onToggleQueue: () => void
}) {
  const [seekHover, setSeekHover] = useState<number | null>(null)
  const [seekDragValue, setSeekDragValue] = useState<number | null>(null)
  const [volumeHover, setVolumeHover] = useState<number | null>(null)
  const [volumeDragValue, setVolumeDragValue] = useState<number | null>(null)
  const displayTitle = cleanTrackTitle(state.title, state.artist)
  const displayProgress = seekDragValue ?? state.progress
  const displayVolume = state.isMuted ? 0 : volumeDragValue ?? state.volume

  const triggerPlayer = (action: PlayerAction) => {
    void controlSoundCloudPlayer(action)
  }

  const valueFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))
  }

  const seekFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const nextProgress = valueFromPointer(event)
    setSeekDragValue(nextProgress)
    void seekSoundCloudPlayer(nextProgress)
  }

  const volumeFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const nextVolume = valueFromPointer(event)
    setVolumeDragValue(nextVolume)
    void setSoundCloudVolume(nextVolume)
  }

  const durationSeconds = timeToSeconds(state.duration)
  const hoverTime = seekHover === null || durationSeconds <= 0 ? state.currentTime : secondsToTime((durationSeconds * seekHover) / 100)

  return (
    <footer className="playerbar-shell" aria-label="Player controls">
      {isQueueOpen ? <NextUpPanel state={state} onClose={onToggleQueue} /> : null}

      <div className="playerbar">
        <div className="playerbar__track">
          <div
            className="playerbar__art"
            aria-hidden="true"
            style={state.artworkUrl ? { backgroundImage: `url(${state.artworkUrl})` } : undefined}
          >
            <span />
          </div>
          <div className="playerbar__copy">
            <strong>{displayTitle}</strong>
            <span>{state.artist}</span>
          </div>
        </div>

        <div className="playerbar__center">
          <div className="playerbar__controls">
            <button
              type="button"
              className={state.shuffleEnabled ? 'playerbar__button playerbar__button--active' : 'playerbar__button'}
              aria-label="Shuffle"
              onClick={() => triggerPlayer('shuffle')}
            >
              <PlayerIcon action="shuffle" />
            </button>
            <button type="button" className="playerbar__button" aria-label="Previous" onClick={() => triggerPlayer('previous')}>
              <PlayerIcon action="previous" />
            </button>
            <button type="button" className="playerbar__button playerbar__button--play" aria-label="Play or pause" onClick={() => triggerPlayer('toggle')}>
              <PlayerIcon action="toggle" isPlaying={state.isPlaying} />
            </button>
            <button type="button" className="playerbar__button" aria-label="Next" onClick={() => triggerPlayer('next')}>
              <PlayerIcon action="next" />
            </button>
            <button
              type="button"
              className={state.repeatMode === 'off' ? 'playerbar__button' : 'playerbar__button playerbar__button--active'}
              aria-label={state.repeatMode === 'one' ? 'Repeat one' : 'Repeat'}
              onClick={() => triggerPlayer('repeat')}
            >
              <PlayerIcon action="repeat" repeatMode={state.repeatMode} />
            </button>
          </div>

          <div className="playerbar__timeline">
            <span>{state.currentTime}</span>
            <button
              type="button"
              className="playerbar__progress"
              style={{ '--slider-value': `${displayProgress}%`, '--slider-hover': `${seekHover ?? displayProgress}%` } as CSSProperties}
              aria-label="Seek in current track"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(state.progress)}
              data-tooltip={hoverTime}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                const nextProgress = valueFromPointer(event)
                setSeekHover(nextProgress)
                setSeekDragValue(nextProgress)
              }}
              onPointerMove={(event) => {
                const nextProgress = valueFromPointer(event)
                setSeekHover(nextProgress)
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  setSeekDragValue(nextProgress)
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                seekFromPointer(event)
                window.setTimeout(() => setSeekDragValue(null), 500)
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                setSeekDragValue(null)
              }}
              onPointerLeave={() => setSeekHover(null)}
            >
              <span className="playerbar__slider-fill" />
              <span className="playerbar__slider-thumb" />
            </button>
            <span>{state.duration}</span>
          </div>
        </div>

        <div className="playerbar__tools">
          <button type="button" className="playerbar__tool" aria-label="Like current track" onClick={() => triggerPlayer('like')}>
            <PlayerIcon action="like" />
          </button>
          <button
            type="button"
            className={state.isMuted ? 'playerbar__tool playerbar__tool--muted' : 'playerbar__tool'}
            aria-label={state.isMuted ? 'Unmute' : 'Mute'}
            onClick={() => triggerPlayer('volume')}
          >
            <PlayerIcon action="volume" isMuted={state.isMuted} />
          </button>
          <button
            type="button"
            className="playerbar__volume"
            style={{ '--slider-value': `${displayVolume}%`, '--slider-hover': `${volumeHover ?? displayVolume}%` } as CSSProperties}
            aria-label="Set volume"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(displayVolume)}
            data-tooltip={`${Math.round(volumeHover ?? displayVolume)}%`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setVolumeHover(valueFromPointer(event))
              volumeFromPointer(event)
            }}
            onPointerMove={(event) => {
              setVolumeHover(valueFromPointer(event))
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                volumeFromPointer(event)
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              setVolumeDragValue(null)
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              setVolumeDragValue(null)
            }}
            onPointerLeave={() => setVolumeHover(null)}
          >
            <span className="playerbar__slider-fill" />
            <span className="playerbar__slider-thumb" />
          </button>
          <button
            type="button"
            className={isQueueOpen ? 'playerbar__tool playerbar__tool--active' : 'playerbar__tool'}
            aria-label="Next up"
            aria-expanded={isQueueOpen}
            onClick={onToggleQueue}
          >
            <QueueIcon />
          </button>
        </div>
      </div>
    </footer>
  )
}

function SoundCloudSurface({
  url,
  refreshToken,
  onReady,
  onError,
}: {
  url: string
  refreshToken: number
  onReady: () => void
  onError: (message: string) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let disposed = false
    let didSignalReady = false

    const signalReady = () => {
      if (disposed || didSignalReady) {
        return
      }

      didSignalReady = true
      onReadyRef.current()
    }

    const syncBounds = async () => {
      if (!hostRef.current) {
        return
      }

      const bounds = hostRef.current.getBoundingClientRect()
      if (bounds.width < 1 || bounds.height < 1) {
        return
      }

      await setSoundCloudWebviewBounds(bounds).catch(() => undefined)
    }

    const createWebview = async () => {
      const host = hostRef.current
      if (!host) {
        return
      }

      const bounds = host.getBoundingClientRect()
      if (bounds.width < 1 || bounds.height < 1) {
        window.setTimeout(() => {
          void createWebview()
        }, 60)
        return
      }

      await closeSoundCloudWebview().catch(() => undefined)

      if (disposed) {
        return
      }

      await createSoundCloudWebview(url, bounds)
        .then(async () => {
          if (disposed) {
            return
          }

          await syncBounds()
          window.setTimeout(signalReady, 900)
        })
        .catch((error: unknown) => {
          if (disposed) {
            return
          }

          const message = error instanceof Error ? error.message : String(error)
          onErrorRef.current(message || 'Unknown webview creation error')
        })

      if (!disposed) {
        signalReady()
      }
    }

    const observer = new ResizeObserver(() => {
      void syncBounds()
    })

    const handleResize = () => {
      void syncBounds()
    }

    if (hostRef.current) {
      observer.observe(hostRef.current)
    }

    window.addEventListener('resize', handleResize)
    void createWebview()

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
      void closeSoundCloudWebview().catch(() => undefined)
    }
  }, [url, refreshToken])

  return <div className="browser-surface__host" ref={hostRef} />
}

function App() {
  const initialSettings = loadSettings()
  const [settings, setSettings] = useState<AppSettings>(initialSettings)
  const [view, setView] = useState<ShellView>('browser')
  const [targetUrl, setTargetUrl] = useState(initialSettings.startPage)
  const [inputValue, setInputValue] = useState(initialSettings.startPage)
  const [history, setHistory] = useState<string[]>([initialSettings.startPage])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [surfaceState, setSurfaceState] = useState<SurfaceState>('booting')
  const [surfaceError, setSurfaceError] = useState('')
  const [surfaceRefreshToken, setSurfaceRefreshToken] = useState(0)
  const [isSignedIn, setIsSignedIn] = useState(loadAccountState)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [playerState, setPlayerState] = useState<PlayerState>(DEFAULT_PLAYER_STATE)
  const historyRef = useRef(history)
  const historyIndexRef = useRef(historyIndex)
  const consentCleanupRef = useRef<(() => void) | null>(null)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  const activeQuickLink = useMemo(
    () => QUICK_LINKS.find((item) => item.url === targetUrl)?.id ?? null,
    [targetUrl],
  )
  const currentTitle = useMemo(() => pageTitle(targetUrl), [targetUrl])
  const isSettingsOpen = view === 'settings'
  const surfaceTone = surfaceState === 'ready' ? 'Live site' : surfaceState === 'error' ? 'Needs attention' : 'Connecting'

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, isSignedIn ? 'signed-in' : 'signed-out')
  }, [isSignedIn])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    historyIndexRef.current = historyIndex
  }, [historyIndex])

  useEffect(() => {
    return () => {
      consentCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    const timer = window.setInterval(() => {
      void applySoundCloudAppMode().catch(() => undefined)
    }, 4500)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let removeCloseHandler: (() => void) | undefined
    let removeShellListener: (() => void) | undefined
    let removeLinkListener: (() => void) | undefined
    let removeAccountListener: (() => void) | undefined
    let removePlayerListener: (() => void) | undefined

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!settings.closeToTray) {
          return
        }

        event.preventDefault()
        await getCurrentWindow().hide()
      })
      .then((unlisten) => {
        removeCloseHandler = unlisten
      })

    void listen<string>(SHELL_EVENT, (event) => {
      if (event.payload === 'settings') {
        setView('settings')
      }
    }).then((unlisten) => {
      removeShellListener = unlisten
    })

    void listen<string>(SOUND_CLOUD_LINK_EVENT, (event) => {
      navigateTo(event.payload)
    }).then((unlisten) => {
      removeLinkListener = unlisten
    })

    void listen<string>(SOUND_CLOUD_ACCOUNT_EVENT, (event) => {
      if (event.payload === 'signed-in') {
        setIsSignedIn(true)
        setIsAccountMenuOpen(false)
      }
    }).then((unlisten) => {
      removeAccountListener = unlisten
    })

    void listen<string>(SOUND_CLOUD_PLAYER_EVENT, (event) => {
      try {
        const nextState = JSON.parse(event.payload) as Partial<PlayerState>
        setPlayerState({
          title: nextState.title || DEFAULT_PLAYER_STATE.title,
          artist: nextState.artist || DEFAULT_PLAYER_STATE.artist,
          artworkUrl: nextState.artworkUrl || '',
          currentTime: nextState.currentTime || DEFAULT_PLAYER_STATE.currentTime,
          duration: nextState.duration || DEFAULT_PLAYER_STATE.duration,
          progress: Math.max(0, Math.min(100, Number(nextState.progress) || 0)),
          volume: Math.max(0, Math.min(100, Number(nextState.volume) || DEFAULT_PLAYER_STATE.volume)),
          isMuted: Boolean(nextState.isMuted),
          isPlaying: Boolean(nextState.isPlaying),
          shuffleEnabled: Boolean(nextState.shuffleEnabled),
          repeatMode: nextState.repeatMode === 'one' || nextState.repeatMode === 'all' ? nextState.repeatMode : 'off',
          queueItems: Array.isArray(nextState.queueItems) ? nextState.queueItems : [],
        })
      } catch {
        setPlayerState(DEFAULT_PLAYER_STATE)
      }
    }).then((unlisten) => {
      removePlayerListener = unlisten
    })

    return () => {
      removeCloseHandler?.()
      removeShellListener?.()
      removeLinkListener?.()
      removeAccountListener?.()
      removePlayerListener?.()
    }
  }, [settings.closeToTray])

  const persistSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings)
  }

  function navigateTo(url: string) {
    setView('browser')
    setIsAccountMenuOpen(false)
    setIsQueueOpen(false)
    setTargetUrl(url)
    setInputValue(url)
    setSurfaceState('booting')
    setSurfaceError('')

    setHistory((currentHistory) => {
      const head = currentHistory.slice(0, historyIndexRef.current + 1)
      if (head.at(-1) === url) {
        return head
      }

      return [...head, url]
    })
    setHistoryIndex((currentIndex) => {
      const currentUrl = historyRef.current[currentIndex]
      if (currentUrl === url) {
        return currentIndex
      }

      return currentIndex + 1
    })
  }

  const reloadSurface = () => {
    setView('browser')
    setSurfaceState('booting')
    setSurfaceError('')
    setSurfaceRefreshToken((value) => value + 1)
  }

  const handleNavigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = inputValue.trim()

    if (!value) {
      return
    }

    const nextUrl = isSoundCloudUrl(value) ? value : buildSearchUrl(value)
    navigateTo(nextUrl)
  }

  const handleWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (!isTauriRuntime()) {
      return
    }

    const appWindow = getCurrentWindow()

    if (action === 'minimize') {
      await appWindow.minimize()
      return
    }

    if (action === 'maximize') {
      await appWindow.toggleMaximize()
      return
    }

    if (settings.minimizeToTray) {
      await appWindow.hide()
      return
    }

    await appWindow.close()
  }

  return (
    <div className="app-shell">
      <header className="shellbar">
        <div className="brand" data-tauri-drag-region>
          <h1>SoundCloud</h1>
        </div>

        <div className="shellbar__cluster">
          <button type="button" className="shell-icon-button" aria-label="Refresh content" title="Refresh" onClick={reloadSurface}>
            <RefreshIcon />
          </button>
        </div>

        <nav className="app-tabs" aria-label="SoundCloud sections">
          {PRIMARY_NAV_LINKS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={targetUrl === item.url ? 'app-tab app-tab--active' : 'app-tab'}
              onClick={() => navigateTo(item.url)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <form className="commandbar" onSubmit={handleNavigate}>
          <input
            type="text"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Search SoundCloud or paste a link"
            aria-label="Search SoundCloud"
          />
          <button type="submit" aria-label="Search" title="Search">
            <SearchIcon />
          </button>
        </form>

        <div className="shellbar__cluster shellbar__cluster--end">
          <div className="account-menu" ref={accountMenuRef}>
            <button
              type="button"
              className={isAccountMenuOpen ? 'shell-icon-button shell-icon-button--active' : 'shell-icon-button'}
              aria-label={isSignedIn ? 'Account options' : 'Account / Sign in'}
              aria-expanded={isAccountMenuOpen}
              title={isSignedIn ? 'Account options' : 'Account / Sign in'}
              onClick={() => {
                if (!isSignedIn) {
                  navigateTo('https://soundcloud.com/signin')
                  return
                }

                setIsAccountMenuOpen((value) => !value)
              }}
            >
              <AccountIcon />
            </button>

            {isSignedIn && isAccountMenuOpen ? (
              <div className="account-menu__panel" role="menu">
                {ACCOUNT_MENU_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="account-menu__item"
                    role="menuitem"
                    onClick={() => navigateTo(item.url)}
                  >
                    <AccountMenuIcon icon={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button type="button" className="shell-icon-button" aria-label="Upload" title="Upload" onClick={() => navigateTo('https://soundcloud.com/upload')}>
            <UploadIcon />
          </button>

          <button
            type="button"
            className={isSettingsOpen ? 'shell-icon-button shell-icon-button--active' : 'shell-icon-button'}
            aria-label={isSettingsOpen ? 'Close settings' : 'Open settings'}
            title={isSettingsOpen ? 'Close settings' : 'Settings'}
            onClick={() => setView(isSettingsOpen ? 'browser' : 'settings')}
          >
            <SettingsIcon />
          </button>
        </div>

        <div className="window-actions">
          {(['minimize', 'maximize', 'close'] as const).map((action) => (
            <button key={action} type="button" aria-label={titleBarButtonLabel(action)} onClick={() => void handleWindowAction(action)}>
              {action === 'minimize' ? '-' : action === 'maximize' ? <FullscreenIcon /> : <CloseIcon />}
            </button>
          ))}
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <section className="rail__hero">
            <p className="rail__eyebrow">SoundCloud</p>
            <h2>{currentTitle}</h2>
            <div className="rail__chips">
              <span>{surfaceTone}</span>
              <span>{activeQuickLink ? 'Pinned route' : 'Direct page'}</span>
            </div>
          </section>

          <section className="rail__nav">
            {QUICK_LINKS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeQuickLink ? 'rail-link rail-link--active' : 'rail-link'}
                onClick={() => navigateTo(item.url)}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </section>
        </aside>

        <main className="stage">
          <section className={isSettingsOpen ? 'surface-shell surface-shell--settings-open' : 'surface-shell'}>
            <div className="surface-shell__body">
              <div className="browser-surface__frame">
                <SoundCloudSurface
                  url={targetUrl}
                  refreshToken={surfaceRefreshToken}
                  onReady={() => {
                    setSurfaceState('ready')
                    setSurfaceError('')
                    consentCleanupRef.current?.()
                    consentCleanupRef.current = scheduleSoundCloudAppMode()
                  }}
                  onError={(message) => {
                    setSurfaceState('error')
                    setSurfaceError(message)
                  }}
                />

                {surfaceState === 'booting' ? (
                  <div className="surface-overlay">
                  <h3>Loading SoundCloud</h3>
                  <p>Preparing content.</p>
                  </div>
                ) : null}

                {surfaceState === 'error' ? (
                  <div className="surface-overlay surface-overlay--error">
                  <h3>SoundCloud content failed to open</h3>
                    <p>{surfaceError || 'The child webview failed before SoundCloud loaded.'}</p>
                    <div className="surface-overlay__actions">
                      <button
                        type="button"
                        onClick={() => {
                          setSurfaceState('booting')
                          setSurfaceError('')
                          setSurfaceRefreshToken((value) => value + 1)
                        }}
                      >
                      Retry
                      </button>
                      <button type="button" className="button-ghost" onClick={() => void openUrl(targetUrl)}>
                        Open externally
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {isSettingsOpen ? (
                <aside className="settings-drawer">
                <div className="settings-drawer__header">
                  <div>
                    <p className="panel__eyebrow">App controls</p>
                    <h2>Settings</h2>
                  </div>
                  <button type="button" className="shell-button" onClick={() => setView('browser')}>
                    Done
                  </button>
                </div>

                <div className="settings-grid">
                  <label>
                    <span>Theme</span>
                    <select value={settings.theme} onChange={(event) => persistSettings({ ...settings, theme: event.target.value as ThemeMode })}>
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>

                  <label>
                    <span>Start page</span>
                    <select
                      value={settings.startPage}
                      onChange={(event) => persistSettings({ ...settings, startPage: event.target.value })}
                    >
                      {QUICK_LINKS.map((item) => (
                        <option key={item.id} value={item.url}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="toggle-card">
                    <div>
                      <strong>Close to tray</strong>
                      <p>Keep the app alive when the window closes.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.closeToTray}
                      onChange={() => persistSettings({ ...settings, closeToTray: !settings.closeToTray })}
                    />
                  </label>

                  <label className="toggle-card">
                    <div>
                      <strong>Hide on close button</strong>
                      <p>Use the titlebar close action as a hide-to-tray shortcut.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.minimizeToTray}
                      onChange={() => persistSettings({ ...settings, minimizeToTray: !settings.minimizeToTray })}
                    />
                  </label>
                </div>

                <div className="settings-drawer__footer">
                  <span>Current route</span>
                  <code>{toDisplayUrl(targetUrl)}</code>
                </div>
                </aside>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      <PlayerBar state={playerState} isQueueOpen={isQueueOpen} onToggleQueue={() => setIsQueueOpen((value) => !value)} />
    </div>
  )
}

export default App
