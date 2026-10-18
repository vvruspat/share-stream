// Export exactly one selected Developer ID identity; never export the keychain.
import Foundation
import Security
import CryptoKit

guard CommandLine.arguments.count == 4 else {
    fatalError("Usage: export-signing-identity SHA1 OUTPUT.p12 PASSWORD_FILE")
}
let expected = CommandLine.arguments[1].uppercased()
let password = try String(contentsOfFile: CommandLine.arguments[3], encoding: .utf8)
var result: CFTypeRef?
let query: [String: Any] = [kSecClass as String: kSecClassIdentity,
    kSecReturnRef as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
let status = SecItemCopyMatching(query as CFDictionary, &result)
guard status == errSecSuccess, let identities = result as? [SecIdentity] else {
    fatalError("Cannot list signing identities: \(status)")
}
var exported = false
for identity in identities {
    var certificate: SecCertificate?
    guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess,
          let certificate else { continue }
    let data = SecCertificateCopyData(certificate) as Data
    let digest = Insecure.SHA1.hash(data: data).map { String(format: "%02X", $0) }.joined()
    guard digest == expected else { continue }
    let name = SecCertificateCopySubjectSummary(certificate) as String? ?? ""
    guard name.hasPrefix("Developer ID Application:"), name.contains("(3WKK5AGY66)") else {
        fatalError("Refusing an identity outside the owner's Developer ID account")
    }
    var parameters = SecItemImportExportKeyParameters()
    parameters.version = UInt32(SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION)
    parameters.passphrase = Unmanaged.passUnretained(password as CFString)
    var p12: CFData?
    let code = SecItemExport(identity, .formatPKCS12, [], &parameters, &p12)
    guard code == errSecSuccess, let p12 else { fatalError("Selected identity export failed: \(code)") }
    let path = CommandLine.arguments[2]
    FileManager.default.createFile(atPath: path, contents: p12 as Data, attributes: [.posixPermissions: 0o600])
    print("Exported selected Developer ID identity for Team 3WKK5AGY66")
    exported = true
}
guard exported else { fatalError("Selected identity was not found") }
