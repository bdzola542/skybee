// Перевіряє data/stars.json перед тим, як він потрапить на сайт: гілка stars-data не захищена правилом,
// тож hosting.yml (і stars.yml перед пушем) не довіряє файлу сліпо. Код виходу 0 — файл придатний.
// Запуск: node scripts/stars-check.mjs <шлях до stars.json>
import { readFileSync, statSync } from "node:fs";

const file = process.argv[2];
const fail = (why) => { console.error(`stars.json: ${why}`); process.exit(1); };
if (!file) fail("не вказано файл");
if (statSync(file).size > 3_000_000) fail("завеликий (> 3 МБ)");
let d; try { d = JSON.parse(readFileSync(file, "utf8")); } catch { fail("не JSON"); }
const a = d?.artists;
if (!Array.isArray(a) || a.length < 100 || a.length > 20000) fail(`дивна кількість виконавців (${a?.length})`);
const STATUS = new Set(["za", "proty", "movchat", "spirno", "none"]);
const str = (s, max) => typeof s === "string" && s.length <= max;
for (const [i, e] of a.entries()) {
  if (!Array.isArray(e)) fail(`запис ${i} не масив`);
  const [slug, status, names, excerpt, points] = e;
  if (!str(slug, 120) || !/^[a-z0-9-]+$/.test(slug)) fail(`запис ${i}: адреса сторінки`);
  if (!STATUS.has(status)) fail(`запис ${i}: позиція`);
  if (!Array.isArray(names) || names.length > 10 || !names.every(n => str(n, 200))) fail(`запис ${i}: імена`);
  if (excerpt != null && !str(excerpt, 500)) fail(`запис ${i}: уривок`);
  if (points != null && (!Array.isArray(points) || points.length > 10 || !points.every(p => str(p, 300)))) fail(`запис ${i}: пункти`);
}
console.log(`stars.json: ${a.length} виконавців, формат правильний`);
