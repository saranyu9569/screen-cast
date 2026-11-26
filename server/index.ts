// Realtime slide server: one shared session, state in memory.
// shortcut: single room, login sessions and slide state lost on restart — add rooms/persistence before real use.
import { mkdir, unlink } from 'node:fs/promises'
import { ACCOUNTS_FILE, loadAccounts } from './accounts'
import { eraseStrokes, type Ink, parseStroke, upsertStroke } from './ink'

const PORT = Number(process.env.PORT ?? 3001)
const MAX_BYTES = 50 * 1024 * 1024
const UPLOAD_DIR = new URL('../uploads/', import.meta.url).pathname
await mkdir(UPLOAD_DIR, { recursive: true })

if (!Object.keys(await loadAccounts()).length) console.log(`No instructor accounts in ${ACCOUNTS_FILE}. Add one: bun run add-account <username>`)
const sessions = new Map<string, string>() // token -> username
// Verified when the username is unknown, so response time doesn't reveal which usernames exist.
const DUMMY_HASH = await Bun.password.hash(crypto.randomUUID())

async function credentialsOk(username: string, password: string) {
  const hash = (await loadAccounts())[username.toLowerCase()]
  return (await Bun.password.verify(password, hash ?? DUMMY_HASH)) && !!hash
}
const tokenOk = (token: string | null | undefined) => !!token && sessions.has(token)
const bearer = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer /, '')
const unauthorized = () => new Response('กรุณาเข้าสู่ระบบ', { status: 401 })

type Role = 'instructor' | 'viewer'
type State = { pdfUrl: string | null; pdfName: string | null; page: number; ink: Ink }
const state: State = { pdfUrl: null, pdfName: null, page: 1, ink: {} }
// Every socket message is { type, ... }: 'state' carries the whole state, the others are ink edits.
const broadcast = (msg: object): void => { server.publish('room', JSON.stringify(msg)) }
const publishState = () => broadcast({ type: 'state', ...state })

const server = Bun.serve<{ role: Role }>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      // Only a logged-in token gets instructor powers; anything else silently joins as a viewer.
      const role: Role = tokenOk(url.searchParams.get('token')) ? 'instructor' : 'viewer'
      return server.upgrade(req, { data: { role } }) ? undefined : new Response('Upgrade failed', { status: 400 })
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await req.json().catch(() => null)
      const username = typeof body?.username === 'string' ? body.username.trim() : ''
      const password = typeof body?.password === 'string' ? body.password : ''
      if (!(await credentialsOk(username, password))) {
        await Bun.sleep(500) // slows down password guessing
        return new Response('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', { status: 401 })
      }
      const token = crypto.randomUUID()
      sessions.set(token, username)
      return Response.json({ token, username })
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      sessions.delete(bearer(req) ?? '')
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/api/me') {
      const username = sessions.get(bearer(req) ?? '')
      return username ? Response.json({ username }) : unauthorized()
    }

    if (url.pathname === '/api/pdf' && req.method === 'DELETE') {
      if (!tokenOk(bearer(req))) return unauthorized()
      const id = state.pdfUrl?.split('/').pop()
      if (id) await unlink(`${UPLOAD_DIR}${id}.pdf`).catch(() => {})
      Object.assign(state, { pdfUrl: null, pdfName: null, page: 1, ink: {} })
      publishState()
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') {
      if (!tokenOk(bearer(req))) return unauthorized()
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!(file instanceof File)) return new Response('ไม่พบไฟล์', { status: 400 })
      if (file.size > MAX_BYTES) return new Response('ไฟล์ใหญ่เกิน 50 MB', { status: 413 })
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return new Response('ไฟล์นี้ไม่ใช่ PDF', { status: 415 })

      const id = crypto.randomUUID()
      await Bun.write(`${UPLOAD_DIR}${id}.pdf`, bytes)
      state.pdfUrl = `/api/pdf/${id}`
      state.pdfName = file.name.slice(0, 200)
      state.page = 1
      state.ink = {}
      publishState()
      return new Response(null, { status: 204 })
    }

    const pdf = url.pathname.match(/^\/api\/pdf\/([0-9a-f-]{36})$/)
    if (pdf) {
      const file = Bun.file(`${UPLOAD_DIR}${pdf[1]}.pdf`)
      return (await file.exists())
        ? new Response(file, { headers: { 'Content-Type': 'application/pdf' } })
        : new Response('Not found', { status: 404 })
    }

    return new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      ws.subscribe('room')
      ws.send(JSON.stringify({ type: 'state', ...state }))
    },
    message(ws, raw) {
      if (ws.data.role !== 'instructor') return
      let msg: { type?: unknown; page?: unknown; stroke?: unknown; ids?: unknown }
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg?.type === 'clear') {
        state.ink = {}
        broadcast({ type: 'clear' })
        return
      }
      const page = msg?.page
      if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > 10_000) return
      const p = page as number

      if (msg.type === 'page') {
        state.page = p
        publishState()
      } else if (msg.type === 'stroke') {
        const stroke = parseStroke(msg.stroke)
        if (stroke && upsertStroke(state.ink, p, stroke)) broadcast({ type: 'stroke', page: p, stroke })
      } else if (msg.type === 'erase') {
        const ids = eraseStrokes(state.ink, p, msg.ids)
        if (ids.length) broadcast({ type: 'erase', page: p, ids })
      } else if (msg.type === 'laser') {
        // Ephemeral: relayed to viewers, never stored. null hides the dot.
        const at = (msg as { at?: unknown }).at
        const ok = at === null || (Array.isArray(at) && at.length === 2 && at.every((n) => typeof n === 'number' && n >= 0 && n <= 1))
        if (ok) broadcast({ type: 'laser', page: p, at })
      } else if (msg.type === 'clearPage') {
        delete state.ink[p]
        broadcast({ type: 'clearPage', page: p })
      }
    },
  },
})

console.log(`screen-cast server on http://localhost:${server.port}`)
