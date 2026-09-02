package app.vocivo.sip

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayDeque

/**
 * The bridge between Android's telecom stack and the JavaScript SIP engine.
 *
 * Vocivo speaks SIP to its own edge from JavaScript. This object exists for the
 * two things that must work before JavaScript does: putting an incoming call on
 * the system's call screen when a high-priority FCM message wakes a killed app,
 * and keeping the system's idea of the call in step with ours afterwards.
 *
 * It is a process-wide singleton on purpose. `VocivoConnectionService` is
 * created by the system, not by React Native, so the two halves can only meet
 * through something neither of them owns.
 */
object VocivoSipCallRegistry {
  private val main = Handler(Looper.getMainLooper())
  private val connections = HashMap<String, VocivoConnection>()

  /** Events raised before the JavaScript runtime attached. */
  private val pending = ArrayDeque<Pair<String, WritableMap>>()
  private const val MAX_PENDING = 16

  @Volatile
  private var reactContext: ReactContext? = null

  @Synchronized
  fun attach(context: ReactContext) {
    reactContext = context
    // Hand over everything that happened while the app was still starting —
    // above all the wake-up that put this call on screen in the first place.
    while (pending.isNotEmpty()) {
      val (name, body) = pending.removeFirst()
      send(context, name, body)
    }
  }

  @Synchronized
  fun detach() {
    reactContext = null
  }

  @Synchronized
  fun emit(name: String, body: WritableMap) {
    val context = reactContext
    if (context != null && context.hasActiveReactInstance()) {
      send(context, name, body)
      return
    }
    if (pending.size >= MAX_PENDING) pending.removeFirst()
    pending.addLast(name to body)
  }

  fun emit(name: String, vararg entries: Pair<String, Any?>) {
    val body = Arguments.createMap()
    entries.forEach { (key, value) ->
      when (value) {
        null -> body.putNull(key)
        is Boolean -> body.putBoolean(key, value)
        is Int -> body.putInt(key, value)
        is Double -> body.putDouble(key, value)
        else -> body.putString(key, value.toString())
      }
    }
    emit(name, body)
  }

  private fun send(context: ReactContext, name: String, body: WritableMap) {
    main.post {
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(name, body)
    }
  }

  @Synchronized
  fun register(callId: String, connection: VocivoConnection) {
    connections[callId] = connection
  }

  @Synchronized
  fun connection(callId: String): VocivoConnection? = connections[callId]

  @Synchronized
  fun forget(callId: String) {
    connections.remove(callId)
  }

  @Synchronized
  fun forgetAll() {
    connections.clear()
  }
}
