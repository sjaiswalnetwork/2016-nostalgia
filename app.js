/* UI for the excuse engine. Keeps the last 40 signatures so a session never
   serves you the same combination twice, and remembers your settings. */
(function () {
  'use strict';

  const E = window.ExcuseEngine;
  const L = window.ExcuseLive;
  const $ = function (id) { return document.getElementById(id); };

  const el = {
    region: $('region'), city: $('city'), scenario: $('scenario'), tone: $('tone'),
    seasonal: $('seasonal'), go: $('go'), again: $('again'), copy: $('copy'),
    excuse: $('excuse'), chips: $('chips'), controls: $('controls'),
    meterCard: $('meterCard'), band: $('band'), fill: $('fill'), checks: $('checks'),
    factsCard: $('factsCard'), facts: $('facts'),
    history: $('history'), histHead: $('histHead'), live: $('live'),
    livePanel: $('livePanel'), liveBadge: $('liveBadge'), liveSub: $('liveSub'),
    useLive: $('useLive'), refreshLive: $('refreshLive'), dropLive: $('dropLive'),
    obs: $('obs')
  };

  const STORE = 'alibi.settings.v1';
  const seen = new Set();   /* signatures served this session */
  const past = [];          /* previous excuse texts, newest first */
  let current = null;
  let liveData = null;      /* real conditions, once granted */

  const DEFAULT_SUB = el.liveSub.textContent;

  /* ------------------------------------------------------------- dropdowns */

  function opt(value, label) {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    return o;
  }

  function buildSelects() {
    el.region.append(opt('', 'Anywhere'));
    Object.keys(E.regions).forEach(function (k) {
      el.region.append(opt(k, E.regions[k].label));
    });

    el.scenario.append(opt('', 'Surprise me'));
    E.scenarios.forEach(function (s) { el.scenario.append(opt(s.id, s.label)); });

    el.tone.append(opt('', 'Surprise me'));
    E.tones.forEach(function (t) { el.tone.append(opt(t.id, t.label)); });

    refreshCities();
  }

  function refreshCities() {
    const region = el.region.value;
    const keep = el.city.value;
    el.city.innerHTML = '';
    el.city.append(opt('', 'Any city'));
    const keys = region ? [region] : Object.keys(E.regions);
    keys.forEach(function (k) {
      E.regions[k].cities.forEach(function (c) { el.city.append(opt(c.name, c.name)); });
    });
    /* keep the chosen city if it still exists in the new region */
    if (keep && Array.prototype.some.call(el.city.options, function (o) { return o.value === keep; })) {
      el.city.value = keep;
    }
  }

  /* -------------------------------------------------------------- settings */

  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        region: el.region.value, city: el.city.value,
        scenario: el.scenario.value, tone: el.tone.value,
        seasonal: el.seasonal.checked
      }));
    } catch (e) { /* private mode — settings just won't persist */ }
  }

  function loadSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
    if (!s) return;
    if (s.region) { el.region.value = s.region; refreshCities(); }
    if (s.city) el.city.value = s.city;
    if (s.scenario) el.scenario.value = s.scenario;
    if (s.tone) el.tone.value = s.tone;
    if (typeof s.seasonal === 'boolean') el.seasonal.checked = s.seasonal;
  }

  /* --------------------------------------------------------------- render */

  function scoreColor(score) {
    if (score >= 85) return 'var(--good)';
    if (score >= 70) return 'var(--mid)';
    return 'var(--bad)';
  }

  function render(r) {
    current = r;
    el.excuse.textContent = r.text;

    el.chips.innerHTML = '';
    const chips = r.meta.live
      ? ['live · ' + r.meta.observedAtLabel, r.meta.city, r.meta.weather, r.meta.tone, r.meta.scenario]
      : [r.meta.city, r.meta.weather, r.meta.tone, r.meta.scenario,
        r.meta.seasonMatch ? 'in season' : 'out of season'];
    chips.forEach(function (t) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = t;
      el.chips.append(c);
    });

    el.meterCard.hidden = false;
    el.band.textContent = r.meta.band + ' · ' + r.meta.score + '/100';
    el.band.style.color = scoreColor(r.meta.score);
    el.fill.style.width = r.meta.score + '%';
    el.fill.style.background = scoreColor(r.meta.score);

    el.checks.innerHTML = '';
    r.meta.checks.forEach(function (c) {
      const li = document.createElement('li');
      li.textContent = c;
      el.checks.append(li);
    });

    el.factsCard.hidden = false;
    el.facts.innerHTML = '';
    r.meta.facts.forEach(function (pair) {
      const row = document.createElement('div');
      row.className = 'fact';
      const dt = document.createElement('dt'); dt.textContent = pair[0];
      const dd = document.createElement('dd'); dd.textContent = pair[1];
      row.append(dt, dd);
      el.facts.append(row);
    });

    el.live.textContent = 'New excuse: ' + r.text;
  }

  function renderHistory() {
    el.history.innerHTML = '';
    el.histHead.hidden = past.length === 0;
    past.slice(0, 6).forEach(function (text) {
      const wrap = document.createElement('div');
      wrap.className = 'hist';
      const p = document.createElement('p');
      p.textContent = text;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Copy';
      b.addEventListener('click', function () { copyText(text, b); });
      wrap.append(p, b);
      el.history.append(wrap);
    });
  }

  /* ------------------------------------------------------------- generate */

  function generate() {
    if (current) {
      past.unshift(current.text);
      if (past.length > 6) past.length = 6;
    }
    const r = E.generate({
      live: liveData,   /* when set, overrides region/city/season entirely */
      region: el.region.value || null,
      city: el.city.value || null,
      scenario: el.scenario.value || null,
      tone: el.tone.value || null,
      seasonal: el.seasonal.checked,
      avoid: seen
    });
    if (!r) return;
    seen.add(r.signature);
    if (seen.size > 40) seen.delete(seen.values().next().value);
    render(r);
    renderHistory();
  }

  /* ----------------------------------------------------------------- copy */

  function flash(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1100);
  }

  function copyText(text, btn) {
    const done = function () { flash(btn, 'Copied'); el.live.textContent = 'Copied to clipboard.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, btn, done); });
    } else {
      fallbackCopy(text, btn, done);
    }
  }

  /* Some contexts refuse the clipboard entirely (unfocused documents, Safari
     without a gesture). Then the useful thing is to select the text so the user
     can press Ctrl+C themselves, rather than just saying it failed. */
  function fallbackCopy(text, btn, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (ok) { done(); return; }

    if (text === (current && current.text)) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el.excuse);
      sel.removeAllRanges();
      sel.addRange(range);
      flash(btn, 'Press Ctrl+C');
      el.live.textContent = 'Clipboard blocked — the excuse is selected, press Ctrl+C to copy.';
    } else {
      flash(btn, 'Copy failed');
    }
  }

  /* ------------------------------------------------------ live conditions */

  const ROAD_SOURCE_NOTE = {
    nearby: 'road names are real ones within 2.5 km of you',
    city: 'nearby-road lookup was down, so these are real arterials for your city',
    street: 'nearby-road lookup was down, so this is the street you are on',
    generic: 'no road names were available, so the road is generic'
  };

  function renderObs(live) {
    const rows = [
      ['Where', live.area === live.city ? live.city : live.area + ', ' + live.city],
      ['Conditions', live.weatherLabel],
      ['Temperature', Math.round(live.tempC) + '°C'],
      ['Local time', live.observedAt],
      ['Roads found', live.roadCount]
    ];
    el.obs.innerHTML = '';
    rows.forEach(function (pair) {
      const d = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = pair[0];
      const dd = document.createElement('dd'); dd.textContent = pair[1];
      d.append(dt, dd);
      el.obs.append(d);
    });
    el.obs.hidden = false;
  }

  function setLiveUI(on) {
    el.livePanel.classList.toggle('on', on);
    el.liveBadge.hidden = !on;
    el.controls.classList.toggle('muted', on);
    el.seasonal.disabled = on;
    el.useLive.hidden = on;
    el.refreshLive.hidden = !on;
    el.dropLive.hidden = !on;
    el.obs.hidden = !on;
  }

  function applyLive(live) {
    liveData = live;
    const note = ROAD_SOURCE_NOTE[live.roadSource] || '';
    el.liveSub.classList.remove('err');
    el.liveSub.textContent = 'Using real conditions in ' + live.city + ' — ' + note + '.' +
      (live.weatherId ? '' : ' The sky is clear right now, so there is no weather to blame.');
    renderObs(live);
    setLiveUI(true);
    generate();
  }

  function requestLive(force) {
    const btn = force ? el.refreshLive : el.useLive;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = force ? 'Refreshing…' : 'Locating…';
    el.liveSub.classList.remove('err');
    el.liveSub.textContent = 'Waiting for the browser location prompt, then fetching weather and nearby roads…';

    /* Overpass sometimes answers after we have already shown an excuse; when it
       does, quietly adopt the better road names for the next one. */
    const onRoads = function (upgraded) {
      if (!liveData) return;
      liveData = upgraded;
      renderObs(upgraded);
      el.liveSub.textContent = 'Using real conditions in ' + upgraded.city + ' — ' +
        ROAD_SOURCE_NOTE.nearby + '.';
    };

    L.get({ force: !!force, onRoads: onRoads }).then(function (live) {
      btn.disabled = false; btn.textContent = label;
      applyLive(live);
    }, function (err) {
      btn.disabled = false; btn.textContent = label;
      liveData = null;
      setLiveUI(false);
      el.liveSub.classList.add('err');
      el.liveSub.textContent = err.message.replace(/\.?$/, '.') + ' Still generating from invented places.';
      generate();
    });
  }

  function dropLive() {
    liveData = null;
    L.clearCache();
    setLiveUI(false);
    el.liveSub.classList.remove('err');
    el.liveSub.textContent = DEFAULT_SUB;
    generate();
  }

  /* --------------------------------------------------------------- wiring */

  buildSelects();
  loadSettings();

  el.useLive.addEventListener('click', function () { requestLive(false); });
  el.refreshLive.addEventListener('click', function () { requestLive(true); });
  el.dropLive.addEventListener('click', dropLive);

  if (!L.secure()) {
    el.useLive.disabled = true;
    el.liveSub.classList.add('err');
    el.liveSub.textContent = location.protocol === 'file:'
      ? 'Live conditions need the page served over http, not opened as a local file — browsers ' +
        'block location on file:// URLs. This unlocks itself on your GitHub Pages URL.'
      : 'Live conditions need an https:// page. This unlocks itself once the app is on GitHub Pages.';
  }

  el.go.addEventListener('click', generate);
  el.again.addEventListener('click', generate);
  el.copy.addEventListener('click', function () {
    if (current) copyText(current.text, el.copy);
  });

  el.region.addEventListener('change', function () { refreshCities(); saveSettings(); generate(); });
  [el.city, el.scenario, el.tone].forEach(function (s) {
    s.addEventListener('change', function () { saveSettings(); generate(); });
  });
  el.seasonal.addEventListener('change', function () { saveSettings(); generate(); });

  document.addEventListener('keydown', function (ev) {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.code === 'Space' || ev.key === 'Enter') { ev.preventDefault(); generate(); }
    else if (ev.key === 'c' || ev.key === 'C') { if (current) copyText(current.text, el.copy); }
  });

  generate();
})();
