import Foundation
import WebRTC

final class VocivoSipMedia: NSObject, RTCPeerConnectionDelegate {
  static let shared = VocivoSipMedia()

  private let factory: RTCPeerConnectionFactory
  private var peer: RTCPeerConnection?
  private var localAudio: RTCAudioTrack?
  private var iceWaiters: [() -> Void] = []

  private override init() {
    RTCInitializeSSL()
    factory = RTCPeerConnectionFactory()
    super.init()
  }

  func reset() {
    iceWaiters.removeAll()
    peer?.close()
    peer = nil
    localAudio = nil
  }

  func makePeer(iceServers: [RTCIceServer]) -> RTCPeerConnection? {
    reset()
    let config = RTCConfiguration()
    config.iceServers = iceServers
    config.sdpSemantics = .unifiedPlan
    config.continualGatheringPolicy = .gatherContinually
    let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
    guard let connection = factory.peerConnection(with: config, constraints: constraints, delegate: self) else { return nil }
    let audio = factory.audioTrack(with: factory.audioSource(with: nil), trackId: "vocivo-audio")
    connection.add(audio, streamIds: ["vocivo"])
    localAudio = audio
    peer = connection
    return connection
  }

  func createOffer(completion: @escaping (String?) -> Void) {
    let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
    peer?.offer(for: constraints) { [weak self] sdp, _ in
      guard let self, let sdp else { return completion(nil) }
      self.peer?.setLocalDescription(sdp) { _ in
        self.waitForIce { completion(self.peer?.localDescription?.sdp) }
      }
    }
  }

  func createAnswer(completion: @escaping (String?) -> Void) {
    let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
    peer?.answer(for: constraints) { [weak self] sdp, _ in
      guard let self, let sdp else { return completion(nil) }
      self.peer?.setLocalDescription(sdp) { _ in
        self.waitForIce { completion(self.peer?.localDescription?.sdp) }
      }
    }
  }

  func setRemoteSdp(_ sdp: String, type: RTCSdpType, completion: @escaping () -> Void) {
    let description = RTCSessionDescription(type: type, sdp: sdp)
    peer?.setRemoteDescription(description) { _ in completion() }
  }

  func setMuted(_ muted: Bool) {
    localAudio?.isEnabled = !muted
  }

  private func waitForIce(completion: @escaping () -> Void) {
    if peer?.iceGatheringState == .complete {
      completion()
      return
    }
    iceWaiters.append(completion)
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
      self?.flushIceWaiters()
    }
  }

  private func flushIceWaiters() {
    let waiters = iceWaiters
    iceWaiters.removeAll()
    waiters.forEach { $0() }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
    if newState == .complete { flushIceWaiters() }
  }
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
