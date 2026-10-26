(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pad = (n, l = 2) => String(n).padStart(l, "0");

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  if (reduce) document.documentElement.classList.add("reduce");

  /* =====================================================
     THE FIELD
     Thousands of "thoughts" drift around. Hold still and
     they snap into order. Move and they scatter. That's it.
     That's the whole product pitch.
     ===================================================== */
  const canvas = $("#field");
  const ctx = canvas.getContext("2d");
  const WORD = "STEALTH";

  let W = 0, H = 0, DPR = 1, N = 0;
  let px, py, vx, vy, tx, ty, acc, seed; // typed arrays
  const shapes = { word: null, grid: null, ring: null };
  let mode = "word";
  let focus = 0;
  let forceFocusUntil = 0;
  const ptr = { x: -9999, y: -9999, speed: 0, last: 0, down: false, inside: false };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildWord() {
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const c = off.getContext("2d", { willReadFrequently: true });
    let size = 400;
    c.font = `400 ${size}px "Instrument Serif", serif`;
    if ("letterSpacing" in c) c.letterSpacing = `${size * 0.03}px`;
    const mw = c.measureText(WORD).width;
    size = Math.min(size * (W * (W < 700 ? 0.9 : 0.8)) / mw, H * 0.46);
    c.font = `400 ${size}px "Instrument Serif", serif`;
    if ("letterSpacing" in c) c.letterSpacing = `${size * 0.03}px`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#fff";
    const cy = H * (W < 700 ? 0.4 : 0.47) + size * 0.3;
    c.fillText(WORD, W / 2, cy);
    const data = c.getImageData(0, 0, W, H).data;

    let covered = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 128) covered++;
    const step = Math.max(1.6, Math.sqrt((covered * 4) / N));
    const pts = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const jx = x + rand(-step * 0.4, step * 0.4);
        const jy = y + rand(-step * 0.4, step * 0.4);
        const xi = clamp(jx | 0, 0, W - 1), yi = clamp(jy | 0, 0, H - 1);
        if (data[(yi * W + xi) * 4 + 3] > 128) pts.push([jx, jy]);
      }
    }
    shuffle(pts);
    const out = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const p = pts[i % pts.length] || [W / 2, H / 2];
      const j = i >= pts.length ? 2.2 : 0;
      out[i * 2] = p[0] + rand(-j, j);
      out[i * 2 + 1] = p[1] + rand(-j, j);
    }
    return out;
  }

  function buildGrid() {
    const out = new Float32Array(N * 2);
    const cols = Math.ceil(Math.sqrt((N * W) / H));
    const rows = Math.ceil(N / cols);
    const sx = W / cols, sy = H / rows;
    const order = shuffle(Array.from({ length: N }, (_, i) => i));
    for (let k = 0; k < N; k++) {
      const i = order[k];
      out[i * 2] = (k % cols) * sx + sx / 2;
      out[i * 2 + 1] = ((k / cols) | 0) * sy + sy / 2;
    }
    return out;
  }

  function buildRing() {
    const out = new Float32Array(N * 2);
    const R = Math.min(W, H) * (W < 700 ? 0.36 : 0.4);
    const rings = [0.14, 0.4, 0.68, 1];
    const weight = rings.map((r) => r + 0.05);
    const total = weight.reduce((a, b) => a + b, 0);
    const order = shuffle(Array.from({ length: N }, (_, i) => i));
    let k = 0;
    rings.forEach((r, ri) => {
      const count = ri === rings.length - 1 ? N - k : Math.round((weight[ri] / total) * N);
      for (let n = 0; n < count && k < N; n++, k++) {
        const a = (n / count) * TAU + ri * 0.7;
        const i = order[k];
        out[i * 2] = W * (W < 700 ? 0.5 : 0.68) + Math.cos(a) * R * r;
        out[i * 2 + 1] = H * 0.5 + Math.sin(a) * R * r;
      }
    });
    return out;
  }

  function rebuildShapes() {
    shapes.word = buildWord();
    shapes.grid = buildGrid();
    shapes.ring = buildRing();
    applyShape();
  }

  function applyShape() {
    const s = shapes[mode];
    if (!s) return;
    for (let i = 0; i < N; i++) {
      tx[i] = s[i * 2];
      ty[i] = s[i * 2 + 1];
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const n = clamp(Math.round((W * H) / (W < 700 ? 520 : 640)), 1100, 3000);
    if (n !== N) {
      N = n;
      px = new Float32Array(N); py = new Float32Array(N);
      vx = new Float32Array(N); vy = new Float32Array(N);
      tx = new Float32Array(N); ty = new Float32Array(N);
      acc = new Uint8Array(N); seed = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        px[i] = rand(0, W); py[i] = rand(0, H);
        acc[i] = Math.random() < 0.15 ? 1 : 0;
        seed[i] = rand(0, TAU);
      }
    }
    rebuildShapes();
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    focus *= 0.25; // scatter a little, then re-form into the new shape
    applyShape();
    canvas.style.setProperty("--fo", m === "word" ? 1 : m === "ring" ? 0.85 : 0.3);
  }

  function pickMode() {
    const vh = innerHeight;
    const endTop = $("#end").getBoundingClientRect().top;
    const m = scrollY < vh * 0.5 ? "word" : endTop < vh * 0.55 ? "ring" : "grid";
    setMode(m);
  }

  let last = performance.now(), t = 0;
  const ringFg = $("#ringFg");
  const focusPct = $("#focusPct");
  const hint = $("#hint");
  let shownPct = -1;

  function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16.667);
    last = now;
    t = now / 1000;

    ptr.speed *= Math.pow(0.9, dt);
    const idle = now - ptr.last;
    const goal = reduce || now < forceFocusUntil ? 1 : ptr.down ? 0 : idle > 600 ? 1 : 0;
    focus += (goal - focus) * (goal > focus ? 0.022 : 0.14) * dt;
    focus = clamp(focus, 0, 1);
    const f = focus * focus * (3 - 2 * focus);

    const damp = Math.pow(lerp(0.965, 0.82, f), dt);
    const free = 1 - f;
    const R = 140, R2 = R * R;
    const mx = ptr.inside ? ptr.x : -9999, my = ptr.y;
    const push = 1.1 + Math.min(ptr.speed, 40) * 0.05;

    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    const aw = 0.5 + 0.45 * f; // brightness rises as order emerges
    const lw = 1.25;

    ctx.beginPath();
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        ctx.stroke();
        ctx.beginPath();
      }
      for (let i = 0; i < N; i++) {
        if (acc[i] !== pass) continue;
        let x = px[i], y = py[i], vxi = vx[i], vyi = vy[i];

        if (free > 0.01) {
          const a = Math.sin(x * 0.0021 + t * 0.35 + seed[i] * 0.05) * Math.cos(y * 0.0027 - t * 0.27) * TAU * 2;
          vxi += Math.cos(a) * 0.07 * free * dt;
          vyi += Math.sin(a) * 0.07 * free * dt;
          if (Math.random() < 0.0012 * free) { // a sudden distraction
            const d = rand(0, TAU), s = rand(2.5, 6);
            vxi += Math.cos(d) * s; vyi += Math.sin(d) * s;
          }
        }
        if (f > 0.001) {
          const sh = 0.7 * f;
          vxi += (tx[i] + Math.sin(t * 1.7 + seed[i]) * sh - x) * 0.04 * f * dt;
          vyi += (ty[i] + Math.cos(t * 1.4 + seed[i]) * sh - y) * 0.04 * f * dt;
        }
        const dx = x - mx, dy = y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2), k = (1 - d / R);
          const s = k * k * push;
          vxi += (dx / d) * s * dt; vyi += (dy / d) * s * dt;
        }

        vxi *= damp; vyi *= damp;
        x += vxi * dt; y += vyi * dt;
        if (x < -10) x = W + 10; else if (x > W + 10) x = -10;
        if (y < -10) y = H + 10; else if (y > H + 10) y = -10;
        px[i] = x; py[i] = y; vx[i] = vxi; vy[i] = vyi;

        ctx.moveTo(x - vxi * 1.6, y - vyi * 1.6);
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = pass ? lw * 1.15 : lw;
      ctx.strokeStyle = pass ? `rgba(255,106,43,${0.55 + 0.4 * f})` : `rgba(236,235,230,${aw})`;
    }
    ctx.stroke();

    // cursor + HUD readouts
    ringFg.style.strokeDashoffset = (113.1 * (1 - focus)).toFixed(1);
    const pct = Math.round(focus * 100);
    if (pct !== shownPct) {
      shownPct = pct;
      focusPct.textContent = pad(pct, 3);
    }
    if (mode === "word") {
      if (focus > 0.85) hint.classList.add("moved");
      else if (focus < 0.3) hint.classList.remove("moved");
    }

    requestAnimationFrame(frame);
  }

  /* ---------- pointer ---------- */
  function onMove(x, y) {
    const dx = x - ptr.x, dy = y - ptr.y;
    if (ptr.x > -9000) ptr.speed = Math.max(ptr.speed, Math.hypot(dx, dy));
    ptr.x = x; ptr.y = y; ptr.inside = true;
    if (Math.hypot(dx, dy) > 2.5) ptr.last = performance.now();
  }
  addEventListener("pointermove", (e) => {
    onMove(e.clientX, e.clientY);
    if (finePointer) {
      curX = e.clientX; curY = e.clientY;
      cur.style.transform = `translate(${curX}px, ${curY}px)`;
    }
  }, { passive: true });
  addEventListener("pointerdown", (e) => {
    ptr.down = true;
    onMove(e.clientX, e.clientY);
    ptr.last = performance.now();
    // shockwave
    for (let i = 0; i < N; i++) {
      const dx = px[i] - e.clientX, dy = py[i] - e.clientY;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 420) {
        const s = (1 - d / 420) * 14;
        vx[i] += (dx / d) * s; vy[i] += (dy / d) * s;
      }
    }
  });
  addEventListener("pointerup", (e) => {
    ptr.down = false;
    ptr.last = performance.now();
    if (e.pointerType !== "mouse") ptr.inside = false;
  });
  document.addEventListener("pointerleave", () => { ptr.inside = false; });

  /* ---------- custom cursor ---------- */
  const cur = $("#cur"), ring = $("#ring");
  let curX = -100, curY = -100, ringX = -100, ringY = -100;
  if (finePointer) {
    (function loop() {
      ringX = lerp(ringX, curX, 0.18);
      ringY = lerp(ringY, curY, 0.18);
      ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
      requestAnimationFrame(loop);
    })();
    document.addEventListener("pointerover", (e) => {
      ring.classList.toggle("hot", !!e.target.closest("a, .redact, .card, button"));
    });
  }

  /* ---------- scramble text ---------- */
  const GLYPHS = "▒░▓█<>/\\_-+=*#@%&01";
  function scramble(el) {
    const final = el.dataset.final || (el.dataset.final = el.textContent);
    if (reduce) return;
    let frameN = 0;
    const total = final.length * 2.2;
    const id = setInterval(() => {
      const done = Math.floor(frameN / 2.2);
      el.textContent = final.split("").map((ch, i) => (i < done || ch === " " ? ch : pick(GLYPHS))).join("");
      if (++frameN > total) { clearInterval(id); el.textContent = final; }
    }, 28);
  }

  /* ---------- reveal on scroll ---------- */
  $$(".label, .med, .huge, .stats, .term, .card, .coda, .foot").forEach((el) => el.classList.add("rv"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("in");
      if (en.target.matches("[data-scramble]")) scramble(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.2 });
  $$(".rv").forEach((el, i) => {
    el.style.transitionDelay = el.matches(".card") ? `${(i % 3) * 0.08}s` : "0s";
    io.observe(el);
  });

  /* ---------- word-by-word scrub ---------- */
  const scrubs = $$(".scrub").map((el) => {
    const words = [];
    (function walk(node) {
      [...node.childNodes].forEach((c) => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            const s = document.createElement("span");
            s.textContent = part;
            if (/\S/.test(part)) { s.className = "w"; words.push(s); }
            frag.appendChild(s);
          });
          c.replaceWith(frag);
        } else if (c.classList && c.classList.contains("redact")) {
          const s = document.createElement("span");
          s.className = "w";
          c.replaceWith(s);
          s.appendChild(c);
          words.push(s);
        } else if (c.nodeType === 1) walk(c);
      });
    })(el);
    return { el, words };
  });

  function scrub() {
    if (reduce) return;
    const vh = innerHeight;
    scrubs.forEach(({ el, words }) => {
      const r = el.getBoundingClientRect();
      const p = clamp((vh * 0.86 - r.top) / (r.height + vh * 0.22), 0, 1);
      const n = words.length;
      words.forEach((w, i) => {
        const o = clamp((p * 1.3 - i / n) * 6, 0, 1);
        w.style.opacity = (0.14 + 0.86 * o).toFixed(2);
      });
    });
  }

  /* ---------- redactions: tap to toggle on touch ---------- */
  $$(".redact").forEach((el) => {
    el.addEventListener("click", () => el.classList.toggle("open"));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.classList.toggle("open"); } });
  });

  /* ---------- card spotlight ---------- */
  $$(".card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  /* ---------- clock ---------- */
  const clock = $("#clock");
  const hhmmss = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  setInterval(() => { clock.textContent = hhmmss(); }, 1000);
  clock.textContent = hhmmss();

  /* ---------- the activity feed ---------- */
  const feed = $("#feed");
  const stats = $$("[data-count]").map((el) => ({ el, v: +el.dataset.count }));
  const templates = [
    ["inbox", () => `${randInt(90, 420)} unread → ${randInt(1, 4)} need you`],
    ["calendar", () => `moved “dentist” off your deep-work block`],
    ["reminder", () => `you said “I’ll do it later.” it’s later. done.`],
    ["receipts", () => `${randInt(6, 22)} filed. 0 lost. 1 found from March`],
    ["tabs", () => `${randInt(22, 61)} closed. ${randInt(2, 5)} saved. you’ll thank us`],
    ["laundry", () => `nudged you once. exactly once. gently`],
    ["bills", () => `paid before it got weird`],
    ["keys", () => `last seen: kitchen counter, under the mail`],
    ["meds", () => `reminded at the one moment you’d actually listen`],
    ["docs", () => `found “final_FINAL_v3_really.pdf” for you`],
    ["focus", () => `held ${randInt(2, 4)} notifications until you surface`],
    ["email", () => `drafted a reply. you can ignore it. no judgment`],
  ];
  const redLines = [
    ["▒▒▒▒▒▒", "▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒"],
    ["▒▒▒▒", "▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒"],
    ["▒▒▒▒▒▒▒▒", "▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒"],
  ];
  const MAX = 9;
  let feedTimer = null;

  function addLine(instant) {
    const li = document.createElement("li");
    const red = Math.random() < 0.14;
    const [k, msg] = red ? pick(redLines) : (() => { const x = pick(templates); return [x[0], x[1]()]; })();
    if (red) li.className = "red";
    li.innerHTML = `<span class="t">${hhmmss()}</span><span class="k">${k}</span><span class="m"></span>`;
    const m = $(".m", li);
    feed.appendChild(li);
    while (feed.children.length > MAX) feed.firstChild.remove();
    if (instant || reduce) { m.textContent = msg; return; }
    li.classList.add("type");
    let i = 0;
    const id = setInterval(() => {
      m.textContent = msg.slice(0, ++i);
      if (i >= msg.length) { clearInterval(id); li.classList.remove("type"); }
    }, 16);
    // numbers go up, because they should
    const s = pick(stats);
    s.v += randInt(1, 14);
    s.el.textContent = s.v.toLocaleString("en-US");
  }
  for (let i = 0; i < 6; i++) addLine(true);

  function runFeed() {
    if (feedTimer || reduce) return;
    const tick = () => { addLine(false); feedTimer = setTimeout(tick, rand(1300, 2800)); };
    feedTimer = setTimeout(tick, 600);
  }
  new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (e.isIntersecting) runFeed();
      else { clearTimeout(feedTimer); feedTimer = null; }
    });
  }, { threshold: 0.1 }).observe($(".term"));

  /* ---------- easter eggs ---------- */
  const toast = $("#toast");
  let toastTimer;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("on"), 2600);
  }
  let typed = "";
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-8);
    if (typed.endsWith("focus")) {
      forceFocusUntil = performance.now() + 8000;
      say("hyperfocus engaged · 8s");
    } else if (typed.endsWith("squirrel")) {
      forceFocusUntil = 0;
      ptr.last = performance.now();
      for (let i = 0; i < N; i++) { const a = rand(0, TAU), s = rand(4, 16); vx[i] += Math.cos(a) * s; vy[i] += Math.sin(a) * s; }
      say("squirrel!");
    }
  });
  console.log("%cSTEALTH", "font:italic 28px Georgia;color:#ff6a2b", "\nhold still. type “focus”. or “squirrel”.");

  /* ---------- boot ---------- */
  const boot = $("#boot"), bootNum = $("#bootNum"), bootLine = $("#bootLine");
  const lines = ["waking up…", "closing tabs…", "finding keys…", "ready."];
  function runBoot() {
    const start = performance.now(), dur = reduce ? 200 : 1600;
    (function tick(now) {
      const p = clamp((now - start) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      bootNum.textContent = pad(Math.round(e * 100), 3);
      bootLine.textContent = lines[Math.min(lines.length - 1, Math.floor(p * lines.length))];
      if (p < 1) return requestAnimationFrame(tick);
      setTimeout(() => {
        boot.classList.add("done");
        document.body.classList.remove("booting");
        ptr.last = performance.now() + 900; // chaos first, order after
      }, 250);
    })(start);
  }

  /* ---------- go ---------- */
  function start() {
    resize();
    ptr.last = performance.now() + 60000; // held until boot completes
    pickMode();
    scrub();
    requestAnimationFrame(frame);
    runBoot();
  }
  addEventListener("resize", () => { resize(); scrub(); }, { passive: true });
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { pickMode(); scrub(); ticking = false; });
  }, { passive: true });

  const fontsReady = document.fonts && document.fonts.load
    ? Promise.race([
        Promise.all([document.fonts.load('400 120px "Instrument Serif"'), document.fonts.load('400 12px "JetBrains Mono"')]),
        new Promise((r) => setTimeout(r, 2500)),
      ])
    : Promise.resolve();
  fontsReady.then(start);
})();
