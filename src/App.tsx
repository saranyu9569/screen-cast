import { useState } from 'react'
import { InstructorGate } from './Instructor'
import { InkLayer } from './InkLayer'
import { PdfSlide } from './PdfSlide'
import { ScreenView } from './ScreenView'
import { useSlideSync } from './useSlideSync'
import { clamp, useArrowKeys, useHash, usePinnedBar } from './hooks'
import { FullscreenButton, LockButton, PersonIcon, SlideNav, Status } from './ui'
import './App.css'

function Viewer() {
  const { state, connected, laser, onScreenChunk } = useSlideSync(null)
  const [numPages, setNumPages] = useState(0)
  const [following, setFollowing] = useState(true)
  const [ownPage, setOwnPage] = useState(1)
  const [seenUrl, setSeenUrl] = useState(state.pdfUrl)
  const [pinned, togglePinned] = usePinnedBar()

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
      {state.screen
        ? <ScreenView codec={state.screen.codec} chunkRef={onScreenChunk} />
        : state.pdfUrl
        ? (
          <PdfSlide url={state.pdfUrl} page={page} onLoad={setNumPages}>
            <InkLayer strokes={state.ink[page] ?? []} laserAt={laser?.page === page ? laser.at : null} />
          </PdfSlide>
        )
        : <p className="empty">รอผู้สอนแชร์สไลด์…</p>}
      {!pinned && <div className="reveal-zone" aria-hidden="true" />}
      <footer className={pinned ? 'bar pinned' : 'bar'}>
        <div className="side">
          <a href="#/instructor" className="who" title="เข้าสู่ระบบผู้สอน" aria-label="ผู้ชม — เข้าสู่ระบบผู้สอน">
            <PersonIcon />ผู้ชม
          </a>
          <span className="muted current">{state.screen ? 'ผู้สอนกำลังแชร์หน้าจอ' : `ผู้สอนอยู่ที่สไลด์ ${state.page}`}</span>
        </div>
        <div className="nav" hidden={!!state.screen}>
          <SlideNav page={page} numPages={state.pdfUrl ? numPages : 0} go={go} />
          {!following && (
            <button className="primary" onClick={() => setFollowing(true)}>
              ไปที่สไลด์ของผู้สอน ({state.page})
            </button>
          )}
        </div>
        <div className="side end">
          <Status connected={connected} />
          <FullscreenButton />
          <LockButton pinned={pinned} onToggle={togglePinned} />
        </div>
      </footer>
    </main>
  )
}

export default function App() {
  return useHash().startsWith('#/instructor') ? <InstructorGate /> : <Viewer />
}
