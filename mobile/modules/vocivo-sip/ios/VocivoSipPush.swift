import Foundation
import PushKit

@objc(VocivoSipPush)
public final class VocivoSipPush: NSObject {
  @objc public static func handle(_ payload: PKPushPayload, completion: @escaping () -> Void) -> Bool {
    let dictionary = payload.dictionaryPayload
    guard dictionary["vocivo"] as? String == "sip" else { return false }
    VocivoSipEngine.shared.handleVoipPush(dictionary, completion: completion)
    return true
  }
}
