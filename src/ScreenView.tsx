import { useEffect, useRef, useState, type RefObject } from 'react'
import { canViewScreen, unpackChunk } from './screenShare'

type Props = {
  codec: string
  // The sync hook hands every binary chunk to whatever function this ref holds.
  chunkRef: RefObject<((chunk: ArrayBuffer) => void) | null>
}

/** Decodes the instructor's relayed screen video and draws it, letterboxed to fit. */
export function ScreenView({ codec, chunkRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [waiting, setWaiting] = useState(true)
  const supported = canViewScreen()

  useEffect(() => {
    if (!supported) return
    let decoder: VideoDecoder | null = null
    let needKey = true

    const reset = () => {
      if (decoder && decoder.state !== 'closed') decoder.close()
      decoder = new VideoDecoder({
        output: (frame) => {
          const canvas = canvasRef.current
          if (canvas) {
            if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth
            if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight
            canvas.getContext('2d')!.drawImage(frame, 0, 0)
            setWaiting(false)
          }
          frame.close()
        },
        error: () => reset(), // corrupt/missing data: start over at the next keyframe
      })
      decoder.configure({ codec, optimizeForLatency: true })
      needKey = true
    }
    reset()

    chunkRef.current = (buf) => {
      const chunk = unpackChunk(buf)
      if (!chunk || !decoder || decoder.state !== 'configured') return
      if (needKey && chunk.type !== 'key') return
      needKey = false
      if (decoder.decodeQueueSize > 10) return reset() // fell far behind: skip ahead to the next keyframe
      decoder.decode(chunk)
    }

    return () => {
      chunkRef.current = null
      if (decoder && decoder.state !== 'closed') decoder.close()
    }
  }, [codec, chunkRef, supported])

  if (!supported) return <p className="empty">เบราว์เซอร์นี้แสดงหน้าจอที่แชร์ไม่ได้ — ลองใช้ Chrome, Edge, Safari หรือ Firefox เวอร์ชันล่าสุด</p>
  return (
    <div className="slide-box screen-view">
      <canvas ref={canvasRef} aria-label="หน้าจอที่ผู้สอนแชร์" />
      {waiting && <p className="screen-waiting" role="status">กำลังเชื่อมต่อหน้าจอของผู้สอน…</p>}
    </div>
  )
}
