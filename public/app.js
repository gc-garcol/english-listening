import { tokenize, compare, mask, normalize, charDiff } from './matcher.js';
import { parseTranscript, mergeSentences, readHashImport } from './parsers.js';

const $ = (sel) => document.querySelector(sel);
const SPEEDS = [0.5, 0.75, 1, 1.25];
const EYE_SVG =
  '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const PLAY_PATH = '<path d="M7 4v16l13-8z"/>';
const PAUSE_PATH = '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>';
// Shown after the recent videos so new users have something to try.
const EXAMPLES = [{ videoId: '2BlMNH1QTeE', title: 'Toy Story 3 Official Trailer • Pixar' }];

// ---------------------------------------------------------------- storage
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('el:' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('el:' + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: progress just won't persist */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem('el:' + key);
    } catch {}
  },
};

const settings = {
  difficulty: 'normal',
  mode: 'original',
  padBefore: 0.1,
  padAfter: 0.3,
  autoplay: true,
  autoNext: false,
  speed: 1,
  showTranscript: false,
  ...store.get('settings', {}),
};
const saveSettings = () => store.set('settings', settings);

// ---------------------------------------------------------------- state
let data = null; // { videoId, title, segments }
let segments = []; // working segments (after merge)
let tokens = []; // tokens of the current segment
let progress = null; // { idx, done: {i:true}, revealed: {i:[tokenIdx]}, drafts: {i:text} }
let player = null;
let stopAt = null;
let autoNextTimer = null;

const progressKey = () => `progress:${data.videoId}:${settings.mode}`;
const saveProgress = () => store.set(progressKey(), progress);

// ---------------------------------------------------------------- YouTube player
const ytReady = new Promise((resolve) => {
  if (window.YT && window.YT.loaded) resolve();
  else window.onYouTubeIframeAPIReady = resolve;
});

async function loadPlayer(videoId) {
  await ytReady;
  if (player) {
    player.cueVideoById(videoId);
    return;
  }
  await new Promise((resolve) => {
    player = new YT.Player('player', {
      videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3 },
      events: {
        onReady: () => {
          player.setPlaybackRate(settings.speed);
          resolve();
        },
        onStateChange: (e) => {
          // Hide YouTube's own captions — they'd give the answer away.
          if (e.data === YT.PlayerState.PLAYING) {
            try {
              player.unloadModule('captions');
            } catch {}
          }
          updatePlayIcon();
        },
      },
    });
  });
}

function isPlaying() {
  return player && player.getPlayerState?.() === YT.PlayerState.PLAYING;
}

function updatePlayIcon() {
  const html = isPlaying() ? PAUSE_PATH : PLAY_PATH;
  $('#playIcon').innerHTML = html;
  $('#playIcon').querySelector('path').setAttribute('fill', 'currentColor');
}

function playSegment() {
  const seg = segments[progress.idx];
  if (!player || !seg) return;
  player.setPlaybackRate(settings.speed);
  player.seekTo(Math.max(0, seg.start - settings.padBefore), true);
  stopAt = seg.end + settings.padAfter;
  player.playVideo();
}

function togglePlay() {
  if (isPlaying()) {
    player.pauseVideo();
    stopAt = null;
  } else {
    playSegment();
  }
}

// Pause at the end of the segment.
setInterval(() => {
  if (stopAt !== null && isPlaying() && player.getCurrentTime() >= stopAt) {
    player.pauseVideo();
    stopAt = null;
  }
}, 40);

// ---------------------------------------------------------------- loading
function setStatus(message, { error = false, withPaste = false } = {}) {
  const el = $('#status');
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'status' + (error ? ' error' : '');
  el.textContent = message;
  if (withPaste) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = 'Import transcript';
    btn.onclick = () => openPaste();
    el.append(btn);
  }
}

// YouTube blocks the server's IP, so the transcript has to come from the user's browser:
// open the video on youtube.com and click the bookmarklet there.
function showBlocked(videoId) {
  const el = $('#status');
  el.hidden = false;
  el.className = 'status blocked';
  el.innerHTML = `
    <strong>YouTube blocks our server, so get the transcript from your browser instead:</strong>
    <ol>
      <li>First time only: <button type="button" class="link-btn" data-act="setup">add the 📌 bookmark</button> to your bookmarks bar.</li>
      <li>
        Open the video on YouTube and click the 📌 bookmark. The app opens with the transcript.
        <div><a class="btn btn-primary btn-youtube" data-act="youtube" target="_blank" rel="noopener">▶ Open this video on YouTube</a></div>
      </li>
    </ol>
    <div class="status-actions">
      <button type="button" class="btn btn-ghost" data-act="setup">Set up bookmark / paste transcript</button>
      <a class="btn btn-ghost" href="usage.html#blocked" target="_blank">IP got blocked? Read the guide →</a>
    </div>`;
  el.querySelector('[data-act="youtube"]').href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  el.querySelectorAll('[data-act="setup"]').forEach((b) => (b.onclick = () => openPaste({ blocked: true })));
}

