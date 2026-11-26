import { useEffect, useRef, useState } from 'react'
import { InkLayer, type InkTool } from './InkLayer'
import { PdfSlide } from './PdfSlide'
import { canShareScreen, startScreenShare } from './screenShare'
import { type Ink, useSlideSync, type SlideState } from './useSlideSync'
import { clamp, icons, useArrowKeys, useHash, usePinnedBar } from './hooks'
import { FullscreenButton, Icon, LockButton, PersonIcon, SlideNav, Status } from './ui'

const TOKEN_KEY = 'instructorToken'
const ROUTES = {
  home: '#/instructor',
  teach: '#/instructor/teach',
  present: '#/instructor/present',
  settings: '#/instructor/settings',
}

export function InstructorGate() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY))
  const [username, setUsername] = useState('')

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUsername('')
  }

  // A token from a previous server run is stale; drop it so the login page shows.
  useEffect(() => {
    if (!token || username) return
    fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => {
      if (res.ok) setUsername((await res.json()).username)
      else if (res.status === 401) logout()
    })
  }, [token, username])

  const login = (t: string, name: string) => {
    sessionStorage.setItem(TOKEN_KEY, t)
    setUsername(name)
    setToken(t)
  }

  if (!token) return <Login onLogin={login} />
  if (!username) return null
  return <InstructorApp token={token} username={username} onLogout={logout} />
}

function Login({ onLogin }: { onLogin: (token: string, username: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).catch(() => null)
    setBusy(false)
    if (res?.ok) {
      const data = await res.json()
      onLogin(data.token, data.username)
    } else setError(res ? await res.text() : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
  }

  return (
    <main className="login">
      <a href="#/" className="back">← กลับไปหน้าผู้ชม</a>
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/logo.png" alt="VIEW — Visual Interface for Educational Workspace" width="240" height="84" />
        <h1>เข้าสู่ระบบผู้สอน</h1>
        <label htmlFor="username">ชื่อผู้ใช้</label>
        <input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">รหัสผ่าน</label>
        <div className="password-field">
          <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="eye-btn" onClick={() => setShowPassword(!showPassword)}
            aria-pressed={showPassword} aria-controls="password"
            aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="M4 4l16 16" />}
            </svg>
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form>
    </main>
  )
}

type AppProps = { token: string; username: string; onLogout: () => void }

function InstructorApp({ token, username, onLogout }: AppProps) {
  const route = useHash().split('?')[0]
  const { state, connected, goto, ink, screen } = useSlideSync(token)

  const logout = () => {
    fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    onLogout()
  }

  // Returns an error message, or null on success.
  const upload = async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } })
      .catch(() => null)
    if (res?.status === 401) onLogout()
    return res?.ok ? null : res ? await res.text() : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'
  }

  // Returns an error message, or null on success.
  const remove = async () => {
    const res = await fetch('/api/pdf', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      .catch(() => null)
    if (res?.status === 401) onLogout()
    return res?.ok ? null : 'ลบไฟล์ไม่สำเร็จ'
  }

  const auth = { Authorization: `Bearer ${token}` }
  const decks = {
    list: async (): Promise<Deck[]> => {
      const res = await fetch('/api/decks', { headers: auth }).catch(() => null)
      if (res?.status === 401) onLogout()
      return res?.ok ? res.json() : []
    },
    open: async (id: string) => {
      const res = await fetch(`/api/decks/${id}/open`, { method: 'POST', headers: auth }).catch(() => null)
      if (res?.status === 401) onLogout()
      return !!res?.ok
    },
  }

  if (route === ROUTES.present) return <Present state={state} connected={connected} goto={goto} ink={ink} screen={screen} />

  const page =
    route === ROUTES.teach ? <TeachPage state={state} upload={upload} remove={remove} /> :
    route === ROUTES.settings ? <SettingsPage username={username} onLogout={logout} /> :
    <HomePage state={state} username={username} decks={decks} />

  return (
    <div className="shell">
      <TopNav route={route} username={username} onLogout={logout} />
      <main className="page">{page}</main>
    </div>
  )
}

