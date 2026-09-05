import AVFoundation
import CallKit
import Foundation
import PushKit
import UIKit

/// CallKit and PushKit for Vocivo.
///
/// Vocivo speaks SIP to its own edge from JavaScript. Two things cannot be done
/// there, and they are the whole of this file: drawing the incoming-call screen
/// that iOS owns, and being alive when a VoIP push lands on a phone whose app
/// iOS has killed. PushKit is unforgiving about the second — an app that
/// receives a VoIP push and returns from the delegate without reporting a call
/// to CallKit is terminated, and repeat offenders stop receiving pushes at all.
/// So the call is reported here, synchronously, from the payload, long before
/// the JavaScript runtime exists.
@objc(VocivoSipCallManager)
public final class VocivoSipCallManager: NSObject {
  @objc public static let shared = VocivoSipCallManager()

  /// Set by the React Native module once JavaScript is running.
  public var onEvent: ((String, [String: Any]) -> Void)?

  private let provider: CXProvider
  private let controller = CXCallController()

  /// Vocivo call id <-> CallKit UUID. Both directions are needed: JavaScript
  /// talks in call ids, CallKit talks in UUIDs.
  private var uuidsByCallId: [String: UUID] = [:]
  private var callIdsByUuid: [UUID: String] = [:]
  private var pendingAnswers: [String: CXAnswerCallAction] = [:]
  private var outgoingCalls = Set<String>()
  private var ringingDeadlines: [String: DispatchWorkItem] = [:]

  /// Events raised before JavaScript attached. A push wake is the reason this
  /// exists: without it the wake is delivered to nobody and the user answers a
  /// call the app never learns about.
  private var pending: [(String, [String: Any])] = []
  private let lock = NSLock()

  private override init() {
    let configuration = CXProviderConfiguration(localizedName: "Vocivo")
    configuration.supportsVideo = false
    configuration.maximumCallsPerCallGroup = 1
    configuration.maximumCallGroups = 1
    configuration.supportedHandleTypes = [.phoneNumber, .generic]
    configuration.includesCallsInRecents = true
    if let icon = UIImage(named: "vocivo-icon") {
      configuration.iconTemplateImageData = icon.pngData()
    }
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  // MARK: - Launch

  /// AppDelegate owns the sole PushKit registry and routes pushes by provider.
  @objc public func start() {
    // Initializing the singleton installs the CallKit provider delegate.
  }

  // MARK: - JavaScript attachment

  /// Hands over anything that happened before JavaScript was listening.
  @objc public func flushPendingEvents() {
    lock.lock()
    let queued = pending
    pending = []
    lock.unlock()
    queued.forEach { onEvent?($0.0, $0.1) }
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    if let onEvent = onEvent {
      onEvent(name, body)
      return
    }
    lock.lock()
    // Bound the queue: a phone that has been offline for a while must not
    // replay a hundred stale calls the moment the app opens.
    if pending.count >= 16 { pending.removeFirst() }
    pending.append((name, body))
    lock.unlock()
  }

  // MARK: - Call bookkeeping

  private func uuid(for callId: String) -> UUID {
    if let existing = uuidsByCallId[callId] { return existing }
    let created = UUID()
    uuidsByCallId[callId] = created
    callIdsByUuid[created] = callId
    return created
  }

  private func forget(_ callId: String) {
    ringingDeadlines.removeValue(forKey: callId)?.cancel()
    pendingAnswers.removeValue(forKey: callId)?.fail()
    outgoingCalls.remove(callId)
    guard let uuid = uuidsByCallId.removeValue(forKey: callId) else { return }
    callIdsByUuid.removeValue(forKey: uuid)
  }

  // MARK: - Reporting to CallKit

  @objc public func reportIncomingCall(callId: String, callerName: String?, callerNumber: String?, completion: ((Error?) -> Void)? = nil) {
    let update = CXCallUpdate()
    let number = callerNumber ?? ""
    update.remoteHandle = number.isEmpty
      ? CXHandle(type: .generic, value: callerName ?? "Vocivo call")
      : CXHandle(type: .phoneNumber, value: number)
    update.localizedCallerName = callerName?.isEmpty == false ? callerName : nil
    update.hasVideo = false
    update.supportsHolding = true
    update.supportsDTMF = true
    update.supportsGrouping = false
    update.supportsUngrouping = false
    let alreadyReported = uuidsByCallId[callId] != nil
    provider.reportNewIncomingCall(with: uuid(for: callId), update: update) { error in
      DispatchQueue.main.async {
        if error != nil && !alreadyReported { self.forget(callId) }
        if error == nil && self.uuidsByCallId[callId] != nil {
          let deadline = DispatchWorkItem { [weak self] in
            self?.emit("callUiEnd", ["callId": callId])
            self?.reportCallEnded(callId: callId, reason: "unanswered")
          }
          self.ringingDeadlines.removeValue(forKey: callId)?.cancel()
          self.ringingDeadlines[callId] = deadline
          DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: deadline)
        }
        completion?(error)
      }
    }
  }

