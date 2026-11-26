// Screen sharing without WebRTC: the instructor's browser encodes the screen once with WebCodecs,
// the server relays the chunks over the existing WebSocket, and each viewer decodes them.
// Chunk wire format: [1 byte: 1 = keyframe, 0 = delta][8 bytes: timestamp µs, float64 LE][encoded data]

const FPS = 15
const KEYFRAME_EVERY = FPS * 2 // late joiners and dropped chunks recover within ~2s
const BITRATE = 1_200_000
const MAX_BACKLOG_BYTES = 512 * 1024 // upload falling behind: skip frames rather than build up delay

// H.264 in Annex B carries its own setup data in every keyframe, so viewers need nothing but the codec string.
const CODECS = ['avc1.42E028', 'vp8']

export function packChunk(chunk: EncodedVideoChunk): ArrayBuffer {
  const buf = new ArrayBuffer(9 + chunk.byteLength)
  const view = new DataView(buf)
  view.setUint8(0, chunk.type === 'key' ? 1 : 0)
  view.setFloat64(1, chunk.timestamp, true)
  chunk.copyTo(new Uint8Array(buf, 9))
  return buf
}

export function unpackChunk(buf: ArrayBuffer): EncodedVideoChunk | null {
  if (buf.byteLength <= 9) return null
  const view = new DataView(buf)
  return new EncodedVideoChunk({
    type: view.getUint8(0) === 1 ? 'key' : 'delta',
    timestamp: view.getFloat64(1, true),
    data: new Uint8Array(buf, 9),
  })
}

// shortcut: capture needs MediaStreamTrackProcessor (Chrome/Edge) so it keeps running while the instructor
// is on another tab or app; add a Worker-based reader if Safari/Firefox instructors must share too.
export const canShareScreen = () =>
  typeof VideoEncoder !== 'undefined' && 'MediaStreamTrackProcessor' in window && !!navigator.mediaDevices?.getDisplayMedia

export const canViewScreen = () => typeof VideoDecoder !== 'undefined'

type ShareHandlers = {
  onStart: (codec: string) => void
  onChunk: (chunk: ArrayBuffer) => void
  backlog: () => number
  onEnd: () => void
}

/** Asks the user what to share and starts streaming. Resolves with the captured stream and a stop function. */
export async function startScreenShare({ onStart, onChunk, backlog, onEnd }: ShareHandlers) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: FPS } },
    audio: false,
  })
  const track = stream.getVideoTracks()[0]

  let codec = ''
  let encoder: VideoEncoder | null = null
  let size = ''
  let frameCount = 0
  let stopped = false

  const configure = async (width: number, height: number) => {
    // H.264 needs even dimensions; the encoder scales the frame to fit.
    const config: VideoEncoderConfig = {
      codec: '', width: width & ~1, height: height & ~1, bitrate: BITRATE, framerate: FPS,
      latencyMode: 'realtime', avc: { format: 'annexb' },
    }
    for (const c of CODECS) {
      if ((await VideoEncoder.isConfigSupported({ ...config, codec: c })).supported) {
        encoder?.close()
        encoder = new VideoEncoder({ output: (chunk) => onChunk(packChunk(chunk)), error: () => stop() })
        encoder.configure({ ...config, codec: c })
        if (c !== codec) onStart((codec = c))
        frameCount = 0 // next frame is a keyframe
        return
      }
    }
    throw new Error('เบราว์เซอร์นี้เข้ารหัสวิดีโอไม่ได้')
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    track.stop()
    if (encoder?.state === 'configured') encoder.close()
    onEnd()
  }
  track.addEventListener('ended', stop) // the browser's own "Stop sharing" button

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in the DOM typings yet
  const processor = new (window as any).MediaStreamTrackProcessor({ track })
  const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()
  ;(async () => {
    try {
      while (!stopped) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) break
        try {
          const nextSize = `${frame.displayWidth}x${frame.displayHeight}`
          if (nextSize !== size) {
            size = nextSize
            await configure(frame.displayWidth, frame.displayHeight)
          }
          const busy = encoder!.encodeQueueSize > 2 || backlog() > MAX_BACKLOG_BYTES
          const key = frameCount % KEYFRAME_EVERY === 0
          if (!busy || key) {
            encoder!.encode(frame, { keyFrame: key })
            frameCount++
          }
        } finally {
          frame.close()
        }
      }
    } catch {
      // fall through to stop
    }
    stop()
  })()

  return { stream, stop }
}
