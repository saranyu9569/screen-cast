// Realtime slide server: one shared session, state in memory.
// shortcut: single room, login sessions and slide state lost on restart — add rooms/persistence before real use.
import { mkdir } from 'node:fs/promises'
import { ACCOUNTS_FILE, loadAccounts } from './accounts'

const PORT = Number(process.env.PORT ?? 3001)
const MAX_BYTES = 50 * 1024 * 1024
const UPLOAD_DIR = new URL('../uploads/', import.meta.url).pathname
await mkdir(UPLOAD_DIR, { recursive: true })

if (!Object.keys(await loadAccounts()).length) console.log(`No instructor accounts in ${ACCOUNTS_FILE}. Add one: bun run add-account <username>`)
const sessions = new Set<string>()
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
type State = { pdfUrl: string | null; page: number }
const state: State = { pdfUrl: null, page: 1 }

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
      sessions.add(token)
      return Response.json({ token })
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      sessions.delete(bearer(req) ?? '')
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/api/me') {
      return tokenOk(bearer(req)) ? new Response(null, { status: 204 }) : unauthorized()
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
      state.page = 1
      server.publish('room', JSON.stringify(state))
      return Response.json(state)
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
      ws.send(JSON.stringify(state))
    },
    message(ws, raw) {
      if (ws.data.role !== 'instructor') return
      let msg: unknown
      try { msg = JSON.parse(String(raw)) } catch { return }
      const page = (msg as { page?: unknown })?.page
      if (!Number.isInteger(page) || (page as number) < 1) return
      state.page = page as number
      server.publish('room', JSON.stringify(state))
    },
  },
})

console.log(`screen-cast server on http://localhost:${server.port}`)
