import Foundation
func profile(_ environment: String) -> Data {
  var envelope = Data([0, 1, 2])
  envelope.append(try! PropertyListSerialization.data(fromPropertyList: ["Entitlements": ["aps-environment": environment]], format: .xml, options: 0))
  envelope.append(Data([3, 4, 5]))
  return envelope
}
@main
struct PushEnvironmentTests {
  static func main() {
    precondition(VocivoPushEnvironment.fromProfile(profile("development")) == "sandbox")
    precondition(VocivoPushEnvironment.fromProfile(profile("production")) == "production")
    precondition(VocivoPushEnvironment.fromProfile(nil) == "production")
    precondition(VocivoPushEnvironment.fromProfile(Data("malformed".utf8)) == "production")
    print("PASS native APNs environment: development, production, App Store, malformed profile")
  }
}