async function loadFromUrl(url) {
  // A transcript imported with the bookmarklet (or pasted) wins: no server request needed.
  const manual = store.get(`manual:${extractVideoId(url)}`);
  if (manual) return start(manual);

  const lang = $('#langSelect').value;
  setStatus('Loading transcript…');
  try {
    const res = await fetch(`/api/transcript?url=${encodeURIComponent(url)}&lang=${encodeURIComponent(lang)}`);
    const json = await res.json();
    if (!res.ok) {
      $('#pasteUrl').value = url;
      if (/not a bot|blocked/i.test(json.error || '')) return showBlocked(json.videoId);
      setStatus(json.error || 'Failed to load transcript.', { error: true, withPaste: true });
      return;
    }
    await start(json);
  } catch (err) {
    setStatus('Network error: ' + err.message, { error: true });
  }
}

async function start(payload) {
  data = payload;
  setStatus(null);
  $('#app').hidden = false;
  $('#videoTitle').textContent = data.title || '';
  history.replaceState(null, '', `?v=${data.videoId}`);
  addRecent(data.videoId, data.title);
  await loadPlayer(data.videoId);
  buildSegments();
}

function buildSegments() {
  segments = settings.mode === 'sentences' ? mergeSentences(data.segments) : data.segments;
  progress = { idx: 0, done: {}, revealed: {}, drafts: {}, ...store.get(progressKey(), {}) };
  progress.idx = Math.min(progress.idx, segments.length - 1);
  renderTranscript();
  goTo(progress.idx, { play: false });
}

function addRecent(videoId, title) {
  const list = store.get('recent', []).filter((r) => r.videoId !== videoId);
  list.unshift({ videoId, title: title || videoId });
  store.set('recent', list.slice(0, 8));
  renderRecent();
}

function renderRecent() {
  const el = $('#recent');
  el.replaceChildren();
  const recent = store.get('recent', []);
  const examples = EXAMPLES.filter((e) => !recent.some((r) => r.videoId === e.videoId));
  for (const r of [...recent, ...examples]) {
    const b = document.createElement('button');
    b.textContent = r.title;
    b.title = r.title;
    b.onclick = () => {
      const url = `https://www.youtube.com/watch?v=${r.videoId}`;
      $('#urlInput').value = url;
      loadFromUrl(url);
    };
    if (examples.includes(r)) {
      b.className = 'example';
      b.title = 'Example: ' + r.title;
      el.append(b);
      continue;
    }
    const item = document.createElement('span');
    item.className = 'recent-item';
    const x = document.createElement('button');
    x.className = 'recent-remove';
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remove from recent';
    x.setAttribute('aria-label', 'Remove ' + r.title + ' from recent');
    x.onclick = () => removeRecent(r.videoId);
    item.append(b, x);
    el.append(item);
  }
}

function removeRecent(videoId) {
  store.set('recent', store.get('recent', []).filter((r) => r.videoId !== videoId));
  renderRecent();
}

