// Instructor ink: strokes drawn over slides, kept per page until the instructor discards them.
// Points are normalized to 0..1 of the slide; size is in px per 1000px of slide width.
// A point may carry stylus pressure (0..1) as a third value.
export type Stroke = { id: string; tool: 'pen' | 'pencil'; color: string; size: number; points: number[][] }
export type Ink = Record<string, Stroke[]>

const MAX_POINTS = 5000
const MAX_STROKES_PER_PAGE = 2000

const isPressure = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1
const isUnit = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= -0.05 && n <= 1.05

/** Validates untrusted stroke data from the socket; returns a clean copy or null. */
export function parseStroke(s: unknown): Stroke | null {
  const v = s as Partial<Stroke> | null
  if (!v || typeof v.id !== 'string' || v.id.length > 64) return null
  if (v.tool !== 'pen' && v.tool !== 'pencil') return null
  if (typeof v.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.color)) return null
  if (typeof v.size !== 'number' || !(v.size >= 1 && v.size <= 60)) return null
  if (!Array.isArray(v.points) || !v.points.length || v.points.length > MAX_POINTS) return null
  const pointOk = (p: unknown) => Array.isArray(p) && (p.length === 2 || (p.length === 3 && isPressure(p[2]))) && isUnit(p[0]) && isUnit(p[1])
  if (!v.points.every(pointOk)) return null
  return { id: v.id, tool: v.tool, color: v.color, size: v.size, points: v.points.map((p) => p.slice(0, 3)) }
}

/** Adds or replaces a stroke (strokes are streamed while being drawn). Returns false if the page is full. */
export function upsertStroke(ink: Ink, page: number, stroke: Stroke) {
  const list = (ink[page] ??= [])
  const i = list.findIndex((s) => s.id === stroke.id)
  if (i >= 0) list[i] = stroke
  else if (list.length < MAX_STROKES_PER_PAGE) list.push(stroke)
  else return false
  return true
}

export function eraseStrokes(ink: Ink, page: number, ids: unknown) {
  if (!Array.isArray(ids) || !ink[page]) return []
  const drop = new Set(ids.filter((id) => typeof id === 'string'))
  ink[page] = ink[page].filter((s) => !drop.has(s.id))
  return [...drop]
}
