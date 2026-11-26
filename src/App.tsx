import { useEffect, useState } from 'react'
import { PdfSlide } from './PdfSlide'
import { useSlideSync } from './useSlideSync'
import './App.css'

const useHash = () => {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

function useArrowKeys(go: (delta: number) => void) {
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

const clamp = (n: number, max: number) => Math.min(Math.max(n, 1), Math.max(max, 1))

function Nav({ page, numPages, go }: { page: number; numPages: number; go: (d: number) => void }) {
  return (
    <div className="nav">
      <button onClick={() => go(-1)} disabled={page <= 1} aria-label="สไลด์ก่อนหน้า">‹</button>
      <span>{page} / {numPages || '–'}</span>
      <button onClick={() => go(1)} disabled={page >= numPages} aria-label="สไลด์ถัดไป">›</button>
    </div>
  )
}

const TOKEN_KEY = 'instructorToken'

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
    </svg>
  )
}

function InstructorGate() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY))
  const [checked, setChecked] = useState(false)

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  // A token from a previous server run is stale; drop it so the login page shows.
  useEffect(() => {
    if (!token) return
    fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } }).then((res) => {
      if (res.status === 401) logout()
      setChecked(true)
    })
  }, [token])

  const login = (t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t)
    setChecked(true)
    setToken(t)
  }

  if (!token) return <Login onLogin={login} />
  if (!checked) return null
  return <Instructor token={token} onLogout={logout} />
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
    if (res?.ok) onLogin((await res.json()).token)
    else setError(res ? await res.text() : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <span className="login-icon"><PersonIcon /></span>
        <h1>เข้าสู่ระบบผู้สอน</h1>
        <label htmlFor="username">ชื่อผู้ใช้</label>
        <input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="password">รหัสผ่าน</label>
        <input id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        <a href="#/" className="back">← กลับไปหน้าผู้ชม</a>
      </form>
    </main>
  )
}

function Instructor({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { state, connected, goto } = useSlideSync(token)
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState('')

  const go = (d: number) => goto(clamp(state.page + d, numPages))
  useArrowKeys(go)

  const upload = async (file: File) => {
    setError('')
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) onLogout()
    else if (!res.ok) setError(await res.text())
  }

  const viewerLink = `${location.origin}${location.pathname}#/`

  return (
    <main className="layout">
      {state.pdfUrl
        ? <PdfSlide url={state.pdfUrl} page={state.page} onLoad={setNumPages} />
        : <p className="empty">อัปโหลดไฟล์ PDF เพื่อเริ่มนำเสนอ</p>}
      <div className="reveal-zone" aria-hidden="true" />
      <footer className="bar">
        <div className="side">
          <strong className="who"><PersonIcon />ผู้สอน</strong>
          <label className="upload">
            อัปโหลด PDF
            <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {error && <span className="error">{error}</span>}
        </div>
        <Nav page={state.page} numPages={numPages} go={go} />
        <div className="side end">
          <span className="muted">ลิงก์สำหรับผู้ชม: <code>{viewerLink}</code></span>
          <Status connected={connected} />
          <FullscreenButton />
          <button onClick={() => {
            fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
            onLogout()
          }}>ออกจากระบบ</button>
        </div>
      </footer>
    </main>
  )
}

function Viewer() {
  const { state, connected } = useSlideSync(null)
  const [numPages, setNumPages] = useState(0)
  const [following, setFollowing] = useState(true)
  const [ownPage, setOwnPage] = useState(1)
  const [seenUrl, setSeenUrl] = useState(state.pdfUrl)

  // A new deck snaps everyone back to following the instructor.
  if (seenUrl !== state.pdfUrl) {
    setSeenUrl(state.pdfUrl)
    setFollowing(true)
  }

  const page = following ? state.page : ownPage
  const go = (d: number) => {
    setOwnPage(clamp(page + d, numPages))
    setFollowing(false)
  }
  useArrowKeys(go)

  return (
    <main className="layout">
      {state.pdfUrl
        ? <PdfSlide url={state.pdfUrl} page={page} onLoad={setNumPages} />
        : <p className="empty">รอผู้สอนแชร์สไลด์…</p>}
      <div className="reveal-zone" aria-hidden="true" />
      <footer className="bar">
        <div className="side">
          <a href="#/instructor" className="who" title="เข้าสู่ระบบผู้สอน" aria-label="ผู้ชม — เข้าสู่ระบบผู้สอน">
            <PersonIcon />ผู้ชม
          </a>
          <span className="muted">ผู้สอนอยู่ที่สไลด์ {state.page}</span>
        </div>
        <div className="nav">
          <Nav page={page} numPages={numPages} go={go} />
          {!following && (
            <button className="primary" onClick={() => setFollowing(true)}>
              ไปที่สไลด์ของผู้สอน ({state.page})
            </button>
          )}
        </div>
        <div className="side end">
          <Status connected={connected} />
          <FullscreenButton />
        </div>
      </footer>
    </main>
  )
}

function FullscreenButton() {
  const [on, setOn] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggle = () => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})
  return <button onClick={toggle}>{on ? 'ออกจากเต็มจอ' : 'เต็มจอ'}</button>
}

function Status({ connected }: { connected: boolean }) {
  return <span className={connected ? 'status on' : 'status'}>{connected ? 'ออนไลน์' : 'กำลังเชื่อมต่อใหม่…'}</span>
}

export default function App() {
  return useHash().startsWith('#/instructor') ? <InstructorGate /> : <Viewer />
}
