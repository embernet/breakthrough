/*
 * Breakthrough client: canvas rendering, effects, input, sound and UI.
 * All game rules live in engine.js (window.BreakthroughEngine).
 */
(function () {
  'use strict';
  const E = window.BreakthroughEngine;
  const COLS = E.COLS, ROWS = E.ROWS;
  const $ = (id) => document.getElementById(id);
  const PLAYER = document.body.dataset.displayName || 'Player';

  const PIECE_COLORS = {
    I: '#22b8cf', J: '#4c6ef5', L: '#be4bdb', O: '#20c997', S: '#82c91e', T: '#7950f2', Z: '#339af0',
  };

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('breakthrough.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('breakthrough.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------------------------------------------------------------- theme
  let theme;
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    theme = {
      well: v('--well'), grid: v('--well-grid'), text: v('--well-text'),
      amber: v('--problem-amber'), red: v('--problem-red'), perfect: v('--perfect'),
    };
    spriteCache.clear();
  }

  // ---------------------------------------------------------------- colour helpers
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
  }
  function shade(hex, amt) { return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt); }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  // ---------------------------------------------------------------- canvas setup
  const wrap = $('well-wrap');
  const well = $('well');
  const ctx = well.getContext('2d');
  let cell = 28, dpr = 1, W = 280, H = 560;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = wrap.getBoundingClientRect();
    cell = Math.max(10, Math.floor(Math.min(rect.width / COLS, rect.height / ROWS)));
    W = rect.width; H = rect.height;
    well.width = Math.round(W * dpr);
    well.height = Math.round(H * dpr);
    spriteCache.clear();
    drawSide(true);
  }
  // offset so the board is centred in the wrapper if it doesn't divide evenly
  const ox = () => Math.floor((W - cell * COLS) / 2);
  const oy = () => Math.floor((H - cell * ROWS) / 2);

  // Pre-rendered block sprites, keyed by colour+size (fast + crisp).
  const spriteCache = new Map();
  function sprite(color, size, style) {
    const key = color + '|' + size + '|' + style + '|' + dpr;
    let c = spriteCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const px = Math.round(size * dpr);
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const pad = Math.max(1, size * 0.05), r = size * 0.2, s = size - pad * 2;
    const grad = g.createLinearGradient(0, pad, 0, pad + s);
    if (style === 'problem') {
      grad.addColorStop(0, shade(color, 0.12));
      grad.addColorStop(1, shade(color, -0.18));
    } else {
      grad.addColorStop(0, shade(color, 0.28));
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, shade(color, -0.22));
    }
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(pad, pad, s, s, r); g.fill();
    // top gloss
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.roundRect(pad + s * 0.12, pad + s * 0.08, s * 0.76, s * 0.18, s * 0.09); g.fill();
    // edge
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = Math.max(1, size * 0.04);
    g.beginPath(); g.roundRect(pad, pad, s, s, r); g.stroke();
    if (style === 'problem') {
      // hatching: problems look like problems
      g.save();
      g.beginPath(); g.roundRect(pad, pad, s, s, r); g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = Math.max(1, size * 0.07);
      for (let i = -size; i < size * 2; i += size * 0.32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + size, size); g.stroke(); }
      g.restore();
    }
    spriteCache.set(key, c);
    return c;
  }
  function drawBlock(g, x, y, size, color, style) {
    g.drawImage(sprite(color, size, style || 'solution'), x, y, size, size);
  }

  // Problem colour gets hotter (amber -> red) the higher the row sits.
  function problemColor(y) {
    const t = Math.min(1, Math.max(0, (ROWS - 1 - y) / (ROWS * 0.55)));
    const step = Math.round(t * 5) / 5;
    return { color: mix(theme.amber, theme.red, step), hot: step >= 0.6 };
  }

  // ---------------------------------------------------------------- state
  let content = null; // the active mode: {id, name, solutionNoun, problems, solutions, ...}
  let game = null;
  let mode = 'loading'; // start | play | pause | over
  let myBest = null;
  let lastFrame = 0;
  const fx = { particles: [], flashes: [], popups: [], rings: [], trails: [], shake: 0, rise: 0, lockGlow: [] };

  // ---------------------------------------------------------------- sound (off by default)
  const sound = {
    on: store.get('sound', false) === true,
    ctx: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    blip(freq, dur = 0.08, type = 'square', vol = 0.05, when = 0, slide = 0) {
      if (!this.on) return;
      const ac = this.ensure();
      if (!ac) return;
      const t = ac.currentTime + when;
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    arp(notes, step = 0.06, type = 'triangle', vol = 0.06) { notes.forEach((f, i) => this.blip(f, 0.14, type, vol, i * step)); },
  };
  function setSound(on) {
    sound.on = on;
    store.set('sound', on);
    const b = $('btn-sound');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Sound on' : 'Sound off';
    if (on) sound.blip(660, 0.06, 'triangle', 0.05);
  }

  // ---------------------------------------------------------------- effects
  function rand(a, b) { return a + Math.random() * (b - a); }
  function burst(cx, cy, color, n, power, opts = {}) {
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(0.3, 1) * power;
      fx.particles.push({
        x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - power * (opts.lift || 0.4),
        size: rand(0.12, opts.big ? 0.42 : 0.28) * cell, rot: rand(0, 6.28), vr: rand(-10, 10),
        life: rand(0.55, 1.1) * (opts.long ? 1.5 : 1), age: 0, color, spark: !!opts.spark,
      });
    }
  }
  function popup(text, x, y, color, big) {
    fx.popups.push({ text, x, y, color, age: 0, life: 1.1, big: !!big });
  }
  function banner(text, cls) {
    const b = $('banner');
    b.hidden = true;
    b.className = 'banner ' + (cls || '');
    b.textContent = text;
    void b.offsetWidth; // restart animation
    b.hidden = false;
  }
  function toast(html, cls, life = 3.2) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + (cls || '');
    t.style.setProperty('--life', life + 's');
    t.innerHTML = html;
    box.prepend(t);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => t.remove(), (life + 0.5) * 1000);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------- events from the engine
  function handleEvents() {
    const evs = E.drainEvents(game);
    const breaks = [];
    for (const ev of evs) {
      switch (ev.type) {
        case 'move': sound.blip(220, 0.025, 'square', 0.015); break;
        case 'rotate': sound.blip(ev.kicked ? 520 : 440, 0.035, 'square', 0.02); break;
        case 'hold': sound.blip(330, 0.07, 'triangle', 0.04, 0, 1.5); drawSide(true); break;
        case 'spawn': drawSide(true); break;
        case 'hardDrop': {
          fx.shake = Math.max(fx.shake, 2 + Math.min(4, ev.distance / 5));
          for (const [x, y] of ev.cells) fx.trails.push({ x, y, len: ev.distance, age: 0, life: 0.22, color: PIECE_COLORS[ev.pieceType] });
          sound.blip(140, 0.09, 'sine', 0.08, 0, 0.5);
          break;
        }
        case 'lock':
          for (const [x, y] of ev.cells) fx.lockGlow.push({ x, y, age: 0, life: 0.18 });
          sound.blip(110, 0.06, 'triangle', 0.05);
          break;
        case 'clear': {
          for (const row of ev.rows) {
            const problem = !!row.problem;
            fx.flashes.push({ y: row.y, age: 0, life: problem ? 0.35 : 0.22, problem });
            row.cells.forEach((c, x) => {
              if (!c) return;
              const color = c.kind === 'problem' ? problemColor(row.y).color : PIECE_COLORS[c.type];
              burst(ox() + (x + 0.5) * cell, oy() + (row.y + 0.5) * cell, color, problem ? 6 : 2, cell * (problem ? 9 : 5), { big: problem });
            });
          }
          if (ev.points) {
            const y = Math.min(...ev.rows.map((r) => r.y));
            popup('+' + ev.points.toLocaleString(), ox() + (COLS / 2) * cell, oy() + y * cell, '#ffffff', ev.rows.some((r) => r.problem));
          }
          break;
        }
        case 'break': breaks.push(ev); drawSide(true); break;
        case 'solutionRow':
          toast(`<span class="t-pts">+${ev.points}</span><b>Solution looking for a problem</b><span class="t-hint">${ev.count > 1 ? ev.count + ' rows' : 'A row'} of solutions, no problem solved.</span>`, 'minor', 2.2);
          if (!breaksIn(evs)) sound.blip(392, 0.1, 'triangle', 0.04);
          break;
        case 'combo': break;
        case 'rise':
          fx.rise = 1;
          drawSide(true);
          sound.blip(80, 0.18, 'sine', 0.09, 0, 0.7);
          break;
        case 'levelUp':
          banner('Level ' + ev.level, 'level');
          toast(`<b>Level ${ev.level}</b><span class="t-hint">Problems rise faster. Solutions fall faster.</span>`, '', 2.6);
          sound.arp([523, 659, 784, 1047], 0.07, 'square', 0.04);
          break;
        case 'gameOver': break;
      }
    }
    if (breaks.length) celebrate(breaks, evs);
  }
  function breaksIn(evs) { return evs.some((e) => e.type === 'break'); }

  function celebrate(breaks, evs) {
    const anyPerfect = breaks.some((b) => b.perfect);
    const combo = breaks[breaks.length - 1].combo;
    for (const b of breaks) {
      const badges = (b.perfect ? '<span class="badge">PERFECT FIT ×2</span>' : '') +
        (b.rightTool ? '<span class="badge right">RIGHT TOOL ×1.5</span>' : '') + (combo >= 2 ? `<span class="badge combo">COMBO ×${combo}</span>` : '');
      toast(`<span class="t-pts">+${b.points.toLocaleString()}</span><b>${esc(b.label)}</b>solved with <strong>${esc(b.principle)}</strong>${badges}${b.hint ? `<div class="t-hint">${esc(b.hint)}</div>` : ''}`, b.perfect ? 'perfect' : '', b.perfect ? 3.8 : 3.2);
    }
    const clear = evs.find((e) => e.type === 'clear');
    const rows = clear ? clear.rows.filter((r) => r.problem) : [];
    if (breaks.some((b) => b.rightTool) && !anyPerfect) banner(breaks.length > 1 ? 'Right tools!' : 'Right tool!', 'level');
    if (anyPerfect) {
      fx.shake = Math.max(fx.shake, 9);
      for (const r of rows) {
        const cy = oy() + (r.y + 0.5) * cell;
        fx.rings.push({ x: ox() + (COLS / 2) * cell, y: cy, age: 0, life: 0.7, color: theme.perfect });
        for (let x = 0; x < COLS; x++) burst(ox() + (x + 0.5) * cell, cy, theme.perfect, 4, cell * 12, { spark: true, long: true, lift: 0.8 });
      }
      banner(breaks.length > 1 ? `Perfect fit ×${breaks.length}!` : 'Perfect fit!', 'perfect');
      sound.arp([784, 988, 1175, 1568, 1976], 0.055, 'square', 0.05);
    } else {
      fx.shake = Math.max(fx.shake, 4 + breaks.length * 2);
      if (breaks.length >= 2) banner(`${breaks.length} problems broken!`, '');
      else if (combo >= 3) banner(`Combo ×${combo}`, 'level');
      sound.arp(breaks.length >= 2 ? [523, 659, 784, 1047] : [523, 784], 0.06, 'triangle', 0.07);
    }
    if (combo >= 2) sound.blip(880 + combo * 60, 0.12, 'square', 0.03, 0.25);
  }

  // ---------------------------------------------------------------- drawing
  function drawWell(now) {
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = theme.well;
    g.fillRect(0, 0, W, H);
    if (!game) return;

    let sx = 0, sy = 0;
    if (fx.shake > 0.2) { sx = rand(-1, 1) * fx.shake; sy = rand(-1, 1) * fx.shake; }
    g.save();
    g.translate(ox() + sx, oy() + sy);

    // grid
    g.strokeStyle = theme.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < COLS; x++) { g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, ROWS * cell); }
    for (let y = 1; y < ROWS; y++) { g.moveTo(0, y * cell + 0.5); g.lineTo(COLS * cell, y * cell + 0.5); }
    g.stroke();

    // danger glow when the stack nears the top
    const height = E.stackHeight(game);
    if (height >= ROWS - 5 && mode !== 'start') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      const grad = g.createLinearGradient(0, 0, 0, cell * 5);
      grad.addColorStop(0, rgba(theme.red, 0.18 + 0.22 * pulse * ((height - (ROWS - 5)) / 5)));
      grad.addColorStop(1, rgba(theme.red, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, COLS * cell, cell * 5);
    }

    // stack (slides up when a problem rises)
    const riseOff = fx.rise * cell;
    g.save();
    g.translate(0, riseOff);
    for (let y = 0; y < ROWS; y++) drawRow(g, y);
    g.restore();

    // ghost + active piece
    if (game.active && mode !== 'over') {
      const p = game.active;
      const color = PIECE_COLORS[p.type];
      const gy = E.ghostY(game);
      if (gy !== p.y) {
        g.save();
        for (const [x, y] of E.pieceCells({ ...p, y: gy })) {
          if (y < 0) continue;
          g.fillStyle = rgba(color, 0.13);
          g.strokeStyle = rgba(color, 0.65);
          g.lineWidth = Math.max(1, cell * 0.06);
          g.setLineDash([cell * 0.18, cell * 0.12]);
          g.beginPath(); g.roundRect(x * cell + cell * 0.1, y * cell + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.16); g.fill(); g.stroke();
        }
        g.restore();
      }
      const cells = E.pieceCells(p);
      for (const [x, y] of cells) if (y >= 0) drawBlock(g, x * cell, y * cell, cell, color);
      drawPieceLabel(g, cells, p.principle.name, color);
    }

    // effects on top
    for (const t of fx.trails) {
      const a = 1 - t.age / t.life;
      const grad = g.createLinearGradient(0, (t.y - t.len) * cell, 0, t.y * cell);
      grad.addColorStop(0, rgba(t.color, 0));
      grad.addColorStop(1, rgba(t.color, 0.35 * a));
      g.fillStyle = grad;
      g.fillRect(t.x * cell + cell * 0.2, (t.y - t.len) * cell, cell * 0.6, t.len * cell);
    }
    for (const l of fx.lockGlow) {
      g.fillStyle = `rgba(255,255,255,${0.35 * (1 - l.age / l.life)})`;
      g.beginPath(); g.roundRect(l.x * cell + 1, l.y * cell + 1, cell - 2, cell - 2, cell * 0.2); g.fill();
    }
    for (const f of fx.flashes) {
      const a = 1 - f.age / f.life;
      g.fillStyle = f.problem ? `rgba(255,244,214,${0.85 * a})` : `rgba(255,255,255,${0.55 * a})`;
      const grow = (1 - a) * cell * 0.4;
      g.fillRect(-grow, f.y * cell - grow / 2, COLS * cell + grow * 2, cell + grow);
    }
    g.restore();

    // particles/popups/rings in wrapper coordinates (they fly outside the well)
    g.save();
    g.translate(sx, sy);
    for (const r of fx.rings) {
      const k = r.age / r.life;
      g.strokeStyle = rgba(r.color, 1 - k);
      g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath(); g.ellipse(r.x, r.y, k * COLS * cell * 0.75, k * cell * 2.2, 0, 0, Math.PI * 2); g.stroke();
    }
    for (const p of fx.particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.globalAlpha = a;
      if (p.spark) {
        g.fillStyle = p.color;
        g.beginPath(); g.moveTo(0, -p.size); g.lineTo(p.size * 0.3, 0); g.lineTo(0, p.size); g.lineTo(-p.size * 0.3, 0); g.closePath(); g.fill();
      } else {
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      g.restore();
    }
    for (const p of fx.popups) {
      const k = p.age / p.life;
      g.globalAlpha = 1 - k * k;
      g.font = `800 ${Math.round(cell * (p.big ? 0.75 : 0.55))}px ${fontFamily()}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeText(p.text, p.x, p.y - k * cell * 1.6);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y - k * cell * 1.6);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  let _font;
  function fontFamily() {
    if (!_font) _font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    return _font;
  }

  function drawRow(g, y) {
    const row = game.grid[y];
    const pc = row.problem ? problemColor(y) : null;
    const labelled = new Set();
    for (let x = 0; x < COLS; x++) {
      const c = row.cells[x];
      if (!c) {
        if (row.problem && row.problem.gaps.includes(x)) {
          // the slot: show where a solution must go
          g.save();
          g.fillStyle = rgba(pc.color, 0.1);
          g.strokeStyle = rgba(pc.color, 0.55);
          g.lineWidth = Math.max(1, cell * 0.05);
          g.setLineDash([cell * 0.14, cell * 0.1]);
          g.beginPath(); g.roundRect(x * cell + cell * 0.12, y * cell + cell * 0.12, cell * 0.76, cell * 0.76, cell * 0.14); g.fill(); g.stroke();
          g.restore();
        }
        continue;
      }
      if (c.kind === 'problem') drawBlock(g, x * cell, y * cell, cell, pc.color, 'problem');
      else {
        drawBlock(g, x * cell, y * cell, cell, PIECE_COLORS[c.type]);
        if (!labelled.has(c.pieceId) && cell >= 18) {
          labelled.add(c.pieceId);
          g.font = `700 ${Math.round(cell * 0.3)}px ${fontFamily()}`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = 'rgba(255,255,255,0.78)';
          g.fillText(c.principle.short || '', x * cell + cell / 2, y * cell + cell * 0.56);
        }
      }
    }
    if (row.problem) {
      const right = game.active && mode === 'play' && (row.problem.bestFits || []).includes(game.active.principle.name);
      if (right) {
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 160);
        g.save();
        g.strokeStyle = `rgba(31,181,122,${0.55 + 0.4 * pulse})`;
        g.lineWidth = Math.max(2, cell * 0.09);
        g.beginPath(); g.roundRect(1, y * cell + 1, COLS * cell - 2, cell - 2, cell * 0.2); g.stroke();
        g.restore();
      }
      drawProblemLabel(g, row, y, pc, right);
    }
  }

  function drawProblemLabel(g, row, y, pc, right) {
    // label goes on the longest run of problem cells
    let best = [0, 0], start = -1;
    for (let x = 0; x <= COLS; x++) {
      const isP = x < COLS && row.cells[x] && row.cells[x].kind === 'problem';
      if (isP && start < 0) start = x;
      if (!isP && start >= 0) { if (x - start > best[1] - best[0]) best = [start, x]; start = -1; }
    }
    const text = (right ? '★ ' : '') + row.problem.label;
    let run = (best[1] - best[0]) * cell - cell * 0.3;
    let cx = ((best[0] + best[1]) / 2) * cell;
    let size = Math.min(cell * 0.5, 15);
    g.font = `750 ${Math.round(size)}px ${fontFamily()}`;
    let w = g.measureText(text).width;
    while (w > run && size > 9) { size -= 0.5; g.font = `750 ${Math.round(size)}px ${fontFamily()}`; w = g.measureText(text).width; }
    const pill = w > run;
    if (pill) cx = Math.min(Math.max(cx, w / 2 + 6), COLS * cell - w / 2 - 6);
    const cy = y * cell + cell / 2 + 0.5;
    if (pill || !pc.hot) {
      g.fillStyle = pill ? 'rgba(15,17,27,0.78)' : 'rgba(0,0,0,0)';
      if (pill) { g.beginPath(); g.roundRect(cx - w / 2 - 5, cy - size * 0.75, w + 10, size * 1.5, size * 0.5); g.fill(); }
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = pill ? '#ffffff' : pc.hot ? '#ffffff' : '#2b1700';
    if (!pill) {
      // a soft halo keeps the label legible across the block edges
      g.lineJoin = 'round';
      g.lineWidth = Math.max(2.5, size * 0.28);
      g.strokeStyle = pc.hot ? 'rgba(60,0,0,0.55)' : 'rgba(255,236,200,0.7)';
      g.strokeText(text, cx, cy);
    }
    g.fillText(text, cx, cy);
    g.shadowBlur = 0;
  }

  function drawPieceLabel(g, cells, name, color) {
    const vis = cells.filter(([, y]) => y >= 0);
    if (!vis.length) return;
    const minY = Math.min(...vis.map(([, y]) => y));
    const xs = vis.map(([x]) => x);
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cell;
    const size = Math.max(10, Math.min(13, cell * 0.44));
    g.font = `700 ${Math.round(size)}px ${fontFamily()}`;
    const w = g.measureText(name).width;
    const x = Math.min(Math.max(cx, w / 2 + 6), COLS * cell - w / 2 - 6);
    // sit just above the piece; if that's off the top, sit on it
    let y = minY * cell - size * 0.9;
    if (y < size) y = minY * cell + size;
    g.fillStyle = 'rgba(12,14,22,0.82)';
    g.strokeStyle = rgba(color, 0.9);
    g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(x - w / 2 - 7, y - size * 0.8, w + 14, size * 1.6, size * 0.8); g.fill(); g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x, y + 0.5);
  }

  function stepFx(dt) {
    const s = dt / 1000;
    const grav = cell * 30;
    fx.particles = fx.particles.filter((p) => {
      p.age += s; p.vy += grav * s * (p.spark ? 0.35 : 1);
      p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
      return p.age < p.life;
    });
    for (const k of ['flashes', 'popups', 'rings', 'trails', 'lockGlow']) fx[k] = fx[k].filter((f) => (f.age += s) < f.life);
    fx.shake *= Math.pow(0.0015, s);
    fx.rise = Math.max(0, fx.rise - s * 7);
  }

  // ---------------------------------------------------------------- side panels
  function setupMini(c) {
    const r = c.getBoundingClientRect();
    const w = r.width || c.width, h = r.height || c.height;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function drawMini(c, spec, dim) {
    const { g, w, h } = setupMini(c);
    if (!spec) return;
    const cells = E.ROTATIONS[spec.type][0];
    const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y);
    const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
    const size = Math.floor(Math.min((w - 8) / 4, (h - 6) / 2));
    const x0 = (w - bw * size) / 2 - Math.min(...xs) * size, y0 = (h - bh * size) / 2 - Math.min(...ys) * size;
    g.globalAlpha = dim ? 0.4 : 1;
    for (const [x, y] of cells) drawBlock(g, x0 + x * size, y0 + y * size, size, PIECE_COLORS[spec.type]);
    g.globalAlpha = 1;
  }

  const sideCache = {};
  function setText(id, v) {
    if (sideCache[id] === v) return;
    sideCache[id] = v;
    $(id).textContent = v;
  }
  function drawSide(full) {
    if (!game) return;
    setText('s-score', game.score.toLocaleString());
    setText('s-level', String(game.level));
    setText('s-solved', String(game.stats.solved.length));
    setText('s-combo', game.combo >= 2 ? '×' + game.combo : game.combo === 1 ? '×1' : '–');
    setText('s-best', myBest ? myBest.score.toLocaleString() + ' (#' + myBest.rank + ')' : '–');
    const up = game.upcomingProblem;
    setText('rise-label', up ? up.label : '…');
    $('rise-bar').style.width = Math.min(100, (game.riseAcc / E.riseMs(game.level)) * 100).toFixed(1) + '%';
    if (!full) return;
    const list = $('next-list');
    if (list.children.length !== 3) {
      list.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const item = document.createElement('div');
        item.className = 'next-item';
        item.innerHTML = '<canvas width="60" height="40"></canvas><div></div>';
        list.appendChild(item);
      }
    }
    game.queue.slice(0, 3).forEach((spec, i) => {
      const item = list.children[i];
      drawMini(item.querySelector('canvas'), spec);
      item.querySelector('div').textContent = spec.principle.name;
    });
    drawMini($('hold'), game.hold, game.holdUsed);
    setText('hold-name', game.hold ? game.hold.principle.name : 'Nothing parked');
    const cur = game.active;
    setText('cur-name', cur ? cur.principle.name : '–');
    setText('cur-hint', cur ? cur.principle.hint : '');
    const fits = up && up.bestFits && up.bestFits.length ? 'Best fits: ' + up.bestFits.join(', ') : '';
    setText('rise-fits', fits);
    const rightFor = cur ? [...new Set(E.rightToolFor(game, cur.principle.name))] : [];
    const rf = $('cur-right');
    rf.hidden = !rightFor.length;
    setText('cur-right', rightFor.length ? '★ Right tool for: ' + rightFor.join(', ') : '');
  }

  // ---------------------------------------------------------------- input
  const held = { left: false, right: false, soft: false };
  let dir = 0, dasT = 0, softT = 0;
  const DAS = 150, ARR = 45, SOFT = 35;

  function press(act) {
    if (mode !== 'play') return;
    switch (act) {
      case 'left': case 'right':
        held[act] = true; dir = act === 'left' ? -1 : 1; dasT = 0;
        E.move(game, dir);
        break;
      case 'soft': held.soft = true; softT = SOFT; break;
      case 'rotate': E.rotate(game, 1); break;
      case 'rotateBack': E.rotate(game, -1); break;
      case 'hard': E.hardDrop(game); break;
      case 'hold': E.hold(game); break;
    }
  }
  function release(act) {
    if (act === 'left' || act === 'right') {
      held[act] = false;
      if (held.left) dir = -1; else if (held.right) dir = 1; else dir = 0;
      dasT = 0;
    }
    if (act === 'soft') held.soft = false;
  }
  function processHeld(dt) {
    if (dir !== 0) {
      dasT += dt;
      if (dasT >= DAS) {
        let n = Math.floor((dasT - DAS) / ARR) + 1;
        dasT -= n * ARR;
        while (n-- > 0) if (!E.move(game, dir)) break;
      }
    }
    if (held.soft) {
      softT += dt;
      while (softT >= SOFT) { softT -= SOFT; if (!E.softDrop(game)) break; }
    }
  }

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowDown: 'soft', KeyS: 'soft', ArrowUp: 'rotate', KeyW: 'rotate', KeyX: 'rotate',
    KeyZ: 'rotateBack', KeyQ: 'rotateBack',
    Space: 'hard', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  };
  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.id !== 'copy-buffer') return;
    if (e.target && e.target.tagName === 'SELECT') {
      if (mode !== 'play') return; // browsing the mode list
      e.target.blur(); // mid-game: arrows steer the piece, not the dropdown
    }
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (e.code === 'KeyM') { setSound(!sound.on); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (mode === 'start' || mode === 'over') { e.preventDefault(); startGame(); }
      else if (mode === 'pause') { e.preventDefault(); resume(); }
      return;
    }
    const act = KEYMAP[e.code];
    if (!act) return;
    if (mode === 'play') e.preventDefault();
    if (e.repeat) return;
    press(act);
  });
  document.addEventListener('keyup', (e) => {
    const act = KEYMAP[e.code];
    if (act) release(act);
  });

  // touch / pointer buttons
  for (const btn of document.querySelectorAll('#touch button')) {
    const act = btn.dataset.act;
    const down = (e) => { e.preventDefault(); btn.classList.add('down'); btn.setPointerCapture && btn.setPointerCapture(e.pointerId); press(act); };
    const up = () => { btn.classList.remove('down'); release(act); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // tap the well to rotate, swipe down to hard drop (phones)
  let touchStart = null;
  well.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') touchStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  well.addEventListener('pointerup', (e) => {
    if (!touchStart || mode !== 'play') { touchStart = null; return; }
    const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) E.hardDrop(game);
    else if (Math.abs(dx) > 30) E.move(game, dx > 0 ? 1 : -1);
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) E.rotate(game, 1);
    touchStart = null;
  });

  // ---------------------------------------------------------------- modes
  function showOverlay(which) {
    $('overlay').hidden = !which;
    for (const id of ['ov-start', 'ov-pause', 'ov-over']) $(id).hidden = id !== which;
  }
  function newGame() {
    game = E.createGame({
      problems: content ? content.problems : undefined,
      principles: content ? content.solutions : undefined,
      modeId: content ? content.id : null,
      modeName: content ? content.name : null,
      solutionNoun: content ? content.solutionNoun : undefined,
      solutionNounPlural: content ? content.solutionNounPlural : undefined,
    });
    fx.particles.length = fx.popups.length = fx.flashes.length = 0;
    $('toasts').innerHTML = '';
    drawSide(true);
  }
  function startGame() {
    newGame();
    held.left = held.right = held.soft = false; dir = 0;
    mode = 'play';
    showOverlay(null);
    $('btn-pause').textContent = 'Pause';
    if (sound.on) sound.arp([392, 523, 659], 0.07, 'triangle', 0.05);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    showOverlay('ov-pause');
    $('btn-pause').textContent = 'Resume';
  }
  function resume() {
    if (mode !== 'pause') return;
    mode = 'play';
    showOverlay(null);
    $('btn-pause').textContent = 'Pause';
    lastFrame = performance.now();
  }
  function togglePause() { if (mode === 'play') pause(); else if (mode === 'pause') resume(); }

  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  async function finish() {
    mode = 'over';
    const g = game;
    banner('Overwhelmed', 'over');
    fx.shake = 10;
    // the stack crumbles
    g.grid.forEach((row, y) => row.cells.forEach((c, x) => {
      if (c && Math.random() < 0.5) burst(ox() + (x + 0.5) * cell, oy() + (y + 0.5) * cell, c.kind === 'problem' ? problemColor(y).color : PIECE_COLORS[c.type], 1, cell * 6);
    }));
    sound.arp([392, 330, 262, 196], 0.12, 'sawtooth', 0.04);
    fillReport(g);
    const submitP = submitScore(g);
    setTimeout(() => { if (game === g && mode === 'over') { showOverlay('ov-over'); $('btn-again').focus(); } }, 1300);
    await submitP;
  }

  function fillReport(g) {
    const s = E.summary(g);
    $('r-score').textContent = s.score.toLocaleString();
    $('r-solved').textContent = s.problemsSolved;
    $('r-perfect').textContent = s.perfectFits;
    $('r-combo').textContent = s.bestCombo ? '×' + s.bestCombo : '–';
    $('r-right').textContent = s.rightTools;
    $('r-mode').textContent = g.meta.modeName || '';
    $('r-board-mode').textContent = g.meta.modeName || '';
    const mins = Math.floor(s.durationMs / 60000), secs = Math.round(s.durationMs / 1000) % 60;
    $('r-meta').textContent = `Level ${s.level} · ${mins}m ${String(secs).padStart(2, '0')}s · ${s.pieces} solutions placed` +
      (s.solutionRows ? ` · ${s.solutionRows} solution${s.solutionRows === 1 ? '' : 's'} looking for a problem` : '');
    const list = $('r-list');
    list.innerHTML = '';
    if (!g.stats.solved.length) list.innerHTML = '<li class="muted">None this time. The problems won.</li>';
    for (const x of g.stats.solved) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${esc(x.label)}</b>, with ${esc(x.principle)}${x.perfect ? '<span class="pf">PERFECT</span>' : ''}${x.rightTool ? '<span class="rt">RIGHT TOOL</span>' : ''}`;
      list.appendChild(li);
    }
    const pl = $('r-principles');
    pl.innerHTML = '';
    const top = E.topPrinciples(g, 5);
    if (!top.length) pl.innerHTML = '<li class="muted">–</li>';
    for (const t of top) {
      const li = document.createElement('li');
      li.textContent = `${t.name} ×${t.count}`;
      pl.appendChild(li);
    }
    $('r-submit').textContent = 'Saving your score…';
    renderBoard(null);
  }

  async function submitScore(g) {
    try {
      const res = await fetch('/api/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(E.summary(g)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { $('r-submit').textContent = 'Your session expired. Sign in again to save scores.'; return; }
      if (!res.ok) { $('r-submit').textContent = 'Score not saved: ' + (data.error || res.status); return loadBoard(); }
      myBest = data.me;
      $('r-submit').textContent = data.personalBest
        ? `New personal best! Rank #${data.rank}.`
        : `Rank #${data.rank} for this game. Your best: ${data.me ? data.me.score.toLocaleString() : '–'}.`;
      renderBoard(data);
      drawSide(true);
    } catch {
      $('r-submit').textContent = 'Could not reach the server; score not saved.';
    }
  }

  async function loadBoard() {
    try {
      const r = await fetch('/api/scores?mode=' + encodeURIComponent(content ? content.id : ''), { credentials: 'same-origin' });
      if (!r.ok) return null;
      const data = await r.json();
      myBest = data.me;
      renderBoard(data);
      return data;
    } catch { return null; }
  }

  function renderBoard(data) {
    const tb = $('r-board').querySelector('tbody');
    tb.innerHTML = '';
    if (!data) return;
    if (!data.top.length) { tb.innerHTML = '<tr><td class="muted">No scores yet.</td></tr>'; return; }
    for (const r of data.top) {
      const tr = document.createElement('tr');
      if (r.isMe) tr.className = 'me';
      tr.innerHTML = `<td class="rank">${r.rank}</td><td>${esc(r.displayName)}<div class="sub">${r.problemsSolved} solved${r.topPrinciple ? ' · ' + esc(r.topPrinciple) : ''}</div></td><td class="num">${r.score.toLocaleString()}</td>`;
      tb.appendChild(tr);
    }
    if (data.me && !data.top.some((r) => r.isMe)) {
      const tr = document.createElement('tr');
      tr.className = 'me';
      tr.innerHTML = `<td class="rank">${data.me.rank}</td><td>${esc(PLAYER)}</td><td class="num">${data.me.score.toLocaleString()}</td>`;
      tb.appendChild(tr);
    }
  }

  async function copyReport() {
    const text = E.reportText(game, PLAYER);
    const btn = $('btn-copy');
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch { /* fall back */ }
    if (!ok) {
      // plain http on the LAN has no async clipboard: use a hidden textarea
      const ta = $('copy-buffer');
      ta.value = text;
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.blur();
    }
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy report'; }, 1600);
  }

  // ---------------------------------------------------------------- main loop
  function frame(now) {
    const dt = Math.min(100, now - (lastFrame || now));
    lastFrame = now;
    if (game && mode === 'play') {
      processHeld(dt);
      E.update(game, dt);
      handleEvents();
      drawSide(false);
      if (game.over) finish();
    } else if (game) {
      E.drainEvents(game);
    }
    stepFx(dt);
    drawWell(now);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  // ---------------------------------------------------------------- modes
  const select = $('mode-select');
  const modeIds = () => [...select.options].map((o) => o.value);

  /** ?mode=<id> wins, then the viewer's last choice, then the server default. */
  function initialModeId() {
    const ids = modeIds();
    const fromUrl = new URLSearchParams(location.search).get('mode');
    if (fromUrl && ids.includes(fromUrl)) return fromUrl;
    const saved = store.get('mode', null);
    if (saved && ids.includes(saved)) return saved;
    const def = document.body.dataset.defaultMode;
    return ids.includes(def) ? def : ids[0] || null;
  }

  async function fetchMode(id) {
    const r = await fetch('/api/modes/' + encodeURIComponent(id), { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return null; }
    if (!r.ok) throw new Error('mode ' + id + ': ' + r.status);
    return r.json();
  }

  function applyModeText() {
    const c = content;
    const noun = c ? c.solutionNoun : 'principle';
    const plural = c ? c.solutionNounPlural : 'principles';
    document.querySelectorAll('.noun').forEach((el) => { el.textContent = noun; });
    document.querySelectorAll('.noun-plural').forEach((el) => { el.textContent = plural; });
    $('start-mode').textContent = c ? c.name : '';
    $('start-desc').textContent = c ? c.description : '';
    document.title = c ? `Breakthrough · ${c.name}` : 'Breakthrough';
  }

  /** Load a mode and show its start card with a fresh board. */
  async function useMode(id) {
    try {
      content = await fetchMode(id);
      if (!content) return;
    } catch {
      content = null; // the engine's tiny built-in deck still plays
    }
    if (content) {
      select.value = content.id;
      store.set('mode', content.id);
      // keep a shared ?mode= link in step with the dropdown
      const url = new URL(location.href);
      if (url.searchParams.has('mode')) { url.searchParams.set('mode', content.id); history.replaceState(null, '', url); }
    }
    applyModeText();
    myBest = null;
    newGame(); // a board to look at behind the start card
    mode = 'start';
    showOverlay('ov-start');
    drawSide(true);
    loadBoard().then(() => drawSide(false));
  }

  select.addEventListener('change', async () => {
    const want = select.value;
    const prev = content ? content.id : null;
    if (want === prev) return;
    // Switching mode simply resets: no confirmation (apps never use browser dialogs).
    select.blur(); // arrow keys belong to the game again
    await useMode(want);
  });

  // ---------------------------------------------------------------- boot
  async function boot() {
    readTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); drawSide(true); });
    new ResizeObserver(resize).observe(wrap);
    window.addEventListener('resize', resize);
    setSound(sound.on);
    $('btn-sound').addEventListener('click', () => setSound(!sound.on));
    $('btn-pause').addEventListener('click', togglePause);
    $('btn-start').addEventListener('click', startGame);
    $('btn-resume').addEventListener('click', resume);
    $('btn-again').addEventListener('click', startGame);
    $('btn-copy').addEventListener('click', copyReport);
    const id = initialModeId();
    if (id) await useMode(id);
    else { applyModeText(); newGame(); mode = 'start'; showOverlay('ov-start'); }
    resize();
    requestAnimationFrame(frame);
  }
  boot();
})();
