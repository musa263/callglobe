package app.vocivo.sip

import android.telecom.CallAudioState
import android.telecom.Connection
import android.telecom.DisconnectCause

/**
 * One call, as Android's telecom stack sees it.
 *
 * Every override here turns a press on the system call screen into an event the
 * JavaScript engine acts on. The connection deliberately does not touch SIP
 * itself: if the two ever disagree about what a call is doing, the SIP side is
 * the one telling the truth, and it corrects this one through the module.
 */
class VocivoConnection(private val callId: String) : Connection() {

  init {
    connectionProperties = PROPERTY_SELF_MANAGED
    connectionCapabilities = CAPABILITY_HOLD or CAPABILITY_SUPPORT_HOLD or CAPABILITY_MUTE
    audioModeIsVoip = true
    setInitializing()
  }

  override fun onShowIncomingCallUi() {
    // Self-managed connections may draw their own incoming-call screen. Vocivo
    // lets the system do it, so there is nothing to do but let it ring.
  }

  override fun onAnswer() {
    VocivoSipCallRegistry.emit("callUiAnswer", "callId" to callId)
    setActive()
  }

  override fun onAnswer(videoState: Int) = onAnswer()

  override fun onReject() {
    VocivoSipCallRegistry.emit("callUiEnd", "callId" to callId)
    finish(DisconnectCause.REJECTED)
  }

  override fun onDisconnect() {
    VocivoSipCallRegistry.emit("callUiEnd", "callId" to callId)
    finish(DisconnectCause.LOCAL)
  }

  override fun onAbort() {
    VocivoSipCallRegistry.emit("callUiEnd", "callId" to callId)
    finish(DisconnectCause.CANCELED)
  }

  override fun onHold() {
    VocivoSipCallRegistry.emit("callUiHold", "callId" to callId, "held" to true)
    setOnHold()
  }

  override fun onUnhold() {
    VocivoSipCallRegistry.emit("callUiHold", "callId" to callId, "held" to false)
    setActive()
  }

  override fun onPlayDtmfTone(c: Char) {
    VocivoSipCallRegistry.emit("callUiDtmf", "callId" to callId, "digit" to c.toString())
  }

  override fun onCallAudioStateChanged(state: CallAudioState) {
    VocivoSipCallRegistry.emit(
      "callUiMute",
      "callId" to callId,
      "muted" to state.isMuted,
    )
    VocivoSipCallRegistry.emit(
      "callUiAudioSession",
      "callId" to callId,
      "route" to when (state.route) {
        CallAudioState.ROUTE_SPEAKER -> "speaker"
        CallAudioState.ROUTE_BLUETOOTH -> "bluetooth"
        CallAudioState.ROUTE_WIRED_HEADSET -> "headset"
        else -> "earpiece"
      },
    )
  }

  /** Called by the module when SIP — not the user — ended the call. */
  fun finish(cause: Int) {
    setDisconnected(DisconnectCause(cause))
    destroy()
    VocivoSipCallRegistry.forget(callId)
  }

  fun markRinging() = setRinging()

  fun markDialing() = setDialing()

  fun markActive() = setActive()
}
