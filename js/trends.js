// Skybee — "Trends": the trending topics are alive. Once a minute the list is asked again; a topic that moved glides to its new place
// on a spring (the rows swap places), a new one pops in, one that left folds away. FLIP: measure, reorder, play from the old place.
import { calmMotion } from "./ui.js";

/* box: the element holding the chips; load(): Promise<[topic…]>; chipHtml(topic): the markup of one chip (an element with data-t set here) */
export function liveTrends(box, load, chipHtml, every = 60000) {
  const make = (t) => {
    const w = document.createElement("div"); w.innerHTML = chipHtml(t).trim();
    const el = w.firstElementChild; el.dataset.t = t.topic; return el;
  };
  [...box.children].forEach((c, i) => { c.dataset.t = c.textContent.trim(); });
  const timer = setInterval(async () => {
    if (!box.isConnected) { clearInterval(timer); return; }
    if (document.hidden) return;
    let topics; try { topics = (await load()).slice(0, 12); } catch { return; }
    if (!topics?.length || !box.isConnected) return;
    const old = new Map([...box.children].map(c => [c.dataset.t, c]));
    const same = topics.length === old.size && topics.every((t, i) => box.children[i]?.dataset.t === t.topic);
    if (same) return;
    const first = new Map([...old].map(([k, c]) => [k, c.getBoundingClientRect()]));
    const fresh = [];
    const nodes = topics.map(t => old.get(t.topic) || (fresh.push(t.topic), make(t)));
    box.replaceChildren(...nodes);
    if (calmMotion()) return;
    nodes.forEach((el) => {
      const was = first.get(el.dataset.t);
      if (!was) { el.animate([{ transform: "scale(.5)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 480, easing: "cubic-bezier(.34,1.56,.64,1)" }); return; }
      const now = el.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 560, easing: "cubic-bezier(.3,1.35,.5,1)" }); // lands with a little overshoot
    });
  }, every);
}
