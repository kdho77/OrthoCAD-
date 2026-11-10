import Foundation
import Security

let raw = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
let parts = raw.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
let op = parts.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
let account = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
let secret = parts.count > 2 ? parts[2] : ""
let service = "orthocad-print-bridge"

func baseQuery() -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
}

if account.isEmpty || account.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) == nil {
    exit(1)
}

if op == "delete" || op == "set" {
    SecItemDelete(baseQuery() as CFDictionary)
}

if op == "set" {
    var query = baseQuery()
    query[kSecValueData as String] = Data(secret.utf8)
    let status = SecItemAdd(query as CFDictionary, nil)
    exit(status == errSecSuccess ? 0 : 1)
}

if op == "get" {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data, let text = String(data: data, encoding: .utf8) else {
        exit(1)
    }
    FileHandle.standardOutput.write(Data(text.utf8))
    exit(0)
}

if op == "delete" {
    exit(0)
}

exit(1)
