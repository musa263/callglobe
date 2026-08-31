import ExpoModulesCore
import WebRTC

public final class VocivoSipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VocivoSip")
    Events("onIncomingCall", "onCallEnded", "onCallConnected", "onCallRinging", "onRegistered")

    OnCreate {
      VocivoSipEngine.shared.onEvent = { [weak self] name, payload in
        self?.sendEvent(name, payload)
      }
    }

    AsyncFunction("register") { (config: [String: Any], promise: Promise) in
      guard let username = config["username"] as? String,
            let password = config["password"] as? String,
            let domain = config["domain"] as? String else {
        promise.reject("SIP_CONFIG", "username, password, and domain are required.")
        return
      }
      let wsUri = (config["wsUri"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let wsUri, !wsUri.isEmpty else {
        promise.reject("SIP_CONFIG", "wsUri is required. Inbound DIDs stay on Telnyx Call Control.")
        return
      }
      var ice: [RTCIceServer] = []
      if let servers = config["iceServers"] as? [[String: Any]] {
        ice = servers.compactMap { item in
          let urls: [String]
          if let list = item["urls"] as? [String] { urls = list }
          else if let url = item["urls"] as? String { urls = [url] }
          else { return nil }
          return RTCIceServer(urlStrings: urls, username: item["username"] as? String, credential: item["credential"] as? String)
        }
      }
      let sipConfig = VocivoSipConfig(
        username: username,
        password: password,
        domain: domain,
        wsUri: wsUri,
        displayName: (config["displayName"] as? String) ?? username,
        iceServers: ice
      )
      VocivoSipCredentials.store(sipConfig)
      VocivoSipEngine.shared.register(config: sipConfig) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject("SIP_REGISTER", error.localizedDescription)
        }
      }
    }

    AsyncFunction("unregister") { (promise: Promise) in
      VocivoSipCredentials.clear()
      VocivoSipEngine.shared.unregister()
      promise.resolve(nil)
    }

    AsyncFunction("invite") { (target: String, headers: [[String: String]]?, promise: Promise) in
      VocivoSipEngine.shared.invite(target: target, headers: headers ?? []) { result in
        switch result {
        case .success(let callId): promise.resolve(callId)
        case .failure(let error): promise.reject("SIP_INVITE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("hangup") { (callId: String?, promise: Promise) in
      VocivoSipEngine.shared.hangup(callId: callId)
      promise.resolve(nil)
    }

    AsyncFunction("answer") { (callId: String?, promise: Promise) in
      VocivoSipEngine.shared.answer(callId: callId)
      promise.resolve(nil)
    }
  }
}
