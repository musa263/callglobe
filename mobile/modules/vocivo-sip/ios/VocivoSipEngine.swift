import Foundation
import WebRTC

struct VocivoSipConfig {
  var username: String
  var password: String
  var domain: String
  var wsUri: String
  var displayName: String
  var iceServers: [RTCIceServer]
}

final class VocivoSipEngine: NSObject, URLSessionWebSocketDelegate {
  static let shared = VocivoSipEngine()

  private var config: VocivoSipConfig?
  private var socket: URLSessionWebSocketTask?
  private var session: URLSession?
  private var registerCSeq = 1
  private var inviteCSeq = 1
  private var registerCallId = VocivoSipIds.callId()
  private var fromTag = VocivoSipIds.tag()
  private var registerTimer: Timer?
  private var pendingRegister: ((Result<Void, Error>) -> Void)?
  private var pendingInvite: ((Result<String, Error>) -> Void)?
  private var activeCallId: String?
  private var activeUuid = UUID()
  private var remoteSdp = ""
  private var incomingInvite: VocivoSipMessage?
  private var lastInvite: (target: String, sdp: String, headers: [[String: String]])?
  var onEvent: ((String, [String: Any]) -> Void)?

  func register(config: VocivoSipConfig, completion: @escaping (Result<Void, Error>) -> Void) {
    unregister()
    self.config = config
    pendingRegister = completion
    guard let url = URL(string: config.wsUri) else {
      completion(.failure(NSError(domain: "VocivoSip", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid SIP websocket URL."])))
      return
    }
    let session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    self.session = session
    let task = session.webSocketTask(with: url, protocols: ["sip"])
    socket = task
    task.resume()
    listen()
  }

  func unregister() {
    registerTimer?.invalidate()
    if config != nil { send(method: "REGISTER", extra: [("Expires", "0")]) }
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    session = nil
    pendingRegister = nil
    VocivoSipMedia.shared.reset()
  }

  func invite(target: String, headers: [[String: String]], completion: @escaping (Result<String, Error>) -> Void) {
    guard config != nil else {
      completion(.failure(NSError(domain: "VocivoSip", code: 2, userInfo: [NSLocalizedDescriptionKey: "The SIP phone is not registered yet."])))
      return
    }
    pendingInvite = completion
    let uuid = UUID()
    activeUuid = uuid
    let handle = target.replacingOccurrences(of: "sip:", with: "").split(separator: "@").first.map(String.init) ?? target
    VocivoSipCallKit.shared.startOutgoing(uuid: uuid, handle: handle, displayName: handle)
    VocivoSipCallKit.shared.onEnd = { [weak self] _ in self?.hangup(callId: nil) }
    VocivoSipCallKit.shared.onMute = { _, muted in VocivoSipMedia.shared.setMuted(muted) }
    _ = VocivoSipMedia.shared.makePeer(iceServers: config?.iceServers ?? [])
    VocivoSipMedia.shared.createOffer { [weak self] sdp in
      guard let self, let sdp else {
        completion(.failure(NSError(domain: "VocivoSip", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to create SIP offer."])))
        return
      }
      self.sendInvite(target: target, sdp: sdp, headers: headers)
    }
  }

  func hangup(callId: String?) {
    VocivoSipCallKit.shared.onEnd = nil
    if incomingInvite != nil, activeCallId != nil {
      sendResponse(incomingInvite, status: "486 Busy Here")
    } else if let callId = activeCallId ?? callId {
      sendBye(callId: callId)
    }
    finishCall()
  }

  func answer(callId: String?) {
    guard let invite = incomingInvite else { return }
    VocivoSipMedia.shared.setRemoteSdp(remoteSdp, type: .offer) {
      VocivoSipMedia.shared.createAnswer { [weak self] sdp in
        guard let self, let sdp else { return }
        self.sendResponse(invite, status: "200 OK", body: sdp, contentType: "application/sdp")
        self.onEvent?("onCallConnected", ["callId": self.activeCallId ?? ""])
      }
    }
  }

  private func sendRegister(authorization: String?) {
    guard let config else { return }
    var extra: [(String, String)] = [("Expires", "600")]
    if let authorization { extra.append(("Authorization", authorization)) }
    send(method: "REGISTER", extra: extra, cseq: registerCSeq, callId: registerCallId)
  }

  private func sendInvite(target: String, sdp: String, headers: [[String: String]]) {
    guard let config else { return }
    inviteCSeq += 1
    let callId = VocivoSipIds.callId()
    activeCallId = callId
    let uri = target.hasPrefix("sip:") ? target : "sip:\(target)"
    var extra = headers.compactMap { item -> (String, String)? in
      guard let name = item["name"], let value = item["value"] else { return nil }
      return (name, value)
    }
    extra.append(("Content-Type", "application/sdp"))
    lastInvite = (target: uri, sdp: sdp, headers: headers)
    send(method: "INVITE", requestUri: uri, extra: extra, body: sdp, cseq: inviteCSeq, callId: callId)
    pendingInvite?(.success(callId))
    pendingInvite = nil
  }

  private func sendBye(callId: String) {
    send(method: "BYE", extra: [], cseq: inviteCSeq + 1, callId: callId)
  }

  private func send(method: String, requestUri: String? = nil, extra: [(String, String)], body: String = "", cseq: Int? = nil, callId: String? = nil) {
    guard let config else { return }
    let uri = requestUri ?? "sip:\(config.username)@\(config.domain)"
    let seq = cseq ?? registerCSeq
    var message = VocivoSipMessage(
      startLine: "\(method) \(uri) SIP/2.0",
      headers: [
        ("Via", "SIP/2.0/WSS \(config.domain);branch=\(VocivoSipIds.branch())"),
        ("Max-Forwards", "70"),
        ("From", "\"\(config.displayName)\" <sip:\(config.username)@\(config.domain)>;tag=\(fromTag)"),
        ("To", method == "REGISTER" ? "<sip:\(config.username)@\(config.domain)>" : "<\(uri)>"),
        ("Call-ID", callId ?? registerCallId),
        ("CSeq", "\(seq) \(method)"),
        ("Contact", "<sip:\(config.username)@\(config.domain);transport=ws>"),
        ("Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS, NOTIFY"),
        ("User-Agent", "VocivoSip/1.0"),
        ("Content-Length", "\(body.utf8.count)"),
      ],
      body: body
    )
    extra.forEach { message.setHeader($0.0, $0.1) }
    message.setHeader("Content-Length", "\(body.utf8.count)")
    socket?.send(.string(message.serialized())) { _ in }
  }

  private func sendResponse(_ invite: VocivoSipMessage?, status: String, body: String = "", contentType: String? = nil) {
    guard let invite, let via = invite.header("Via"), let from = invite.header("From"), let to = invite.header("To"), let callId = invite.header("Call-ID"), let cseq = invite.header("CSeq") else { return }
    let taggedTo = to.contains("tag=") ? to : "\(to);tag=\(VocivoSipIds.tag())"
    var headers = [
      ("Via", via),
      ("From", from),
      ("To", taggedTo),
      ("Call-ID", callId),
      ("CSeq", cseq),
      ("Contact", "<sip:\(config?.username ?? "vocivo")@invalid;transport=ws>"),
      ("Content-Length", "\(body.utf8.count)"),
    ]
    if let contentType { headers.insert(("Content-Type", contentType), at: headers.count - 1) }
    let message = VocivoSipMessage(startLine: "SIP/2.0 \(status)", headers: headers, body: body)
    socket?.send(.string(message.serialized())) { _ in }
  }

  private func listen() {
    socket?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure:
        break
      case .success(.string(let text)):
        self.handle(text)
      case .success(.data(let data)):
        if let text = String(data: data, encoding: .utf8) { self.handle(text) }
      @unknown default:
        break
      }
      self.listen()
    }
  }

  private func handle(_ raw: String) {
    guard let message = VocivoSipMessage.parse(raw) else { return }
    if let method = message.method {
      if method == "INVITE" { handleIncomingInvite(message) }
      if method == "OPTIONS" { sendResponse(message, status: "200 OK") }
      if method == "BYE" || method == "CANCEL" {
        sendResponse(message, status: "200 OK")
        finishCall()
      }
      if method == "ACK" { return }
      return
    }
    guard let code = message.statusCode else { return }
    let cseq = message.header("CSeq") ?? ""
    if cseq.contains("REGISTER") {
      if code == 401 || code == 407 {
        registerCSeq += 1
        sendRegister(authorization: digest(for: message, method: "REGISTER", uri: "sip:\(config?.username ?? "")@\(config?.domain ?? "")"))
      } else if (200..<300).contains(code) {
        pendingRegister?(.success(()))
        pendingRegister = nil
        onEvent?("onRegistered", [:])
        DispatchQueue.main.async {
          self.registerTimer?.invalidate()
          self.registerTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.registerCSeq += 1
            self?.sendRegister(authorization: nil)
          }
        }
      } else if code >= 400 {
        pendingRegister?(.failure(NSError(domain: "VocivoSip", code: code, userInfo: [NSLocalizedDescriptionKey: "SIP registration failed (\(code))."])))
        pendingRegister = nil
      }
      return
    }
    if cseq.contains("INVITE") {
      if code == 401 || code == 407 {
        inviteCSeq += 1
        guard let lastInvite else { return }
        let headerName = message.header("Proxy-Authenticate") != nil ? "Proxy-Authorization" : "Authorization"
        var extra = lastInvite.headers.compactMap { item -> (String, String)? in
          guard let name = item["name"], let value = item["value"] else { return nil }
          return (name, value)
        }
        extra.append((headerName, digest(for: message, method: "INVITE", uri: lastInvite.target) ?? ""))
        extra.append(("Content-Type", "application/sdp"))
        send(method: "INVITE", requestUri: lastInvite.target, extra: extra, body: lastInvite.sdp, cseq: inviteCSeq, callId: activeCallId)
      } else if (180...183).contains(code) {
        onEvent?("onCallRinging", ["callId": activeCallId ?? ""])
      } else if (200..<300).contains(code) {
        if !message.body.isEmpty {
          VocivoSipMedia.shared.setRemoteSdp(message.body, type: .answer) {}
        }
        VocivoSipCallKit.shared.reportOutgoingConnected(uuid: activeUuid)
        onEvent?("onCallConnected", ["callId": activeCallId ?? ""])
        sendAck(message)
      } else if code >= 400 {
        finishCall()
      }
    }
  }

  private func handleIncomingInvite(_ message: VocivoSipMessage) {
    incomingInvite = message
    activeCallId = message.header("Call-ID")
    remoteSdp = message.body
    sendResponse(message, status: "100 Trying")
    sendResponse(message, status: "180 Ringing")
    let from = message.header("From") ?? "Incoming call"
    let handle = from.slice(from: "sip:", to: "@") ?? "sip"
    let display = from.slice(from: "\"", to: "\"") ?? handle
    let uuid = UUID()
    activeUuid = uuid
    _ = VocivoSipMedia.shared.makePeer(iceServers: config?.iceServers ?? [])
    VocivoSipCallKit.shared.onAnswer = { [weak self] _ in self?.answer(callId: self?.activeCallId) }
    VocivoSipCallKit.shared.onEnd = { [weak self] _ in self?.hangup(callId: nil) }
    VocivoSipCallKit.shared.reportIncoming(uuid: uuid, handle: handle, displayName: display) { _ in }
    onEvent?("onIncomingCall", ["callId": activeCallId ?? "", "from": handle, "displayName": display])
  }

  private func sendAck(_ response: VocivoSipMessage) {
    guard let to = response.header("To") else { return }
    let uri = to.slice(from: "<", to: ">") ?? "sip:\(config?.domain ?? "")"
    send(method: "ACK", requestUri: uri, extra: [], cseq: inviteCSeq, callId: activeCallId)
  }

  private func digest(for message: VocivoSipMessage, method: String, uri: String) -> String? {
    guard let config else { return nil }
    let header = message.header("WWW-Authenticate") ?? message.header("Proxy-Authenticate") ?? ""
    let values = VocivoSipDigest.challengeValue(header)
    guard let realm = values["realm"], let nonce = values["nonce"] else { return nil }
    return VocivoSipDigest.authorization(
      user: config.username,
      password: config.password,
      realm: realm,
      nonce: nonce,
      uri: uri,
      method: method,
      qop: values["qop"]?.components(separatedBy: ",").first,
      opaque: values["opaque"],
      nc: "00000001",
      cnonce: VocivoSipIds.random(8)
    )
  }

  private func finishCall() {
    incomingInvite = nil
    lastInvite = nil
    let endedId = activeCallId ?? ""
    activeCallId = nil
    remoteSdp = ""
    VocivoSipMedia.shared.reset()
    VocivoSipCallKit.shared.onEnd = nil
    VocivoSipCallKit.shared.end(uuid: activeUuid)
    onEvent?("onCallEnded", ["callId": endedId])
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    sendRegister(authorization: nil)
  }
}

private extension String {
  func slice(from: String, to: String) -> String? {
    guard let start = range(of: from)?.upperBound else { return nil }
    guard let end = range(of: to, range: start..<self.endIndex)?.lowerBound else { return nil }
    return String(self[start..<end])
  }
}
