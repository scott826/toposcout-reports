// SkyGrid — FAA Airspace Classification + UAS Facility Map
// Queries FAA ArcGIS Open Data — no API key required
// Returns airspace class at coordinates + nearest controlled airspace + max drone altitude

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { lat, lng } = event.queryStringParameters || {};
    if (!lat || !lng) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'lat and lng required' }) };
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // Query 1 — Class Airspace at this exact point
    const airspaceUrl = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query` +
      `?geometry=${userLng},${userLat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=NAME,TYPE_CODE,LOWER_VAL,UPPER_VAL,UPPER_UOM,LOWER_UOM` +
      `&returnGeometry=false` +
      `&f=json`;

    // Query 2 — UAS Facility Map (max drone altitude) within 10 miles
    const uasUrl = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0/query` +
      `?geometry=${userLng},${userLat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=CEILING,APT_NAME,IDENT` +
      `&returnGeometry=false` +
      `&f=json`;

    // Query 3 — Nearby controlled airspace within ~20 miles (0.3 degrees)
    const nearbyUrl = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query` +
      `?geometry=${userLng - 0.3},${userLat - 0.3},${userLng + 0.3},${userLat + 0.3}` +
      `&geometryType=esriGeometryEnvelope` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&where=TYPE_CODE IN ('B','C','D')` +
      `&outFields=NAME,TYPE_CODE,LOWER_VAL,UPPER_VAL` +
      `&returnGeometry=false` +
      `&f=json`;

    // Fire all three in parallel
    const [airspaceRes, uasRes, nearbyRes] = await Promise.all([
      fetch(airspaceUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(uasUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(nearbyUrl, { signal: AbortSignal.timeout(8000) })
    ]);

    const [airspaceData, uasData, nearbyData] = await Promise.all([
      airspaceRes.ok ? airspaceRes.json() : null,
      uasRes.ok ? uasRes.json() : null,
      nearbyRes.ok ? nearbyRes.json() : null
    ]);

    // Parse current airspace class
    const airspaceFeatures = airspaceData?.features || [];
    // Sort by most restrictive — B > C > D > E > G
    const classPriority = { 'B': 5, 'C': 4, 'D': 3, 'E': 2, 'G': 1, 'A': 0 };  // AIRSPACE_CLASS_A_FIX_V1
    airspaceFeatures.sort((a, b) => {
      const pa = classPriority[a.attributes?.TYPE_CODE] || 0;
      const pb = classPriority[b.attributes?.TYPE_CODE] || 0;
      return pb - pa;
    });

    const primaryAirspace = airspaceFeatures[0]?.attributes || null;
    // TYPE_CODE sometimes returns "CLASS" instead of the letter — extract from NAME as fallback
    // e.g. "COLUSA CLASS E5" → "E", "SFO CLASS B" → "B"
    let airspaceClass = primaryAirspace?.TYPE_CODE || 'G';
    if (airspaceClass === 'CLASS' || airspaceClass.length > 1) {
      const nameMatch = (primaryAirspace?.NAME || '').match(/CLASS\s+([ABCDEG])/i);
      airspaceClass = nameMatch ? nameMatch[1].toUpperCase() : 'G';
    }
    // AIRSPACE_CLASS_A_FIX_V1: Class A is 18,000ft+ MSL (high-altitude enroute)
    // and never applies to a ground survey site. If the query returned A, the
    // surface class is effectively G (uncontrolled). Treat as G so the badge and
    // the drone note agree and reflect reality.
    if (airspaceClass === 'A') airspaceClass = 'G';
    const airspaceName = primaryAirspace?.NAME || 'Uncontrolled';

    // Parse UAS facility map
    const uasFeatures = uasData?.features || [];
    const uasCeiling = uasFeatures.length > 0 ? uasFeatures[0].attributes?.CEILING : null;
    const uasAirport = uasFeatures.length > 0 ? uasFeatures[0].attributes?.APT_NAME : null;

    // Parse nearby controlled airspace
    const nearbyControlled = (nearbyData?.features || []).map(f => ({
      class: f.attributes?.TYPE_CODE,
      name: f.attributes?.NAME,
      lower: f.attributes?.LOWER_VAL,
      upper: f.attributes?.UPPER_VAL
    }));

    // Build drone status
    let droneStatus, droneColor, droneNote;
    if (airspaceClass === 'B') {
      droneStatus = 'AUTHORIZATION REQUIRED';
      droneColor = 'red';
      droneNote = 'Class B airspace — LAANC or FAA DroneZone authorization required';
    } else if (airspaceClass === 'C') {
      droneStatus = 'AUTHORIZATION REQUIRED';
      droneColor = 'red';
      droneNote = 'Class C airspace — LAANC authorization required before flight';
    } else if (airspaceClass === 'D') {
      droneStatus = 'AUTHORIZATION REQUIRED';
      droneColor = 'orange';
      droneNote = 'Class D airspace — LAANC authorization required before flight';
    } else if (airspaceClass === 'E') {
      droneStatus = 'CAUTION';
      droneColor = 'yellow';
      droneNote = 'Class E controlled airspace — check altitude restrictions';
    } else {
      droneStatus = 'FREE TO FLY';
      droneColor = 'green';
      droneNote = 'Class G uncontrolled airspace — fly under 400ft AGL, follow Part 107';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        airspaceClass,
        airspaceName,
        droneStatus,
        droneColor,
        droneNote,
        uasCeiling,
        uasAirport,
        nearbyControlled: nearbyControlled.slice(0, 3),
        source: 'faa_arcgis'
      })
    };

  } catch(e) {
    console.error('Airspace function error:', e.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: e.message, airspaceClass: 'UNKNOWN' })
    };
  }
};
