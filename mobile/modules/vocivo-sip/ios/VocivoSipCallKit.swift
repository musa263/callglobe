import AVFoundation
import CallKit
import Foundation

/// CallKit for Vocivo SIP legs. Incoming VoIP pushes reuse this provider; Telnyx keeps the single PKPushRegistry.
final class VocivoSipCallKit: NSObject, CXProviderDelegate {
  static let shared = VocivoSipCallKit()

  private let provider: CXProvider
  private let controller = CXCallController()
  var onAnswer: ((UUID) -> Void)?
  var onEnd: ((UUID) -> Void)?
  var onMute: ((UUID, Bool) -> Void)?

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = false
    config.maximumCallsPerCallGroup = 2
    config.supportedHandleTypes = [.generic, .phoneNumber]
    if let ringtone = Bundle.main.path(forResource: "vocivo_classic", ofType: "wav") {
      config.ringtoneSound = URL(fileURLWithPath: ringtone).lastPathComponent
    }
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: DispatchQueue.main)
  }

  func startOutgoing(uuid: UUID, handle: String, displayName: String) {
    let cxHandle = CXHandle(type: handle.hasPrefix("+") ? .phoneNumber : .generic, value: handle)
    let action = CXStartCallAction(call: uuid, handle: cxHandle)
    action.contactIdentifier = displayName
    controller.request(CXTransaction(action: action)) { _ in }
  }

  func reportOutgoingConnected(uuid: UUID) {
    provider.reportOutgoingCall(with: uuid, connectedAt: Date())
  }

  func reportIncoming(uuid: UUID, handle: String, displayName: String, completion: @escaping (Error?) -> Void) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: handle.hasPrefix("+") ? .phoneNumber : .generic, value: handle)
    update.localizedCallerName = displayName
    update.hasVideo = false
    provider.reportNewIncomingCall(with: uuid, update: update, completion: completion)
  }

  func end(uuid: UUID) {
    controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { _ in }
  }

  func providerDidReset(_ provider: CXProvider) {
    onEnd?(UUID())
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    configureAudio()
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    configureAudio()
    onAnswer?(action.callUUID)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    onEnd?(action.callUUID)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    onMute?(action.callUUID, action.isMuted)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    configureAudio()
  }

  private func configureAudio() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP])
    try? session.setActive(true, options: [])
  }
}
