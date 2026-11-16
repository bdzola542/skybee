import Foundation
import Capacitor
import UIKit

// «Значок застосунку»: name = "gold" (основний) або hex без # (наприклад "4a8cff") → альтернативна іконка AppIcon-<hex>
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "change", returnType: CAPPluginReturnPromise)
    ]

    @objc func change(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "gold"
        guard name == "gold" || name.range(of: "^[0-9a-f]{6}$", options: .regularExpression) != nil else {
            call.reject("bad icon name")
            return
        }
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else { call.resolve(); return }
            let target: String? = name == "gold" ? nil : "AppIcon-" + name
            if UIApplication.shared.alternateIconName == target { call.resolve(); return }
            UIApplication.shared.setAlternateIconName(target) { error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        }
    }
}
