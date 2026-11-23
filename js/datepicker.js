// Skybee — a date asked with drum wheels (day · month · year), for the search filters «Від дати» / «До дати».
// Resolves with "YYYY-MM-DD", "" (cleared) or null (cancelled).
import { modal } from "./ui.js";
import { locale, t } from "./i18n.js";
import { wheelPicker } from "./wheelpicker.js";

const pad = (n) => String(n).padStart(2, "0");

export function pickDate(current = "", title = "Обери дату") {
  return new Promise((res) => {
    const now = new Date(), y0 = 2023; // Bluesky started in 2023
    const m0 = /^(\d{4})-(\d{2})-(\d{2})/.exec(current);
    let value = { day: String(m0 ? +m0[3] : now.getDate()), month: String(m0 ? +m0[2] - 1 : now.getMonth()), year: String(m0 ? Math.min(Math.max(+m0[1], y0), now.getFullYear()) : now.getFullYear()) };
    const columns = [
      { id: "day", label: t("День"), loop: true, width: "64px", options: Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })) },
      { id: "month", label: t("Місяць"), loop: true, width: "132px", options: Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: new Date(2000, i, 1).toLocaleDateString(locale, { month: "long" }) })) },
      { id: "year", label: t("Рік"), width: "84px", options: Array.from({ length: now.getFullYear() - y0 + 1 }, (_, i) => ({ value: String(y0 + i), label: String(y0 + i) })) },
    ];
    const asDate = () => { // a day that does not exist (31 February) steps back to the last day of the month
      const y = +value.year, m = +value.month, last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(+value.day, last));
    };
    let wp = null, done = false; const fin = (x) => { if (!done) { done = true; res(x); } };
    const m = modal(`<h3>${title}</h3><div data-wheel></div><p class="small noi18n" data-sum style="text-align:center;margin:8px 0"></p>
      <div class="row between"><button class="ghost" data-x="no">Скасувати</button><span class="row" style="gap:6px"><button class="ghost" data-x="clear">Скинути</button><button class="btn" data-x="ok">Готово</button></span></div>`, { onClose: () => { wp?.destroy(); fin(null); } });
    const sum = () => { m.querySelector("[data-sum]").textContent = asDate().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
    wp = wheelPicker(m.querySelector("[data-wheel]"), { columns, value, label: title, onChange: (v) => { value = v; sum(); } });
    sum();
    m.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
      if (x === "ok") { const d = asDate(); fin(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); }
      else if (x === "clear") fin("");
      m.close();
    });
  });
}
