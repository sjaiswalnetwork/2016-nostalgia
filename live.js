/* Live conditions layer.

   Turns the browser's precise-location permission into a `live` object the
   engine can build a true excuse from:

     navigator.geolocation  -> precise coordinates (with the user's consent)
     Nominatim / OSM        -> neighbourhood, city, street, country
     Open-Meteo             -> current weather + the user's real local time
     Overpass / OSM         -> named major roads near those coordinates

   All three are keyless and CORS-open. There is deliberately NO traffic feed:
   every live traffic API needs a paid key, so the engine infers the incident
   from the real weather and the real local clock and says so in the UI.

   Privacy: coordinates are rounded to ROUND_DP decimals (~110 m at 3) before
   they leave the device, and nothing is stored beyond a short-lived cache of
   the derived place and weather — never the coordinates themselves.

   Exposed as window.ExcuseLive. */
(function (root) {
  'use strict';

  const ROUND_DP = 3;          /* ~110 m — enough for local roads, not your door */
  const CACHE_KEY = 'alibi.live.v1';
  const CACHE_MS = 10 * 60 * 1000;

  /* ------------------------------------------------------------ geolocation */

  /* Chrome counts file:// as a secure context but still auto-denies
     geolocation there, so isSecureContext alone is not enough of a test. */
  function canLocate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
    if (typeof location !== 'undefined' && location.protocol === 'file:') return false;
    return !!window.isSecureContext;
  }

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('This browser has no location support.'));
        return;
      }
      if (location.protocol === 'file:') {
        reject(new Error('Browsers block location on local files. Serve this over http://localhost ' +
          'or open the GitHub Pages URL and it will work.'));
        return;
      }
      if (!window.isSecureContext) {
        reject(new Error('Location needs a secure page. Open this over https:// ' +
          '(a GitHub Pages URL works).'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve(pos.coords); },
        function (err) {
          const map = {
            1: 'Location permission was denied. Allow it in the browser\'s address-bar icon, or keep using invented places.',
            2: 'Your device could not get a fix. Try again, or keep using invented places.',
            3: 'Locating timed out. Try again, or keep using invented places.'
          };
          reject(new Error(map[err.code] || 'Could not get your location.'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  /* ------------------------------------------------------------------ fetch */

  function jsonFetch(url, ms, init) {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, ms);
    const opts = Object.assign({ signal: ctl.signal, cache: 'no-store' }, init || {});
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error(url.split('/')[2] + ' returned ' + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ------------------------------------------------------- weather decoding */

  /* WMO weather codes -> the engine's weather ids, so the real observation
     reuses the hand-written phrasing. Null id means nothing to blame. */
  const WMO = {
    0: [null, 'clear sky'], 1: [null, 'mainly clear'], 2: [null, 'partly cloudy'], 3: [null, 'overcast'],
    45: ['fog', 'fog'], 48: ['fog', 'freezing fog'],
    51: ['rain_light', 'light drizzle'], 53: ['rain_light', 'drizzle'], 55: ['rain_light', 'heavy drizzle'],
    56: ['ice', 'freezing drizzle'], 57: ['ice', 'freezing drizzle'],
    61: ['rain_light', 'light rain'], 63: ['rain_heavy', 'steady rain'], 65: ['rain_heavy', 'heavy rain'],
    66: ['ice', 'freezing rain'], 67: ['ice', 'freezing rain'],
    71: ['snow', 'light snow'], 73: ['snow', 'snow'], 75: ['snow', 'heavy snow'], 77: ['snow', 'snow grains'],
    80: ['rain_light', 'rain showers'], 81: ['rain_heavy', 'heavy showers'], 82: ['rain_heavy', 'violent showers'],
    85: ['snow', 'snow showers'], 86: ['snow', 'heavy snow showers'],
    95: ['thunder', 'a thunderstorm'], 96: ['hail', 'a thunderstorm with hail'], 99: ['hail', 'a hailstorm']
  };

  /* Precipitation wins; then visibility, wind, temperature, humidity. */
  function decodeWeather(c) {
    const entry = WMO[c.weather_code] || [null, 'unremarkable weather'];
    let id = entry[0], label = entry[1];

    if (!id) {
      if (typeof c.visibility === 'number' && c.visibility < 1500) { id = 'fog'; label = 'poor visibility'; }
      else if (c.wind_speed_10m >= 35) { id = 'wind'; label = 'high wind (' + Math.round(c.wind_speed_10m) + ' km/h)'; }
      else if (c.temperature_2m >= 35) { id = 'heat'; label = Math.round(c.temperature_2m) + '°C heat'; }
      else if (c.temperature_2m <= 2) { id = 'cold_snap'; label = 'freezing cold'; }
      else if (c.relative_humidity_2m >= 80 && c.temperature_2m >= 27) { id = 'humid'; label = 'heavy humidity'; }
      else if (c.precipitation > 0) { id = 'rain_light'; label = 'light rain'; }
    }
    return { id: id, label: label };
  }

  /* --------------------------------------------------------- place decoding */

  const COUNTRY_REGION = { in: 'india', us: 'us', gb: 'uk' };

  const TRANSIT = {
    india: ['the metro', 'an auto', 'the local train', 'a bus'],
    us: ['the bus', 'the train', 'a rideshare'],
    uk: ['the bus', 'the train', 'a taxi'],
    other: ['the bus', 'the train', 'a taxi']
  };

  /* Real OSM road names need an article for some forms but not others:
     "the Eastern Express Highway was solid" but "Orchard Avenue was solid". */
  const NEEDS_THE = /(highway|expressway|freeway|motorway|bypass|flyover|connector|ring road|link road|bridge|tunnel|circular)/i;

  function tidyRoad(name) {
    const base = name.split(' (')[0].trim();
    if (/^the /i.test(base)) return base;
    if (NEEDS_THE.test(base) || /^[AM]\d+$/.test(base)) return 'the ' + base;
    return base;
  }

  /* "Greater London" / "Mumbai Suburban District" read badly in a sentence */
  function cleanCity(name) {
    return String(name)
      .replace(/^Greater\s+/i, '')
      .replace(/\s+(City|District|Metropolitan Borough|Borough|Municipality|Municipal Corporation)$/i, '')
      .trim() || name;
  }

  /* Overpass is community-run and frequently overloaded (504s), so it is a
     best-effort enhancement only. Try the mirrors, then degrade gracefully. */
  const OVERPASS_MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  const ROAD_BUDGET_MS = 7000;   /* how long a click will ever wait on roads */

  function fetchRoads(lat, lon) {
    const body = 'data=' + encodeURIComponent('[out:json][timeout:12];way(around:2500,' +
      lat + ',' + lon + ')["highway"~"^(motorway|trunk|primary|secondary)$"]["name"];out tags 60;');

    const attempt = function (i) {
      if (i >= OVERPASS_MIRRORS.length) return Promise.resolve(null);
      return jsonFetch(OVERPASS_MIRRORS[i], 7000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      }).catch(function () { return attempt(i + 1); });
    };
    return attempt(0);
  }

  /* Overpass being down must never cost the user 30 seconds. Wait `ms` at most;
     if the answer turns up later, hand it to onLate so the next excuse can use
     the better road names. */
  function raceWithBudget(promise, ms, onLate) {
    let done = false;
    return new Promise(function (resolve) {
      const timer = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, ms);
      promise.then(function (v) {
        if (done) { if (v && onLate) onLate(v); return; }
        done = true; clearTimeout(timer); resolve(v);
      }, function () {
        if (done) return;
        done = true; clearTimeout(timer); resolve(null);
      });
    });
  }

  /* Overpass elements -> tidy, de-duplicated road names */
  function roadNames(raw) {
    if (!raw || !raw.elements || !raw.elements.length) return [];
    const named = raw.elements
      .map(function (e) { return e.tags && e.tags.name; })
      .filter(Boolean)
      .map(tidyRoad);
    return named.filter(function (r, i) { return named.indexOf(r) === i; }).slice(0, 24);
  }

  /* The curated city lists in engine.js are real arterial roads, so they are a
     good fallback when Overpass is down and we recognise the city. */
  function curatedRoadsFor(cityName) {
    const engine = root.ExcuseEngine ||
      (typeof require === 'function' ? (function () { try { return require('./engine.js'); } catch (e) { return null; } })() : null);
    if (!engine || !engine.regions) return null;
    const want = String(cityName).toLowerCase();
    let hit = null;
    Object.keys(engine.regions).forEach(function (r) {
      engine.regions[r].cities.forEach(function (c) {
        const n = c.name.toLowerCase().replace(/^the /, '');
        if (!hit && (want === n || want.indexOf(n) !== -1 || n.indexOf(want) !== -1)) hit = c;
      });
    });
    return hit ? { roads: hit.roads.slice(), areas: hit.areas.slice() } : null;
  }

  /* Administrative names that read as nonsense in a sentence:
     "the traffic out of S Ward", "out of Mumbai Zone 6". */
  function usableArea(name) {
    if (!name) return null;
    const s = String(name)
      .replace(/^London Borough of\s+/i, '')
      .replace(/^(City|Borough|Municipality) of\s+/i, '')
      .trim();
    if (/(^|\s)(ward|zone)(\s|$)/i.test(s)) return null;
    if (/\bdistrict$/i.test(s)) return null;
    return s || null;
  }

  function decodePlaceNominatim(geo) {
    const a = (geo && geo.address) || {};
    if (!a.country_code && !a.city && !a.town && !a.village) return null;
    const city = a.city || a.town || a.village || a.municipality || a.county || a.state || 'here';
    const area = usableArea(a.neighbourhood) || usableArea(a.suburb) || usableArea(a.quarter) ||
      usableArea(a.residential) || usableArea(a.village) || usableArea(a.town) ||
      usableArea(a.hamlet) || usableArea(a.city_district) || cleanCity(city);
    const cc = (a.country_code || '').toLowerCase();
    return {
      city: cleanCity(city), area: area, street: a.road || null,
      countryName: a.country || '', region: COUNTRY_REGION[cc] || null
    };
  }

  /* photon.komoot.io — OSM-backed, built for app use, best neighbourhood names */
  function decodePlacePhoton(res) {
    const f = res && res.features && res.features[0];
    const p = (f && f.properties) || {};
    if (!p.city && !p.district && !p.locality && !p.state) return null;
    const city = p.city || p.county || p.state || 'here';
    const area = usableArea(p.locality) || usableArea(p.district) || cleanCity(city);
    const cc = (p.countrycode || '').toLowerCase();
    return {
      city: cleanCity(city), area: area, street: p.street || null,
      countryName: p.country || '', region: COUNTRY_REGION[cc] || null
    };
  }

  /* bigdatacloud — the most reliable of the three, but weakest on suburbs */
  function decodePlaceBdc(j) {
    if (!j || !j.countryCode) return null;
    const city = j.city || j.locality || j.principalSubdivision || 'here';
    const admin = (j.localityInfo && j.localityInfo.administrative) || [];
    let area = usableArea(j.locality !== city ? j.locality : null);
    if (!area) {
      /* deepest usable administrative level below the city */
      admin.slice().sort(function (x, y) { return (y.adminLevel || 0) - (x.adminLevel || 0); })
        .forEach(function (l) { if (!area && l.name !== city) area = usableArea(l.name); });
    }
    const cc = (j.countryCode || '').toLowerCase();
    return {
      city: cleanCity(city), area: area || cleanCity(city), street: null,
      countryName: j.countryName || '', region: COUNTRY_REGION[cc] || null
    };
  }

  /* Try the geocoders in order of quality; each one is rate-limited or flaky in
     its own way, so a single source is not dependable enough to build on. */
  const PLACE_SOURCES = [
    {
      name: 'photon',
      url: function (la, lo) { return 'https://photon.komoot.io/reverse?lat=' + la + '&lon=' + lo; },
      decode: decodePlacePhoton
    },
    {
      name: 'nominatim',
      url: function (la, lo) {
        return 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + la +
          '&lon=' + lo + '&zoom=16&addressdetails=1';
      },
      decode: decodePlaceNominatim
    },
    {
      name: 'bigdatacloud',
      url: function (la, lo) {
        return 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + la +
          '&longitude=' + lo + '&localityLanguage=en';
      },
      decode: decodePlaceBdc
    }
  ];

  function fetchPlace(lat, lon) {
    const attempt = function (i) {
      if (i >= PLACE_SOURCES.length) {
        return Promise.reject(new Error('Could not work out where you are — every map service ' +
          'refused. Try again in a minute, or keep using invented places.'));
      }
      const src = PLACE_SOURCES[i];
      return jsonFetch(src.url(lat, lon), 10000).then(function (raw) {
        const place = src.decode(raw);
        if (!place) throw new Error('unusable response');
        place.placeSource = src.name;
        return place;
      }).catch(function () { return attempt(i + 1); });
    };
    return attempt(0);
  }

  /* ------------------------------------------------------------ the gather */

  function fetchLive(opts) {
    const onRoads = (opts && opts.onRoads) || null;
    return getPosition().then(function (coords) {
      const lat = Number(coords.latitude.toFixed(ROUND_DP));
      const lon = Number(coords.longitude.toFixed(ROUND_DP));

      const weather = jsonFetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat +
        '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,is_day,' +
        'precipitation,weather_code,wind_speed_10m,visibility&timezone=auto', 12000);

      const geo = fetchPlace(lat, lon);

      /* best-effort, time-boxed; a late answer upgrades the cache instead */
      const roads = raceWithBudget(fetchRoads(lat, lon), ROAD_BUDGET_MS, function (raw) {
        const names = roadNames(raw);
        if (!names.length) return;
        const cached = readCache();
        if (cached) {
          cached.roads = names;
          cached.roadSource = 'nearby';
          cached.roadCount = names.length;
          writeCache(cached);
          if (onRoads) onRoads(cached);
        }
      });

      return Promise.all([weather, geo, roads]);
    }).then(function (res) {
      const wxRaw = res[0], place = res[1], roadsRaw = res[2];
      const c = wxRaw.current;
      const wx = decodeWeather(c);

      /* real local time at the user's coordinates, not this device's clock */
      const hhmm = String(c.time).slice(11, 16);
      const localMins = parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10);
      const weekday = new Date(String(c.time).slice(0, 10) + 'T00:00:00Z').getUTCDay();

      /* Real road names, in descending order of how good they are:
         1. major roads within 2.5 km of you (OSM/Overpass)
         2. the curated arterials for your city, if we know it
         3. the street you are actually standing on (Nominatim)
         4. a generic road */
      let roads = roadNames(roadsRaw), roadSource = roads.length ? 'nearby' : 'generic';
      if (!roads.length) {
        const curated = curatedRoadsFor(place.city);
        if (curated) { roads = curated.roads; roadSource = 'city'; }
      }
      if (!roads.length && place.street) { roads = [tidyRoad(place.street)]; roadSource = 'street'; }
      if (!roads.length) roads = ['the main road'];

      return {
        city: place.city,
        area: place.area,
        countryName: place.countryName,
        region: place.region,
        placeSource: place.placeSource,
        roads: roads,
        transit: TRANSIT[place.region || 'other'],
        weatherId: wx.id,
        weatherLabel: wx.label,
        tempC: c.temperature_2m,
        windKph: c.wind_speed_10m,
        humidity: c.relative_humidity_2m,
        visibilityM: c.visibility,
        localMins: localMins,
        weekday: weekday,
        observedAt: hhmm,
        roadCount: roads.length,
        roadSource: roadSource,
        fetchedAt: Date.now()
      };
    });
  }

  /* -------------------------------------------------------------- caching */

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && Date.now() - raw.fetchedAt < CACHE_MS) return raw;
    } catch (e) { /* ignore */ }
    return null;
  }

  function writeCache(live) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch (e) { /* ignore */ }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
  }

  /* "Failed to fetch" tells a user nothing; say what actually broke. */
  function friendly(err) {
    const m = String((err && err.message) || err);
    if (/Failed to fetch|NetworkError|Load failed|aborted|abort/i.test(m)) {
      return new Error('Could not reach the weather or map services. Check your connection and try again.');
    }
    if (/returned 4|returned 5/.test(m)) {
      return new Error(m + '. That service is having a moment — try again shortly.');
    }
    return err instanceof Error ? err : new Error(m);
  }

  /* get({force}) -> Promise<live>. Uses the 10-minute cache unless forced. */
  function get(o) {
    const cached = (o && o.force) ? null : readCache();
    if (cached) return Promise.resolve(cached);
    return fetchLive(o).then(function (live) {
      writeCache(live);
      return live;
    }, function (err) {
      throw friendly(err);
    });
  }

  root.ExcuseLive = {
    get: get,
    clearCache: clearCache,
    readCache: readCache,
    decodeWeather: decodeWeather,
    decodePlace: decodePlaceNominatim,
    decodePlacePhoton: decodePlacePhoton,
    decodePlaceBdc: decodePlaceBdc,
    usableArea: usableArea,
    tidyRoad: tidyRoad,
    cleanCity: cleanCity,
    curatedRoadsFor: curatedRoadsFor,
    secure: canLocate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ExcuseLive;
})(typeof window !== 'undefined' ? window : globalThis);