// ---------------------------------------------------------------- segments
function fmt(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function goTo(i, { play = settings.autoplay } = {}) {
  if (i < 0 || i >= segments.length) return;
  clearTimeout(autoNextTimer);
  progress.idx = i;
  saveProgress();

  const seg = segments[i];
  tokens = tokenize(seg.text);
  $('#answer').value = progress.drafts[i] || '';
  $('#segCounter').textContent = `#${i + 1} / ${segments.length}`;
  $('#segTime').textContent = `${fmt(seg.start)} – ${fmt(seg.end)}`;
  renderWords();
  updateTranscriptItems();
  document.querySelector(`#segments li[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#answer').focus();
  if (play) {
    playSegment();
  } else if (player) {
    player.seekTo(Math.max(0, seg.start - settings.padBefore), true);
    player.pauseVideo();
  }
}

const revealedSet = () => new Set(progress.revealed[progress.idx] || []);

function reveal(tokenIndexes) {
  const set = revealedSet();
  tokenIndexes.forEach((t) => set.add(t));
  progress.revealed[progress.idx] = [...set];
  saveProgress();
}

// Reveal one word; if it's the next word to type (or a wrong one), fill it into the answer.
function revealWord(tokenIdx) {
  reveal([tokenIdx]);
  const checkIdx = tokens.slice(0, tokenIdx).filter((t) => t.checkable).length;
  const typed = $('#answer').value.split(/\s+/).filter((w) => normalize(w));
  if (checkIdx <= typed.length) {
    typed[checkIdx] = tokens[tokenIdx].raw;
    $('#answer').value = typed.join(' ') + ' ';
  }
  onInput();
}

function revealNext() {
  const { states } = compare(tokens, $('#answer').value);
  const i = states.findIndex((s) => s.state !== 'static' && s.state !== 'correct');
  if (i !== -1) revealWord(i);
}

function renderWords() {
  const input = $('#answer').value;
  const { states, complete } = compare(tokens, input);
  const revealed = revealedSet();
  const wrap = $('#words');
  wrap.replaceChildren();

  tokens.forEach((tok, i) => {
    const { state, user } = states[i];
    const w = document.createElement('span');
    const box = document.createElement('span');
    box.className = 'box';
    let cls = state;

    if (state === 'static' || state === 'correct') {
      box.textContent = tok.raw;
    } else if (revealed.has(i)) {
      cls = 'revealed';
      box.textContent = tok.raw;
    } else if (user !== undefined) {
      // Typing or wrong: show matching letters, '*' for wrong/missing ones.
      // Hard mode doesn't hint the word length, so untyped letters are left out.
      for (const { ch, state: s } of charDiff(tok, user)) {
        if (s === 'pending' && settings.difficulty === 'hard') continue;
        const c = document.createElement('span');
        c.className = 'ch-' + s;
        c.textContent = ch;
        box.append(c);
      }
      if (state === 'wrong') box.title = `You typed "${user}" — listen again`;
    } else {
      box.textContent = mask(tok, settings.difficulty);
      if (settings.difficulty === 'hard') cls += ' hard';
    }
    w.className = 'word ' + cls;

    if (state !== 'static' && state !== 'correct' && !revealed.has(i)) {
      const eye = document.createElement('button');
      eye.className = 'eye';
      eye.type = 'button';
      eye.title = 'Reveal this word';
      eye.innerHTML = EYE_SVG;
      eye.onclick = () => revealWord(i);
      w.append(eye);
    }
    w.append(box);
    wrap.append(w);
  });

  const res = $('#result');
  if (complete) {
    const nRevealed = revealed.size;
    res.hidden = false;
    res.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = nRevealed ? `Done — ${nRevealed} word${nRevealed > 1 ? 's' : ''} revealed. ` : 'Perfect! ';
    res.append(strong, document.createTextNode('Press Enter for the next sentence.'));
  } else {
    res.hidden = true;
  }
  return complete;
}

function onInput() {
  const i = progress.idx;
  progress.drafts[i] = $('#answer').value;
  const complete = renderWords();
  if (complete && !progress.done[i]) {
    progress.done[i] = true;
    updateTranscriptItems();
    if (settings.autoNext) autoNextTimer = setTimeout(() => goTo(i + 1), 1200);
  }
  saveProgress();
}

// ---------------------------------------------------------------- transcript list
function renderTranscript() {
  const list = $('#segments');
  list.replaceChildren();
  segments.forEach((seg, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.innerHTML = `<div class="seg-head"><span class="num">#${i + 1}</span><span class="time">${fmt(seg.start)}</span></div><div class="txt"></div>`;
    li.onclick = () => goTo(i, { play: true });
    list.append(li);
  });
  updateTranscriptItems();
}

function updateTranscriptItems() {
  const items = document.querySelectorAll('#segments li');
  items.forEach((li) => {
    const i = Number(li.dataset.i);
    const done = !!progress.done[i];
    li.classList.toggle('active', i === progress.idx);
    li.classList.toggle('done', done);
    const txt = li.querySelector('.txt');
    const show = done || settings.showTranscript;
    txt.classList.toggle('masked', !show);
    txt.textContent = show
      ? segments[i].text
      : tokenize(segments[i].text)
          .map((t) => mask(t, settings.difficulty === 'easy' ? 'normal' : settings.difficulty))
          .join(' ');
  });

  const doneCount = Object.keys(progress.done).length;
  const revealedCount = Object.values(progress.revealed).reduce((a, r) => a + r.length, 0);
  const pct = segments.length ? Math.round((doneCount / segments.length) * 100) : 0;
  $('#progressPct').textContent = pct + '%';
  $('#progressBar').style.width = pct + '%';
  $('#statDone').textContent = doneCount;
  $('#statRevealed').textContent = revealedCount;
  $('#statTotal').textContent = segments.length;
}

