import Foundation
import WebRTC

/// Two media slots so a held SIP call keeps its PeerConnection while a second
/// call is placed. `makePeer()` used to reset the shared PC and kill the first call.
final class VocivoSipMedia: NSObject, RTCPeerConnectionDelegate {
  static let shared = VocivoSipMedia()

  private let factory: RTCPeerConnectionFactory
  private var peers: [Int: RTCPeerConnection] = [:]
  private var localAudio: [Int: RTCAudioTrack] = [:]
  private var iceWaiters: [Int: [() -> Void]] = [:]
  private(set) var activeSlot = 0

  private override init() {
    RTCInitializeSSL()
    factory = RTCPeerConnectionFactory()
    super.init()
  }

  func reset() {
    reset(slot: 0)
    reset(slot: 1)
    activeSlot = 0
  }

  func reset(slot: Int) {
    iceWaiters[slot]?.removeAll()
    iceWaiters[slot] = []
    peers[slot]?.close()
    peers.removeValue(forKey: slot)
    localAudio.removeValue(forKey: slot)
  }

  func makePeer(iceServers: [RTCIceServer], replacingActive: Bool = true) -> RTCPeerConnection? {
    if !replacingActive {
      activeSlot = 1 - activeSlot
    }
    reset(slot: activeSlot)
    let config = RTCConfiguration()
    config.iceServers = iceServers
    config.sdpSemantics = .unifiedPlan
    config.continualGatheringPolicy = .gatherContinually
    let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
    guard let connection = factory.peerConnection(with: config, constraints: constraints, delegate: self) else { return nil }
    let audioConstraints = RTCMediaConstraints(
      mandatoryConstraints: nil,
      optionalConstraints: [
        "googEchoCancellation": "true",
        "googAutoGainControl": "true",
        "googNoiseSuppression": "true",
      ]
    )
    let audio = factory.audioTrack(with: factory.audioSource(with: audioConstraints), trackId: "vocivo-audio-\(activeSlot)")
    connection.add(audio, streamIds: ["vocivo-\(activeSlot)"])
    localAudio[activeSlot] = audio
    peers[activeSlot] = connection
    return connection
  }

  func createOffer(completion: @escaping (String?) -> Void) {
    let slot = activeSlot
    let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
    peers[slot]?.offer(for: constraints) { [weak self] sdp, _ in
      guard let self, let sdp else { return completion(nil) }
      self.peers[slot]?.setLocalDescription(sdp) { _ in
        self.waitForIce(slot: slot) { completion(self.peers[slot]?.localDescription?.sdp) }
      }
    }
  }

  func createAnswer(completion: @escaping (String?) -> Void) {
    let slot = activeSlot
    let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
    peers[slot]?.answer(for: constraints) { [weak self] sdp, _ in
      guard let self, let sdp else { return completion(nil) }
      self.peers[slot]?.setLocalDescription(sdp) { _ in
        self.waitForIce(slot: slot) { completion(self.peers[slot]?.localDescription?.sdp) }
      }
    }
  }

  func setRemoteSdp(_ sdp: String, type: RTCSdpType, completion: @escaping () -> Void) {
    let description = RTCSessionDescription(type: type, sdp: sdp)
    peers[activeSlot]?.setRemoteDescription(description) { error in
      if error == nil { completion() }
    }
  }

  /// Mute only the local microphone. Remote audio stays enabled so mute is not
  /// "silence the other party while I still hear sidetone."
  func setMuted(_ muted: Bool) {
    localAudio[activeSlot]?.isEnabled = !muted
  }

  func setHeld(_ held: Bool, slot: Int? = nil) {
    let target = slot ?? activeSlot
    peers[target]?.transceivers.forEach { transceiver in
      transceiver.receiver.track?.isEnabled = !held
    }
  }

  func swapSlots() {
    setHeld(true, slot: activeSlot)
    activeSlot = 1 - activeSlot
    setHeld(false, slot: activeSlot)
  }

  func hasHeldSlot() -> Bool {
    peers[1 - activeSlot] != nil
  }

  private func waitForIce(slot: Int, completion: @escaping () -> Void) {
    if peers[slot]?.iceGatheringState == .complete {
      completion()
      return
    }
    iceWaiters[slot, default: []].append(completion)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      if self?.peers[slot]?.iceGatheringState == .complete {
        self?.flushIceWaiters(slot: slot)
      }
    }
  }

  private func flushIceWaiters(slot: Int) {
    let waiters = iceWaiters[slot] ?? []
    iceWaiters[slot] = []
    waiters.forEach { $0() }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
    if newState == .complete {
      if peerConnection === peers[0] { flushIceWaiters(slot: 0) }
      if peerConnection === peers[1] { flushIceWaiters(slot: 1) }
    }
  }
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