function TopNav({ route, username, onLogout }: { route: string; username: string; onLogout: () => void }) {
  const links = [
    { href: ROUTES.teach, label: 'เริ่มการสอน', icon: icons.cast },
    { href: ROUTES.settings, label: 'ตั้งค่า', icon: icons.settings },
  ]
  return (
    <header className="topnav">
      <a href={ROUTES.home} className="brand" aria-current={route === ROUTES.home ? 'page' : undefined}>
        <img src="/logo.png" alt="VIEW — Visual Interface for Educational Workspace" width="137" height="48" />
      </a>
      <nav aria-label="เมนูผู้สอน">
        {links.map((l) => (
          <a key={l.href} href={l.href} aria-current={route === l.href ? 'page' : undefined}>
            <Icon d={l.icon} />{l.label}
          </a>
        ))}
      </nav>
      <div className="topnav-user">
        <span className="who"><PersonIcon />{username}</span>
        <button className="icon-btn" onClick={onLogout} aria-label="ออกจากระบบ" title="ออกจากระบบ">
          <Icon d={icons.logout} />
        </button>
      </div>
    </header>
  )
}

type Deck = { id: string; name: string; uploadedAt: string }
type DeckApi = { list: () => Promise<Deck[]>; open: (id: string) => Promise<boolean> }
const noop = () => {}

function HomePage({ state, username, decks }: { state: SlideState; username: string; decks: DeckApi }) {
  return (
    <>
      <section className="hero">
        <h1>สวัสดี, {username}</h1>
        <p>เลือกสไลด์ PDF แล้วเริ่มการสอน ผู้ชมทุกคนจะเห็นสไลด์ตามที่คุณเลื่อนแบบเรียลไทม์</p>
        <div className="hero-actions">
          <a className="btn primary" href={ROUTES.teach}><Icon d={icons.cast} />เริ่มการสอน</a>
          <CopyViewerLink />
        </div>
      </section>
      <DeckHistory state={state} decks={decks} />
    </>
  )
}

