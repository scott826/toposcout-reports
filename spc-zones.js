// spc-zones.js — State Plane Coordinate System Router v2
// Hardened version with input sanitization, VA cities, AK/HI fallback,
// sub-county zone resolution for split-boundary counties
// Session 78 — April 2026

'use strict';

const path = require('path');

const USF  = 0.304800609601219;  // US Survey Foot in meters
const INTF = 0.3048;             // International Foot in meters

// States using International Feet
const INTL_FEET_STATES = new Set(['04','26','29','30','38','41','45']);

// State prefix → file map
const STATE_FILE = {
  '01':'al','04':'az','05':'ar','06':'ca','08':'co','09':'ct','10':'de',
  '12':'fl','13':'ga','16':'id','17':'il','18':'in','19':'ia','20':'ks',
  '21':'ky','22':'la','23':'me','24':'md','25':'ma','26':'mi','27':'mn',
  '28':'ms','29':'mo','30':'mt','31':'ne','32':'nv','33':'nh','34':'nj',
  '35':'nm','36':'ny','37':'nc','38':'nd','39':'oh','40':'ok','41':'or',
  '42':'pa','44':'ri','45':'sc','46':'sd','47':'tn','48':'tx','49':'ut',
  '50':'vt','51':'va','53':'wa','54':'wv','55':'wi','56':'wy'
};

// ── #3 AK/HI: unsupported states with clear error ────────────────────────────
const UNSUPPORTED_STATES = {
  '02': 'Alaska (SPCS zones not implemented — use UTM Zone 4N-7N)',
  '15': 'Hawaii (SPCS zones not implemented — use UTM Zone 4N-5N)',
  '11': 'District of Columbia (use MD or VA zone)',
  '60': 'American Samoa','66': 'Guam','69': 'Northern Mariana Islands',
  '72': 'Puerto Rico / Virgin Islands','78': 'U.S. Virgin Islands',
};

// ── #4 Sub-county zone resolution for split-boundary counties ─────────────
// Counties that straddle a zone boundary — use lat/lng to pick correct zone
// Format: county_fips → function(lat, lng) → zone_fips_code
const SPLIT_COUNTY_RESOLVER = {
  // Grant County WA (53025): North of ~47.5° → North zone, South → South zone
  // Zone boundary follows roughly lat 47°30' per NGS
  '53025': (lat) => lat >= 47.5 ? '4601' : '4602',

  // Harney County OR (41025): spans entire state N-S, mostly South zone
  // Northern tip near lat 44° could be North zone
  '41025': (lat) => lat >= 44.0 ? '3601' : '3602',

  // Lincoln County OR (41041): straddles N/S boundary near lat 44°20'
  '41041': (lat) => lat >= 44.333 ? '3601' : '3602',

  // Linn County OR (41043): similar boundary
  '41043': (lat) => lat >= 44.333 ? '3601' : '3602',

  // Wheeler County OR (41069): straddles boundary
  '41069': (lat) => lat >= 44.0 ? '3601' : '3602',

  // Sherman County OR (41055): northern OR, all North zone ✓ (already correct)

  // Malheur County OR (41045): southern OR, all South zone ✓

  // Chippewa County MN (27023): Central/South boundary ~lat 45.2°
  '27023': (lat) => lat >= 45.217 ? '2202' : '2203',

  // Kanabec County MN (27065): North/Central boundary ~lat 47.05°
  '27065': (lat) => lat >= 47.05 ? '2201' : '2202',

  // Meeker County MN (27101): Central/South boundary
  '27101': (lat) => lat >= 45.217 ? '2202' : '2203',

  // Clearfield County PA (42033): North/South boundary ~lat 40.97°
  '42033': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Centre County PA (42027): North/South boundary
  '42027': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Mifflin County PA (42087): North/South boundary
  '42087': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Snyder County PA (42109): North/South boundary
  '42109': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Union County PA (42119): North/South boundary
  '42119': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Sullivan County PA (42113): North/South boundary
  '42113': (lat) => lat >= 40.967 ? '3701' : '3702',

  // Stark County OH (39151): North/South boundary ~lat 40.43°
  '39151': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Coshocton County OH (39031): boundary
  '39031': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Holmes County OH (39075): boundary
  '39075': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Knox County OH (39083): boundary
  '39083': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Morrow County OH (39117): boundary
  '39117': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Marion County OH (39101): boundary
  '39101': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Hardin County OH (39065): boundary
  '39065': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Shelby County OH (39149): boundary
  '39149': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Auglaize County OH (39011): boundary
  '39011': (lat) => lat >= 40.433 ? '3401' : '3402',

  // Mercer County OH (39107): boundary
  '39107': (lat) => lat >= 40.433 ? '3401' : '3402',
};