// ---------------------------------------------------------------- manual transcript
function openPaste({ blocked = false } = {}) {
  $('#pasteError').textContent = '';
  $('#pasteBlocked').hidden = !blocked;
  if (!$('#pasteUrl').value) $('#pasteUrl').value = $('#urlInput').value;
  $('#pasteDlg').showModal();
}

function submitPaste() {
  const url = $('#pasteUrl').value.trim();
  const id = extractVideoId(url);
  if (!id) return ($('#pasteError').textContent = 'Please enter a valid YouTube URL.');
  const segs = parseTranscript($('#pasteText').value);
  if (!segs.length) return ($('#pasteError').textContent = 'Could not find any timestamps in the transcript.');
  const payload = { videoId: id, title: '', segments: segs, manual: true };
  store.set(`manual:${id}`, payload);
  $('#pasteDlg').close();
  $('#urlInput').value = url;
  start(payload);
}

function extractVideoId(s) {
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12);
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    return u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- UI wiring
function setDifficulty(level) {
  settings.difficulty = level;
  saveSettings();
  document.querySelectorAll('#difficultyTabs button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  if (data) {
    renderWords();
    updateTranscriptItems();
  }
}

function cycleSpeed() {
  settings.speed = SPEEDS[(SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length];
  saveSettings();
  $('#speedLabel').textContent = settings.speed + 'x';
  player?.setPlaybackRate(settings.speed);
}

$('#loadForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#urlInput').value.trim();
  if (url) loadFromUrl(url);
});
$('#pasteSubmit').onclick = submitPaste;

$('#difficultyTabs').addEventListener('click', (e) => {
  const level = e.target.closest('button')?.dataset.level;
  if (level) setDifficulty(level);
});

$('#startBtn').onclick = playSegment;
$('#replayBtn').onclick = playSegment;
$('#replayBtn2').onclick = playSegment;
$('#playBtn').onclick = togglePlay;
$('#prevBtn').onclick = () => goTo(progress.idx - 1);
$('#nextBtn').onclick = () => goTo(progress.idx + 1);
$('#nextBigBtn').onclick = () => goTo(progress.idx + 1);
$('#speedBtn').onclick = cycleSpeed;
$('#keysBtn').onclick = () => $('#keysDlg').showModal();
$('#tutorialBtn').onclick = () => {
  // Point "Try it" at the video the user is on, if any.
  const id = data?.videoId || extractVideoId($('#urlInput').value.trim()) || EXAMPLES[0].videoId;
  $('#tutorialYoutube').href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  showTutorialStep(0);
  $('#tutorialDlg').showModal();
  store.set('tutorialSeen', true);
  $('#tutorialBtn').classList.remove('unseen');
};
// Pulse the Tutorial button until it has been opened once.
if (!store.get('tutorialSeen', false)) $('#tutorialBtn').classList.add('unseen');

let tutorialStep = 0;
function showTutorialStep(i) {
  const slides = document.querySelectorAll('#tutorialDlg .slide');
  tutorialStep = Math.max(0, Math.min(i, slides.length - 1));
  slides.forEach((el, k) => (el.hidden = k !== tutorialStep));
  document.querySelectorAll('#tutorialDlg .dots button').forEach((d, k) => d.classList.toggle('active', k === tutorialStep));
  $('#tutorialPrev').disabled = tutorialStep === 0;
  $('#tutorialNext').textContent = tutorialStep === slides.length - 1 ? 'Got it' : 'Next →';
}
$('#tutorialPrev').onclick = () => showTutorialStep(tutorialStep - 1);
$('#tutorialNext').onclick = () => {
  if (tutorialStep === document.querySelectorAll('#tutorialDlg .slide').length - 1) $('#tutorialDlg').close();
  else showTutorialStep(tutorialStep + 1);
};
$('#tutorialDlg .dots').onclick = (e) => {
  if (e.target.dataset.go) showTutorialStep(Number(e.target.dataset.go));
};
$('#tutorialDlg').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') showTutorialStep(tutorialStep + 1);
  else if (e.key === 'ArrowLeft') showTutorialStep(tutorialStep - 1);
});
$('#showAllBtn').onclick = () => {
  const { states } = compare(tokens, $('#answer').value);
  reveal(states.map((s, i) => (s.state === 'static' || s.state === 'correct' ? -1 : i)).filter((i) => i >= 0));
  renderWords();
  updateTranscriptItems();
};

