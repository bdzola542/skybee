// Ready-made launcher icons for phones (Settings → Оформлення → Іконка): one per colour of ICON_COLORS in js/appicon.js.
// Usage (from CI, after `cap add`): node scripts/app-icons.mjs android | ios
//   android → mipmap-*/ic_icon_<hex>[_dim|_dark].png in mobile/android/app/src/main/res + activity-aliases in AndroidManifest.xml
//   ios     → AppIcon-<hex>.appiconset in mobile/ios/App/App/Assets.xcassets; prints the names for ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sharp = createRequire(root + "mobile/package.json")("sharp");
// js/appicon.js has no imports and no top-level DOM use, so it can be loaded as is
const src = readFileSync(root + "js/appicon.js", "utf8");
const { ICON_COLORS, ICON_BGS, beeSvg, iconName } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
// every colour on every tile (light, «Сутінки», dark); "" is gold. Android «gold» light stays the main icon (ic_launcher)
const variants = ICON_BGS.flatMap(bg => ["", ...ICON_COLORS].map(c => ({ c, bg, name: iconName(c, bg) })));
const names = variants.map(v => v.name).filter(n => n !== "gold");
const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
const mode = process.argv[2];

if (mode === "android") {
  const res = root + "mobile/android/app/src/main/res/";
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const v of variants) {
    if (v.name === "gold") continue;
    const svg = beeSvg(v.c, true, 112, v.bg);
    for (const [d, px] of Object.entries(dens)) {
      mkdirSync(res + "mipmap-" + d, { recursive: true });
      writeFileSync(`${res}mipmap-${d}/ic_icon_${v.name.replace("-", "_")}.png`, await png(svg, px));
    }
  }
  const mp = root + "mobile/android/app/src/main/AndroidManifest.xml";
  let m = readFileSync(mp, "utf8");
  // the launcher entry moves from MainActivity to the «gold» alias, so only one icon is ever on the home screen
  const launcher = /\s*<intent-filter>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>/;
  if (!launcher.test(m)) throw new Error("не знайдено LAUNCHER у AndroidManifest.xml");
  m = m.replace(launcher, "");
  const alias = (n, icon, round, on) => `
        <activity-alias android:name=".Icon${n}" android:targetActivity=".MainActivity" android:enabled="${on}" android:exported="true" android:icon="${icon}"${round ? ` android:roundIcon="${round}"` : ""} android:label="@string/app_name">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity-alias>`;
  const all = alias("Gold", "@mipmap/ic_launcher", "@mipmap/ic_launcher_round", "true") +
    names.map(n => alias("C" + n.replace("-", "_"), "@mipmap/ic_icon_" + n.replace("-", "_"), "", "false")).join("");
  if (!m.includes("</application>")) throw new Error("немає </application>");
  m = m.replace("</application>", all + "\n    </application>");
  writeFileSync(mp, m);
  console.log(`Android: ${names.length + 1} значків`);
} else if (mode === "ios") {
  const cat = root + "mobile/ios/App/App/Assets.xcassets/";
  const list = variants.filter(v => v.name !== "gold");
  for (const v of list) {
    const dir = `${cat}AppIcon-${v.name}.appiconset/`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + "icon.png", await sharp(Buffer.from(beeSvg(v.c, true, 0, v.bg))).resize(1024, 1024).flatten({ background: v.bg === "dim" ? "#161e27" : v.bg === "dark" ? "#0f1218" : "#ffffff" }).png().toBuffer()); // iOS: квадрат без прозорості, кути ріже система
    writeFileSync(dir + "Contents.json", JSON.stringify({ images: [{ filename: "icon.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }, null, 2));
  }
  console.log(list.map(v => "AppIcon-" + v.name).join(" "));
} else {
  console.error("Usage: node scripts/app-icons.mjs android|ios"); process.exit(1);
}
