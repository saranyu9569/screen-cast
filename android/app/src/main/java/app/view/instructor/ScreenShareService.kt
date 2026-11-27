package app.view.instructor

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Captures the tablet screen and streams it to the VIEW server exactly like the desktop browser does
 * (src/screenShare.ts): H.264 Annex B, 15 fps, a keyframe every 2 s, each chunk sent as
 * [1 byte: 1 = keyframe][8 bytes: timestamp µs, float64 little-endian][encoded data].
 * The server and viewers need no changes.
 */
class ScreenShareService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var codec: MediaCodec? = null
    private var socket: WebSocket? = null
    private var worker: HandlerThread? = null
    @Volatile private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSharing()
            return START_NOT_STICKY
        }
        if (running) return START_NOT_STICKY

        // Android 14+ requires the foreground notification to be up before the projection is created.
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        running = true

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
            else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)
        val server = intent?.getStringExtra(EXTRA_SERVER)
        val token = intent?.getStringExtra(EXTRA_TOKEN)
        if (data == null || server == null || token == null) {
            stopSharing()
            return START_NOT_STICKY
        }

        try {
            start(resultCode, data, server, token)
        } catch (e: Exception) {
            stopSharing()
        }
        return START_NOT_STICKY
    }

    private fun start(resultCode: Int, data: Intent, server: String, token: String) {
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val proj = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("no projection")
        projection = proj
        val handlerThread = HandlerThread("screen-share").also { it.start() }
        worker = handlerThread
        val handler = Handler(handlerThread.looper)
        // The system's own "stop sharing" control ends up here.
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() = stopSharing()
        }, handler)

        val (width, height) = captureSize()
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, KEYFRAME_SECONDS)
            setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
            setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel4)
            // A still screen produces no new frames; repeating the last one keeps keyframes coming for late joiners.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / FPS)
        }
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec = encoder

        var config: ByteArray? = null // SPS/PPS, prepended to every keyframe so viewers can join at any keyframe
        encoder.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = Unit // input comes from the surface

            override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
                try {
                    val buf = codec.getOutputBuffer(index) ?: return
                    val bytes = ByteArray(info.size).also { buf.position(info.offset); buf.get(it) }
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        config = bytes
                        return
                    }
                    val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                    val ws = socket ?: return
                    // Upload falling behind: skip deltas, never keyframes.
                    if (!key && ws.queueSize() > MAX_BACKLOG_BYTES) return
                    ws.send(pack(key, info.presentationTimeUs, if (key) (config ?: ByteArray(0)) + bytes else bytes).toByteString())
                } finally {
                    try { codec.releaseOutputBuffer(index, false) } catch (_: IllegalStateException) {}
                }
            }

            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) = stopSharing()
            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) = Unit
        }, handler)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = encoder.createInputSurface()

        val wsUrl = server.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") +
            "/ws?token=" + java.net.URLEncoder.encode(token, "UTF-8")
        val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
        socket = client.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("""{"type":"screenStart","codec":"$CODEC"}""")
                handler.post {
                    if (stopping) return@post
                    display = proj.createVirtualDisplay(
                        "VIEW screen share", width, height, resources.displayMetrics.densityDpi,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, handler,
                    )
                    encoder.start()
                    requestKeyframesPeriodically(handler)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = stopSharing()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = stopSharing()
        })
    }

    // Belt and braces next to KEY_I_FRAME_INTERVAL: some encoders stretch the interval on static content.
    private fun requestKeyframesPeriodically(handler: Handler) {
        handler.postDelayed(object : Runnable {
            override fun run() {
                if (stopping) return
                try {
                    codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
                } catch (_: IllegalStateException) {}
                handler.postDelayed(this, KEYFRAME_SECONDS * 1000L)
            }
        }, KEYFRAME_SECONDS * 1000L)
    }

    /** Screen size scaled to fit 1920x1080 (either orientation), rounded to even numbers for H.264. */
    private fun captureSize(): Pair<Int, Int> {
        val m = resources.displayMetrics
        val (w, h) = m.widthPixels to m.heightPixels
        val scale = min(1.0, min(MAX_LONG_SIDE.toDouble() / maxOf(w, h), MAX_SHORT_SIDE.toDouble() / minOf(w, h)))
        return ((w * scale).roundToInt() and 1.inv()) to ((h * scale).roundToInt() and 1.inv())
    }

    private fun stopSharing() {
        if (stopping) return
        stopping = true
        try { socket?.send("""{"type":"screenStop"}"""); socket?.close(1000, null) } catch (_: Exception) {}
        try { display?.release() } catch (_: Exception) {}
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        try { projection?.stop() } catch (_: Exception) {}
        worker?.quitSafely()
        running = false
        onEnded?.invoke()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopSharing()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "การแชร์หน้าจอ", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(
            this, 0, Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("VIEW กำลังแชร์หน้าจอ")
            .setContentText("ผู้ชมเห็นหน้าจอแท็บเล็ตของคุณ")
            .setSmallIcon(android.R.drawable.ic_menu_slideshow)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "หยุดแชร์", stop).build())
            .build()
    }

    companion object {
        const val ACTION_STOP = "app.view.instructor.STOP_SHARE"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_SERVER = "server"
        const val EXTRA_TOKEN = "token"

        private const val CHANNEL = "screen-share"
        private const val NOTIFICATION_ID = 1
        private const val CODEC = "avc1.42E028" // same codec string the browser sender announces
        private const val FPS = 15
        private const val KEYFRAME_SECONDS = 2
        private const val BITRATE = 1_200_000
        private const val MAX_BACKLOG_BYTES = 512L * 1024
        private const val MAX_LONG_SIDE = 1920
        private const val MAX_SHORT_SIDE = 1080

        @Volatile var running = false
            private set

        /** Set by [MainActivity] so the web page learns when sharing ended (stop button, system, or error). */
        @Volatile var onEnded: (() -> Unit)? = null

        /** Same wire format as packChunk in src/screenShare.ts. */
        fun pack(key: Boolean, timestampUs: Long, data: ByteArray): ByteArray {
            val out = java.nio.ByteBuffer.allocate(9 + data.size).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            out.put(if (key) 1 else 0)
            out.putDouble(timestampUs.toDouble())
            out.put(data)
            return out.array()
        }
    }
}
