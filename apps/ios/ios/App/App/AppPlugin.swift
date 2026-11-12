import Capacitor
import UIKit
import UserNotifications

// The web app's way into the iPhone app, for what Capacitor's plugins don't cover
// (plan 12). The web app calls it as `PrPeek` (native.ts).
@objc(PrPeekPlugin)
public class PrPeekPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrPeekPlugin"
    public let jsName = "PrPeek"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "build", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
    ]

    // Whether this is an Xcode build. Only Apple's sandbox push service reaches those.
    // TestFlight and App Store builds use the main one.
    @objc func build(_ call: CAPPluginCall) {
        #if DEBUG
        call.resolve(["sandbox": true])
        #else
        call.resolve(["sandbox": false])
        #endif
    }

    // The count on the app's icon. 0 clears it.
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(count) { _ in call.resolve() }
        } else {
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }
}

// Capacitor's view controller, with the app's own plugin added.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrPeekPlugin())
    }
}
