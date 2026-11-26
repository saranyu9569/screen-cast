// Shared components used by both the viewer and instructor screens.
import { useEffect, useState } from 'react'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...stroke}><path d={d} /></svg>
}


export function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
    </svg>
  )
}

export function SlideNav({ page, numPages, go }: { page: number; numPages: number; go: (d: number) => void }) {
  return (
    <div className="nav">
      <button onClick={() => go(-1)} disabled={page <= 1} aria-label="สไลด์ก่อนหน้า">‹</button>
      <span>{page} / {numPages || '–'}</span>
      <button onClick={() => go(1)} disabled={page >= numPages} aria-label="สไลด์ถัดไป">›</button>
    </div>
  )
}

export function LockButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const label = pinned ? 'ปลดล็อกแถบ (ซ่อนอัตโนมัติ)' : 'ล็อกแถบให้แสดงค้างไว้'
  return (
    <button className="icon-btn" onClick={onToggle} aria-pressed={pinned} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d={pinned ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
      </svg>
    </button>
  )
}

export function FullscreenButton() {
  const [on, setOn] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggle = () => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})
  const label = on ? 'ออกจากเต็มจอ' : 'เต็มจอ'
  return (
    <button className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      <Icon d={on ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
    </button>
  )
}

export function Status({ connected }: { connected: boolean }) {
  return connected ? null : <span className="status" role="status">กำลังเชื่อมต่อใหม่…</span>
}
