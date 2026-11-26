import { useEffect, useRef, useState } from 'react'
import type { Stroke } from './useSlideSync'

export type InkTool = 'pen' | 'pencil' | 'eraser' | 'laser'
const ERASER_RADIUS_PX = 10

type Props = {
  strokes: Stroke[]
  // Without a tool the layer is read-only and lets clicks through.
  tool?: InkTool | null
  color?: string
  sizePx?: number
  onStroke?: (stroke: Stroke) => void
  onErase?: (ids: string[]) => void
  // Laser pointer: `laserAt` shows the dot; `onLaser` streams the pointer while the laser tool is active.
  laserAt?: [number, number] | null
  onLaser?: (at: [number, number] | null) => void
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  const pts = s.points.map(([x, y]) => [x * w, y * h] as const)
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = (s.size * w) / 1000
  ctx.globalAlpha = s.tool === 'pencil' ? 0.65 : 1
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Quadratic curves through segment midpoints smooth out the pointer jitter.
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i]
      const [nx, ny] = pts[i + 1]
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last[0], last[1])
    ctx.stroke()
  }
  ctx.restore()
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function InkLayer({ strokes, tool = null, color = '#e53935', sizePx = 4, onStroke, onErase, laserAt, onLaser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const current = useRef<Stroke | null>(null)
  const frame = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(() => setSize({ w: canvas.clientWidth, h: canvas.clientHeight }))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    for (const s of strokes) drawStroke(ctx, s, size.w, size.h)
  }, [strokes, size])

  const point = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const eraseAt = (e: React.PointerEvent) => {
    const [x, y] = point(e)
    const { w, h } = size
    const hit = strokes.filter((s) => {
      const reach = ERASER_RADIUS_PX + (s.size * w) / 2000
      return s.points.some(([ax, ay], i) => {
        const [bx, by] = s.points[i + 1] ?? s.points[i]
        return distToSegment(x * w, y * h, ax * w, ay * h, bx * w, by * h) <= reach
      })
    })
    if (hit.length) onErase?.(hit.map((s) => s.id))
  }

  // Stream the stroke at most once per frame so viewers watch it being written.
  const flush = () => {
    frame.current = 0
    if (current.current) onStroke?.({ ...current.current, points: [...current.current.points] })
  }
  const scheduleFlush = () => { frame.current ||= requestAnimationFrame(flush) }

  const laserFrame = useRef(0)
  const laserPos = useRef<[number, number] | null>(null)
  const [ownLaser, setOwnLaser] = useState<[number, number] | null>(null)
  const sendLaser = (at: [number, number] | null) => {
    laserPos.current = at
    setOwnLaser(at)
    laserFrame.current ||= requestAnimationFrame(() => {
      laserFrame.current = 0
      onLaser?.(laserPos.current)
    })
  }

  const down = (e: React.PointerEvent) => {
    if (!tool || tool === 'laser' || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'eraser') return eraseAt(e)
    const size = Math.min(60, Math.max(1, (sizePx * 1000) / Math.max(1, canvasRef.current!.clientWidth)))
    current.current = { id: crypto.randomUUID(), tool, color, size, points: [point(e)] }
    scheduleFlush()
  }

  const move = (e: React.PointerEvent) => {
    if (tool === 'laser') return sendLaser(point(e))
    if (!tool || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (tool === 'eraser') return eraseAt(e)
    if (!current.current) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events.length ? events : [e.nativeEvent]) current.current.points.push(point(ev))
    if (current.current.points.length > 4900) up() // stay under the server's per-stroke limit
    else scheduleFlush()
  }

  const up = () => {
    if (!current.current) return
    cancelAnimationFrame(frame.current)
    flush()
    current.current = null
  }

  const dot = tool === 'laser' ? ownLaser : laserAt
  return (
    <>
      <canvas
        ref={canvasRef}
        className={tool ? `ink-layer editing ${tool}` : 'ink-layer'}
        aria-hidden="true"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => tool === 'laser' && sendLaser(null)}
      />
      {dot && <span className="laser-dot" style={{ left: `${dot[0] * 100}%`, top: `${dot[1] * 100}%` }} aria-hidden="true" />}
    </>
  )
}
