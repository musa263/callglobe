import Foundation

// Release/debug JavaScript is independent of signing: a locally signed Release
// build still has a development APNs token. App Store installs have no embedded
// profile and use production. The OS verifies the profile when installing.
enum VocivoPushEnvironment {
  static func fromProfile(_ data: Data?) -> String {
    guard let data,
          let start = data.range(of: Data("<?xml".utf8)),
          let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
          let plist = try? PropertyListSerialization.propertyList(
            from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil
          ) as? [String: Any],
          let entitlements = plist["Entitlements"] as? [String: Any]
    else { return "production" }
    return entitlements["aps-environment"] as? String == "development" ? "sandbox" : "production"
  }

  static var current: String {
    let data = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
      .flatMap { try? Data(contentsOf: $0) }
    return fromProfile(data)
  }
}
