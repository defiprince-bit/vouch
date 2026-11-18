// Vouch landing — story reveals + the meadow close. Ported from design/mocks/landing.js (v2).
// The hills are painted once per size into offscreen canvases (per-pixel: slope light,
// mottled grass, grain, aerial haze), then composited each frame with a few drawImage
// calls. In still mode (reduced motion, ?static=1, ?shot=1) only the final frame is drawn.
// Returns a cleanup that stops the RAF loop, observers, listeners and timers.

type RGB = [number, number, number];
type Layer = { c: HTMLCanvasElement; y0: number };
type Flower = { x: number; y: number; r: number; a: number; d: number };

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paper / ink / mint, far to near. Each ridge is [lit, shadow].
const PAL = {
  skyTop: '#F3EDE3',
  skyLow: '#FBF8F1',
  glow: 'rgba(255, 252, 244, 0.95)',
  fog: [243, 237, 227] as RGB,
  haze: hex('#E7E8DC'),
  ground: hex('#0E1A16'),
  hills: [
    ['#DCE4D3', '#C8D3C1'],
    ['#BFD2BC', '#A3BBA4'],
    ['#93B79F', '#729B84'],
    ['#5E9A7F', '#3F7A62'],
    ['#2F7A5E', '#1C5A44'],
    ['#17513F', '#0D3428'],
  ].map((p) => [hex(p[0]), hex(p[1])] as [RGB, RGB]),
};
// Shape per ridge: where its crest sits between hill top and ground (0–1), how tall
// the domes are, how many across, and how much it hazes and drifts in parallax.
const SPEC = [
  { at: 0.06, amp: 0.05, k: 4.2, seed: 1.3, haze: 0.42, par: 0.15 },
  { at: 0.2, amp: 0.07, k: 3.3, seed: 2.9, haze: 0.28, par: 0.28 },
  { at: 0.36, amp: 0.085, k: 2.7, seed: 4.1, haze: 0.16, par: 0.45 },
  { at: 0.52, amp: 0.1, k: 2.1, seed: 5.7, haze: 0.07, par: 0.65 },
  { at: 0.69, amp: 0.11, k: 1.6, seed: 7.2, haze: 0.02, par: 0.85 },
  { at: 0.86, amp: 0.12, k: 1.25, seed: 8.8, haze: 0, par: 1 },
];

