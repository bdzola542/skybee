// Skybee — "Letter limit" for every text field that has a length limit (name, bio, list and starter pack names, ALT text …).
// A field with maxlength loses the attribute (the browser would just refuse the letters) and gets the ring counter instead:
// letters past the limit fall out of the field and pile up, the ring turns gold near the limit and red at it.
// The post editor and the chat bar have their own place for it and are left alone.
import { letterLimit } from "./letterlimit.js";

const SKIP = "input[type=password],input[type=url],input[type=email],input[type=search],input[type=number],input[type=file],input[type=color]";
const live = new Set();
const graphemes = (s) => { try { return [...new Intl.Segmenter().segment(s)].length; } catch { return [...s].length; } };

function enhance(f) {
  if (f._ll || !(f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement)) return;
  const limit = +f.getAttribute("maxlength");
  if (!limit || limit < 30 || limit > 2000) return; // tiny limits (a pronoun) and huge ones are fine as they are
  if (f.closest(".composer, .chatbar, .searchbar, .loginform") || f.matches(SKIP) || f.disabled || f.readOnly) return;
  f._ll = true;
  f.removeAttribute("maxlength");
  const box = document.createElement("div"); box.className = "fieldcount";
  const counter = document.createElement("span"); counter.className = "counter"; box.appendChild(counter);
  f.insertAdjacentElement("afterend", box);
  const lim = letterLimit(counter, f, { limit, floorOf: () => f.closest(".modal") || f });
  const refresh = () => lim.set(graphemes(f.value));
  f.addEventListener("input", () => { lim.cut(); refresh(); });
  refresh();
  live.add({ f, lim, box });
}

const scan = (root) => {
  if (root.nodeType !== 1) return;
  if (root.matches?.("input[maxlength],textarea[maxlength]")) enhance(root);
  root.querySelectorAll?.("input[maxlength],textarea[maxlength]").forEach(enhance);
};
let queued = false;
const soon = (nodes) => {
  nodes.forEach(scan);
  if (queued) return; queued = true;
  setTimeout(() => { // forget the fields that left the page (a closed window)
    queued = false;
    for (const x of live) if (!x.f.isConnected) { x.lim.destroy(); x.box.remove(); live.delete(x); }
  }, 600);
};
new MutationObserver((list) => soon(list.flatMap(m => [...m.addedNodes]))).observe(document.body, { childList: true, subtree: true });
scan(document.body);
