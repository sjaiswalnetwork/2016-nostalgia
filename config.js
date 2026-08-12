/* ── Live listener count ───────────────────────────────────────────
 *
 * GitHub Pages serves static files and nothing else, so counting who is
 * on the page needs one small outside service. This uses a Firebase
 * Realtime Database, which has a free tier and — crucially — an
 * `onDisconnect` hook, so a browser that closes, crashes or loses signal
 * removes itself without the page having to notice.
 *
 * Leave this file exactly as it is and the site works fine: the counter
 * simply hides itself and the top bar shows the track count instead.
 *
 * To switch it on, follow "Turning on the live count" in the README, then
 * paste the two values below. Both are safe to commit — a Firebase web
 * apiKey identifies the project, it does not grant access. What actually
 * guards the data is the security rule the README gives you.
 */
window.PRESENCE = {
  // e.g. 'AIzaSyB...'
  apiKey: '',
  // e.g. 'https://nostalgia-2016-default-rtdb.asia-southeast1.firebasedatabase.app'
  databaseURL: '',
};
