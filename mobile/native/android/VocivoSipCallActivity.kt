package app.vocivo.sip

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Direct notification Activity avoids Android's notification-trampoline ban. */
class VocivoSipCallActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private var callId = ""
  private val watch = object : Runnable {
    override fun run() {
      val call = VocivoSipCallRegistry.connection(callId)
      if (call == null || call.state == android.telecom.Connection.STATE_DISCONNECTED) finish()
      else main.postDelayed(this, 500)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    callId = intent.getStringExtra("callId") ?: return finish()
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
    else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    val call = VocivoSipCallRegistry.connection(callId) ?: return finish()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(32, 48, 32, 48)
      setBackgroundColor(0xff102c45.toInt())
    }
    layout.addView(TextView(this).apply { text = call.callerDisplayName ?: "Incoming Vocivo call"; textSize = 28f; setTextColor(-1) })
    if (call.state == android.telecom.Connection.STATE_RINGING) layout.addView(Button(this).apply {
      text = "Answer"; setOnClickListener { answer() }
    })
    layout.addView(Button(this).apply { text = "End call"; setOnClickListener { call.onDisconnect(); finish() } })
    setContentView(layout)
    main.post(watch)
    if (intent.action == "ANSWER") answer()
  }

  private fun answer() {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
      return
    }
    val signedIn = getSharedPreferences("vocivo_auth", MODE_PRIVATE).getBoolean("voice_signed_in", false)
    val call = VocivoSipCallRegistry.connection(callId)
    if (!signedIn || call == null) { finish(); return }
    call.onAnswer()
    packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
    finish()
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) answer()
  }

  override fun onDestroy() { main.removeCallbacksAndMessages(null); super.onDestroy() }
}