function DeckHistory({ state, decks }: { state: SlideState; decks: DeckApi }) {
  const [list, setList] = useState<Deck[] | null>(null)
  const [opening, setOpening] = useState('')

  // Reload whenever the showing deck changes (a new upload lands at the top).
  useEffect(() => { decks.list().then(setList) }, [decks, state.pdfUrl])

  const use = async (deck: Deck) => {
    setOpening(deck.id)
    if (await decks.open(deck.id)) location.assign(ROUTES.present)
    setOpening('')
  }

  if (!list) return null
  if (!list.length) return <section className="card"><h2>ประวัติสไลด์</h2><p className="muted">ยังไม่มีไฟล์ — อัปโหลด PDF เพื่อเริ่มนำเสนอ</p></section>

  return (
    <section>
      <h2 className="section-title">ประวัติสไลด์</h2>
      <ul className="deck-grid">
        {list.map((deck) => {
          const active = state.pdfUrl === `/api/pdf/${deck.id}`
          return (
            <li key={deck.id} className={active ? 'deck active' : 'deck'}>
              <div className="deck-thumb">
                <PdfSlide url={`/api/pdf/${deck.id}`} page={1} onLoad={noop} />
                <div className="deck-overlay">
                  <button className="primary" onClick={() => use(deck)} disabled={!!opening}
                    aria-label={`${active ? 'นำเสนอต่อ' : 'ใช้สไลด์นี้'}: ${deck.name}`}>
                    <Icon d={icons.cast} />{opening === deck.id ? 'กำลังเปิด…' : active ? 'นำเสนอต่อ' : 'ใช้สไลด์นี้'}
                  </button>
                </div>
                {active && <span className="deck-badge">กำลังใช้งาน · สไลด์ {state.page}</span>}
              </div>
              <div className="deck-info">
                <strong className="file-name">{deck.name}</strong>
                <span className="muted">{new Date(deck.uploadedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CopyViewerLink() {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(`${location.origin}${location.pathname}#/`).then(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  })
  return (
    <button className="btn" onClick={copy}>
      <Icon d={icons.link} />{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์ผู้ชม'}
    </button>
  )
}

type TeachProps = {
  state: SlideState
  upload: (f: File) => Promise<string | null>
  remove: () => Promise<string | null>
}

function TeachPage({ state, upload, remove }: TeachProps) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const send = async (file: File | undefined) => {
    if (!file) return
    setStatus('busy')
    setError('')
    const err = await upload(file)
    setError(err ?? '')
    setStatus(err ? 'idle' : 'done')
  }

  const [previewing, setPreviewing] = useState(false)

  const del = async () => {
    if (!confirm(`ลบไฟล์ "${state.pdfName}"? ผู้ชมจะไม่เห็นสไลด์นี้อีก`)) return
    setStatus('idle')
    setError((await remove()) ?? '')
  }

  return (
    <>
      <h1 className="page-title">เริ่มการสอน</h1>
      {state.pdfUrl && (
        <div className="card success file-card" role={status === 'done' ? 'status' : undefined}>
          <p>{status === 'done' ? 'อัปโหลดเรียบร้อย: ' : 'ไฟล์ปัจจุบัน: '}<strong className="file-name">{state.pdfName}</strong></p>
          <div className="file-actions">
            <button className="icon-btn" onClick={() => setPreviewing(true)} aria-label="ดูตัวอย่าง" title="ดูตัวอย่าง">
              <Icon d={icons.eye} />
            </button>
            <button className="icon-btn danger" onClick={del} aria-label="ลบไฟล์" title="ลบไฟล์">
              <Icon d={icons.trash} />
            </button>
          </div>
          <a className="btn primary" href={ROUTES.present}><Icon d={icons.cast} />เริ่มนำเสนอ</a>
        </div>
      )}
      {previewing && state.pdfUrl && (
        <PreviewModal url={state.pdfUrl} name={state.pdfName ?? ''} ink={state.ink} onClose={() => setPreviewing(false)} />
      )}
      <label
        className={dragging ? 'dropzone dragging' : 'dropzone'}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files[0]) }}
      >
        <Icon d={icons.upload} size={36} />
        <strong>{status === 'busy' ? 'กำลังอัปโหลด…'
          : state.pdfUrl ? 'ต้องการเปลี่ยนไฟล์? ลากไฟล์ PDF ใหม่มาวาง หรือคลิกเพื่อเลือก'
          : 'ลากไฟล์ PDF มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์'}</strong>
        <span className="muted">รองรับเฉพาะ PDF ขนาดไม่เกิน 50 MB · ไฟล์ใหม่จะแทนที่ไฟล์เดิม</span>
        <input type="file" disabled={status === 'busy'} accept="application/pdf"
          onChange={(e) => { send(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {!state.pdfUrl && (
        <a className="btn share-only" href={ROUTES.present}><Icon d={icons.cast} />หรือแชร์หน้าจอโดยไม่ใช้สไลด์</a>
      )}
    </>
  )
}

function PreviewModal({ url, name, ink, onClose }: { url: string; name: string; ink: Ink; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(0)

  // Native modal dialog gives focus trapping and Esc-to-close for free.
  useEffect(() => { ref.current?.showModal() }, [])

  return (
    <dialog ref={ref} className="preview" onClose={onClose} aria-label={`ตัวอย่าง ${name}`}
      onClick={(e) => e.target === ref.current && ref.current.close()}>
      <header>
        <strong className="file-name">{name}</strong>
        <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="ปิด" title="ปิด">
          <Icon d={icons.close} />
        </button>
      </header>
      <PdfSlide url={url} page={page} onLoad={setNumPages}>
        <InkLayer strokes={ink[page] ?? []} />
      </PdfSlide>
      <footer>
        <SlideNav page={page} numPages={numPages} go={(d) => setPage((p) => clamp(p + d, numPages))} />
      </footer>
    </dialog>
  )
}

function SettingsPage({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [pinned, togglePinned] = usePinnedBar()
  return (
    <>
      <h1 className="page-title">ตั้งค่า</h1>
      <section className="card">
        <h2>บัญชี</h2>
        <div className="row">
          <span className="who"><PersonIcon />{username}</span>
          <button className="btn" onClick={onLogout}><Icon d={icons.logout} />ออกจากระบบ</button>
        </div>
      </section>
      <section className="card">
        <h2>การแสดงผล</h2>
        <label className="row toggle">
          <span>
            ล็อกแถบเครื่องมือด้านล่างให้แสดงค้างไว้
            <span className="muted block">ถ้าปิด แถบจะซ่อนเองและโผล่เมื่อเลื่อนเมาส์ไปขอบล่าง</span>
          </span>
          <input type="checkbox" role="switch" checked={pinned} onChange={togglePinned} />
        </label>
      </section>
    </>
  )
}

type PresentProps = {
  state: SlideState
  connected: boolean
  goto: (page: number) => void
  ink: ReturnType<typeof useSlideSync>['ink']
  screen: ReturnType<typeof useSlideSync>['screen']
}

const INK_COLORS = [
  { value: '#e53935', name: 'แดง' },
  { value: '#1e88e5', name: 'น้ำเงิน' },
  { value: '#43a047', name: 'เขียว' },
  { value: '#f77f00', name: 'ส้ม' },
  { value: '#14213d', name: 'กรมท่า' },
  { value: '#000000', name: 'ดำ' },
]

const INK_TOOLS: { tool: InkTool | null; label: string; icon: string }[] = [
  { tool: null, label: 'เมาส์ (ไม่เขียน)', icon: icons.pointer },
  { tool: 'laser', label: 'เลเซอร์พอยน์เตอร์', icon: icons.laser },
  { tool: 'pen', label: 'ปากกา', icon: icons.pen },
  { tool: 'pencil', label: 'ดินสอ', icon: icons.pencil },
  { tool: 'eraser', label: 'ยางลบ', icon: icons.eraser },
]

function Present({ state, connected, goto, ink, screen }: PresentProps) {
  const [numPages, setNumPages] = useState(0)
  const [pinned, togglePinned] = usePinnedBar()
  const [tool, setTool] = useState<InkTool | null>(null)
  const [color, setColor] = useState(INK_COLORS[0].value)
  const [sizePx, setSizePx] = useState(4)
  const exitRef = useRef<HTMLDialogElement>(null)
  const [shareStream, setShareStream] = useState<MediaStream | null>(null)
  const [shareError, setShareError] = useState('')
  const stopShare = useRef<(() => void) | null>(null)

  // Leaving the presenter view ends the share so viewers aren't left on a frozen screen.
  useEffect(() => () => stopShare.current?.(), [])

  const toggleShare = async () => {
    if (stopShare.current) return stopShare.current()
    setShareError('')
    if (!canShareScreen()) return setShareError('การแชร์จอต้องใช้ Chrome หรือ Edge บนคอมพิวเตอร์')
    try {
      const share = await startScreenShare({
        onStart: screen.start,
        onChunk: screen.send,
        backlog: screen.backlog,
        onEnd: () => {
          screen.stop()
          stopShare.current = null
          setShareStream(null)
        },
      })
      stopShare.current = share.stop
      setShareStream(share.stream)
    } catch (e) {
      // Closing the picker without choosing is not an error worth showing.
      if ((e as Error).name !== 'NotAllowedError') setShareError('เริ่มแชร์จอไม่สำเร็จ')
    }
  }

  const go = (d: number) => goto(clamp(state.page + d, numPages))
  useArrowKeys(go)

  const strokes = state.ink[state.page] ?? []
  const hasInk = Object.values(state.ink).some((list) => list.length > 0)
  const leave = () => { location.hash = ROUTES.home }
  // Like PowerPoint: ink stays until the instructor leaves, then they choose to keep or discard it.
  const exit = () => (hasInk ? exitRef.current?.showModal() : leave())

  return (
    <main className="layout">
      {shareStream
        ? (
          <div className="slide-box screen-view">
            <video autoPlay muted playsInline aria-label="ตัวอย่างหน้าจอที่กำลังแชร์"
              ref={(v) => { if (v && v.srcObject !== shareStream) v.srcObject = shareStream }} />
          </div>
        )
        : state.pdfUrl
        ? (
          <PdfSlide url={state.pdfUrl} page={state.page} onLoad={setNumPages}>
            <InkLayer strokes={strokes} tool={tool} color={color} sizePx={tool === 'pencil' ? Math.max(1, sizePx / 2) : sizePx}
              onStroke={(s) => ink.stroke(state.page, s)} onErase={(ids) => ink.erase(state.page, ids)}
              onLaser={(at) => ink.laser(state.page, at)} />
          </PdfSlide>
        )
        : <p className="empty">ยังไม่มีไฟล์ — <a href={ROUTES.teach}>เลือกไฟล์ PDF</a> หรือกด “แชร์จอ” ด้านล่าง</p>}
      {!pinned && <div className="reveal-zone" aria-hidden="true" />}
      <aside className="ink-panel" role="toolbar" aria-orientation="vertical" aria-label="เครื่องมือ">
        <button className={shareStream ? 'icon-btn sharing' : 'icon-btn'} onClick={toggleShare} aria-pressed={!!shareStream}
          aria-label={shareStream ? 'หยุดแชร์จอ' : 'แชร์จอ'} title={shareStream ? 'หยุดแชร์จอ' : 'แชร์จอ'}>
          <Icon d={icons.cast} />
        </button>
        {state.pdfUrl && !shareStream && (
          <>
            <span className="divider" aria-hidden="true" />
            {INK_TOOLS.map((t) => (
              <button key={t.label} className="icon-btn" aria-pressed={tool === t.tool} onClick={() => {
                  if (tool === 'laser' && t.tool !== 'laser') ink.laser(state.page, null)
                  setTool(t.tool)
                }}
                aria-label={t.label} title={t.label}>
                <Icon d={t.icon} />
              </button>
            ))}
            {(tool === 'pen' || tool === 'pencil') && (
              <>
                <span className="divider" aria-hidden="true" />
                <div className="swatches" role="radiogroup" aria-label="สีหมึก">
                  {INK_COLORS.map((c) => (
                    <button key={c.value} className="swatch" role="radio" aria-checked={color === c.value}
                      aria-label={c.name} title={c.name} style={{ background: c.value }} onClick={() => setColor(c.value)} />
                  ))}
                </div>
                <span className="divider" aria-hidden="true" />
                <label className="size" title={`ขนาดเส้น ${sizePx}`}>
                  <span className="dot" style={{ width: sizePx + 4, height: sizePx + 4, background: color }} aria-hidden="true" />
                  <span className="sr-only">ขนาดเส้น</span>
                  <input type="range" min="1" max="20" value={sizePx} onChange={(e) => setSizePx(Number(e.target.value))} />
                </label>
              </>
            )}
            {strokes.length > 0 && (
              <>
                <span className="divider" aria-hidden="true" />
                <button className="icon-btn danger" onClick={() => ink.clearPage(state.page)}
                  aria-label="ลบการเขียนทั้งหน้านี้" title="ลบการเขียนทั้งหน้านี้">
                  <Icon d={icons.trash} />
                </button>
              </>
            )}
          </>
        )}
      </aside>
      <footer className={pinned ? 'bar pinned' : 'bar'}>
        <div className="side">
          <button className="icon-btn" onClick={exit} aria-label="กลับหน้าหลัก" title="กลับหน้าหลัก">
            <Icon d={icons.home} />
          </button>
          <strong className="who"><PersonIcon />ผู้สอน</strong>
          <button className={shareStream ? 'primary' : undefined} onClick={toggleShare} aria-pressed={!!shareStream}>
            <Icon d={icons.cast} />{shareStream ? 'หยุดแชร์จอ' : 'แชร์จอ'}
          </button>
          {shareError && <span className="error" role="alert">{shareError}</span>}
        </div>
        <SlideNav page={state.page} numPages={state.pdfUrl ? numPages : 0} go={go} />
        <div className="side end">
          <Status connected={connected} />
          <FullscreenButton />
          <LockButton pinned={pinned} onToggle={togglePinned} />
        </div>
      </footer>

      <dialog ref={exitRef} className="confirm" aria-labelledby="exit-title">
        <h2 id="exit-title">บันทึกการเขียนไว้หรือไม่?</h2>
        <p>คุณได้เขียนบนสไลด์ไว้ ถ้าบันทึก การเขียนจะยังอยู่ให้ผู้ชมเห็นและแสดงต่อเมื่อกลับมานำเสนอ</p>
        <div className="confirm-actions">
          <button onClick={() => exitRef.current?.close()}>ยกเลิก</button>
          <button className="danger-text" onClick={() => { ink.clearAll(); leave() }}>ไม่บันทึก</button>
          <button className="primary" autoFocus onClick={leave}>บันทึก</button>
        </div>
      </dialog>
    </main>
  )
}
