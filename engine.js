/* Excuse engine — builds a fresh, internally-consistent excuse out of
   location -> weather -> traffic -> failed workaround -> ETA.

   The chain matters: a city only gets weather its climate allows, weather only
   gets traffic incidents it could actually cause, and every clock time hangs
   off one target time. That consistency is what makes the output read as real
   instead of random.

   `risk` on weather and traffic = how easily the claim could be checked or
   disproved. Low risk is vague and safe; high risk is specific and memorable.

   Exposed as window.ExcuseEngine (browser) and module.exports (node, for tests). */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- places */

  const REGIONS = {
    india: {
      label: 'India',
      cities: [
        {
          name: 'Mumbai',
          areas: ['Andheri', 'Bandra', 'Kurla', 'Chembur', 'Vashi', 'Dadar', 'Powai', 'Ghatkopar'],
          roads: ['the Western Express Highway', 'the Sion–Panvel Highway', 'the Eastern Freeway', 'LBS Marg', 'the JVLR stretch', 'SV Road', 'the Chembur–Ghatkopar link road'],
          transit: ['the Harbour Line', 'the Andheri–Ghatkopar metro', 'the fast local from Borivali', 'a BEST bus'],
          wx: ['rain_heavy', 'rain_light', 'thunder', 'flood', 'humid', 'heat', 'wind']
        },
        {
          name: 'Delhi',
          areas: ['Gurgaon', 'Noida', 'Dwarka', 'Saket', 'Okhla', 'Rohini', 'Mayur Vihar'],
          roads: ['the Delhi–Gurgaon Expressway', 'the Outer Ring Road', 'NH-48 near Rajokri', 'the Ashram flyover', 'the DND Flyway', 'Ring Road near Mukarba Chowk'],
          transit: ['the Blue Line', 'the Yellow Line', 'the Rapid Metro', 'a DTC bus'],
          wx: ['fog', 'smog', 'dust', 'heat', 'rain_heavy', 'rain_light', 'thunder', 'cold_snap', 'wind']
        },
        {
          name: 'Bengaluru',
          areas: ['Whitefield', 'Koramangala', 'HSR Layout', 'Hebbal', 'Electronic City', 'Marathahalli', 'Indiranagar'],
          roads: ['the Outer Ring Road', 'Hosur Road', 'Old Airport Road', 'the Silk Board junction', 'the Bellandur stretch', 'Sarjapur Road'],
          transit: ['the Purple Line', 'the Green Line', 'a Vayu Vajra bus'],
          wx: ['rain_heavy', 'rain_light', 'thunder', 'flood', 'wind', 'humid']
        },
        {
          name: 'Pune',
          areas: ['Hinjewadi', 'Kothrud', 'Viman Nagar', 'Baner', 'Hadapsar', 'Wakad'],
          roads: ['the Mumbai–Pune Expressway', 'the Katraj tunnel road', 'University Road', 'the Hinjewadi flyover', 'Nagar Road'],
          transit: ['the Purple Line metro', 'a PMPML bus'],
          wx: ['rain_heavy', 'rain_light', 'thunder', 'heat', 'wind', 'fog']
        },
        {
          name: 'Chennai',
          areas: ['Velachery', 'Adyar', 'T. Nagar', 'Guindy', 'Porur', 'Tambaram'],
          roads: ['the OMR', 'Anna Salai', 'the GST Road', 'the Kathipara flyover', 'the ECR'],
          transit: ['the Blue Line metro', 'the Beach–Tambaram local', 'an MTC bus'],
          wx: ['rain_heavy', 'flood', 'thunder', 'humid', 'heat', 'wind']
        },
        {
          name: 'Hyderabad',
          areas: ['Gachibowli', 'Madhapur', 'Kukatpally', 'Begumpet', 'LB Nagar', 'Uppal'],
          roads: ['the ORR', 'the Cyberabad stretch', 'the Punjagutta flyover', 'the Attapur road', 'NH-65'],
          transit: ['the Blue Line metro', 'the MMTS', 'a TSRTC bus'],
          wx: ['rain_heavy', 'thunder', 'heat', 'rain_light', 'wind', 'flood']
        },
        {
          name: 'Kolkata',
          areas: ['Salt Lake', 'Behala', 'Howrah', 'Ballygunge', 'Dum Dum', 'New Town'],
          roads: ['the EM Bypass', 'the Second Hooghly Bridge', 'AJC Bose Road', 'the Ultadanga flyover', 'VIP Road'],
          transit: ['the North–South metro', 'the Sealdah local', 'a tram on Rajabazar'],
          wx: ['rain_heavy', 'flood', 'thunder', 'humid', 'fog', 'heat']
        }
      ]
    },

    us: {
      label: 'United States',
      cities: [
        {
          name: 'New York',
          areas: ['Bushwick', 'Astoria', 'the Bronx', 'Jersey City', 'Flatbush', 'Long Island City'],
          roads: ['the BQE', 'the Holland Tunnel approach', 'the FDR', 'the Cross Bronx', 'the Williamsburg Bridge'],
          transit: ['the L train', 'the 4 train', 'the PATH', 'the M15 bus'],
          wx: ['snow', 'ice', 'cold_snap', 'rain_heavy', 'thunder', 'heat', 'humid', 'wind', 'fog']
        },
        {
          name: 'the Bay Area',
          areas: ['Oakland', 'Daly City', 'Fremont', 'the Mission', 'San Mateo', 'Berkeley'],
          roads: ['the 101', 'the Bay Bridge', 'I-880', 'the 92 over the hill', 'the 280'],
          transit: ['BART', 'Caltrain', 'the N Judah'],
          wx: ['fog', 'rain_heavy', 'rain_light', 'wind', 'heat', 'smog']
        },
        {
          name: 'Chicago',
          areas: ['Logan Square', 'Hyde Park', 'Evanston', 'Pilsen', 'Rogers Park'],
          roads: ['the Kennedy', 'Lake Shore Drive', 'the Dan Ryan', 'the Eisenhower', 'I-290'],
          transit: ['the Blue Line', 'the Red Line', 'Metra'],
          wx: ['snow', 'ice', 'cold_snap', 'wind', 'thunder', 'rain_heavy', 'heat', 'hail']
        },
        {
          name: 'Los Angeles',
          areas: ['Silver Lake', 'Pasadena', 'Culver City', 'the Valley', 'Long Beach'],
          roads: ['the 405', 'the 10', 'the 110', 'Sepulveda', 'the 5 near Burbank'],
          transit: ['the Expo Line', 'the Metro B Line', 'a Big Blue Bus'],
          wx: ['heat', 'rain_heavy', 'wind', 'smog', 'fog', 'rain_light']
        },
        {
          name: 'Boston',
          areas: ['Somerville', 'Dorchester', 'Cambridge', 'Quincy', 'Allston'],
          roads: ['the Pike', 'Storrow Drive', 'I-93', 'the Zakim Bridge', 'Route 2'],
          transit: ['the Red Line', 'the Green Line', 'the commuter rail'],
          wx: ['snow', 'ice', 'cold_snap', 'rain_heavy', 'wind', 'fog', 'heat', 'thunder']
        },
        {
          name: 'Seattle',
          areas: ['Ballard', 'Capitol Hill', 'Bellevue', 'West Seattle', 'Renton'],
          roads: ['I-5', 'the 520 bridge', 'Aurora', 'the West Seattle Bridge', 'I-405'],
          transit: ['the Link', 'the D Line', 'the ferry from Bainbridge'],
          wx: ['rain_light', 'rain_heavy', 'fog', 'wind', 'ice', 'snow']
        },
        {
          name: 'Atlanta',
          areas: ['Decatur', 'Buckhead', 'East Point', 'Marietta', 'Sandy Springs'],
          roads: ['the Downtown Connector', 'I-285', 'GA-400', 'I-75 north', 'Peachtree'],
          transit: ['MARTA', 'the Red Line', 'a MARTA bus'],
          wx: ['thunder', 'rain_heavy', 'heat', 'humid', 'ice', 'wind', 'hail']
        }
      ]
    },

    uk: {
      label: 'United Kingdom',
      cities: [
        {
          name: 'London',
          areas: ['Croydon', 'Walthamstow', 'Hackney', 'Wembley', 'Lewisham', 'Ealing'],
          roads: ['the North Circular', 'the A2 out of Blackheath', 'the M25 near junction 15', 'the Blackwall Tunnel approach', 'the A40'],
          transit: ['the Central line', 'the Overground', 'a Thameslink service', 'the 38 bus'],
          wx: ['rain_light', 'rain_heavy', 'fog', 'wind', 'ice', 'snow', 'heat', 'cold_snap']
        },
        {
          name: 'Manchester',
          areas: ['Salford', 'Didsbury', 'Stockport', 'Chorlton', 'Oldham'],
          roads: ['the M60', 'the Mancunian Way', 'the A56', 'the M602', 'Princess Road'],
          transit: ['the Metrolink', 'a Northern service', 'the 142 bus'],
          wx: ['rain_light', 'rain_heavy', 'wind', 'fog', 'ice', 'snow', 'cold_snap']
        },
        {
          name: 'Birmingham',
          areas: ['Digbeth', 'Solihull', 'Selly Oak', 'Erdington', 'Smethwick'],
          roads: ['the M6 through Spaghetti Junction', 'the A38 tunnels', 'the M42', 'the Aston Expressway'],
          transit: ['the West Midlands Metro', 'a Cross City line train', 'the 11A bus'],
          wx: ['rain_light', 'rain_heavy', 'wind', 'fog', 'ice', 'snow', 'thunder']
        },
        {
          name: 'Glasgow',
          areas: ['Partick', 'Govan', 'Dennistoun', 'Paisley', 'Clydebank'],
          roads: ['the M8', 'the Kingston Bridge', 'the Clyde Tunnel', 'the A82'],
          transit: ['the Subway', 'a ScotRail service', 'the 38 bus'],
          wx: ['rain_light', 'rain_heavy', 'wind', 'ice', 'snow', 'cold_snap', 'fog']
        },
        {
          name: 'Bristol',
          areas: ['Bedminster', 'Clifton', 'Fishponds', 'Filton', 'Brislington'],
          roads: ['the M32', 'the Portway', 'the A4174 ring road', 'the M5 near Avonmouth'],
          transit: ['a MetroBus', 'the Severn Beach line', 'the 75 bus'],
          wx: ['rain_light', 'rain_heavy', 'wind', 'fog', 'flood', 'ice']
        }
      ]
    }
  };

  /* --------------------------------------------------------------- weather */
  /* tags drive which traffic incidents are physically possible.
     months keep it seasonally plausible. */

  const WEATHER = [
    {
      id: 'rain_light', label: 'drizzle', tags: ['wet'], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], risk: 1,
      phrases: [
        'there was that greasy first-rain drizzle over {area}',
        'it drizzled just enough to make everyone forget how to drive',
        'the road was slick from the overnight rain around {area}'
      ]
    },
    {
      id: 'rain_heavy', label: 'heavy rain', tags: ['wet', 'low-vis'], months: [3, 4, 5, 6, 7, 8, 9, 10, 11], risk: 2,
      phrases: [
        'it started absolutely hammering down over {area} about ten minutes after I left',
        'the rain came down so hard over {area} that wipers on full were doing nothing',
        'a proper downpour parked itself over {area} right at {leftTime}',
        'the sky opened up over {area} the second I got onto {road}'
      ]
    },
    {
      id: 'thunder', label: 'a thunderstorm', tags: ['wet', 'low-vis'], months: [3, 4, 5, 6, 7, 8, 9, 10], risk: 3,
      phrases: [
        'a thunderstorm rolled in over {area} out of nowhere',
        'there was lightning over {area} and everything simply stopped',
        'the storm hit {area} around {leftTime} and took the power with it'
      ]
    },
    {
      id: 'flood', label: 'flooding', tags: ['wet'], months: [5, 6, 7, 8, 9, 10, 11], risk: 3,
      phrases: [
        'the low stretch past {area} was under water again',
        'the water had nowhere to go around {area}',
        '{area} was flooded from last night and nothing had drained'
      ]
    },
    {
      id: 'fog', label: 'fog', tags: ['low-vis'], months: [1, 2, 6, 7, 8, 10, 11, 12], risk: 2,
      phrases: [
        'the fog over {area} was thick enough that I could not see two cars ahead',
        'visibility on {road} was down to almost nothing',
        'fog rolled in across {area} and never lifted'
      ]
    },
    {
      id: 'smog', label: 'smog', tags: ['low-vis'], months: [10, 11, 12, 1, 2], risk: 2,
      phrases: [
        'the smog over {area} was sitting low and grey',
        'you could barely make out the flyover through the haze near {area}'
      ]
    },
    {
      id: 'heat', label: 'heat', tags: ['hot'], months: [3, 4, 5, 6, 7, 8, 9], risk: 1,
      phrases: [
        'the heat around {area} was doing something to the traffic',
        'it was already blazing before {leftTime} and everything had slowed to a crawl',
        'the heat coming off {road} was unreal'
      ]
    },
    {
      id: 'humid', label: 'humidity', tags: ['hot'], months: [4, 5, 6, 7, 8, 9], risk: 1,
      phrases: [
        'it was so humid near {area} that the windscreen kept fogging from the inside',
        'the air around {area} was completely still and thick'
      ]
    },
    {
      id: 'wind', label: 'high wind', tags: ['windy'], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], risk: 1,
      phrases: [
        'the wind past {area} was strong enough to move the car in the lane',
        'there were gusts across the open stretch of {road}',
        'the wind was throwing everything around near {area}'
      ]
    },
    {
      id: 'snow', label: 'snow', tags: ['cold', 'slick', 'low-vis'], months: [11, 12, 1, 2, 3], risk: 3,
      phrases: [
        'the snow started well before it was forecast to and {area} was not cleared',
        'we got a few inches on {road} before anyone touched it',
        'the snow turned to slush and then to nothing anyone could drive on'
      ]
    },
    {
      id: 'ice', label: 'ice', tags: ['cold', 'slick'], months: [11, 12, 1, 2, 3], risk: 2,
      phrases: [
        'everything had frozen over near {area}',
        'there was black ice on the ramp onto {road}',
        'the side streets around {area} were sheet ice'
      ]
    },
    {
      id: 'cold_snap', label: 'a cold snap', tags: ['cold'], months: [11, 12, 1, 2], risk: 2,
      phrases: [
        'it was cold enough this morning that the car would not turn over',
        'the cold near {area} did something to the battery'
      ]
    },
    {
      id: 'dust', label: 'a dust storm', tags: ['low-vis', 'dusty'], months: [4, 5, 6], risk: 4,
      phrases: [
        'a dust storm came through {area} and blotted everything out',
        'the wind picked up so much dust past {area} that I had to stop'
      ]
    },
    {
      id: 'hail', label: 'hail', tags: ['wet', 'low-vis'], months: [3, 4, 5, 10, 11], risk: 4,
      phrases: [
        'it started hailing over {area} — actual hail, in {monthName}',
        'hail came through {area} hard enough that people pulled over'
      ]
    }
  ];

  /* --------------------------------------------------------------- traffic */
  /* needs: weather tags that could cause this. 'any' = always possible.
     only: restrict to regions where the wording fits.
     {areaBare} is the area name without a leading "the", for use after "the". */

  const TRAFFIC = [
    { needs: ['any'], risk: 1, text: '{road} was solid from {area} onward, and nobody could tell me why' },
    { needs: ['any'], risk: 1, text: 'the roadworks on {road} were down to one lane and the queue went back past {area}' },
    { needs: ['any'], risk: 2, text: 'the junction onto {road} was locked up in all four directions' },
    { needs: ['any'], risk: 3, text: 'they had {road} closed at the {areaBare} end with no diversion signs anywhere' },
    { needs: ['any'], risk: 2, text: 'a bus had broken down in the middle lane of {road}' },
    { needs: ['any'], risk: 2, text: 'someone had stopped dead in the right lane of {road} with a flat' },
    { needs: ['any'], risk: 2, text: 'the lights at {road} were stuck on a two-second green' },
    { needs: ['any'], risk: 1, text: 'the queue on {road} was three times its usual length and moving in inches' },

    { needs: ['wet'], risk: 1, text: '{road} was down to one moving lane, and nothing was moving in it' },
    { needs: ['wet'], risk: 2, text: 'the underpass on {road} was knee-deep, so they were turning everyone back through {area}' },
    { needs: ['wet'], risk: 2, text: 'the signals at {road} were out, with one traffic cop waving four directions through' },
    { needs: ['wet'], risk: 2, text: 'every two-wheeler had pulled in under the flyover on {road} and blocked the left completely' },
    { needs: ['wet'], risk: 3, text: 'a bus had stalled in the flooded dip on {road} and taken the whole lane with it' },
    { needs: ['wet'], risk: 3, text: 'a drain had backed up across {road} and they had coned off half of it' },

    { needs: ['low-vis'], risk: 1, text: 'the whole line on {road} was doing twenty with hazards on' },
    { needs: ['low-vis'], risk: 3, text: 'someone went into the back of someone else on {road} and both of them just stood there' },
    { needs: ['low-vis'], risk: 4, text: 'there was a three-car pile-up on the slip road onto {road} and the police were holding everyone back' },

    { needs: ['slick'], risk: 1, text: 'the gritters had not been through {area} yet, so everything was crawling', only: ['uk'] },
    { needs: ['slick'], risk: 1, text: 'the plows had not made it to {area} yet and the side streets were unusable', only: ['us'] },
    { needs: ['slick'], risk: 3, text: 'a car had spun out on the ramp onto {road} and they were waiting on a tow' },
    { needs: ['slick'], risk: 4, text: 'a lorry had jackknifed across {road} and closed both lanes' },

    { needs: ['cold'], risk: 2, text: 'half the buses through {area} simply never turned up' },
    { needs: ['cold'], risk: 3, text: 'there was a points failure on {transit} and the platform was three deep' },

    { needs: ['hot'], risk: 1, text: 'they had {road} dug up with one lane open, in that heat, with no shade anywhere' },
    { needs: ['hot'], risk: 3, text: 'a truck had overheated on the climb on {road} and blocked the inside lane' },

    { needs: ['windy'], risk: 2, text: 'a hoarding had blown into the road near {area} and they had shut the lane to clear it' },
    { needs: ['windy'], risk: 3, text: 'a tree had come down across {road}' },
    { needs: ['windy'], risk: 4, text: 'a lorry had been blown into the barrier on {road}' },

    { needs: ['dusty'], risk: 2, text: 'traffic on {road} just stopped where it was until it passed' }
  ];

  /* -------------------------------------------------- the failed workaround
     This is the realism multiplier: real late people try something first. */

  const ATTEMPTS = [
    'I cut through {area} to get around it, and so had everyone else.',
    'I tried the service road, but it was already one long queue.',
    'I gave up and went for {transit}, which was then held for {dur} minutes.',
    'I sat in it for {dur} minutes before accepting it was not going to move.',
    'I turned around to go the long way and hit the same thing from the other side.',
    'Two cabs cancelled the moment they saw where the route went.',
    'I left {early} minutes early specifically so this would not happen.',
    'I parked up and waited it out, and it only got worse.',
    'I went back for {transit} instead, and the platform was too full to board.',
    'I asked someone at the barricade how long and got a shrug.',
    'The maps app kept rerouting me into the same jam from three different angles.',
    'I tried calling ahead but had no signal in that stretch past {area}.',
    'I walked up the line to see how far back it went — a long way.',
    'I found a gap through {area}, which turned out to be a dead end.'
  ];

  /* ------------------------------------------- when there is no weather left
     In live mode the sky is sometimes simply clear. Rather than invent weather
     that anyone could disprove by looking out of a window, blame the clock. */

  const RUSH_CLAUSES = [
    'the {partOfDay} rush had not cleared at all',
    'it is peak hour and {road} was already backed up',
    'everyone in the city seems to have left at the same time',
    'the {partOfDay} traffic out of {area} was worse than usual'
  ];

  const OFFPEAK_CLAUSES = [
    '{road} was far busier than it had any right to be at this hour',
    'the traffic out of {area} made no sense for the time of day',
    'there was no reason for {road} to be this bad and yet here we are'
  ];

  /* ------------------------------------------------------------- scenarios */

  const SCENARIOS = [
    { id: 'work', label: 'Late to work', things: ['the shift', 'the morning', 'my {target} start', 'the office'] },
    { id: 'meeting', label: 'Late to a meeting / call', things: ['the {target}', 'the {target} call', 'the client review', 'the sync'] },
    { id: 'social', label: 'Late to a social thing', things: ['dinner', 'the party', 'drinks', 'the birthday thing'] },
    { id: 'appointment', label: 'Late to an appointment', things: ['my {target} slot', 'the appointment', 'the check-up'] },
    { id: 'pickup', label: 'Late to pick someone up', things: ['picking you up', 'the school run', 'the airport run'] },
    { id: 'deadline', label: 'Missing a deadline', things: ['sending the files', 'the handover', 'getting that over to you'] },
    { id: 'class', label: 'Skipping class / gym / lesson', things: ['class', 'the session', 'the lesson'] }
  ];

  /* ----------------------------------------------------------------- tones */

  const TONES = [
    {
      id: 'apologetic', label: 'Apologetic',
      openers: [
        'I am so sorry — I am not going to make {thing} on time.',
        'Really sorry to do this, but I am stuck and {thing} is slipping.',
        'Apologies in advance — {thing} is going to be late on me.',
        'I hate sending this message, but {thing} is not happening at {target}.'
      ],
      closers: [
        'Genuinely sorry. Best case I am there by {eta}.',
        'I will make this up — realistically {eta}.',
        'Sorry again. Looking like {eta} now.'
      ]
    },
    {
      id: 'professional', label: 'Professional',
      openers: [
        'Flagging early: I am going to be delayed for {thing}.',
        'Heads up that {thing} will be delayed at my end.',
        'Quick note — I am held up and will not make {target} for {thing}.',
        'Unfortunately I am going to be late for {thing}.'
      ],
      closers: [
        'Current estimate is {eta}. Please start without me and I will catch up.',
        'Revised ETA {eta}. Happy to join from the car if that is easier.',
        'I will confirm as soon as I am moving; working assumption is {eta}.'
      ]
    },
    {
      id: 'casual', label: 'Casual',
      openers: [
        'Ugh — running late for {thing}.',
        'Going to be late for {thing}, sorry.',
        'Not going to make {target}, sadly.',
        'So {thing} is going badly already.'
      ],
      closers: [
        'Should roll in around {eta}.',
        'Save me a seat — {eta}, give or take.',
        'On my way, just slowly. {eta} probably.'
      ]
    },
    {
      id: 'dramatic', label: 'Dramatic',
      openers: [
        'You will not believe the time I am having. {thing} is off.',
        'I have been defeated by this city, and {thing} with it.',
        'I am writing to you from inside a traffic jam. {thing} is in danger.',
        'Everything that could go wrong on the way to {thing} has gone wrong.'
      ],
      closers: [
        'I have aged a year on this road. {eta}, if the universe allows.',
        'Send help, or at least coffee. {eta}.',
        'If I make it out of here it will be by {eta}.'
      ]
    }
  ];

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* ------------------------------------------------------------- utilities */

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function fmtTime(mins) {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    const h24 = Math.floor(m / 60);
    let h = h24 % 12; if (h === 0) h = 12;
    return h + ':' + String(m % 60).padStart(2, '0') + (h24 < 12 ? ' am' : ' pm');
  }

  function fill(tpl, v) {
    return tpl.replace(/\{(\w+)\}/g, function (whole, k) {
      return k in v ? v[k] : whole;
    });
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* Sentence-case the assembled text: a slot like {thing} can land at the
     start of a sentence, where "the party" has to become "The party". */
  function sentenceCase(s) {
    return s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, pre, ch) {
      return pre + ch.toUpperCase();
    });
  }

  /* ------------------------------------------------------------- the build */

  function allCities(regionId) {
    if (regionId && REGIONS[regionId]) {
      return REGIONS[regionId].cities.map(function (c) { return { region: regionId, city: c }; });
    }
    return Object.keys(REGIONS).reduce(function (acc, r) {
      return acc.concat(REGIONS[r].cities.map(function (c) { return { region: r, city: c }; }));
    }, []);
  }

  function isRush(mins, weekday) {
    if (weekday === 0 || weekday === 6) return false;
    return (mins >= 420 && mins <= 630) || (mins >= 990 && mins <= 1200);
  }

  function partOfDay(mins) {
    if (mins < 720) return 'morning';
    if (mins < 1020) return 'afternoon';
    return 'evening';
  }

  /* One attempt at a build. Returns null if the chain dead-ends.
     opts.live (see live.js) replaces the invented location and weather with
     what is actually outside the user's window right now. */
  function build(opts) {
    const live = opts.live || null;
    const now = opts.now || new Date();
    const month = now.getMonth() + 1;

    /* location — real if we have it, invented otherwise */
    let place, city;
    if (live) {
      city = {
        name: live.city, areas: [live.area],
        roads: live.roads, transit: live.transit, wx: []
      };
      place = { region: live.region, city: city };
    } else {
      let pool = allCities(opts.region);
      if (opts.city) {
        const narrowed = pool.filter(function (p) { return p.city.name === opts.city; });
        if (narrowed.length) pool = narrowed;
      }
      place = pick(pool);
      city = place.city;
    }
    const area = pick(city.areas);
    /* avoid roads and lines whose names contain the neighbourhood — "the West
       Seattle Bridge was solid from West Seattle onward" reads badly */
    const notNamedForArea = function (s) { return s.indexOf(area) === -1; };
    const roadPool = city.roads.filter(notNamedForArea);
    const transitPool = city.transit.filter(notNamedForArea);
    const road = pick(roadPool.length ? roadPool : city.roads);
    const transit = pick(transitPool.length ? transitPool : city.transit);

    /* weather — the real observation, or one this city could plausibly get */
    let wx = null, seasonMatch = true, benign = false;
    if (live) {
      if (live.weatherId) {
        wx = WEATHER.filter(function (w) { return w.id === live.weatherId; })[0] || null;
      }
      benign = !wx;  /* clear skies: nothing to blame the weather for */
    } else {
      let wxPool = WEATHER.filter(function (w) { return city.wx.indexOf(w.id) !== -1; });
      if (opts.seasonal) {
        const inSeason = wxPool.filter(function (w) { return w.months.indexOf(month) !== -1; });
        if (inSeason.length) wxPool = inSeason;
      }
      if (!wxPool.length) return null;
      wx = pick(wxPool);
      seasonMatch = wx.months.indexOf(month) !== -1;
    }

    /* traffic this weather could plausibly cause (benign -> 'any' only) */
    const wxTags = wx ? wx.tags : [];
    const trPool = TRAFFIC.filter(function (t) {
      if (t.only && t.only.indexOf(place.region) === -1) return false;
      return t.needs.indexOf('any') !== -1 ||
        t.needs.some(function (n) { return wxTags.indexOf(n) !== -1; });
    });
    if (!trPool.length) return null;
    const tr = pick(trPool);

    /* clock — everything hangs off one target time so the story lines up.
       In live mode that clock is the user's real local time, not this machine's. */
    const nowMins = live ? live.localMins : now.getHours() * 60 + now.getMinutes();
    const weekday = live ? live.weekday : now.getDay();
    const target = Math.round((nowMins + rint(-20, 40)) / 15) * 15;
    const leftMins = target - rint(25, 55);
    const early = rint(10, 25);
    const eta = target + rint(20, 75);
    /* time stuck has to fit inside the journey, or the numbers give you away */
    const window = eta - leftMins;
    const dur = rint(15, Math.max(20, window - 15));

    const vars = {
      area: area, areaBare: area.replace(/^the /, ''), road: road,
      transit: transit, city: city.name, monthName: MONTHS[month - 1],
      leftTime: fmtTime(leftMins), target: fmtTime(target), eta: fmtTime(eta),
      dur: dur, early: early, partOfDay: partOfDay(nowMins)
    };

    const scenario = opts.scenario
      ? (SCENARIOS.filter(function (s) { return s.id === opts.scenario; })[0] || pick(SCENARIOS))
      : pick(SCENARIOS);
    const tone = opts.tone
      ? (TONES.filter(function (t) { return t.id === opts.tone; })[0] || pick(TONES))
      : pick(TONES);

    const thingTpl = pick(scenario.things);
    vars.thing = fill(thingTpl, vars);

    /* if the subject already names the time, don't state the time twice */
    let openers = tone.openers;
    if (thingTpl.indexOf('{target}') !== -1) {
      const trimmed = openers.filter(function (o) { return o.indexOf('{target}') === -1; });
      if (trimmed.length) openers = trimmed;
    }

    const opener = fill(pick(openers), vars);

    /* don't name the same place twice in one breath ("the heat coming off the
       10 was unreal, and they had the 10 closed...") */
    let wxPhrases = benign
      ? (isRush(nowMins, weekday) ? RUSH_CLAUSES : OFFPEAK_CLAUSES)
      : wx.phrases;
    ['{road}', '{area}'].forEach(function (slot) {
      if (tr.text.indexOf(slot) === -1) return;
      const without = wxPhrases.filter(function (p) { return p.indexOf(slot) === -1; });
      if (without.length) wxPhrases = without;
    });
    /* "and" implies the weather caused the jam. When the incident is one that
       could happen in any weather, say so instead of implying a false link. */
    const causal = !benign && tr.needs.indexOf('any') === -1;
    const joiner = causal
      ? ', and '
      : pick([', and on top of that ', ', and separately ', '. Then ']);
    const cause = cap(fill(pick(wxPhrases), vars)) + joiner + fill(tr.text, vars) + '.';

    /* if the area is already named twice, don't name it a third time */
    let attempts = ATTEMPTS;
    if (cause.split(area).length - 1 >= 2) {
      const without = ATTEMPTS.filter(function (a) { return a.indexOf('{area}') === -1; });
      if (without.length) attempts = without;
    }
    const attempt = fill(pick(attempts), vars);
    const closer = fill(pick(tone.closers), vars);

    /* three or four sentences — length variation stops it sounding templated */
    const useAttempt = Math.random() < 0.78;
    const parts = [opener, cause];
    if (useAttempt) parts.push(attempt);
    parts.push(closer);

    /* plausibility: how hard would this be to check or disprove?
       Live mode scores higher because the weather half is not a claim — it is
       an observation, and it will still be true when they check. */
    let score, checks = [];
    if (live) {
      score = 100 - tr.risk * 6 - (benign ? 12 : 0);
      if (benign) {
        checks.push('It is clear in ' + city.name + ' right now, so there is no weather to blame. ' +
          'This leans entirely on traffic, which is the weakest version of this excuse.');
      } else {
        checks.push('This half is true: ' + city.name + ' has ' + live.weatherLabel +
          ' right now, observed at ' + live.observedAt + '. Anyone who checks will confirm it.');
      }
      checks.push(tr.risk >= 3
        ? 'The incident is inferred, not observed — there is no live traffic feed here. Something this specific could be contradicted by a maps app.'
        : 'The congestion is inferred from the real time of day, which is the safe kind of vague.');
    } else {
      score = 100 - (wx.risk + tr.risk) * 6 - (seasonMatch ? 0 : 18);
      checks.push('Weather is the first thing anyone checks. This only holds up if ' +
        city.name + ' actually had ' + wx.label + ' today — use live conditions to be sure.');
      checks.push(tr.risk >= 3
        ? 'A crash or closure that specific either shows up on a maps app or it does not. High risk.'
        : 'Unexplained congestion is the safe kind of detail: always a little true, never provable.');
      if (!seasonMatch) {
        checks.push(cap(wx.label) + ' in ' + MONTHS[month - 1] +
          ' is a stretch. Turn on season matching for something plausible.');
      }
    }
    if (score < 30) score = 30;
    if (score > 97) score = 97;
    if (useAttempt) {
      checks.push('Keep the workaround straight — that you tried something and it failed is the part people remember.');
    }

    const weatherLabel = benign
      ? (live ? live.weatherLabel : 'clear')
      : (live ? live.weatherLabel : wx.label);

    const facts = [
      ['Where', area + ', ' + city.name + (live ? ' (your location)' : ' — ' + road)],
      [live ? 'Conditions now' : 'Weather', cap(weatherLabel) +
        (live && typeof live.tempC === 'number' ? ', ' + Math.round(live.tempC) + '°C' : '')],
      ['What happened', cap(fill(tr.text, vars))],
      ['Left home', vars.leftTime],
      ['Stuck for', dur + ' minutes'],
      ['Was due', vars.target],
      ['Now arriving', vars.eta]
    ];
    if (live) facts.splice(2, 0, ['Observed at', live.observedAt + ' local']);

    return {
      text: sentenceCase(parts.join(' ')),
      signature: [(wx ? wx.id : 'benign'), tr.text, road, tone.id, scenario.id].join('|'),
      meta: {
        region: place.region && REGIONS[place.region] ? REGIONS[place.region].label : (live ? live.countryName : ''),
        city: city.name,
        area: area,
        road: road,
        weather: weatherLabel,
        traffic: fill(tr.text, vars),
        scenario: scenario.label,
        tone: tone.label,
        seasonMatch: seasonMatch,
        live: !!live,
        benign: benign,
        observedAtLabel: live ? live.observedAt : '',
        score: score,
        band: score >= 85 ? 'Solid' : score >= 70 ? 'Believable' : score >= 55 ? 'Thin' : 'Risky',
        checks: checks,
        facts: facts
      }
    };
  }

  /* Public: generate one excuse whose signature isn't in `avoid` (a Set). */
  function generate(opts) {
    opts = opts || {};
    const avoid = opts.avoid instanceof Set ? opts.avoid : new Set();
    let last = null;
    for (let i = 0; i < 120; i++) {
      const r = build(opts);
      if (!r) continue;
      last = r;
      if (!avoid.has(r.signature)) return r;
    }
    return last; /* combination pool exhausted — repeat rather than fail */
  }

  const api = {
    generate: generate,
    regions: REGIONS,
    scenarios: SCENARIOS,
    tones: TONES,
    weather: WEATHER,
    traffic: TRAFFIC
  };

  root.ExcuseEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
