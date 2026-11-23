// Skybee — "Parallax ticket": a card with two faces that tilts toward the pointer (14°) and flips on a spring (170/15, with a little
// overshoot). Used for the share window: the QR code on one face, the link on the other.
import { spring, step, rest, clamp } from "./spring.js";

const TILT = 14, DEPTH = 12, FLIP = [170, 15], FOLLOW = [300, 20];

/* host: the element that becomes the ticket (it holds .tk-front and .tk-back); returns { flip() } */
export function ticket(host) {
  host.classList.add("tk");
  const inner = document.createElement("div"); inner.className = "tk-in";
  while (host.firstChild) inner.appendChild(host.firstChild);
  host.appendChild(inner);
  const front = inner.querySelector(".tk-front"), back = inner.querySelector(".tk-back");
  const R = spring(0, FLIP), TX = spring(0, FOLLOW), TY = spring(0, FOLLOW);
  let flipped = false, raf = 0, last = 0;
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { step(R, dt / 4); step(TX, dt / 4); step(TY, dt / 4); }
    inner.style.transform = `rotateX(${TX.x.toFixed(2)}deg) rotateY(${(R.x + TY.x).toFixed(2)}deg)`;
    // the layer in front moves a little more than the card: depth
    const d = (flipped ? back : front); if (d) d.style.setProperty("--tkx", `${(TY.x / TILT * DEPTH).toFixed(1)}px`), d.style.setProperty("--tky", `${(-TX.x / TILT * DEPTH).toFixed(1)}px`);
    raf = !rest(R) || !rest(TX) || !rest(TY) ? requestAnimationFrame(frame) : 0;
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  host.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect();
    TY.t = clamp(((e.clientX - r.left) / r.width - .5) * 2, -1, 1) * TILT; TX.t = clamp(-((e.clientY - r.top) / r.height - .5) * 2, -1, 1) * TILT; wake();
  });
  host.addEventListener("pointerleave", () => { TX.t = 0; TY.t = 0; wake(); });
  const flip = () => { flipped = !flipped; R.t = flipped ? 180 : 0; front.setAttribute("aria-hidden", flipped); back.setAttribute("aria-hidden", !flipped); wake(); };
  host.addEventListener("click", (e) => { if (e.target.closest("button, a, input")) return; flip(); });
  back.setAttribute("aria-hidden", "true");
  wake();
  return { flip };
}
