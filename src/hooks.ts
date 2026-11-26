// Shared hooks and constants used by both the viewer and instructor screens.
import { useEffect, useState } from 'react'

export function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function useArrowKeys(go: (delta: number) => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [go])
}

// Bottom bar starts locked open; unlocking makes it auto-hide. Remembered per browser.
export function usePinnedBar() {
  const [pinned, setPinned] = useState(() => localStorage.getItem('barPinned') !== 'false')
  const toggle = () => {
    localStorage.setItem('barPinned', String(!pinned))
    setPinned(!pinned)
  }
  return [pinned, toggle] as const
}

export const clamp = (n: number, max: number) => Math.min(Math.max(n, 1), Math.max(max, 1))

export const icons = {
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  cast: 'M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4M3 20h.01',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  close: 'M6 6l12 12M18 6L6 18',
  pointer: 'M5 3l14 8-6 2-3 6z',
  laser: 'M12 12h.01M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  pen: 'M15 4l5 5L9 20H4v-5zM13 6l5 5',
  pencil: 'M17 3l4 4L8 20l-5 1 1-5zM15 5l4 4M4 16l4 4',
  eraser: 'M8 20h12M5 15l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-8 8H9l-4-4a2 2 0 0 1 0-1zM9 11l5 5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
}
