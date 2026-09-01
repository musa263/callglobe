package app.vocivo.sip

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VocivoSipModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VocivoSip")
    AsyncFunction("register") { _: Map<String, Any?> ->
      throw Exception("Vocivo native SIP is iOS-only. Inbound DIDs stay on Telnyx Call Control.")
    }
    AsyncFunction("unregister") { }
    AsyncFunction("hangup") { _: String? -> }
    AsyncFunction("answer") { _: String? -> }
    AsyncFunction("invite") { _: String, _: List<Map<String, String>>? ->
      throw Exception("Vocivo native SIP is iOS-only.")
    }
    AsyncFunction("setMuted") { _: Boolean -> }
    AsyncFunction("setHeld") { _: Boolean -> }
    AsyncFunction("sendDtmf") { _: String -> }
    AsyncFunction("swap") { }
    AsyncFunction("merge") { _: String -> throw Exception("Vocivo native SIP is iOS-only.") }
    AsyncFunction("refer") { _: String -> throw Exception("Vocivo native SIP is iOS-only.") }
  }
}