// Value noise on a 256² lattice.
const NS = 256;
const lat = new Float32Array(NS * NS);
{
  let s = 1337;
  for (let i = 0; i < lat.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    lat[i] = s / 4294967296;
  }
}
function vn(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lat[y0 * NS + x0], b = lat[y0 * NS + x1], c = lat[y1 * NS + x0], d = lat[y1 * NS + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => { t = clamp(t); return 1 - Math.pow(1 - t, 3); };
const spring = (t: number) => (t <= 0 ? 0 : 1 - Math.exp(-6.5 * t) * (Math.cos(9 * t) + 0.72 * Math.sin(9 * t)));

function paintMist() {
  const w = 640, h = 110, cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  const g = cnv.getContext('2d')!, img = g.createImageData(w, h), px = img.data;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h, bell = Math.exp(-Math.pow((v - 0.55) / 0.24, 2));
    for (let x = 0; x < w; x++) {
      // Tile horizontally: blend the noise at x and x - w across the width.
      const a = vn((x / w) * 8, y * 0.06) * 0.65 + vn((x / w) * 16 + 40, y * 0.12) * 0.35;
      const b = vn(((x - w) / w) * 8, y * 0.06) * 0.65 + vn(((x - w) / w) * 16 + 40, y * 0.12) * 0.35;
      const f = x / w, n = a * (1 - f) + b * f;
      const al = clamp((n - 0.34) * 2.4) * bell;
      const o = (y * w + x) * 4;
      px[o] = 250; px[o + 1] = 248; px[o + 2] = 240; px[o + 3] = al * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cnv;
}


function setupHeroTilt(root: HTMLElement, STILL: boolean): () => void {
  const hero = root.querySelector<HTMLElement>('.vl-hero');
  const tilt = hero?.querySelector<HTMLElement>('.vl-ticket-tilt');
  if (!hero || !tilt || STILL) return () => {};
  if (!window.matchMedia('(pointer: fine)').matches) return () => {};
  const max = 6;
  const onMove = (e: PointerEvent) => {
    const r = hero.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    tilt.style.setProperty('--vl-ry', `${(px * max).toFixed(2)}deg`);
    tilt.style.setProperty('--vl-rx', `${(-py * max).toFixed(2)}deg`);
    hero.classList.add('is-hovering');
  };
  const onLeave = () => {
    tilt.style.setProperty('--vl-ry', '0deg');
    tilt.style.setProperty('--vl-rx', '0deg');
    hero.classList.remove('is-hovering');
  };
  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', onLeave);
  return () => {
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    hero.classList.remove('is-hovering');
    tilt.style.removeProperty('--vl-rx');
    tilt.style.removeProperty('--vl-ry');
  };
}

export function startLanding(root: HTMLElement, STILL: boolean): () => void {
  const cleanups: Array<() => void> = [];
  let disposed = false;

  // Stagger indices for the headline words and footer items.
  root.querySelectorAll<HTMLElement>('.vl-close-h .vl-w > span').forEach((s, i) => s.style.setProperty('--i', String(i < 3 ? i : i + 2)));
  root.querySelectorAll<HTMLElement>('.vl-foot-links a, .vl-foot-base, .vl-foot-brand p').forEach((s, i) => s.style.setProperty('--i', String(i)));

  // Section reveals live in landing-reveal.ts so they can run before this chunk loads.
  cleanups.push(setupHeroTilt(root, STILL));

  const stop = () => { disposed = true; cleanups.forEach((f) => f()); };

  // ——— Meadow ———
  const sec = root.querySelector<HTMLElement>('.vl-meadow');
  const cv = sec?.querySelector('canvas');
  const ctx = cv?.getContext('2d');
  if (!sec || !cv || !ctx) return stop;
  const hs = sec.querySelector<HTMLElement>('.vl-hillspace')!;
  const ft = sec.querySelector<HTMLElement>('.vl-foot')!;

  let W = 0, H = 0, DPR = 1, hillTop = 0, groundTop = 0, span = 0, PAD = 0;
  let layers: Layer[] = [];
  let mist: HTMLCanvasElement | null = null;
  let flowers: Flower[] = [];

  function crest(i: number, x: number) {
    const s = SPEC[i], u = (x / W) * Math.PI * 2 * s.k * Math.max(0.42, Math.min(1, W / 1440));
    let v = 0.55 * Math.sin(u + s.seed) + 0.3 * Math.sin(u * 1.9 + s.seed * 2.3) + 0.15 * Math.sin(u * 3.7 + s.seed * 0.7);
    v += (vn((x / W) * 6 + s.seed * 10, s.seed * 7) - 0.5) * 0.5;
    // Domes: soften troughs, round the tops.
    v = v * (0.8 + 0.28 * v); // smooth (C1) so slope light has no seams
    return hillTop + span * s.at - v * span * s.amp;
  }

  function paintRidge(i: number): Layer {
    const s = SPEC[i], lit = PAL.hills[i][0], sh = PAL.hills[i][1], hz = PAL.haze, gr = PAL.ground;
    const w = Math.ceil((W + PAD * 2) * DPR);
    const cys = new Float32Array(w + 2);
    let minY = 1e9;
    for (let c = -1; c <= w; c++) { const y = crest(i, (c + 0.5) / DPR - PAD); cys[c + 1] = y; if (y < minY) minY = y; }
    const y0 = Math.floor(minY) - 2, bottom = H + 60, h = Math.ceil((bottom - y0) * DPR);
    const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
    const g = cnv.getContext('2d')!, img = g.createImageData(w, h), px = img.data;
    const near = i === SPEC.length - 1, depthPx = near ? groundTop + 26 - (hillTop + span * s.at) : span * 0.35;
    const grainAmp = 0.03 + 0.05 * (i / 5), patchAmp = 0.06 + 0.06 * (i / 5);
    for (let c = 0; c < w; c++) {
      const cy = (cys[c + 1] - y0) * DPR, m = ((cys[c + 2] - cys[c]) * DPR) / 2;
      const litF = clamp(0.62 - m * 1.5);
      const X = c / DPR - PAD;
      const start = Math.max(0, Math.floor(cy) - 1);
      for (let r = start; r < h; r++) {
        const dd = r + 0.5 - cy; if (dd <= -0.5) continue;
        const cov = dd >= 0.5 ? 1 : dd + 0.5;
        const d = dd / DPR; // css px below crest
        const t = clamp(d / depthPx);
        let shade = litF + (0.42 - litF) * (1 - Math.exp(-d / 34));
        shade *= 1 - 0.38 * t;
        let R = sh[0] + (lit[0] - sh[0]) * shade, G = sh[1] + (lit[1] - sh[1]) * shade, B = sh[2] + (lit[2] - sh[2]) * shade;
        const Y = r / DPR + y0;
        const patch = vn(X * 0.02 + i * 31, Y * 0.035) - 0.5;
        const clump = vn(X * 0.16 + i * 17, d * 0.5 + i * 9) - 0.5;
        let hsh = Math.imul(c + 7919, 374761393) ^ Math.imul(r + 104729, 668265263);
        hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
        const grain = ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296 - 0.5;
        const tex = 1 + patch * patchAmp + clump * patchAmp * 0.6 + grain * grainAmp;
        R *= tex; G *= tex; B *= tex;
        // Aerial haze, plus a thin bright rim of mist on each crest.
        const hzA = clamp(s.haze + 0.22 * Math.exp(-d / 7) * (1 - i / 7) + 0.12 * (1 - i / 5) * t);
        R += (hz[0] - R) * hzA; G += (hz[1] - G) * hzA; B += (hz[2] - B) * hzA;
        if (near) {
          let gt = clamp((d - depthPx * 0.25) / (depthPx * 0.75));
          gt = gt * gt * (3 - 2 * gt);
          R += (gr[0] - R) * gt; G += (gr[1] - G) * gt; B += (gr[2] - B) * gt;
        }
        const o = (r * w + c) * 4;
        px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = cov * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { c: cnv, y0 };
  }

  // Wildflowers sketched faintly into the ground behind the footer.
  function seedFlowers() {
    flowers = [];
    let s = 99;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const n = Math.round(W / 70);
    for (let i = 0; i < n; i++) flowers.push({ x: rnd() * W, y: groundTop + 10 + rnd() * (H - groundTop - 20), r: 2.5 + rnd() * 3.5, a: rnd() * 6.28, d: rnd() * 0.8 });
  }

  function layout() {
    const rect = sec!.getBoundingClientRect();
    W = Math.round(rect.width); H = Math.round(sec!.offsetHeight);
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    hillTop = hs.offsetTop + (W < 700 ? 28 : 36);
    groundTop = ft.offsetTop + 8;
    span = groundTop - hillTop;
    PAD = 40;
    cv!.width = Math.round(W * DPR); cv!.height = Math.round(H * DPR);
    layers = SPEC.map((_, i) => paintRidge(i));
    if (!mist) mist = paintMist();
    seedFlowers();
  }

  // Timeline
  let t0 = 0, entered = STILL, px = 0, py = 0, tx = 0, ty = 0, settle = STILL ? 1 : 0;

  function frame(now: number) {
    const c = ctx!;
    const T = STILL ? 99 : entered ? (now - t0) / 1000 : 0;
    const time = STILL ? 0 : now / 1000;
    if (!STILL) {
      px += (tx - px) * 0.06; py += (ty - py) * 0.06;
      const r = sec!.getBoundingClientRect(), vh = window.innerHeight;
      // 0 when the meadow's top meets the bottom of the screen, 1 once it is mostly in view.
      const target = clamp((vh - r.top) / Math.min(vh * 0.9, r.height));
      settle += (target - settle) * 0.12;
    }
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    // Sky + light that follows the pointer.
    const sky = c.createLinearGradient(0, 0, 0, hillTop + span * 0.3);
    sky.addColorStop(0, PAL.skyTop); sky.addColorStop(1, PAL.skyLow);
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    const gx = W * (0.5 + px * 0.18), gy = hillTop + span * 0.02 + py * 20, grad = Math.max(W, H) * 0.55;
    const glow = c.createRadialGradient(gx, gy, 0, gx, gy, grad);
    glow.addColorStop(0, PAL.glow); glow.addColorStop(0.35, 'rgba(255, 250, 236, 0.5)'); glow.addColorStop(1, 'rgba(255, 250, 236, 0)');
    c.fillStyle = glow; c.fillRect(0, 0, W, H);
    // Ground under everything.
    c.fillStyle = '#0E1A16'; c.fillRect(0, groundTop + 20, W, H);

    // Horizon: a pencil line drawn out from the centre, gone once the hills are up.
    const hp = ease(T / 0.7), p0 = spring(T - 0.45);
    if (hp > 0 && p0 < 1) {
      const hy = hillTop + span * SPEC[0].at + 2, hw = W * 0.5 * hp;
      c.globalAlpha = 0.35 * (1 - clamp(p0)); c.fillStyle = '#14211C';
      c.fillRect(W / 2 - hw, hy, hw * 2, 1);
      c.globalAlpha = 1;
    }
    for (let i = 0; i < layers.length; i++) {
      const s = SPEC[i], p = spring(T - 0.45 - i * 0.13);
      const rise = (1 - p) * (span * (0.35 + i * 0.1));
      const drift = (1 - settle) * (12 + i * 14);
      const x = -PAD - px * s.par * 26 + Math.sin(time * 0.12 + i) * s.par * 2;
      const y = layers[i].y0 + rise + drift + py * s.par * 6;
      c.globalAlpha = clamp(p * 1.4);
      c.drawImage(layers[i].c, x, y, layers[i].c.width / DPR, layers[i].c.height / DPR);
      // Mist drifting between this ridge and the next.
      if (i < 4 && mist) {
        const mw = W * 0.9, mh = 46 + i * 10, my = hillTop + span * (s.at + 0.06) + rise + drift - mh * 0.55;
        const off = (((time * (6 + i * 3) + i * 170) % mw) + mw) % mw;
        c.globalAlpha = (0.42 - i * 0.08) * clamp(p);
        for (let k = -1; k < Math.ceil(W / mw) + 1; k++) c.drawImage(mist, k * mw + off - px * s.par * 34, my, mw, mh);
      }
    }
    c.globalAlpha = 1;
    // Wildflowers on the ground.
    const fa = 0.11 * ease((T - 2.1) / 1.2);
    if (fa > 0) {
      c.strokeStyle = 'rgba(10, 193, 142, 1)'; c.lineWidth = 1;
      for (const fl of flowers) {
        let a = fa * clamp(((T - 2.1) / 1.2) * 2 - fl.d);
        if (STILL) a = 0.11;
        c.globalAlpha = a;
        c.beginPath();
        for (let pe = 0; pe < 5; pe++) {
          const an = fl.a + pe * 1.2566;
          c.moveTo(fl.x + Math.cos(an) * fl.r * 1.6 + fl.r * 0.7, fl.y + Math.sin(an) * fl.r * 1.6);
          c.arc(fl.x + Math.cos(an) * fl.r * 1.6, fl.y + Math.sin(an) * fl.r * 1.6, fl.r * 0.7, 0, 6.283);
        }
        c.moveTo(fl.x, fl.y + fl.r); c.lineTo(fl.x - fl.r * 0.4, fl.y + fl.r * 4);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    // Fog lifts off the hills.
    const fog = 1 - ease((T - 0.2) / 1.6);
    if (fog > 0) {
      const fg = c.createLinearGradient(0, hillTop - 60, 0, H);
      const f = PAL.fog;
      fg.addColorStop(0, `rgba(${f},0)`); fg.addColorStop(0.15, `rgba(${f},${fog})`); fg.addColorStop(0.8, `rgba(${f},${fog * 0.92})`); fg.addColorStop(1, `rgba(${f},${fog * 0.15})`);
      c.fillStyle = fg; c.fillRect(0, hillTop - 60, W, H);
    }
  }

  let running = false, visible = false, raf = 0;
  const loop = (now: number) => {
    if (disposed) return;
    frame(now);
    if (visible) raf = requestAnimationFrame(loop); else running = false;
  };
  const kick = () => { if (!running && !STILL && !disposed) { running = true; raf = requestAnimationFrame(loop); } };
  cleanups.push(() => cancelAnimationFrame(raf));

  layout();
  if (STILL) {
    sec.classList.add('is-in');
    frame(0);
  } else {
    frame(performance.now());
    const mio = new IntersectionObserver((es) => {
      es.forEach((e) => {
        visible = e.isIntersecting;
        if (e.intersectionRatio > 0.15 && !entered) { entered = true; t0 = performance.now(); sec.classList.add('is-in'); }
        if (visible) kick();
      });
    }, { threshold: [0, 0.15, 0.3] });
    mio.observe(sec);
    const onMove = (e: PointerEvent) => {
      const r = sec.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1; ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => { tx = 0; ty = 0; };
    sec.addEventListener('pointermove', onMove);
    sec.addEventListener('pointerleave', onLeave);
    cleanups.push(() => {
      mio.disconnect();
      sec.removeEventListener('pointermove', onMove);
      sec.removeEventListener('pointerleave', onLeave);
    });
  }
  let rt: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!disposed) { layout(); frame(performance.now()); } }, 120);
  };
  window.addEventListener('resize', onResize);
  cleanups.push(() => { window.removeEventListener('resize', onResize); clearTimeout(rt); });
  document.fonts?.ready.then(() => { if (!disposed) { layout(); frame(STILL ? 0 : performance.now()); } });

  return stop;
}
