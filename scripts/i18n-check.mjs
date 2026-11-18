// Checks a dictionary js/i18n/<code>.js against i18n/keys.json: missing keys, wrong {n} placeholders, leftover Cyrillic.
// Variants of Ukrainian/Rusyn (codes uk-*, rue-*) only hold lines that differ: there «missing» is normal; unknown keys are checked instead.
// Usage: node scripts/i18n-check.mjs <code>
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const root = fileURLToPath(new URL("..", import.meta.url));
const code = process.argv[2];
const en = JSON.parse(readFileSync(root + "i18n/keys.json", "utf8"));
const d = (await import(pathToFileURL(root + `js/i18n/${code}.js`).href)).default;
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
let miss = 0, bad = 0, cyr = 0, unk = 0;
const CYR = /[А-ЯЁЇІЄҐа-яїієґ]/;
const variant = /^(uk|rue)(-|$)/.test(code);
const cyrLang = variant || ["bg", "sr", "mk", "be"].includes(code);
for (const k of Object.keys(d)) if (!(k in en)) { unk++; if (unk <= 5) console.log("unknown key:", k); }
for (const k of Object.keys(en)) {
  if (!(k in d)) { if (!variant) { miss++; if (miss <= 5) console.log("missing:", k); } continue; }
  if (ph(k) !== ph(d[k])) { bad++; if (bad <= 5) console.log("placeholders:", k, "=>", d[k]); }
  if (!cyrLang && CYR.test(d[k])) { cyr++; if (cyr <= 5) console.log("cyrillic:", d[k]); }
}
console.log(`${code}: ${Object.keys(d).length} lines; missing ${miss}, unknown keys ${unk}, bad placeholders ${bad}, cyrillic ${cyr}`);
