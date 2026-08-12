# 2016 Nostalgia

A one-screen music site for the year the aux cable was a social contract.
78 songs, two skies, and a player that stays out of the way.

**Live:** https://sjaiswalnetwork.github.io/2016-nostalgia/

---

## How it works

There are no audio files in this repo, and there is nothing to license or host.
A **1×1 YouTube iframe**, parked off-screen, does all the decoding. Everything you
can see is a custom UI driving that iframe through the
[IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
Cover art is pulled from `i.ytimg.com` at runtime.

Three consequences shape most of `app.js`:

1. **The API is async.** The player is unusable until `onReady`, so every control
   starts disabled.
2. **Browsers block autoplay with sound.** The first track is *cued*, never loaded.
   A flag tracks whether a real user gesture has happened yet.
3. **Some videos can't be embedded.** Uploaders can disable embedding, and it only
   fails at play time via `onError`. Those tracks get struck through in the
   playlist and skipped automatically.

Everything else is plain files and no build step.

```
index.html      markup + both SVG scenes
styles.css      all of the design; themes are variables, scenes key off --horizon
app.js          player, playlist, seek, keyboard, theme, Media Session
tracks.js       the 78 tracks + the rotating one-liners — edit this, not app.js
config.js       optional: Firebase keys for the live listener count
presence.js     optional: the live listener count itself
assets/
  favicon.svg
  og.png        link-preview card
  og.html       source for og.png, so the card never drifts from the site
```

## Two skies

There's a **dusk** scene (city, sunset, parked car) and a **beach** scene (midday
sun, sea, sand, palms). The button in the top right switches them, and the choice
sticks. With no saved choice the site matches the time of day where you are —
beach between 6am and 5pm, dusk otherwise.

Both scenes are positioned against a single `--horizon` variable rather than being
one scaled image, which is what keeps the sun, the waterline and the ground welded
together at any window shape. Colours are all CSS variables under
`[data-theme='beach']`, so a third scene would be a palette and a few layers, not
a rewrite.

## Changing the music

Edit `tracks.js`. One line per song:

```js
{ id: 'u-YGV5xt-jk', title: 'Closer', artist: 'The Chainsmokers ft. Halsey' },
```

`id` is the YouTube video id — the `v=` parameter in a watch URL. Nothing else
needs touching: the count in the top bar, the playlist and the cover art all come
from this array. The one-liners under the wordmark live in the same file, in
`BUMPERS`.

## Keyboard

| Key | |
|---|---|
| `Space` | play / pause |
| `←` `→` | back / forward 5s |
| `n` / `p` | next / previous |
| `l` | playlist |
| `s` | shuffle |
| `t` | switch scene |
| `b` | new line under the wordmark |

---

## Putting it on GitHub

Every path in the site is relative, so it works from a project subpath
(`yourname.github.io/2016-nostalgia/`) with no configuration.

**1. Make an empty repo.** On github.com, click **New**, name it `2016-nostalgia`,
leave it **Public**, and do *not* tick "Add a README" — this folder already has
one, and an initialised repo would collide.

**2. Push this folder.** It is already a git repo with a commit in it, so:

```bash
git remote add origin https://github.com/YOURNAME/2016-nostalgia.git
```

```bash
git push -u origin main
```

**3. Turn on Pages.** In the repo: **Settings → Pages → Source: Deploy from a
branch → Branch: `main`, folder: `/ (root)` → Save.** The first build takes a
minute or two; the URL appears on that same page.

**4. Fix the preview URLs.** `index.html` has three absolute URLs near the top
(`og:image`, `og:url`, `canonical`) — link previews drop relative ones, so they
have to name the real host. Replace `sjaiswalnetwork` with your username if it
differs, then commit and push again.

That link is now shareable. WhatsApp and iMessage will show the card in
`assets/og.png`.

> `.nojekyll` is what stops GitHub running the files through Jekyll. Keep it.

### If you want your own name on the commit

The commit was made with a repo-local identity. To change it:

```bash
git -C . config user.name "Your Name"
```

---

## Turning on the live count

By default the top bar shows how many songs are loaded. It can instead show **how
many people are on the page right now** — but GitHub Pages only serves files, so
counting live visitors needs one small outside service. This uses a Firebase
Realtime Database: free, and it has an `onDisconnect` hook, which is what lets a
browser that closes or loses signal remove itself without the page noticing.

**1.** Go to [console.firebase.google.com](https://console.firebase.google.com) →
**Add project**. Any name. You can turn Google Analytics off.

**2.** In the left sidebar: **Build → Realtime Database → Create Database**. Pick a
region, then choose **Start in locked mode** (the rule in step 4 opens exactly what
is needed and nothing else).

**3.** Project settings (the gear) → scroll to **Your apps** → the **`</>`** web
icon → register the app. Copy `apiKey` and `databaseURL` out of the config it
shows you, and paste them into `config.js`:

```js
window.PRESENCE = {
  apiKey: 'AIzaSy…',
  databaseURL: 'https://your-project-default-rtdb.firebaseio.com',
};
```

**4.** Back in **Realtime Database → Rules**, replace everything with this and
publish:

```json
{
  "rules": {
    "presence": {
      ".read": true,
      ".write": true,
      "$id": {
        ".validate": "newData.hasChild('t')"
      }
    }
  }
}
```

**5.** Commit and push. Open the site in two tabs — the top bar should say **2
people**.

Both values in `config.js` are safe to commit. A Firebase web `apiKey` identifies
a project, it does not grant access; the rule above is what actually guards the
data, and it confines reads and writes to the `presence` branch.

**Honest caveat:** I built and wired this but could not test it end to end, since
that needs a Firebase account only you can create. The site itself is unaffected
either way — if the keys are blank, wrong, or the service is unreachable, the
counter silently never appears and the top bar keeps showing the track count.

### How the count stays honest

Each open tab writes one entry and registers an `onDisconnect` handler, which
Firebase runs server-side the moment the socket drops. That covers closed tabs and
dead wifi. For the rarer case of a connection the server never noticed die, each
tab also re-stamps a timestamp every 45 seconds and readers ignore anything older
than two minutes — so ghosts expire instead of inflating the number forever.

## Running it locally

Any static server will do — it must be served over `http://`, not opened as a
`file://` path, or the YouTube API rejects the origin.

```bash
python -m http.server 5173
```

### Re-rendering the link-preview card

`assets/og.png` is a screenshot of `assets/og.html`, which pulls in the site's own
stylesheet — so the card can never drift from the design. With the server running:

```bash
chrome --headless --disable-gpu --hide-scrollbars --window-size=1200,630 --virtual-time-budget=8000 --screenshot=assets/og.png http://localhost:5173/assets/og.html
```

Then bump `?v=` on the `og:image` URLs — previews are cached for weeks and keyed
on the URL.

## Notes

- Playback is served by YouTube, so plays count for the rightsholders and no audio
  is redistributed here. The player is hidden rather than visible, which is a
  liberty the API doesn't formally bless — worth knowing if this ever goes
  anywhere commercial.
- Track titles and artists were cleaned up by hand; YouTube's own metadata is full
  of `(Official Video)` and `- Topic` channel names.
- Built as a riff on [hornokplease.xyz](https://hornokplease.xyz), which does the
  same trick for Indian highway music. Different code, different art, same good
  idea.