$('#showTranscript').checked = settings.showTranscript;
$('#showTranscript').onchange = (e) => {
  settings.showTranscript = e.target.checked;
  saveSettings();
  updateTranscriptItems();
};

$('#answer').addEventListener('input', onInput);
document.addEventListener('keydown', (e) => {
  if (!data || document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'Enter') {
    e.preventDefault();
    playSegment();
  } else if (ctrl && e.key === 'ArrowRight') {
    e.preventDefault();
    goTo(progress.idx + 1);
  } else if (ctrl && e.key === 'ArrowLeft') {
    e.preventDefault();
    goTo(progress.idx - 1);
  } else if (ctrl && e.key === 'ArrowUp') {
    e.preventDefault();
    revealNext();
  } else if (ctrl && e.key === 'ArrowDown') {
    e.preventDefault();
    cycleSpeed();
  } else if (e.key === 'Enter' && e.target === $('#answer')) {
    e.preventDefault();
    if (progress.done[progress.idx] && compare(tokens, $('#answer').value).complete) goTo(progress.idx + 1);
    else playSegment();
  }
});

// Settings dialog
$('#settingsBtn').onclick = () => {
  $('#setMode').value = settings.mode;
  $('#setPadBefore').value = settings.padBefore;
  $('#setPadAfter').value = settings.padAfter;
  $('#setAutoplay').checked = settings.autoplay;
  $('#setAutoNext').checked = settings.autoNext;
  $('#settingsDlg').showModal();
};
$('#settingsDlg').addEventListener('close', () => {
  const modeChanged = $('#setMode').value !== settings.mode;
  Object.assign(settings, {
    mode: $('#setMode').value,
    padBefore: Math.max(0, parseFloat($('#setPadBefore').value) || 0),
    padAfter: Math.max(0, parseFloat($('#setPadAfter').value) || 0),
    autoplay: $('#setAutoplay').checked,
    autoNext: $('#setAutoNext').checked,
  });
  saveSettings();
  if (modeChanged && data) buildSegments();
});
function resetProgress() {
  if (!data) return;
  store.remove(progressKey());
  buildSegments();
}
$('#resetProgress').onclick = () => {
  $('#settingsDlg').close();
  resetProgress();
};
// Sits next to Play, so it takes two clicks: the first arms it for a few seconds.
let resetArmTimer = null;
$('#resetBtn').onclick = () => {
  const btn = $('#resetBtn');
  clearTimeout(resetArmTimer);
  if (btn.classList.toggle('confirm')) {
    resetArmTimer = setTimeout(() => btn.classList.remove('confirm'), 3000);
  } else {
    resetProgress();
  }
};

// The bookmarklet source lives in bookmarklet.js; inline it into a javascript: link
// that opens the production site, wherever the bookmark was dragged from
// (a local dev server keeps pointing at itself for testing).
const APP_URL = 'https://betterme.site/';
async function setupBookmarklet() {
  const src = await (await fetch('bookmarklet.js')).text();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const app = local ? location.origin + location.pathname : APP_URL;
  const href = 'javascript:' + encodeURIComponent(src.replaceAll('__APP__', app));
  document.querySelectorAll('.bookmarklet-link').forEach((a) => (a.href = href));
}
// The header bookmark is meant to be dragged; a plain click explains how to use it.
document.querySelector('.topbar .bookmarklet-link').onclick = (e) => {
  e.preventDefault();
  openPaste();
};

// ---------------------------------------------------------------- boot
setDifficulty(settings.difficulty);
$('#speedLabel').textContent = settings.speed + 'x';
renderRecent();
setupBookmarklet();
const initial = new URLSearchParams(location.search).get('v');
const imported = await readHashImport(location.hash).catch((err) => {
  setStatus('Could not read the transcript from the bookmarklet: ' + err.message, { error: true });
  return null;
});
if (imported) {
  history.replaceState(null, '', location.pathname + location.search); // drop the big hash
  store.set(`manual:${imported.videoId}`, imported);
  $('#urlInput').value = `https://www.youtube.com/watch?v=${imported.videoId}`;
  start(imported);
} else if (initial) {
  const url = `https://www.youtube.com/watch?v=${initial}`;
  $('#urlInput').value = url;
  loadFromUrl(url);
}
