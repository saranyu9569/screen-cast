package app.view.instructor

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Instructor app: shows the VIEW web app in a WebView and adds the one thing a tablet browser can't do,
 * sharing the screen (see [ScreenShareService]).
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShareToken: String? = null

    private val prefs by lazy { getSharedPreferences("view", MODE_PRIVATE) }
    private val serverUrl get() = prefs.getString("server", null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0) // for the "sharing screen" notice
        }
        val url = serverUrl
        if (url == null) showServerSetup(null) else showWeb(url)
    }

    // ---------- Server address (asked on first launch, changeable from the web Settings page) ----------

    private fun showServerSetup(error: String?) {
        val pad = (24 * resources.displayMetrics.density).toInt()
        val input = EditText(this).apply {
            hint = "https://your-server.up.railway.app"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(serverUrl ?: "")
        }
        val message = TextView(this).apply {
            text = error ?: "ใส่ที่อยู่เซิร์ฟเวอร์ VIEW ของคุณ"
            setTextColor(if (error != null) Color.rgb(198, 40, 40) else Color.rgb(28, 43, 69))
            textSize = 16f
        }
        val save = Button(this).apply {
            text = "เชื่อมต่อ"
            setOnClickListener {
                val normalized = normalizeUrl(input.text.toString())
                if (normalized == null) {
                    message.text = "ที่อยู่ไม่ถูกต้อง ต้องขึ้นต้นด้วย https:// หรือ http://"
                    message.setTextColor(Color.rgb(198, 40, 40))
                } else {
                    prefs.edit().putString("server", normalized).apply()
                    showWeb(normalized)
                }
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.rgb(244, 246, 249))
            addView(TextView(this@MainActivity).apply {
                text = "VIEW"
                textSize = 32f
                setTextColor(Color.rgb(23, 52, 88))
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(message, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad })
            addView(input, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(save, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad / 2 })
        })
    }

    // ---------- The web app ----------

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(base: String) {
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "ViewNative")
            webViewClient = object : WebViewClient() {
                // Stay on our server; anything else opens in the normal browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (sameOrigin(request.url, Uri.parse(base))) return false
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showServerSetup("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (${error.description}) ตรวจสอบที่อยู่หรืออินเทอร์เน็ต")
                }
            }
            webChromeClient = object : WebChromeClient() {
                // <input type="file"> needs the app to open Android's file picker.
                override fun onShowFileChooser(
                    view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        startActivityForResult(params.createIntent(), REQUEST_FILE)
                        true
                    } catch (e: Exception) {
                        fileCallback = null
                        false
                    }
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("$base/#/instructor")
        ScreenShareService.onEnded = { runOnUiThread { notifyWeb("viewnative-share-ended") } }
    }

    private fun notifyWeb(event: String) {
        if (::webView.isInitialized) webView.evaluateJavascript("window.dispatchEvent(new Event('$event'))", null)
    }

    /** Called from the web page as `window.ViewNative.*`. Runs on a background thread. */
    inner class Bridge {
        @JavascriptInterface
        fun startScreenShare(token: String) = runOnUiThread {
            pendingShareToken = token
            val mpm = getSystemService(MediaProjectionManager::class.java)
            startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_CAPTURE)
        }

        @JavascriptInterface
        fun stopScreenShare() = runOnUiThread {
            startService(Intent(this@MainActivity, ScreenShareService::class.java).setAction(ScreenShareService.ACTION_STOP))
        }

        @JavascriptInterface
        fun isSharing() = ScreenShareService.running

        @JavascriptInterface
        fun changeServer() = runOnUiThread { showServerSetup(null) }
    }

    @Deprecated("Activity result API needs AndroidX; this app keeps to the platform")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_FILE -> {
                fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                fileCallback = null
            }
            REQUEST_CAPTURE -> {
                val token = pendingShareToken
                pendingShareToken = null
                if (resultCode != RESULT_OK || data == null || token == null) {
                    notifyWeb("viewnative-share-ended") // user said no in the system dialog
                    return
                }
                val intent = Intent(this, ScreenShareService::class.java)
                    .putExtra(ScreenShareService.EXTRA_RESULT_CODE, resultCode)
                    .putExtra(ScreenShareService.EXTRA_DATA, data)
                    .putExtra(ScreenShareService.EXTRA_SERVER, serverUrl)
                    .putExtra(ScreenShareService.EXTRA_TOKEN, token)
                startForegroundService(intent)
                Toast.makeText(this, "เริ่มแชร์หน้าจอแล้ว", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @Deprecated("Matches the platform Activity API used here")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val REQUEST_FILE = 1
        private const val REQUEST_CAPTURE = 2

        /** Accepts "host", "https://host/", etc. Returns an origin-like base URL without a trailing slash, or null. */
        fun normalizeUrl(raw: String): String? {
            var s = raw.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            val uri = Uri.parse(s)
            if (uri.host.isNullOrBlank() || s.contains(' ')) return null
            return s
        }

        fun sameOrigin(a: Uri, b: Uri) = a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }
}
