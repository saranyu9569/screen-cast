import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

type Props = { url: string; page: number; onLoad: (numPages: number) => void }

export function PdfSlide({ url, page, onLoad }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const task = getDocument({ url })
    task.promise.then((d) => {
      setDoc(d)
      onLoad(d.numPages)
    })
    return () => {
      task.destroy()
      setDoc(null)
    }
  }, [url, onLoad])

  useEffect(() => {
    const box = boxRef.current!
    const ro = new ResizeObserver(() => setSize({ w: box.clientWidth, h: box.clientHeight }))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !size.w || page < 1 || page > doc.numPages) return
    let task: RenderTask | null = null
    let cancelled = false
    doc.getPage(page).then((p) => {
      if (cancelled) return
      const base = p.getViewport({ scale: 1 })
      const scale = Math.min(size.w / base.width, size.h / base.height)
      const dpr = window.devicePixelRatio || 1
      const vp = p.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current!
      canvas.width = vp.width
      canvas.height = vp.height
      canvas.style.width = `${vp.width / dpr}px`
      canvas.style.height = `${vp.height / dpr}px`
      task = p.render({ canvas, viewport: vp })
      task.promise.catch(() => {}) // cancelled renders reject; that's expected
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, page, size])

  return (
    <div ref={boxRef} className="slide-box">
      <canvas ref={canvasRef} aria-label={`สไลด์ ${page}`} />
    </div>
  )
}