  @objc public func reportOutgoingCall(callId: String, handle: String) {
    outgoingCalls.insert(callId)
    let uuid = uuid(for: callId)
    let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .phoneNumber, value: handle))
    controller.request(CXTransaction(action: action)) { _ in }
    provider.reportOutgoingCall(with: uuid, startedConnectingAt: nil)
  }

  @objc public func reportCallConnected(callId: String) {
    ringingDeadlines.removeValue(forKey: callId)?.cancel()
    guard let uuid = uuidsByCallId[callId] else { return }
    if outgoingCalls.contains(callId) { provider.reportOutgoingCall(with: uuid, connectedAt: nil) }
  }

  @objc public func completeAnswer(callId: String, success: Bool) {
    guard let action = pendingAnswers.removeValue(forKey: callId) else { return }
    if success { action.fulfill() } else { action.fail() }
  }

  @objc public func reportCallEnded(callId: String, reason: String) {
    guard let uuid = uuidsByCallId[callId] else { return }
    let cxReason: CXCallEndedReason
    switch reason {
    case "failed": cxReason = .failed
    case "declined": cxReason = .remoteEnded
    case "unanswered": cxReason = .unanswered
    default: cxReason = .remoteEnded
    }
    provider.reportCall(with: uuid, endedAt: nil, reason: cxReason)
    forget(callId)
  }

  @objc public func reportMuted(callId: String, muted: Bool) {
    guard let uuid = uuidsByCallId[callId] else { return }
    controller.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: muted))) { _ in }
  }

  @objc public func reportHeld(callId: String, held: Bool) {
    guard let uuid = uuidsByCallId[callId] else { return }
    controller.request(CXTransaction(action: CXSetHeldCallAction(call: uuid, onHold: held))) { _ in }
  }

  // MARK: - Audio route

  @objc public func setSpeaker(_ on: Bool) throws {
    let session = AVAudioSession.sharedInstance()
    try session.overrideOutputAudioPort(on ? .speaker : .none)
  }

  /// Voice-chat mode with Bluetooth allowed: the phone in a pocket, a headset
  /// in the ear and a van's hands-free kit are the normal cases for this app.
  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers])
      try session.setPreferredIOBufferDuration(0.02)
    } catch {
      NSLog("Vocivo: could not configure the audio session: \(error.localizedDescription)")
    }
  }
}

// MARK: - PushKit

extension VocivoSipCallManager: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = credentials.token.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(token, forKey: "vocivo_voip_push_token")
    emit("callUiPushToken", ["token": token])
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    UserDefaults.standard.removeObject(forKey: "vocivo_voip_push_token")
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else { completion(); return }
    let data = (payload.dictionaryPayload["vocivo"] as? [AnyHashable: Any]) ?? payload.dictionaryPayload
    // The id must be the edge's own call UUID: the INVITE that follows carries
    // it in X-Vocivo-Call-UUID, and that is what makes the pushed call and the
    // signalled call one call instead of two.
    let callId = (data["callId"] as? String) ?? (data["call_id"] as? String) ?? UUID().uuidString
    let callerName = data["callerName"] as? String ?? data["caller_name"] as? String
    let callerNumber = data["callerNumber"] as? String ?? data["caller_number"] as? String

    let signedIn = UserDefaults.standard.bool(forKey: "vocivo_voice_signed_in")
    let expiresAt = (data["expiresAt"] as? String).flatMap { value -> Date? in
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    let actionable = signedIn && (expiresAt.map { $0 > Date() } ?? true)
    // Report first, tell JavaScript second. iOS requires the call on screen
    // before this delegate returns, whatever else is or is not running.
    reportIncomingCall(callId: callId, callerName: callerName, callerNumber: callerNumber) { error in
      // Even a stale push must satisfy PushKit's reporting contract. End it
      // immediately and never wake SIP or accept it for a signed-out account.
      guard error == nil, actionable else {
        if error == nil { self.reportCallEnded(callId: callId, reason: "unanswered") }
        completion()
        return
      }
      var body: [String: Any] = ["callId": callId]
      if let callerName = callerName { body["callerName"] = callerName }
      if let callerNumber = callerNumber { body["callerNumber"] = callerNumber }
      if let expiresAt = data["expiresAt"] as? String { body["expiresAt"] = expiresAt }
      self.emit("callUiPushWake", body)
      completion()
    }
  }
}

// MARK: - CallKit

extension VocivoSipCallManager: CXProviderDelegate {
  public func providerDidReset(_ provider: CXProvider) {
    // The system tore every call down; JavaScript must not think otherwise.
    let ids = Array(callIdsByUuid.values)
    pendingAnswers.values.forEach { $0.fail() }
    pendingAnswers.removeAll()
    ringingDeadlines.values.forEach { $0.cancel() }
    ringingDeadlines.removeAll()
    outgoingCalls.removeAll()
    uuidsByCallId.removeAll()
    callIdsByUuid.removeAll()
    ids.forEach { emit("callUiEnd", ["callId": $0]) }
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else { action.fail(); return }
    ringingDeadlines.removeValue(forKey: callId)?.cancel()
    configureAudioSession()
    pendingAnswers[callId]?.fail()
    pendingAnswers[callId] = action
    emit("callUiAnswer", ["callId": callId])
    // JS resolves this action only after the matching SIP INVITE is accepted.
    // CallKit's own deadline remains authoritative if JS never starts.
  }

  public func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
    guard let answer = action as? CXAnswerCallAction,
          let callId = callIdsByUuid[answer.callUUID] else { return }
    pendingAnswers.removeValue(forKey: callId)
    emit("callUiEnd", ["callId": callId])
    reportCallEnded(callId: callId, reason: "failed")
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else { action.fulfill(); return }
    emit("callUiEnd", ["callId": callId])
    forget(callId)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else { action.fail(); return }
    emit("callUiMute", ["callId": callId, "muted": action.isMuted])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else { action.fail(); return }
    emit("callUiHold", ["callId": callId, "held": action.isOnHold])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else { action.fail(); return }
    emit("callUiDtmf", ["callId": callId, "digit": action.digits])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // WebRTC only starts moving audio once the session CallKit owns is active.
    emit("callUiAudioSession", ["active": true])
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    emit("callUiAudioSession", ["active": false])
  }
}
