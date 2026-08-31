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
    AsyncFunction("invite") { _: String, _: List<Map<String, String>>? ->
      throw Exception("Vocivo native SIP is iOS-only.")
    }
    AsyncFunction("hangup") { _: String? -> }
    AsyncFunction("answer") { _: String? -> }
  }
}
