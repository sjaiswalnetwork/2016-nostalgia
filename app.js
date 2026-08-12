/* 2016 Nostalgia — player.
   ------------------------------------------------------------------
   A 1×1 YouTube iframe does the decoding; everything on screen is a
   custom UI driving it through the IFrame Player API. That's the whole
   trick — no audio files ship with this site, so there is nothing to
   host and nothing to license.

   Three things follow from it and shape most of the code below:

     1. The API loads asynchronously and the player is unusable until
        onReady. Every control is disabled until then.
     2. Browsers block autoplay with sound, so the first track is *cued*,
        never loaded. `armed` tracks whether a user gesture has happened.
     3. Some videos have embedding disabled by the uploader and fail only
        at play time, with an onError. Those get marked dead and skipped.
*/

(() => {
  'use strict';

  const TRACKS = window.TRACKS || [];
  const BUMPERS = window.BUMPERS || [];
  const STORE = 'n2016:v1';
  const THEME_STORE = 'n2016:theme';

  const $ = (id) => document.getElementById(id);

  const el = {
    body: document.body,
    clock: $('clock'),
    tally: document.querySelector('.tally'),
    tallyNum: $('tallyNum'),
    tallyLabel: $('tallyLabel'),
    themeBtn: $('themeBtn'),
    plug: $('plug'),
    bumper: document.querySelector('.bumper'),
    bumperText: $('bumperText'),
    bumperNext: $('bumperNext'),
    disc: $('disc'),
    cover: $('cover'),
    title: $('title'),
    artist: $('artist'),
    seek: $('seek'),
    seekFill: $('seekFill'),
    seekKnob: $('seekKnob'),
    tCur: $('tCur'),
    tDur: $('tDur'),
    shuffle: $('shuffle'),
    prev: $('prev'),
    play: $('play'),
    next: $('next'),
    listBtn: $('listBtn'),
    list: $('list'),
    listItems: $('listItems'),
    toast: $('toast'),
  };

  /* ── State ─────────────────────────────────────────────────────── */

  let player = null;
  let ready = false;
  let armed = false; // a user gesture has happened; safe to autoplay
  let shuffle = true;
  let order = []; // indices into TRACKS, in play order
  let cursor = 0; // position within `order`
  let dead = new Set(); // TRACKS indices YouTube refused to embed
  let ticker = null;
  let dragging = false;
  let skidCount = 0; // consecutive embed failures, to stop a runaway skip
  let wantPlaying = false; // we asked for sound; the user hasn't paused
  let adShowing = false;
  let stalledAt = 0; // when the "asked to play but isn't" window opened

  const track = () => TRACKS[order[cursor]];
  const thumb = (id, big) =>
    `https://i.ytimg.com/vi/${id}/${big ? 'hqdefault' : 'mqdefault'}.jpg`;

  /* ── Helpers ───────────────────────────────────────────────────── */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function mmss(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-up'), 2400);
  }

  /* Fisher–Yates, but the current track is pulled to the front afterwards
     so hitting shuffle mid-song doesn't interrupt what's playing. */
  function shuffled(keep) {
    const a = TRACKS.map((_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (keep != null) {
      const at = a.indexOf(keep);
      if (at > 0) [a[0], a[at]] = [a[at], a[0]];
    }
    return a;
  }

  function save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({ id: track() ? track().id : null, shuffle })
      );
    } catch (_) {
      /* Private mode, or storage full. Losing the resume point is fine. */
    }
  }

  function restore() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || {};
    } catch (_) {
      return {};
    }
  }

  /* ── Playlist UI ───────────────────────────────────────────────── */

  function renderList() {
    const frag = document.createDocumentFragment();

    order.forEach((tIndex, pos) => {
      const t = TRACKS[tIndex];
      const li = document.createElement('li');
      if (pos === cursor) li.className = 'is-current';
      if (dead.has(tIndex)) li.classList.add('is-dead');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML =
        `<span class="list__num">${pos + 1}</span><span>` +
        `<span class="list__title"></span><span class="list__artist"></span></span>`;
      // Titles come from a data file, but they still go in as text — one
      // stray apostrophe or ampersand shouldn't be able to break markup.
      btn.querySelector('.list__title').textContent = t.title;
      btn.querySelector('.list__artist').textContent = t.artist;
      btn.addEventListener('click', () => {
        cursor = pos;
        go(true);
        closeList();
      });

      li.appendChild(btn);
      frag.appendChild(li);
    });

    el.listItems.replaceChildren(frag);
  }

  function markCurrent() {
    [...el.listItems.children].forEach((li, i) => {
      li.classList.toggle('is-current', i === cursor);
      li.classList.toggle('is-dead', dead.has(order[i]));
    });
  }

  function openList() {
    el.list.hidden = false;
    el.listBtn.classList.add('is-on');
    el.listBtn.setAttribute('aria-expanded', 'true');
    const cur = el.listItems.children[cursor];
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function closeList() {
    el.list.hidden = true;
    el.listBtn.classList.remove('is-on');
    el.listBtn.setAttribute('aria-expanded', 'false');
  }

  /* ── Now playing ───────────────────────────────────────────────── */

  function paintTrack() {
    const t = track();
    if (!t) return;

    el.title.textContent = t.title;
    el.artist.textContent = t.artist;
    document.title = `${t.title} — ${t.artist} · 2016 Nostalgia`;

    el.cover.classList.remove('is-loaded');
    el.cover.onload = () => el.cover.classList.add('is-loaded');
    el.cover.src = thumb(t.id, false);
    el.cover.alt = `${t.title} by ${t.artist}`;

    setSeek(0, 0);
    markCurrent();

    // Lock screen / media keys on phones and desktops that support it.
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: '2016 Nostalgia',
        artwork: [{ src: thumb(t.id, true), sizes: '480x360', type: 'image/jpeg' }],
      });
    }
  }

  /* Load the track at `cursor`. `play` false cues it silently instead —
     that's the very first track, before any user gesture exists. */
  function go(play) {
    const t = track();
    if (!t || !ready) return;

    // Clear it outright rather than just dropping the class: leaving the
    // flag set makes the next checkAd() see no change and skip restoring
    // the title, stranding the advert label over a track that has already
    // moved on. The timer resets too, or the new track inherits the last
    // one's stall and flashes the label instantly.
    adShowing = false;
    stalledAt = 0;
    lastSeenTime = -1;
    el.body.classList.remove('is-ad');

    paintTrack();
    if (play) {
      armed = true;
      wantPlaying = true;
      player.loadVideoById(t.id);
    } else {
      player.cueVideoById(t.id);
    }
    save();
  }

  function step(delta) {
    if (!order.length) return;
    cursor = (cursor + delta + order.length) % order.length;
    go(armed);
  }

  /* Previous doubles as "restart this track" for the first few seconds,
     the way every other player behaves. */
  function prev() {
    if (ready && player.getCurrentTime() > 3) {
      player.seekTo(0, true);
      return;
    }
    step(-1);
  }

  function toggle() {
    if (!ready) return;
    if (!armed) {
      // First press: the cued video needs an explicit load to get sound
      // on iOS, which ignores playVideo() on a merely-cued player.
      armed = true;
      wantPlaying = true;
      player.loadVideoById(track().id);
      return;
    }

    // Mid-advert the song reports itself paused, so asking the player what
    // to do next would restart the advert rather than stop it. `adShowing`
    // is the only thing that knows sound is actually coming out.
    const s = player.getPlayerState();
    const sounding = adShowing || s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING;

    if (sounding) {
      wantPlaying = false;
      setAd(false); // stop claiming an advert once we've stopped asking for sound
      player.pauseVideo();
    } else {
      wantPlaying = true;
      player.playVideo();
    }
  }

  /* ── Progress ──────────────────────────────────────────────────── */

  function setSeek(cur, dur) {
    const pct = dur > 0 ? clamp((cur / dur) * 100, 0, 100) : 0;
    el.seekFill.style.width = pct + '%';
    el.seekKnob.style.left = pct + '%';
    el.tCur.textContent = mmss(cur);
    el.tDur.textContent = mmss(dur);
    el.seek.setAttribute('aria-valuenow', Math.round(pct));
    el.seek.setAttribute('aria-valuetext', `${mmss(cur)} of ${mmss(dur)}`);
  }

  /* ── Ads ───────────────────────────────────────────────────────────
   *
   * YouTube serves the audio, so YouTube sells the pre-rolls, and there is
   * no API for skipping or suppressing them — nor should there be; the
   * plays are what pay the artists. What we *can* do is stop lying about
   * them: without this, an ad plays while the dock still shows the song
   * title and the seek bar counts through the advert's runtime, which
   * reads as a broken player rather than an advert.
   *
   * There is no official ad hook — `getAdState` does not exist, and during
   * a pre-roll `getVideoData().video_id` still reports the *song*, so
   * comparing ids finds nothing. What the player does betray is its state:
   * it reports the song as not-started while the advert plays over the top,
   * and `getDuration()` is already the song's full length. So the tell is
   * simply "we asked for sound, sound is presumably coming out, and yet the
   * song claims it hasn't begun".
   *
   * State alone isn't enough, though: this player can sit in CUED for
   * several seconds on a slow connection, which would flash the label at
   * someone who is merely waiting. The separator is the clock. During an
   * advert `getCurrentTime()` runs — it's the advert's own position — while
   * the song still claims not to have started. A slow load leaves it at
   * zero. So the test is "a clock is running that cannot be the song's".
   *
   * A user-initiated pause clears `wantPlaying`, and normal playback
   * reports PLAYING, so neither is mistaken for an advert. If a future
   * player stops leaking the advert's clock this simply never fires, and
   * the behaviour is what it was before.
   */
  const AD_STATES = [-1, 2, 5]; // UNSTARTED, PAUSED, CUED
  const AD_AFTER_MS = 800;
  let lastSeenTime = -1;

  function setAd(on) {
    if (on === adShowing) return;
    adShowing = on;
    el.body.classList.toggle('is-ad', on);

    const t = track();
    el.title.textContent = on ? 'Ad — your song is next' : t ? t.title : '';
    el.artist.textContent = on ? 'it starts on its own' : t ? t.artist : '';
    paintPlayState();
  }

  function checkAd() {
    if (!armed || !wantPlaying) {
      stalledAt = 0;
      lastSeenTime = -1;
      return setAd(false);
    }

    let s, now;
    try {
      s = player.getPlayerState();
      now = player.getCurrentTime() || 0;
    } catch (_) {
      return;
    }

    if (!AD_STATES.includes(s)) {
      stalledAt = 0;
      lastSeenTime = now;
      return setAd(false);
    }

    // Needs two samples to say anything, so the first tick only arms it.
    const running = lastSeenTime >= 0 && now > lastSeenTime + 0.05;
    lastSeenTime = now;

    if (!running) {
      stalledAt = 0; // waiting on the network, not sitting through an advert
      return setAd(false);
    }

    if (!stalledAt) stalledAt = Date.now();
    setAd(Date.now() - stalledAt > AD_AFTER_MS);
  }

  /* A 250ms interval rather than requestAnimationFrame: the numbers only
     change a few times a second, and an interval keeps ticking when the
     tab is backgrounded — which is exactly when music is still playing. */
  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (dragging || !ready) return;
      checkAd();
      // Leave the bar where it was: painting the advert's clock onto the
      // song's progress is the exact confusion this is here to avoid.
      if (adShowing) return;
      setSeek(player.getCurrentTime() || 0, player.getDuration() || 0);
    }, 250);
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  /* ── Seek bar ──────────────────────────────────────────────────── */

  function ratioFrom(clientX) {
    const r = el.seek.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1);
  }

  function scrubTo(clientX, commit) {
    const dur = player.getDuration() || 0;
    if (!dur) return;
    const at = ratioFrom(clientX) * dur;
    setSeek(at, dur);
    if (commit) player.seekTo(at, true);
  }

  el.seek.addEventListener('pointerdown', (e) => {
    if (!ready || !armed) return;
    dragging = true;
    el.seek.classList.add('is-dragging');
    el.seek.setPointerCapture(e.pointerId);
    scrubTo(e.clientX, false);
  });

  el.seek.addEventListener('pointermove', (e) => {
    if (dragging) scrubTo(e.clientX, false);
  });

  el.seek.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    el.seek.classList.remove('is-dragging');
    scrubTo(e.clientX, true);
  });

  el.seek.addEventListener('keydown', (e) => {
    if (!ready || !armed) return;
    const dur = player.getDuration() || 0;
    const cur = player.getCurrentTime() || 0;
    const jump = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (jump == null) return;
    e.preventDefault();
    player.seekTo(clamp(cur + jump, 0, dur), true);
  });

  /* ── YouTube player ────────────────────────────────────────────── */

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt-player', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        rel: 0,
        fs: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        // The API rejects a null origin, which is what file:// reports —
        // so this is only sent when the page is actually served.
        ...(location.protocol.startsWith('http') ? { origin: location.origin } : {}),
      },
      events: { onReady, onStateChange, onError },
    });
  };

  function onReady() {
    ready = true;
    el.play.disabled = false;
    go(false); // cue, don't play — no gesture has happened yet
    el.title.textContent = track() ? track().title : 'Nothing here';
    startTicker();
  }

  /* One place decides how the transport looks, because two do not agree:
     during an advert the song's own state says "paused" while sound is
     very much coming out, and a pause button that reads as play is exactly
     the confusion being fixed here. */
  function paintPlayState() {
    let s = -1;
    try {
      s = player.getPlayerState();
    } catch (_) {}

    const playing = adShowing || s === YT.PlayerState.PLAYING;
    el.body.classList.toggle('is-playing', playing);
    el.body.classList.toggle('is-buffering', !adShowing && s === YT.PlayerState.BUFFERING);
    el.disc.classList.toggle('is-spinning', playing);
    el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }

  function onStateChange(e) {
    const S = YT.PlayerState;

    // Runs first: the advert check decides what "playing" even means below.
    checkAd();
    paintPlayState();

    if (e.data === S.PLAYING) {
      skidCount = 0; // it played, so the run of dead tracks is over
      if (!adShowing) setSeek(player.getCurrentTime() || 0, player.getDuration() || 0);
    }

    if (e.data === S.ENDED) {
      wantPlaying = true; // rolling on to the next track, not stopping
      step(1);
    }
  }

  /* 101 and 150 both mean "the uploader disabled embedding"; 100 means the
     video is gone. Either way the track is unplayable here — strike it off
     and move on, unless we've just struck off ten in a row, which means
     something broader is wrong and skipping forever would only spin. */
  function onError(e) {
    const code = e.data;
    const idx = order[cursor];
    if ([100, 101, 150, 5, 2].includes(code)) dead.add(idx);
    markCurrent();

    if (++skidCount > 10) {
      toast("Can't reach YouTube right now");
      return;
    }
    toast(`Skipping — ${TRACKS[idx].title} won't play here`);
    step(1);
  }

  /* ── The plug chime ────────────────────────────────────────────── */

  let ctx = null;

  /* Four notes, synthesised. Shipping an mp3 for this would be a request,
     a licence question and a cache entry for about 600ms of sound. */
  function chime() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (_) {
      return;
    }

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const bus = ctx.createGain();
    bus.gain.value = 0.18;
    bus.connect(ctx.destination);

    notes.forEach((hz, i) => {
      const t = now + i * 0.085;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }

  el.plug.addEventListener('click', () => {
    chime();
    el.plug.classList.add('is-live');
    setTimeout(() => el.plug.classList.remove('is-live'), 460);
    toast('aux secured · 2016 forever');
  });

  /* ── Bumper line ───────────────────────────────────────────────── */

  let bumperAt = 0;

  function nextBumper() {
    if (!BUMPERS.length) return;
    bumperAt = (bumperAt + 1) % BUMPERS.length;
    el.bumper.classList.add('is-swapping');
    setTimeout(() => {
      el.bumperText.textContent = BUMPERS[bumperAt];
      el.bumper.classList.remove('is-swapping');
    }, 180);
  }

  el.bumperNext.addEventListener('click', nextBumper);

  /* ── Clock ─────────────────────────────────────────────────────── */

  function tickClock() {
    el.clock.textContent = new Date()
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      .toLowerCase();
  }

  /* ── Theme ─────────────────────────────────────────────────────── */

  /* The initial value is set by an inline script in <head>, before first
     paint — doing it here instead would flash the wrong sky. This only
     handles changes. */
  let theme = document.documentElement.dataset.theme === 'beach' ? 'beach' : 'dusk';

  function paintTheme() {
    document.documentElement.dataset.theme = theme;
    const next = theme === 'beach' ? 'dusk' : 'beach';
    el.themeBtn.setAttribute(
      'aria-label',
      next === 'beach' ? 'Switch to the beach' : 'Switch to the city at dusk'
    );
    // The browser chrome on mobile is tinted from this.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'beach' ? '#7fd4ea' : '#120a2e';
    paintTally();
  }

  el.themeBtn.addEventListener('click', () => {
    theme = theme === 'beach' ? 'dusk' : 'beach';
    try {
      localStorage.setItem(THEME_STORE, theme);
    } catch (_) {}
    paintTheme();
    toast(theme === 'beach' ? 'Sun’s out' : 'Sun’s down');
  });

  /* ── Who else is here ──────────────────────────────────────────── */

  /* presence.js is optional and entirely self-contained; it announces a
     count on `window` and knows nothing about this markup. Until (or
     unless) it does, the top bar shows how many tracks are loaded. */
  let listeners = null;

  function paintTally() {
    if (listeners == null) {
      el.tally.classList.remove('is-live');
      el.tallyNum.textContent = String(TRACKS.length);
      el.tallyLabel.textContent = 'songs from 2016';
      return;
    }
    el.tally.classList.add('is-live');
    el.tallyNum.textContent = String(listeners);
    el.tallyLabel.textContent =
      (listeners === 1 ? 'person' : 'people') +
      (theme === 'beach' ? ' on the beach' : ' up late');
  }

  addEventListener('presence', (e) => {
    listeners = e.detail.count;
    paintTally();
  });

  /* ── Controls ──────────────────────────────────────────────────── */

  el.play.addEventListener('click', toggle);
  el.next.addEventListener('click', () => step(1));
  el.prev.addEventListener('click', prev);

  el.shuffle.addEventListener('click', () => {
    shuffle = !shuffle;
    const keep = order.length ? order[cursor] : 0;
    order = shuffle ? shuffled(keep) : TRACKS.map((_, i) => i);
    cursor = Math.max(0, order.indexOf(keep));
    el.shuffle.classList.toggle('is-on', shuffle);
    el.shuffle.setAttribute('aria-pressed', String(shuffle));
    renderList();
    save();
    toast(shuffle ? 'Shuffled' : 'In order');
  });

  el.listBtn.addEventListener('click', () => {
    el.list.hidden ? openList() : closeList();
  });

  // Click-away and Escape both close the playlist.
  document.addEventListener('pointerdown', (e) => {
    if (el.list.hidden) return;
    if (!el.list.contains(e.target) && !el.listBtn.contains(e.target)) closeList();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.list.hidden) return closeList();

    // Don't hijack keys the focused control already handles.
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && (tag === 'button' || e.target === el.seek)) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        toggle();
        break;
      case 'ArrowRight':
        if (ready && armed) player.seekTo((player.getCurrentTime() || 0) + 5, true);
        break;
      case 'ArrowLeft':
        if (ready && armed) player.seekTo(Math.max(0, (player.getCurrentTime() || 0) - 5), true);
        break;
      case 'n':
        step(1);
        break;
      case 'p':
        prev();
        break;
      case 'l':
        el.list.hidden ? openList() : closeList();
        break;
      case 's':
        el.shuffle.click();
        break;
      case 'b':
        nextBumper();
        break;
      case 't':
        el.themeBtn.click();
        break;
    }
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', toggle);
      ms.setActionHandler('pause', toggle);
      ms.setActionHandler('nexttrack', () => step(1));
      ms.setActionHandler('previoustrack', prev);
    } catch (_) {
      /* Older browsers throw on unknown actions. Not worth branching on. */
    }
  }

  /* ── Boot ──────────────────────────────────────────────────────── */

  function boot() {
    if (!TRACKS.length) {
      el.title.textContent = 'No tracks loaded';
      return;
    }

    paintTheme(); // also paints the tally
    bumperAt = Math.floor(Math.random() * BUMPERS.length);
    el.bumperText.textContent = BUMPERS[bumperAt] || '';

    tickClock();
    setInterval(tickClock, 15000);

    const saved = restore();
    shuffle = saved.shuffle !== false;
    el.shuffle.classList.toggle('is-on', shuffle);
    el.shuffle.setAttribute('aria-pressed', String(shuffle));

    // Resume on the track you left, wherever shuffle happens to put it.
    const last = saved.id ? TRACKS.findIndex((t) => t.id === saved.id) : -1;
    const seed = last >= 0 ? last : Math.floor(Math.random() * TRACKS.length);
    order = shuffle ? shuffled(seed) : TRACKS.map((_, i) => i);
    cursor = Math.max(0, order.indexOf(seed));

    renderList();
    paintTrack();
    el.title.textContent = 'Winding the tape…';

    // Load the IFrame API last, so the UI is painted before the network
    // goes anywhere near YouTube.
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  boot();
})();
