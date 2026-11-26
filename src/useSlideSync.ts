import { useEffect, useRef, useState } from 'react'

// Points are normalized to 0..1 of the slide; size is in px per 1000px of slide width.
export type Stroke = { id: string; tool: 'pen' | 'pencil'; color: string; size: number; points: [number, number][] }
export type Ink = Record<number, Stroke[]>
export type SlideState = { pdfUrl: string | null; pdfName: string | null; page: number; ink: Ink }

type Message =
  | ({ type: 'state' } & SlideState)
  | { type: 'stroke'; page: number; stroke: Stroke }
  | { type: 'erase'; page: number; ids: string[] }
  | { type: 'clearPage'; page: number }
  | { type: 'clear' }
  | { type: 'laser'; page: number; at: [number, number] | null }

function applyInk(ink: Ink, msg: Message): Ink {
  switch (msg.type) {
    case 'stroke': {
      const list = ink[msg.page] ?? []
      const i = list.findIndex((s) => s.id === msg.stroke.id)
      return { ...ink, [msg.page]: i >= 0 ? list.with(i, msg.stroke) : [...list, msg.stroke] }
    }
    case 'erase':
      return { ...ink, [msg.page]: (ink[msg.page] ?? []).filter((s) => !msg.ids.includes(s.id)) }
    case 'clearPage':
      return { ...ink, [msg.page]: [] }
    case 'clear':
      return {}
    default:
      return ink
  }
}

// Pass the instructor's login token to control slides; null joins as a viewer.
export function useSlideSync(token: string | null) {
  const [state, setState] = useState<SlideState>({ pdfUrl: null, pdfName: null, page: 1, ink: {} })
  const [connected, setConnected] = useState(false)
  const [laser, setLaser] = useState<{ page: number; at: [number, number] } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      const ws = new WebSocket(`${proto}://${location.host}/ws${query}`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => {
        const msg: Message = JSON.parse(e.data)
        if (msg.type === 'laser') setLaser(msg.at ? { page: msg.page, at: msg.at } : null)
        else if (msg.type === 'state') {
          const { type: _type, ...next } = msg // eslint-disable-line @typescript-eslint/no-unused-vars
          setState(next)
        } else setState((s) => ({ ...s, ink: applyInk(s.ink, msg) }))
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [token])

  // Instructor-only; edits apply locally right away so drawing and rapid clicks never lag behind the server.
  const send = (msg: Message | { type: 'page'; page: number }) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify(msg))
    if (msg.type === 'page') setState((s) => ({ ...s, page: msg.page }))
    else if (msg.type !== 'state' && msg.type !== 'laser') setState((s) => ({ ...s, ink: applyInk(s.ink, msg) }))
  }

  const goto = (page: number) => send({ type: 'page', page })
  const ink = {
    stroke: (page: number, stroke: Stroke) => send({ type: 'stroke', page, stroke }),
    erase: (page: number, ids: string[]) => send({ type: 'erase', page, ids }),
    clearPage: (page: number) => send({ type: 'clearPage', page }),
    clearAll: () => send({ type: 'clear' }),
    laser: (page: number, at: [number, number] | null) => send({ type: 'laser', page, at }),
  }

  return { state, connected, goto, ink, laser }
}
