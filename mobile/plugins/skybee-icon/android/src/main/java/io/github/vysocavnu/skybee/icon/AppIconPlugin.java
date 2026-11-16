package io.github.vysocavnu.skybee.icon;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Pattern;
import org.json.JSONException;

// «Значок застосунку»: у маніфесті є activity-alias на кожен колір (CI), тут вмикається один, решта вимикаються.
// name = "gold" або hex без # ("4a8cff"); all — усі імена, що є в збірці.
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final Pattern OK = Pattern.compile("^(gold|[0-9a-f]{6})$");

    private static String alias(String name) {
        return ".Icon" + (name.equals("gold") ? "Gold" : "C" + name);
    }

    @PluginMethod
    public void change(PluginCall call) {
        String name = call.getString("name", "gold");
        if (name == null || !OK.matcher(name).matches()) { call.reject("bad icon name"); return; }
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            JSArray all = call.getArray("all");
            // спершу вмикаємо потрібний (щоб завжди був хоч один значок), потім вимикаємо решту
            pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + alias(name)), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            if (all != null) {
                for (int i = 0; i < all.length(); i++) {
                    String n = all.getString(i);
                    if (n == null || !OK.matcher(n).matches() || n.equals(name)) continue;
                    pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + alias(n)), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            }
            call.resolve();
        } catch (JSONException | RuntimeException e) {
            call.reject("icon change failed");
        }
    }
}
