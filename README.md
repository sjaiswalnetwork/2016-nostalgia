# Alibi — realistic excuse generator

A single-page app that generates a fresh, plausible "I'm going to be late" message every
time, built from a real location, weather that location actually gets, and the traffic
that weather actually causes.

Open `index.html` in a browser. No build step, no server, no dependencies.

## Why the output reads as real

Most generators pick random phrases from flat lists, so you get hail in a heatwave and a
snowplough in Chennai. This one builds a causal chain and refuses to break it:

1. **Location** — a city, then one of *its* neighbourhoods, roads and transit lines.
2. **Weather** — only from the list that city's climate allows, and (by default) only
   weather plausible for the current calendar month.
3. **Traffic** — only incidents that weather could physically cause. Weather carries tags
   (`wet`, `low-vis`, `slick`, `cold`, `hot`, `windy`, `dusty`); each incident declares
   which tags it needs. Ice gets a jackknifed lorry; heat gets an overheated truck.
   Incidents tagged `any` are joined with "and separately" rather than "and", so the
   message never implies a causal link that isn't there.
4. **A failed workaround** — the detail that sells it. Real late people try something
   first, and it fails.
5. **Times** — every clock time derives from one target time, so "left home", "stuck for",
   "was due" and "now arriving" always reconcile.

Regional wording is respected too: gritters in the UK, plows in the US.

## Live conditions (real location, real weather)

Click **Use my location** and the browser asks for precise location. With that granted, the
excuse stops being fiction on the parts that matter:

| Layer | Source | Real? |
| --- | --- | --- |
| Precise coordinates | `navigator.geolocation` | yes |
| Neighbourhood, city, street | photon.komoot.io → Nominatim → BigDataCloud | yes |
| Current weather + your local clock | Open-Meteo | yes |
| Named major roads within 2.5 km | Overpass (OpenStreetMap) | yes |
| The traffic incident | inferred from the real weather and real rush hour | **no** |

**There is no live traffic feed.** Every traffic API (TomTom, HERE, Google, Mapbox) needs a
paid key, so the incident is inferred rather than observed, and the app says so rather than
implying otherwise. Everything else is a real observation, which is why live mode scores
higher: the weather half is not a claim, it is a fact that will still be true when checked.

Requires an `https://` page or `http://localhost` — browsers block geolocation on `file://`
URLs, and the app detects that and explains it instead of showing a misleading
"permission denied".

### Clear skies

If the weather where you are is genuinely unremarkable, the app refuses to invent weather
you could be caught out on. It says the sky is clear, drops the score, and builds a
traffic-and-rush-hour excuse instead.

### Designed for flaky free APIs

These are community-run services, and during development each one failed in a different
way. All of it is handled:

- **Overpass returns 504 under load.** Two mirrors are tried, the whole lookup is capped at
  7 s, and a late answer silently upgrades the road names for the next excuse. Without the
  cap, one outage cost 32 seconds per click.
- **Nominatim drops its CORS headers when rate-limiting**, which surfaces as an instant
  "Failed to fetch". Hence three geocoders in quality order, not one.
- **If road lookup fails entirely**, the curated arterials for your city are used (they are
  real roads), then the street you are standing on, then a generic road. The UI states
  which of those you got.
- Any total failure falls back to invented places with the reason shown, and the app keeps
  working.

### Privacy

Coordinates are rounded to three decimals (about 110 m) before they leave the device, then
sent only to the services above. Coordinates are never stored — the 10-minute cache holds
only the derived place name, weather, and road list. Raise `ROUND_DP` in `live.js` if you
want tighter road matching, lower it for more fuzz.

## Plausibility score

Each weather condition and traffic incident carries a `risk` value — how easily the claim
could be checked or disproved. Vague congestion is safe; a specific pile-up either appears
on a maps app or it doesn't. Out-of-season weather takes a heavy penalty. The score is
advice about *verifiability*, nothing more.

The "Keep your story straight" panel lists the specifics you'd need to repeat
consistently if asked twice.

## Controls

| Control | Effect |
| --- | --- |
| Region / City | Constrain the geography, or leave open for anywhere |
| Situation | Late to work, a meeting, a social thing, an appointment, a pickup, a deadline, a class |
| Tone | Apologetic, Professional, Casual, Dramatic |
| Match today's season | On by default — restricts weather to the current month |

`space` generates a new excuse, `c` copies the current one. Settings persist in
`localStorage`; the last 40 combinations are tracked so a session never repeats itself.

## Files

- `engine.js` — data and generation logic. Runs in the browser and in Node
  (`require('./engine.js')`), which is how it's tested.
- `live.js` — geolocation, the three data sources, and weather decoding.
- `app.js` — UI wiring, history, clipboard, persistence.
- `index.html` — markup and styles, light and dark.

All four must sit together at the site root.

## Testing

The engine is pure and dependency-free, so it can be swept from the command line:

```bash
node -e "const E=require('./engine.js');const s=new Set();for(let i=0;i<30000;i++)s.add(E.generate({seasonal:true}).text);console.log(s.size)"
```

30,000 draws currently yield 30,000 distinct messages, with no placeholder leaks,
sentence-case errors, duplicated place names, or clock contradictions.

## Extending it

Add a city to `REGIONS` with its own `areas`, `roads`, `transit` and `wx` list — the
weather ids it can plausibly get. Add weather to `WEATHER` with `tags`, `months` and a
`risk`. Add incidents to `TRAFFIC` with the tags they `need` (and `only: ['uk']` if the
wording is regional). Everything downstream picks it up automatically.

It is for entertainment. The score tells you how checkable a story is, not whether telling
it is a good idea.