// Lazy-loaded state modules
const _cache = {};
function loadState(stateFile) {
  if (!_cache[stateFile]) {
    _cache[stateFile] = require(path.join(__dirname, 'spc', stateFile + '.js'));
  }
  return _cache[stateFile];
}

// ── LCC Projection ────────────────────────────────────────────────────────
function projectLCC(lat, lng, zone, ftPerMeter) {
  const {lat0, lon0, lat1, lat2, fe, fn} = zone;
  const a = 6378137.0;
  const f = 1/298.257222101;
  const e2 = 2*f - f*f;
  const e = Math.sqrt(e2);
  const R = Math.PI/180;

  const phi0=lat0*R, lam0=lon0*R, phi1=lat1*R, phi2=lat2*R;
  const phi=lat*R, lam=lng*R;

  const m = p => Math.cos(p)/Math.sqrt(1-e2*Math.sin(p)**2);
  const t = p => Math.tan(Math.PI/4-p/2)/((1-e*Math.sin(p))/(1+e*Math.sin(p)))**(e/2);

  const m1=m(phi1), m2=m(phi2);
  const t0=t(phi0), t1=t(phi1), t2=t(phi2), tP=t(phi);

  const n  = (Math.log(m1)-Math.log(m2))/(Math.log(t1)-Math.log(t2));
  const F  = m1/(n*t1**n);
  const r0 = a*F*t0**n;
  const r  = a*F*tP**n;
  const th = n*(lam-lam0);

  return {
    E: (fe*ftPerMeter + r*Math.sin(th)) / ftPerMeter,
    N: (fn*ftPerMeter + r0 - r*Math.cos(th)) / ftPerMeter
  };
}

// ── TM Projection ─────────────────────────────────────────────────────────
function projectTM(lat, lng, zone, ftPerMeter) {
  const {lat0, lon0, scale, fe, fn} = zone;
  const a=6378137.0, f=1/298.257222101;
  const e2=2*f-f*f, e4=e2*e2, e6=e2*e2*e2;
  const e2p=e2/(1-e2);
  const R=Math.PI/180;

  const phi0=lat0*R, lam0=lon0*R, phi=lat*R, lam=lng*R;
  const sinP=Math.sin(phi);
  const N0=a/Math.sqrt(1-e2*sinP*sinP);
  const T=Math.tan(phi)**2;
  const C=e2p*Math.cos(phi)**2;
  const A=Math.cos(phi)*(lam-lam0);

  const M = p => a*((1-e2/4-3*e4/64-5*e6/256)*p
    -(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*p)
    +(15*e4/256+45*e6/1024)*Math.sin(4*p)
    -(35*e6/3072)*Math.sin(6*p));

  const Mf=M(phi), Mf0=M(phi0);

  return {
    E: (scale*N0*(A+(1-T+C)*A**3/6+(5-18*T+T**2+72*C-58*e2p)*A**5/120)
        + fe*ftPerMeter) / ftPerMeter,
    N: (scale*(Mf-Mf0+N0*Math.tan(phi)*(A**2/2+(5-T+9*C+4*C**2)*A**4/24
        +(61-58*T+T**2+600*C-330*e2p)*A**6/720))
        + fn*ftPerMeter) / ftPerMeter
  };
}

