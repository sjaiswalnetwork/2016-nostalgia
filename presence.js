/* ── Who else is here ──────────────────────────────────────────────
 *
 * Loaded as a module so it can pull the Firebase SDK straight off Google's
 * CDN — no build step, no node_modules. Everything here is optional: if
 * `config.js` is blank, or the network is unhappy, this file does nothing
 * and the top bar keeps showing the track count.
 *
 * How the count works
 * -------------------
 * Each open tab pushes one child under `presence/` and registers an
 * `onDisconnect` handler for it. Firebase runs that handler server-side the
 * moment the socket drops, so a closed laptop or a phone that walked into a
 * lift stops being counted without the page needing to say goodbye.
 *
 * `onDisconnect` covers the usual exits, but not a server that never noticed
 * the socket die. So each tab also stamps a timestamp and refreshes it every
 * 45 seconds, and readers ignore anything staler than two minutes. Ghosts
 * therefore expire on their own rather than inflating the number forever.
 *
 * The count is reported through a callback rather than touching the DOM, so
 * the UI wording lives with the rest of the UI in app.js.
 */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const HEARTBEAT_MS = 45_000;
const STALE_MS = 120_000;

const cfg = window.PRESENCE || {};

function report(count) {
  window.dispatchEvent(new CustomEvent('presence', { detail: { count } }));
}

async function start() {
  if (!cfg.apiKey || !cfg.databaseURL) return; // not configured — stay quiet

  const [{ initializeApp }, db] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-database.js'),
  ]);

  const {
    getDatabase, ref, push, set, remove, onValue,
    onDisconnect, serverTimestamp,
  } = db;

  const app = initializeApp({ apiKey: cfg.apiKey, databaseURL: cfg.databaseURL });
  const rt = getDatabase(app);

  const all = ref(rt, 'presence');
  const me = push(all); // a unique key for this tab

  // `.info/connected` is a local-only flag that flips on every reconnect.
  // Re-arming onDisconnect here (rather than once at startup) is what keeps
  // the entry self-cleaning across dropped wifi and sleeping laptops.
  onValue(ref(rt, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(me).remove();
    set(me, { t: serverTimestamp() });
  });

  setInterval(() => set(me, { t: serverTimestamp() }), HEARTBEAT_MS);

  onValue(all, (snap) => {
    const now = Date.now();
    let live = 0;
    snap.forEach((child) => {
      const t = child.val() && child.val().t;
      // A just-written stamp can read back as null for a beat while the
      // server resolves it — count those rather than flickering the number.
      if (t == null || now - t < STALE_MS) live++;
    });
    report(Math.max(live, 1)); // you are, at minimum, here yourself
  });

  // Best-effort tidy-up. onDisconnect is the real guarantee; this just makes
  // the number drop instantly for everyone else when a tab closes normally.
  addEventListener('pagehide', () => remove(me));
}

start().catch(() => {
  /* Blocked SDK, offline, bad config — the counter simply never appears. */
});
