import Capacitor
import UIKit

/// Ponte JS → WhatsApp no iPhone, seguindo o exemplo oficial (github.com/WhatsApp/stickers, iOS):
/// o pacote vai como JSON na área de transferência com o tipo próprio do WhatsApp e o app abre
/// `whatsapp://stickerPack`. Mesma API JS do plugin Android.
@objc(WhatsAppStickersPlugin)
public class WhatsAppStickersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WhatsAppStickersPlugin"
    public let jsName = "WhatsAppStickers"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writePackFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addPack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isPackAdded", returnType: CAPPluginReturnPromise),
    ]

    private static let pasteboardType = "net.whatsapp.third-party.sticker-pack"
    private static let pasteboardExpiration: TimeInterval = 60
    private static let stickerPackURL = URL(string: "whatsapp://stickerPack")!
    private static let whatsAppURL = URL(string: "whatsapp://")!
    private static let safeName = try! NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,128}$")

    private static func isSafe(_ name: String) -> Bool {
        name != "." && name != ".."
            && safeName.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }

    private func packDirectory(_ identifier: String) throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return base.appendingPathComponent("whatsapp_packs", isDirectory: true).appendingPathComponent(identifier, isDirectory: true)
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // No iPhone não dá para distinguir o WhatsApp Business: os dois respondem a whatsapp://.
            call.resolve(["whatsapp": UIApplication.shared.canOpenURL(Self.whatsAppURL), "business": false])
        }
    }

    /// Recebe um arquivo por vez (base64), para não passar o pacote inteiro numa só mensagem.
    @objc func writePackFile(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier"), let name = call.getString("name"), let base64 = call.getString("data") else {
            call.reject("identifier, name e data são obrigatórios", "INVALID_ARGUMENT")
            return
        }
        guard Self.isSafe(identifier), Self.isSafe(name) else {
            call.reject("Nome inválido", "INVALID_ARGUMENT")
            return
        }
        guard let data = Data(base64Encoded: base64) else {
            call.reject("Arquivo inválido", "INVALID_ARGUMENT")
            return
        }
        do {
            let dir = try packDirectory(identifier)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: dir.appendingPathComponent(name), options: .atomic)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription, "WRITE_FAILED", error)
        }
    }

    @objc func addPack(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier"), Self.isSafe(identifier),
              let name = call.getString("name"),
              let stickers = call.getArray("stickers") as? [[String: Any]] else {
            call.reject("Pacote inválido", "INVALID_PACK")
            return
        }
        let publisher = call.getString("publisher") ?? ""
        let animated = call.getBool("animated") ?? false

        do {
            let dir = try packDirectory(identifier)
            let tray = try Data(contentsOf: dir.appendingPathComponent("tray.png"))
            var items: [[String: Any]] = []
            for sticker in stickers {
                guard let file = sticker["file"] as? String, Self.isSafe(file) else {
                    call.reject("Nome de arquivo inválido", "INVALID_PACK")
                    return
                }
                let webp = try Data(contentsOf: dir.appendingPathComponent(file))
                items.append([
                    "image_data": webp.base64EncodedString(),
                    "emojis": (sticker["emojis"] as? [String]) ?? [],
                ])
            }

            var json: [String: Any] = [
                "identifier": identifier,
                "name": name,
                "publisher": publisher,
                "tray_image": tray.base64EncodedString(),
                "stickers": items,
                "ios_app_store_link": "",
                "android_play_store_link": "",
            ]
            if animated { json["animated_sticker_pack"] = true }
            let payload = try JSONSerialization.data(withJSONObject: json)

            DispatchQueue.main.async {
                guard UIApplication.shared.canOpenURL(Self.whatsAppURL) else {
                    call.reject("WhatsApp não está instalado", "WHATSAPP_NOT_INSTALLED")
                    return
                }
                UIPasteboard.general.setItems(
                    [[Self.pasteboardType: payload]],
                    options: [.localOnly: true, .expirationDate: Date(timeIntervalSinceNow: Self.pasteboardExpiration)]
                )
                UIApplication.shared.open(Self.stickerPackURL) { opened in
                    // O WhatsApp não devolve o resultado no iPhone: só sabemos que ele abriu.
                    if opened {
                        call.resolve(["status": "sent"])
                    } else {
                        call.reject("Não foi possível abrir o WhatsApp", "WHATSAPP_OUTDATED")
                    }
                }
            }
        } catch {
            call.reject(error.localizedDescription, "INVALID_PACK", error)
        }
    }

    /// O iPhone não tem a consulta "pacote já adicionado" que o Android tem.
    @objc func isPackAdded(_ call: CAPPluginCall) {
        call.resolve(["added": false, "whatsapp": false, "business": false, "supported": false])
    }
}

/// Registra o plugin local assim que o Capacitor carrega.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WhatsAppStickersPlugin())
    }
}