// ── Main export ────────────────────────────────────────────────────────────
function latLngToSPC(lat, lng, countyFips) {
  // ── #1 Input sanitization ──────────────────────────────────────────────
  if (countyFips === null || countyFips === undefined) {
    throw new Error('latLngToSPC: countyFips is required');
  }
  // Trim whitespace, convert to string, pad to 5 digits
  const fips = String(countyFips).trim().padStart(5, '0');

  if (!/^\d{5}$/.test(fips)) {
    throw new Error(`latLngToSPC: invalid FIPS code "${countyFips}" — must be 5 digits`);
  }

  const statePrefix = fips.substring(0, 2);

  // ── #3 AK/HI/territories: clear error, don't crash ────────────────────
  if (UNSUPPORTED_STATES[statePrefix]) {
    throw new Error(`latLngToSPC: ${UNSUPPORTED_STATES[statePrefix]}`);
  }

  const stateFile = STATE_FILE[statePrefix];
  if (!stateFile) {
    // Fallback: scan all states by lat/lng bounds
    for (const sf of Object.values(STATE_FILE)) {
      try {
        const {ZONES} = loadState(sf);
        for (const z of ZONES) {
          if (lat >= z.latS && lat <= z.latN && lng >= z.lonW && lng <= z.lonE) {
            const result = z.proj === 'tm' ? projectTM(lat, lng, z) : projectLCC(lat, lng, z);
            result.zone = z.zoneName; result.fipsZone = z.fips; result.intlFeet = !!z.intlFeet;
            console.log('[SPC] bounds fallback hit:', z.zoneName);
            return result;
          }
        }
      } catch(e) {}
    }
    return { error: `no zone found for (${lat}, ${lng})` };
  }

  const {ZONES, COUNTY_ZONE} = loadState(stateFile);

  // ── #4 Sub-county resolution: use lat/lng for split-boundary counties ──
  let zoneCode;
  if (SPLIT_COUNTY_RESOLVER[fips]) {
    // Use geographic position — more accurate than county assignment alone
    zoneCode = SPLIT_COUNTY_RESOLVER[fips](lat, lng);
  } else {
    zoneCode = COUNTY_ZONE[fips];
  }

  // ── #2 VA independent cities + missing FIPS fallback ──────────────────
  if (!zoneCode) {
    // Try known stale/renamed FIPS remapping
    const FIPS_REMAP = {
      '51515': '51019',  // Bedford City VA → Bedford County (merged 2013)
      '46113': '46102',  // Shannon County SD → Oglala Lakota (renamed 2015)
      '02270': null,     // Wade Hampton AK → Kusilvak (AK unsupported anyway)
    };
    const remapped = FIPS_REMAP[fips];
    if (remapped) {
      zoneCode = COUNTY_ZONE[remapped];
    }
  }

  if (!zoneCode) {
    throw new Error(`latLngToSPC: county FIPS "${fips}" not found — check FIPS code is current`);
  }

  const zone = ZONES[zoneCode];
  if (!zone) {
    throw new Error(`latLngToSPC: zone "${zoneCode}" not defined in ${stateFile}.js`);
  }

  const useIntlFeet = INTL_FEET_STATES.has(statePrefix);
  const ftPerMeter  = useIntlFeet ? INTF : USF;

  const coords = zone.proj === 'lcc'
    ? projectLCC(lat, lng, zone, ftPerMeter)
    : projectTM(lat, lng, zone, ftPerMeter);

  return {
    E: coords.E,
    N: coords.N,
    zone: zone.zoneName,
    fipsZone: zoneCode,
    intlFeet: useIntlFeet,
    // ── #5 Caller awareness flags ────────────────────────────────────────
    splitCounty: !!SPLIT_COUNTY_RESOLVER[fips],
    ftUnit: useIntlFeet ? 'international_ft' : 'us_survey_ft',
  };
}

module.exports = { latLngToSPC, projectLCC, projectTM };
