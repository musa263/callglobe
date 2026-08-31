import Foundation
import WebRTC

enum VocivoSipCredentials {
  private static let service = "app.vocivo.sip.credentials"

  private struct Stored: Codable {
    var username: String
    var password: String
    var domain: String
    var wsUri: String
    var displayName: String
    var ice: [[String: String]]
  }

  static func store(_ config: VocivoSipConfig) {
    let ice = config.iceServers.compactMap { server -> [String: String]? in
      let urls = server.urlStrings?.joined(separator: ",") ?? ""
      if urls.isEmpty { return nil }
      return ["urls": urls, "username": server.username ?? "", "credential": server.credential ?? ""]
    }
    let stored = Stored(
      username: config.username,
      password: config.password,
      domain: config.domain,
      wsUri: config.wsUri,
      displayName: config.displayName,
      ice: ice
    )
    guard let data = try? JSONEncoder().encode(stored) else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "current",
    ]
    SecItemDelete(query as CFDictionary)
    var write = query
    write[kSecValueData as String] = data
    SecItemAdd(write as CFDictionary, nil)
  }

  static func load() -> VocivoSipConfig? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "current",
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
          let stored = try? JSONDecoder().decode(Stored.self, from: data) else { return nil }
    let ice = stored.ice.compactMap { row -> RTCIceServer? in
      let urls = (row["urls"] ?? "").split(separator: ",").map(String.init)
      if urls.isEmpty { return nil }
      return RTCIceServer(urlStrings: urls, username: row["username"], credential: row["credential"])
    }
    return VocivoSipConfig(
      username: stored.username,
      password: stored.password,
      domain: stored.domain,
      wsUri: stored.wsUri,
      displayName: stored.displayName,
      iceServers: ice
    )
  }

  static func clear() {
    SecItemDelete([
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "current",
    ] as CFDictionary)
  }
}
