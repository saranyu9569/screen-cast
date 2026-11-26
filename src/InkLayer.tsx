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
  const pts = s.points.map(([x, y, p]) => [x * w, y * h, p] as const)
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = (s.size * w) / 1000
  ctx.globalAlpha = s.tool === 'pencil' ? 0.65 : 1
  const base = ctx.lineWidth
  // S Pen pressure (pen tool only): each segment gets its own width. Pencil stays even so its
  // see-through overlaps don't show as dots.
  const width = (p: number | undefined) => (p === undefined ? base : base * (0.35 + 1.3 * p))
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0][0], pts[0][1], width(pts[0][2]) / 2, 0, Math.PI * 2)
    ctx.fill()
  } else if (s.tool === 'pen' && pts[0][2] !== undefined) {
    const mid = (a: readonly (number | undefined)[], b: readonly (number | undefined)[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]
    for (let i = 1; i < pts.length; i++) {
      const from = i === 1 ? pts[0] : mid(pts[i - 1], pts[i])
      const to = i === pts.length - 1 ? pts[i] : mid(pts[i], pts[i + 1])
      ctx.beginPath()
      ctx.lineWidth = width(pts[i][2])
      ctx.moveTo(from[0], from[1])
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], to[0], to[1])
      ctx.stroke()
    }
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
  const drawingWith = useRef<{ id: number; type: string } | null>(null)
  // Palm rejection: once a stylus has touched the slide, fingers and palms no longer draw or erase.
  const penSeen = useRef(false)
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
  const inkPoint = (e: PointerEvent): Stroke['points'][number] => {
    const [x, y] = point(e)
    return e.pointerType === 'pen' && e.pressure > 0 ? [x, y, Math.round(e.pressure * 100) / 100] : [x, y]
  }
  const ignored = (e: React.PointerEvent) => e.pointerType === 'touch' && penSeen.current

  // A second finger means a pinch-zoom, not writing: drop the half-drawn stroke from the first finger.
  const abandonTouchStroke = () => {
    if (current.current && drawingWith.current?.type === 'touch') {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      onErase?.([current.current.id])
      current.current = null
      drawingWith.current = null
    }
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
    if (e.pointerType === 'pen') penSeen.current = true
    if (!tool || tool === 'laser' || e.button !== 0 || ignored(e)) return
    if (drawingWith.current) return abandonTouchStroke() // another pointer is already drawing
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingWith.current = { id: e.pointerId, type: e.pointerType }
    if (tool === 'eraser') return eraseAt(e)
    const size = Math.min(60, Math.max(1, (sizePx * 1000) / Math.max(1, canvasRef.current!.clientWidth)))
    current.current = { id: crypto.randomUUID(), tool, color, size, points: [inkPoint(e.nativeEvent)] }
    scheduleFlush()
  }

  const move = (e: React.PointerEvent) => {
    if (tool === 'laser') return ignored(e) || sendLaser(point(e))
    if (!tool || e.pointerId !== drawingWith.current?.id) return
    if (tool === 'eraser') return eraseAt(e)
    if (!current.current) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events.length ? events : [e.nativeEvent]) current.current.points.push(inkPoint(ev))
    if (current.current.points.length > 4900) up(e) // stay under the server's per-stroke limit
    else scheduleFlush()
  }

  const up = (e?: React.PointerEvent) => {
    if (e && e.pointerId !== drawingWith.current?.id) return
    drawingWith.current = null
    if (!current.current) return
    cancelAnimationFrame(frame.current)
    flush()
    current.current = null
  }
  // The browser cancels a touch when it takes over for pinch-zoom.
  const cancel = (e: React.PointerEvent) => (e.pointerType === 'touch' ? abandonTouchStroke() : up(e))

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
        onPointerCancel={cancel}
        onPointerLeave={() => tool === 'laser' && sendLaser(null)}
      />
      {dot && <span className="laser-dot" style={{ left: `${dot[0] * 100}%`, top: `${dot[1] * 100}%` }} aria-hidden="true" />}
    </>
  )
}
