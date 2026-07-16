// dxf-server.js — SkyGrid DXF Generator for DigitalOcean
// Fetches OSM data from local PostGIS instead of kumi.systems
const fetch = require('node-fetch');
const { Client } = require('pg');
const NETLIFY = 'https://skygrid-v31.netlify.app';
const PG_CONFIG = {
  host: 'localhost',
  database: 'skygrid',
  user: 'postgres',
  password: 'skygrid2026',
  port: 5432
};
async function queryPostGIS(sql, params) {
  const client = new Client(PG_CONFIG);
  try {
    await client.connect();
    const res = await client.query(sql, params);
    return res.rows;
  } catch(e) {
    console.warn('[DXF] PostGIS query failed:', e.message);
    return [];
  } finally {
    await client.end();
  }
}
function rowsToElements(rows) {
  return rows.map(row => {
    try {
      const geom = JSON.parse(row.geojson);
      let coords = geom.coordinates || [];
      // Polygon: coords[0] is outer ring array of [lng,lat]
      // LineString: coords is array of [lng,lat]
      if (geom.type === 'Polygon') coords = coords[0] || [];
      else if (geom.type === 'MultiPolygon') coords = (coords[0] && coords[0][0]) || [];
      else if (geom.type === 'MultiLineString') coords = coords.flat();
      const geometry = coords.map(coord => ({ lat: coord[1], lon: coord[0] }));
      const tags = { name: row.name || '' };
      if (row.highway)  tags.highway  = row.highway;
      if (row.waterway) tags.waterway = row.waterway;
      if (row.power)    tags.power    = row.power;
      if (row.railway)  tags.railway  = row.railway;
      if (row.building) tags.building = row.building;
      if (row.man_made) tags.man_made = row.man_made;
      if (row.landuse)  tags.landuse  = row.landuse;
      if (row.natural)  tags.natural  = row.natural;
      if (row.leisure)  tags.leisure  = row.leisure;
      return {
        type: 'way',
        id: row.osm_id || 0,
        tags,
        geometry
      };
    } catch(e) { return null; }
  }).filter(Boolean);
}
async function fetchOSMFromPostGIS(lat, lng, d, bldgD) {
  const latMin = lat - d, latMax = lat + d;
  const lngMin = lng - d, lngMax = lng + d;
  const bLatMin = lat - bldgD, bLatMax = lat + bldgD;
  const bLngMin = lng - bldgD, bLngMax = lng + bldgD;
  const lineSQL = (filter) => `
    SELECT osm_id, name, highway, waterway, power, railway, man_made,
           ST_AsGeoJSON(ST_Transform(way, 4326)) as geojson
    FROM planet_osm_line
    WHERE ST_Intersects(way, ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,4326),3857))
    AND ${filter}
    ORDER BY way <-> ST_Transform(ST_SetSRID(ST_MakePoint(($1+$3)/2,($2+$4)/2),4326),3857)
    LIMIT 5000
  `;
  const bldgSQL = `
    (
      SELECT osm_id, name, building,
             ST_AsGeoJSON(ST_Transform(way, 4326)) as geojson
      FROM planet_osm_polygon
      WHERE ST_Intersects(way, ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,4326),3857))
      AND building IS NOT NULL
      ORDER BY way <-> ST_Transform(ST_SetSRID(ST_MakePoint(($1+$3)/2,($2+$4)/2),4326),3857)
      LIMIT 1000
    )
    UNION ALL
    (
      SELECT (m.id + 1000000000)::bigint as osm_id, '' as name, 'yes' as building,
             ST_AsGeoJSON(m.geom) as geojson
      FROM msbf_buildings m
      WHERE ST_Intersects(m.geom, ST_MakeEnvelope($1,$2,$3,$4,4326))
      ORDER BY m.geom <-> ST_SetSRID(ST_MakePoint(($1+$3)/2,($2+$4)/2),4326)
      LIMIT 1000
    )
  `;
  const polySQL = (filter, col) => `
    SELECT osm_id, name, ${col},
           ST_AsGeoJSON(ST_Transform(way, 4326)) as geojson
    FROM planet_osm_polygon
    WHERE ST_Intersects(way, ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,4326),3857))
    AND ${filter}
    ORDER BY way <-> ST_Transform(ST_SetSRID(ST_MakePoint(($1+$3)/2,($2+$4)/2),4326),3857)
    LIMIT 500
  `;
  const [roadsRows, hydroRows, powerRows, pipeRows, railRows, bldgRows, landuseRows, naturalRows, leisureRows] = await Promise.all([
    queryPostGIS(lineSQL("highway IS NOT NULL"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(lineSQL("waterway IS NOT NULL"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(lineSQL("power IS NOT NULL"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(lineSQL("man_made = 'pipeline'"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(lineSQL("railway IS NOT NULL"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(bldgSQL, [bLngMin, bLatMin, bLngMax, bLatMax]),
    queryPostGIS(polySQL("landuse IS NOT NULL", "landuse"), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(polySQL('"natural" IS NOT NULL', '"natural"'), [lngMin, latMin, lngMax, latMax]),
    queryPostGIS(polySQL("leisure IS NOT NULL", "leisure"), [lngMin, latMin, lngMax, latMax])
  ]);
  console.log('[DXF] PostGIS — roads:', roadsRows.length, 'hydro:', hydroRows.length,
    'power:', powerRows.length, 'rail:', railRows.length, 'buildings:', bldgRows.length);
  return {
    roads:     { elements: rowsToElements(roadsRows) },
    hydro:     { elements: rowsToElements(hydroRows) },
    power:     { elements: rowsToElements(powerRows) },
    pipeline:  { elements: rowsToElements(pipeRows) },
    railroad:  { elements: rowsToElements(railRows) },
    buildings: { elements: rowsToElements(bldgRows) },
    landuse:   { elements: rowsToElements(landuseRows) },
    natural:   { elements: rowsToElements(naturalRows) },
    leisure:   { elements: rowsToElements(leisureRows) }
  };
}
async function generateDXF(lat, lng, interval, argFips, civilTwpName, civilTwpRings) {
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const contourInterval = parseFloat(interval || '5');
  const innerRadius = 400;
  const d = 0.025;
  const bldgD = 0.025;
  console.log('[DXF] Fetching all data for', userLat, userLng);

  // County boundary fetch from Census TIGER (needs FIPS split into STATE + COUNTY)
  let countyBdyPromise = Promise.resolve(null);
  if (argFips && String(argFips).length === 5) {
    const countyUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/13/query`
                    + `?where=GEOID%3D'${argFips}'`
                    + `&outFields=NAME,GEOID`
                    + `&returnGeometry=true&outSR=4326&f=geojson`;
    countyBdyPromise = fetch(countyUrl, { timeout: 20000 })
      .then(r => r.ok ? r.json() : null)
      .catch(e => { console.log('[DXF] County boundary fetch failed:', e.message); return null; });
  }

  const [gridRes, innerRes, plssProxyRes, osmBody, countyBdy] = await Promise.all([
    fetch(`${NETLIFY}/.netlify/functions/contour-dxf-test?lat=${userLat}&lng=${userLng}&debug=1`, { timeout: 30000 }),
    fetch(`${NETLIFY}/.netlify/functions/contour-dxf-test?lat=${userLat}&lng=${userLng}&debug=1&radius=${innerRadius}`, { timeout: 30000 }),
    fetch(`${NETLIFY}/.netlify/functions/plss-poly2c?lat=${userLat}&lng=${userLng}`, { timeout: 20000 }).catch(()=>null),
    fetchOSMFromPostGIS(userLat, userLng, d, bldgD),
    countyBdyPromise
  ]);
  // Attach county boundary to osmBody so site-dxf-v21.js picks it up via osmBody.countyBoundary
  if (countyBdy && countyBdy.features) {
    osmBody.countyBoundary = countyBdy;
    console.log('[DXF] County boundary:', countyBdy.features.length, 'features');
  } else {
    osmBody.countyBoundary = null;
    console.log('[DXF] County boundary: none (no FIPS or fetch failed)');
  }
  const gridData  = await gridRes.json();
  const innerData = await innerRes.json();
  const plssProxy = plssProxyRes ? await plssProxyRes.json().catch(()=>null) : null;
  // nearSite filter — clip all elements to 0.022 deg radius in lat/lng space
  // Prevents bad SPC conversions from points far from site
  const nearSite = (elements) => {
    const R = 0.022;
    return elements.filter(el => {
      if (!el.geometry || !el.geometry.length) return false;
      return el.geometry.some(p => 
        Math.abs(p.lat - userLat) <= R && Math.abs(p.lon - userLng) <= R
      );
    });
  };
  for (const key of ['roads','hydro','power','pipeline','railroad','buildings','landuse','natural','leisure']) {
    if (osmBody[key] && osmBody[key].elements) {
      osmBody[key].elements = nearSite(osmBody[key].elements);
    }
  }
  console.log('[DXF] Roads:', osmBody.roads.elements.length, 'Buildings:', osmBody.buildings.elements.length);
  // DIAG: count buildings within 0.001 deg of user
  if (osmBody.buildings && osmBody.buildings.elements) {
    let near = 0, total = 0;
    for (const el of osmBody.buildings.elements) {
      total++;
      if (el.geometry && el.geometry.length > 0) {
        const p = el.geometry[0];
        if (typeof p.lat === 'number' && typeof p.lon === 'number') {
          if (Math.abs(p.lat - userLat) < 0.001 && Math.abs(p.lon - userLng) < 0.001) near++;
        }
      }
    }
    console.log('[DIAG] Buildings within 0.001 deg of subject:', near, '/ total:', total);
    // Show first 3 building first-vertex coords
    for (let i = 0; i < Math.min(5, osmBody.buildings.elements.length); i++) {
      const el = osmBody.buildings.elements[i];
      if (el.geometry && el.geometry[0]) {
        console.log('[DIAG] Building', i, 'vertex[0]:', JSON.stringify(el.geometry[0]), 'vertCount:', el.geometry.length);
      }
    }
  }
  const siteHandler = require('./site-dxf-v21');
  // FCC county FIPS lookup — needed for SPC zone routing
  let countyFips = argFips && argFips !== '00000' ? argFips : '00000';
  // CT planning regions (091xx) → remap to real county FIPS for SPC lookup
  if (countyFips && countyFips.startsWith('09') && countyFips.length === 5 && !['09001','09003','09005','09007','09009','09011','09013','09015'].includes(countyFips)) countyFips = '09003';
  if (!countyFips || countyFips === '00000') try {
    const fccRes = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${userLat}&longitude=${userLng}&format=json`, { timeout: 5000 });
    const fccJson = await fccRes.json();
    if (fccJson && fccJson.County && fccJson.County.FIPS) countyFips = fccJson.County.FIPS;
    console.log('[DXF] County FIPS:', countyFips);
  } catch(e) { console.warn('[DXF] FCC lookup failed:', e.message); }

  const _osmBodyWithCivil = Object.assign({}, osmBody, { civilTwpName: civilTwpName || null, civilTwpRings: civilTwpRings || null });
  const event = {
    queryStringParameters: { lat: String(userLat), lng: String(userLng), interval: String(contourInterval), fips: countyFips },
    body: JSON.stringify(_osmBodyWithCivil),
    httpMethod: 'POST'
  };
  global.fetch = fetch;
  const result = await siteHandler.handler(event);
  if (result.statusCode !== 200) {
    throw new Error('DXF generation failed: ' + result.body);
  }
  const h = result.headers || {};
  return { dxf: result.body, spc: { zone: h["X-SPC-Zone"] || "", fips: h["X-SPC-Fips"] || "", N: parseFloat(h["X-SPC-N"] || 0), E: parseFloat(h["X-SPC-E"] || 0) } };
}
module.exports = { generateDXF };
if (require.main === module) {
  const [,, lat, lng, interval, argFips, argCivilTwpName, argCivilTwpRingsFile] = process.argv;
  const _civilTwpName  = argCivilTwpName || null;
  const _civilTwpRings = (() => { try { if (!argCivilTwpRingsFile) return null; const fs = require('fs'); return JSON.parse(fs.readFileSync(argCivilTwpRingsFile, 'utf8')); } catch(e) { return null; } })();
  generateDXF(lat || '39.7391', lng || '-121.8347', '5', argFips || '00000', _civilTwpName, _civilTwpRings)
    .then(result => {
      const dxfStr = result.dxf || result;
      const spc = result.spc || {};
      console.log('[DXF] Success, length:', dxfStr.length);
      require('fs').writeFileSync('/tmp/test_output.dxf', dxfStr);
      require('fs').writeFileSync('/tmp/test_output_spc.json', JSON.stringify(spc));
      console.log('[DXF] Saved to /tmp/test_output.dxf, SPC:', JSON.stringify(spc));
    })
    .catch(e => console.error('[DXF] Error:', e.message));
}