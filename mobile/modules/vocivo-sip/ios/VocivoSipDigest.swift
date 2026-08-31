import CryptoKit
import Foundation

enum VocivoSipDigest {
  static func md5(_ value: String) -> String {
    Insecure.MD5.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  static func authorization(
    user: String,
    password: String,
    realm: String,
    nonce: String,
    uri: String,
    method: String,
    qop: String?,
    opaque: String?,
    nc: String,
    cnonce: String
  ) -> String {
    let ha1 = md5("\(user):\(realm):\(password)")
    let ha2 = md5("\(method):\(uri)")
    let response: String
    if let qop, !qop.isEmpty {
      response = md5("\(ha1):\(nonce):\(nc):\(cnonce):\(qop):\(ha2)")
    } else {
      response = md5("\(ha1):\(nonce):\(ha2)")
    }
    var parts = [
      "Digest username=\"\(user)\"",
      "realm=\"\(realm)\"",
      "nonce=\"\(nonce)\"",
      "uri=\"\(uri)\"",
      "response=\"\(response)\"",
      "algorithm=MD5",
    ]
    if let qop, !qop.isEmpty {
      parts.append("qop=\(qop)")
      parts.append("nc=\(nc)")
      parts.append("cnonce=\"\(cnonce)\"")
    }
    if let opaque, !opaque.isEmpty {
      parts.append("opaque=\"\(opaque)\"")
    }
    return parts.joined(separator: ", ")
  }

  static func challengeValue(_ header: String) -> [String: String] {
    var values: [String: String] = [:]
    let body = header.trimmingCharacters(in: .whitespacesAndNewlines)
    if body.lowercased().hasPrefix("digest") {
      body = String(body.drop(while: { $0 != " " && $0 != "\t" })).trimmingCharacters(in: .whitespaces)
    }
    let pattern = #"(\w+)=(?:"([^"]*)"|([^\s,]+))"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return values }
    regex.enumerateMatches(in: body, range: NSRange(body.startIndex..., in: body)) { match, _, _ in
      guard let match, let nameRange = Range(match.range(at: 1), in: body) else { return }
      let quoted = Range(match.range(at: 2), in: body)
      let bare = Range(match.range(at: 3), in: body)
      let valueRange = quoted ?? bare
      guard let valueRange else { return }
      values[String(body[nameRange])] = String(body[valueRange])
    }
    return values
  }
}
