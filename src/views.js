'use strict';
// Server-rendered HTML shell. The game itself is public/js/game.js on a canvas.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function gamePage({ user, portalUrl, portalName, version, modes = [], defaultMode = '', selectedMode = '' }) {
  const v = esc(version);
  const current = modes.find((m) => m.id === (selectedMode || defaultMode)) || modes[0] || null;
  const noun = current ? current.solutionNoun : 'principle';
  const options = modes.map((m) => `<option value="${esc(m.id)}"${current && m.id === current.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Breakthrough</title>
<meta name="description" content="Problems rise, solutions fall. A falling-block problem-solving puzzle.">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/css/app.css?v=${v}">
</head>
<body class="game-body" data-display-name="${esc(user.displayName)}" data-default-mode="${esc(defaultMode)}" data-url-mode="${esc(selectedMode)}">
<header class="topbar">
  <label class="mode-pick" title="Game mode: which problems and solutions you play with">
    <span class="mode-pick-label">Mode</span>
    <select id="mode-select" aria-label="Game mode">${options}</select>
  </label>
  ${portalUrl && portalName ? `<a class="portal-link" href="${esc(portalUrl)}">← ${esc(portalName)}</a>` : ''}
  <h1 class="brand">Break<span>through</span></h1>
  <p class="tagline">Problems rise. Solutions fall.</p>
  <div class="spacer"></div>
  <button id="btn-sound" class="chip" type="button" aria-pressed="false" title="Sound (M)">Sound off</button>
  <button id="btn-pause" class="chip" type="button" title="Pause (P)">Pause</button>
  <span class="who" title="${esc(user.username)} (${esc(user.source)})">${esc(user.displayName)}</span>
  <a class="chip" href="/logout">Sign out</a>
</header>

<main class="layout">
  <aside class="side side-left">
    <section class="card hold-card">
      <h2>Parked idea</h2>
      <canvas id="hold" class="mini" width="96" height="64" aria-label="Parked piece"></canvas>
      <div id="hold-name" class="pname">Nothing parked</div>
      <div class="keyhint"><kbd>C</kbd> park / swap</div>
    </section>
    <section class="card stats" aria-live="polite">
      <div class="stat"><span>Score</span><b id="s-score">0</b></div>
      <div class="stat"><span>Level</span><b id="s-level">1</b></div>
      <div class="stat"><span>Solved</span><b id="s-solved">0</b></div>
      <div class="stat"><span>Combo</span><b id="s-combo">–</b></div>
      <div class="stat wide"><span>Your best</span><b id="s-best">–</b></div>
    </section>
  </aside>

  <section class="well-wrap" id="well-wrap">
    <canvas id="well" aria-label="Breakthrough game well"></canvas>
    <div id="toasts" class="toasts" aria-live="polite"></div>
    <div id="banner" class="banner" hidden></div>
    <div id="overlay" class="overlay">
      <div class="panel-card" id="ov-start">
        <h2 class="brand big">Break<span>through</span></h2>
        <p class="mode-line"><span id="start-mode">${esc(current ? current.name : '')}</span></p>
        <p id="start-desc" class="muted small">${esc(current ? current.description : '')}</p>
        <p class="lead">Problems rise from below. Drop solutions to fill their gaps and break them.</p>
        <ul class="howto">
          <li><b class="sw problem"></b> <span>A full row with a <b>problem</b> breaks it, credited to the <span class="noun">${esc(noun)}</span> on the piece that finished it.</span></li>
          <li><b class="sw perfect"></b> <span><b>Perfect fit</b>: one piece fills the whole slot with nothing left over. Double points.</span></li>
          <li><b class="sw right"></b> <span><b>Right tool</b> (×1.5): finish a problem with one of its best-fit <span class="noun-plural">${esc(current ? current.solutionNounPlural : 'principles')}</span>. Watch for ★.</span></li>
          <li><b class="sw solution"></b> <span>Rows of solutions alone are a <i>solution looking for a problem</i>: they clear, for small change.</span></li>
          <li><b class="sw none"></b> <span>Break problems back to back for combos. Let them pile up and you are <b>Overwhelmed</b>.</span></li>
        </ul>
        <button id="btn-start" class="btn primary" type="button">Start <kbd>Enter</kbd></button>
        <p class="keys muted"><kbd>←</kbd><kbd>→</kbd> move · <kbd>↑</kbd>/<kbd>X</kbd> rotate · <kbd>Z</kbd> rotate back · <kbd>↓</kbd> soft drop · <kbd>Space</kbd> hard drop · <kbd>C</kbd> park · <kbd>P</kbd> pause</p>
      </div>
      <div class="panel-card" id="ov-pause" hidden>
        <h2>Paused</h2>
        <p class="muted">The problems will wait. For now.</p>
        <button id="btn-resume" class="btn primary" type="button">Resume <kbd>P</kbd></button>
      </div>
      <div class="panel-card report" id="ov-over" hidden>
        <p class="eyebrow">Overwhelmed · <span id="r-mode"></span></p>
        <h2>Innovation report</h2>
        <div class="report-grid">
          <div class="big-stat"><span>Score</span><b id="r-score">0</b></div>
          <div class="big-stat"><span>Problems solved</span><b id="r-solved">0</b></div>
          <div class="big-stat"><span>Perfect fits</span><b id="r-perfect">0</b></div>
          <div class="big-stat"><span>Right tool</span><b id="r-right">0</b></div>
          <div class="big-stat"><span>Best combo</span><b id="r-combo">0</b></div>
        </div>
        <p id="r-meta" class="muted"></p>
        <div class="report-cols">
          <section><h3>Problems solved</h3><ol id="r-list" class="solved-list"></ol></section>
          <section><h3>Most-used <span class="noun-plural">${esc(current ? current.solutionNounPlural : 'principles')}</span></h3><ol id="r-principles" class="principle-list"></ol></section>
        </div>
        <section class="board"><h3>Leaderboard · <span id="r-board-mode"></span></h3><p id="r-submit" class="muted"></p><table id="r-board"><tbody></tbody></table></section>
        <div class="actions">
          <button id="btn-copy" class="btn" type="button">Copy report</button>
          <button id="btn-again" class="btn primary" type="button">Play again <kbd>Enter</kbd></button>
        </div>
      </div>
    </div>
  </section>

  <aside class="side side-right">
    <section class="card next-card">
      <h2>Next</h2>
      <div id="next-list" class="next-list"></div>
    </section>
    <section class="card rise-card">
      <h2>Rising next</h2>
      <div id="rise-label" class="rise-label">…</div>
      <div class="meter" aria-hidden="true"><div id="rise-bar"></div></div>
      <p id="rise-fits" class="fits muted small"></p>
    </section>
    <section class="card principle-card">
      <h2>Falling now</h2>
      <div id="cur-name" class="pname big">–</div>
      <p id="cur-hint" class="muted small"></p>
      <p id="cur-right" class="right-for small" hidden></p>
    </section>
  </aside>
</main>

<nav class="touch" id="touch" aria-label="Touch controls">
  <button type="button" data-act="hold" aria-label="Park idea">Park</button>
  <button type="button" data-act="left" aria-label="Move left">◀</button>
  <button type="button" data-act="rotate" aria-label="Rotate">⟳</button>
  <button type="button" data-act="right" aria-label="Move right">▶</button>
  <button type="button" data-act="soft" aria-label="Soft drop">▼</button>
  <button type="button" data-act="hard" aria-label="Hard drop">⤓</button>
</nav>

<textarea id="copy-buffer" class="copy-buffer" aria-hidden="true" tabindex="-1" readonly></textarea>
<script src="/js/engine.js?v=${v}"></script>
<script src="/js/game.js?v=${v}"></script>
</body>
</html>`;
}

module.exports = { gamePage, esc };
