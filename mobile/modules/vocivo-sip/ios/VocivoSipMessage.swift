import Foundation

struct VocivoSipMessage {
  var startLine: String
  var headers: [(String, String)]
  var body: String

  var statusCode: Int? {
    let parts = startLine.split(separator: " ")
    guard parts.count >= 2, startLine.hasPrefix("SIP/2.0") else { return nil }
    return Int(parts[1])
  }

  var method: String? {
    guard !startLine.hasPrefix("SIP/2.0") else { return nil }
    return startLine.split(separator: " ").first.map(String.init)
  }

  func header(_ name: String) -> String? {
    headers.first { $0.0.caseInsensitiveCompare(name) == .orderedSame }?.1
  }

  mutating func setHeader(_ name: String, _ value: String) {
    if let index = headers.firstIndex(where: { $0.0.caseInsensitiveCompare(name) == .orderedSame }) {
      headers[index] = (name, value)
    } else {
      headers.append((name, value))
    }
  }

  func serialized() -> String {
    var lines = [startLine]
    headers.forEach { lines.append("\($0.0): \($0.1)") }
    lines.append("")
    return lines.joined(separator: "\r\n") + body
  }

  static func parse(_ raw: String) -> VocivoSipMessage? {
    let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")
    guard let divider = normalized.range(of: "\n\n") else {
      let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
      guard let start = lines.first else { return nil }
      let headers = parseHeaders(Array(lines.dropFirst()))
      return VocivoSipMessage(startLine: start, headers: headers, body: "")
    }
    let head = String(normalized[..<divider.lowerBound])
    let body = String(normalized[divider.upperBound...])
    let lines = head.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    guard let start = lines.first else { return nil }
    return VocivoSipMessage(startLine: start, headers: parseHeaders(Array(lines.dropFirst())), body: body)
  }

  private static func parseHeaders(_ lines: [String]) -> [(String, String)] {
    var headers: [(String, String)] = []
    for line in lines where !line.isEmpty {
      if line.hasPrefix(" ") || line.hasPrefix("\t"), let last = headers.indices.last {
        headers[last].1 += " " + line.trimmingCharacters(in: .whitespaces)
        continue
      }
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = String(line[..<colon])
      let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      headers.append((name, value))
    }
    return headers
  }
}

enum VocivoSipIds {
  static func branch() -> String { "z9hG4bK" + random(8) }
  static func tag() -> String { random(10) }
  static func callId() -> String { random(16) }
  static func random(_ length: Int) -> String {
    let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<length).map { _ in alphabet.randomElement()! })
  }
}
