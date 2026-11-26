import { useEffect, useRef, useState } from 'react'

export type SlideState = { pdfUrl: string | null; page: number }

// Pass the instructor's login token to control slides; null joins as a viewer.
export function useSlideSync(token: string | null) {
  const [state, setState] = useState<SlideState>({ pdfUrl: null, page: 1 })
  const [connected, setConnected] = useState(false)
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
      ws.onmessage = (e) => setState(JSON.parse(e.data))
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

  const goto = (page: number) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ page }))
    setState((s) => ({ ...s, page })) // optimistic, so rapid clicks don't reuse a stale page
  }

  return { state, connected, goto }
}
