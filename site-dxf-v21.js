// site-dxf-v5.js — SkyGrid Site DXF Generator
// Uses exact header/footer from proven AutoCAD-compatible ezdxf output
// Usage: /.netlify/functions/site-dxf-v5?lat=39.2129&lng=-122.0162&interval=5

exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  try {
    const { lat, lng, interval } = event.queryStringParameters || {};
    if (!lat || !lng) {
      return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'lat and lng required' }) };
    }
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const contourInterval = parseFloat(interval || '5');
    const innerRadius = 400; // 1ft contours within 400ft of site

    // ── Fetch data — outer 5ft + inner 1ft + benchmarks + PLSS ───────────
    const host = 'https://skygrid-v31.netlify.app';
    const [gridRes, innerRes, ctrlRes, plssProxyRes] = await Promise.all([
      fetch(`${host}/.netlify/functions/contour-dxf-test?lat=${userLat}&lng=${userLng}&debug=1`,
        { signal: AbortSignal.timeout(25000) }),
      fetch(`${host}/.netlify/functions/contour-dxf-test?lat=${userLat}&lng=${userLng}&debug=1&radius=${innerRadius}`,
        { signal: AbortSignal.timeout(25000) }),
      fetch(`${host}/.netlify/functions/control?lat=${userLat}&lng=${userLng}`,
        { signal: AbortSignal.timeout(15000) }),
      (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch(`${host}/.netlify/functions/plss-poly2c?lat=${userLat}&lng=${userLng}`,
              { signal: AbortSignal.timeout(15000) });
            if (r.ok) return r;
          } catch(e) { console.log('[PLSS fetch] attempt', attempt+1, 'failed:', e.message); }
        }
        return null;
      })(),
    ]);
    const gridData    = await gridRes.json();
    const innerData   = await innerRes.json();
    const ctrlData    = await ctrlRes.json();
    const plssProxy   = plssProxyRes ? await plssProxyRes.json().catch(()=>null) : null;

    // OSM data passed in via POST body from browser (browser fetches Overpass directly)
    let osmBody = null;
    try { osmBody = event.body ? JSON.parse(event.body) : null; } catch(e) {}
    const roadsData   = osmBody ? osmBody.roads    : null;
    const hydroData   = osmBody ? osmBody.hydro    : null;
    const powerData   = osmBody ? osmBody.power    : null;
    const pipeData    = osmBody ? osmBody.pipeline : null;
    const railData    = osmBody ? osmBody.railroad : null;
    const bldgData    = osmBody ? osmBody.buildings: null;
    const countyBdy   = osmBody ? osmBody.countyBoundary : null;
    const otlsData    = osmBody ? osmBody.otls : null;

    // Wrap section/township into geojson-style objects for drawPlssPolygon
    function wrapPlss(p) {
      if(!p || !p.coords) return null;
      return { features: [{ geometry: { type: p.type, coordinates: p.coords }, properties: { FRSTDIVLAB: p.label, TWNSHPLAB: p.label, SRVNAME: p.srvName||'' } }] };
    }
    const plssData = plssProxy ? wrapPlss(plssProxy.section)  : null;
    const twpData  = plssProxy ? wrapPlss(plssProxy.township) : null;
    const qqList   = (plssProxy && plssProxy.quarters) || [];
    const secBbox  = (plssProxy && plssProxy.section && plssProxy.section.bbox) || null;
    const grid       = gridData.grid;
    const gridSize   = gridData.gridSize;
    const radiusFt   = gridData.radiusFt;
    const minElev    = gridData.minElev;
    const maxElev    = gridData.maxElev;
    const benchmarks = ctrlData.benchmarks || [];
    const corsStations = ctrlData.corsStations || [];

    // Inner 1ft grid
    const iGrid     = innerData.grid;
    const iGridSize = innerData.gridSize;
    const iRadiusFt = innerData.radiusFt || innerRadius;

    // ── State Plane CA Zone 2 ─────────────────────────────────────────────
    function latLngToSPC(latDeg, lngDeg) {
      // Texas North Central (FIPS 4202)
      if (latDeg >= 31.6 && latDeg <= 34.1 && lngDeg >= -100.0 && lngDeg <= -94.0) {
        const USF=1200.0/3937.0, toR=d=>d*Math.PI/180;
        const a=6378137.0,f=1/298.257222101,e2=2*f-f*f,e=Math.sqrt(e2);
        const z={lat0:31.6667,lon0:-98.5,lat1:32.1333,lat2:33.9667,fe:1968500.0,fn:6561666.667};
        const lat=toR(latDeg),lon=toR(lngDeg),lat0=toR(z.lat0),lon0=toR(z.lon0),lat1=toR(z.lat1),lat2=toR(z.lat2);
        const mFn=phi=>Math.cos(phi)/Math.sqrt(1-e2*Math.sin(phi)**2);
        const tFn=phi=>{const s=e*Math.sin(phi);return Math.tan(Math.PI/4-phi/2)/Math.pow((1-s)/(1+s),e/2);};
        const m1=mFn(lat1),m2=mFn(lat2),t0=tFn(lat0),t1=tFn(lat1),t2=tFn(lat2),t=tFn(lat);
        const n=(Math.log(m1)-Math.log(m2))/(Math.log(t1)-Math.log(t2));
        const F=m1/(n*Math.pow(t1,n));
        const r0=a*F*Math.pow(t0,n),r=a*F*Math.pow(t,n),theta=n*(lon-lon0);
        return {E:(r*Math.sin(theta))/USF+z.fe, N:(r0-r*Math.cos(theta))/USF+z.fn, zone:'TX North Central', fips:4202, zoneName:'TX North Central'};
      }
      const USF = 1200.0 / 3937.0;
      const toR = d => d * Math.PI / 180;
      const a   = 6378137.0;
      const f   = 1 / 298.257222101;
      const e2  = 2 * f - f * f;
      const e   = Math.sqrt(e2);
      const ZONES = [
        { zone:1, fips:'0401', zoneName:'CA Zone 1 (Eureka)',
          lat0:39.333333333, lon0:-122.0, lat1:40.0, lat2:41.666666667,
          fe:6561666.667, fn:1640416.667,
          latS:39.59, latN:42.01, lonW:-124.55, lonE:-119.99 },
        { zone:2, fips:'0402', zoneName:'CA Zone 2 (San Francisco)',
          lat0:37.666666667, lon0:-122.0, lat1:38.333333333, lat2:39.833333333,
          fe:6561666.667, fn:1640416.667,
          latS:37.07, latN:40.00, lonW:-123.03, lonE:-119.54 },
        { zone:3, fips:'0403', zoneName:'CA Zone 3 (Santa Cruz)',
          lat0:36.5, lon0:-120.5, lat1:37.066666667, lat2:38.433333333,
          fe:6561666.667, fn:1640416.667,
          latS:35.79, latN:38.72, lonW:-123.88, lonE:-117.83 },
        { zone:4, fips:'0404', zoneName:'CA Zone 4 (San Bernardino)',
          lat0:35.333333333, lon0:-119.0, lat1:36.0, lat2:37.25,
          fe:6561666.667, fn:1640416.667,
          latS:34.99, latN:37.58, lonW:-121.42, lonE:-115.62 },
        { zone:5, fips:'0405', zoneName:'CA Zone 5 (Los Angeles)',
          lat0:33.5, lon0:-118.0, lat1:34.033333333, lat2:35.466666667,
          fe:6561666.667, fn:1640416.667,
          latS:32.76, latN:35.81, lonW:-121.43, lonE:-114.12 },
        { zone:6, fips:'0406', zoneName:'CA Zone 6 (San Diego)',
          lat0:32.166666667, lon0:-116.25, lat1:32.783333333, lat2:33.883333333,
          fe:6561666.667, fn:1640416.667,
          latS:32.53, latN:34.08, lonW:-117.68, lonE:-114.43 },
        { zone:21, fips:'4201', zoneName:'TX Zone 1 (North)',
          lat0:34.0, lon0:-101.5, lat1:34.65, lat2:36.1833,
          fe:656166.667, fn:3280833.333,
          latS:34.0, latN:36.5, lonW:-103.0, lonE:-99.5 },
        { zone:22, fips:'4202', zoneName:'TX Zone 2 (North Central)',
          lat0:31.6667, lon0:-98.5, lat1:32.1333, lat2:33.9667,
          fe:1968500.0, fn:6561666.667,
          latS:31.5, latN:34.0, lonW:-100.0, lonE:-96.0 },
        { zone:23, fips:'4203', zoneName:'TX Zone 3 (Central)',
          lat0:29.6667, lon0:-100.3333, lat1:30.1167, lat2:31.8833,
          fe:2296583.333, fn:9842500.0,
          latS:29.5, latN:32.0, lonW:-102.5, lonE:-97.5 },
        { zone:24, fips:'4204', zoneName:'TX Zone 4 (South Central)',
          lat0:27.8333, lon0:-99.0, lat1:28.3833, lat2:30.2833,
          fe:1968500.0, fn:13123333.333,
          latS:27.5, latN:30.5, lonW:-101.5, lonE:-96.5 },
        { zone:25, fips:'4205', zoneName:'TX Zone 5 (South)',
          lat0:25.6667, lon0:-98.5, lat1:26.1667, lat2:27.8333,
          fe:984250.0, fn:16404166.667,
          latS:25.5, latN:28.0, lonW:-100.5, lonE:-96.5 },
      ];
      function projectLCC(latDeg, lngDeg, z) {
        const lat=toR(latDeg), lon=toR(lngDeg);
        const lat0=toR(z.lat0), lon0=toR(z.lon0);
        const lat1=toR(z.lat1), lat2=toR(z.lat2);
        const mFn=phi=>Math.cos(phi)/Math.sqrt(1-e2*Math.sin(phi)**2);
        const tFn=phi=>{const s=e*Math.sin(phi);return Math.tan(Math.PI/4-phi/2)/Math.pow((1-s)/(1+s),e/2);};
        const m1=mFn(lat1),m2=mFn(lat2),t0=tFn(lat0),t1=tFn(lat1),t2=tFn(lat2),t=tFn(lat);
        const n=(Math.log(m1)-Math.log(m2))/(Math.log(t1)-Math.log(t2));
        const F=m1/(n*Math.pow(t1,n));
        const r0=a*F*Math.pow(t0,n), r=a*F*Math.pow(t,n);
        const theta=n*(lon-lon0);
        return { E:r*Math.sin(theta)/USF+z.fe, N:(r0-r*Math.cos(theta))/USF+z.fn };
      }
      let selectedZone=null;
      for(const z of ZONES){
        if(latDeg>=z.latS&&latDeg<=z.latN&&lngDeg>=z.lonW&&lngDeg<=z.lonE){selectedZone=z;break;}
      }
      if(!selectedZone){
        let minDist=Infinity;
        for(const z of ZONES){
          const d=Math.sqrt((latDeg-z.lat0)**2+(lngDeg-z.lon0)**2);
          if(d<minDist){minDist=d;selectedZone=z;}
        }
        console.warn(`[latLngToSPC] Outside CA bounds, falling back to ${selectedZone.zoneName}`);
      }
      const {E,N}=projectLCC(latDeg,lngDeg,selectedZone);
      if(!isFinite(E)||!isFinite(N)) console.warn(`[latLngToSPC] Non-finite result for (${latDeg},${lngDeg})`);
      return { E, N, zone:selectedZone.zone, fips:selectedZone.fips, zoneName:selectedZone.zoneName };
    }

    const site=latLngToSPC(userLat,userLng);
    // === REGRID PARCEL LOOKUP ===
    const REGRID_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJyZWdyaWQuY29tIiwiaWF0IjoxNzc4ODAwMzM4LCJnIjoxMjgwNzAsInQiOjEsImNhcCI6InBhOnRzIiwidGkiOjE2MTl9.-aHtBYXaWp6YY1gmUZiG27H1iEALvtGEPhc66E5mYLw';
    let parcelData = null;
    try {
      const regridUrl = `https://app.regrid.com/api/v2/parcels/point?lat=${userLat}&lon=${userLng}&token=${REGRID_TOKEN}&return_custom=false`;
      const regridRes = await fetch(regridUrl);
      if (regridRes.ok) {
        const regridJson = await regridRes.json();
        const feat = (regridJson.parcels && regridJson.parcels.features && regridJson.parcels.features[0]) || null;
        if (feat) {
          const f = feat.properties.fields || {};
          parcelData = {
            apn:   f.parcelnumb || f.apn || '',
            owner: f.owner || '',
            addr:  f.address || '',
            legal: f.legaldesc || '',
            zone:  f.zoning || '',
            acres: f.ll_gisacre ? parseFloat(f.ll_gisacre).toFixed(3) : '',
            coords: feat.geometry ? feat.geometry.coordinates : null
          };
          console.log('[REGRID] parcel found:', parcelData.apn);
        }
      }
    } catch(e) { console.warn('[REGRID]', e.message); }
    // === END REGRID ===
    // === REGRID ADJOINERS ===
    let adjoinersData = [];
    try {
      const adjUrl = `https://app.regrid.com/api/v2/parcels/point?lat=${userLat}&lon=${userLng}&radius=100&token=${REGRID_TOKEN}&return_custom=false&limit=50`;
      const adjRes = await fetch(adjUrl);
      if (adjRes.ok) {
        const adjJson = await adjRes.json();
        const features = (adjJson.parcels && adjJson.parcels.features) || [];
        const subjectApn = (parcelData && parcelData.apn) || '';
        for (const feat of features) {
          const f = feat.properties.fields || {};
          const apn = f.parcelnumb || f.apn || '';
          if (apn && apn === subjectApn) continue;
          if (feat.geometry && feat.geometry.coordinates) {
            adjoinersData.push({ apn, coords: feat.geometry.coordinates });
          }
        }
        console.log('[REGRID] adjoiners:', adjoinersData.length);
      }
    } catch(e) { console.warn('[REGRID adjoiners]', e.message); }
    // === END ADJOINERS ===

    const cellFt=(2*radiusFt)/gridSize;
    const originN=site.N+radiusFt, originE=site.E-radiusFt;

    // ── OSM clip radii (independent of contour radius) ────────────────────
    const OSM_CLIP_BUILDINGS = 3000;   // 200 yards — immediate neighbors only
    const OSM_CLIP_ROADS    = 1800;  // 400 yards — local street network
    const OSM_CLIP_UTILITIES = 1200;  // 400 yards — hydro/power/pipeline/railroad

    // ── Marching squares ──────────────────────────────────────────────────
    function marchingSquares(level) {
      const segs=[];
      const interp=(v1,v2,lv)=>Math.abs(v2-v1)<1e-10?0.5:(lv-v1)/(v2-v1);
      for(let row=0;row<gridSize-1;row++){
        for(let col=0;col<gridSize-1;col++){
          const tl=grid[row*gridSize+col],tr=grid[row*gridSize+col+1];
          const br=grid[(row+1)*gridSize+col+1],bl=grid[(row+1)*gridSize+col];
          if(tl===null||tr===null||br===null||bl===null) continue;
          const nTL=originN-row*cellFt,eTL=originE+col*cellFt;
          const nTR=originN-row*cellFt,eTR=originE+(col+1)*cellFt;
          const nBR=originN-(row+1)*cellFt;
          const nBL=originN-(row+1)*cellFt,eBL=originE+col*cellFt,eBR=originE+(col+1)*cellFt;
          let idx=0;
          if(tl>=level)idx|=8;if(tr>=level)idx|=4;
          if(br>=level)idx|=2;if(bl>=level)idx|=1;
          if(idx===0||idx===15) continue;
          const ptT=()=>{const t=interp(tl,tr,level);return[eTL+t*(eTR-eTL),nTL,level];};
          const ptR=()=>{const t=interp(tr,br,level);return[eTR,nTR+t*(nBR-nTR),level];};
          const ptB=()=>{const t=interp(bl,br,level);return[eBL+t*(eBR-eBL),nBL,level];};
          const ptL=()=>{const t=interp(tl,bl,level);return[eTL,nTL+t*(nBL-nTL),level];};
          if(idx===5){ segs.push([ptT(),ptL()]);segs.push([ptB(),ptR()]); }
          else if(idx===10){ segs.push([ptT(),ptR()]);segs.push([ptB(),ptL()]); }
          else {
            const cases={1:[ptL,ptB],2:[ptB,ptR],3:[ptL,ptR],4:[ptT,ptR],6:[ptT,ptB],
              7:[ptT,ptL],8:[ptT,ptL],9:[ptT,ptB],11:[ptT,ptR],12:[ptL,ptR],
              13:[ptB,ptR],14:[ptL,ptB]};
            const c=cases[idx];if(!c) continue;
            segs.push([c[0](),c[1]()]);
          }
        }
      }
      return segs;
    }

    // ── DXF entity builder (exact ezdxf format) ───────────────────────────
    let handle = 0x100;
    const nextH = () => (handle++).toString(16).toUpperCase();
    let entities = '';

    function line(x1,y1,z1,x2,y2,z2,layer) {
      const h=nextH();
      entities += `  0\nLINE\n  5\n${h}\n330\n17\n100\nAcDbEntity\n  8\n${layer}\n100\nAcDbLine\n 10\n${x1.toFixed(4)}\n 20\n${y1.toFixed(4)}\n 30\n${z1.toFixed(4)}\n 11\n${x2.toFixed(4)}\n 21\n${y2.toFixed(4)}\n 31\n${z2.toFixed(4)}\n`;
    }
    function circle(cx,cy,cz,r,layer) {
      const h=nextH();
      entities += `  0\nCIRCLE\n  5\n${h}\n330\n17\n100\nAcDbEntity\n  8\n${layer}\n100\nAcDbCircle\n 10\n${cx.toFixed(4)}\n 20\n${cy.toFixed(4)}\n 30\n${cz.toFixed(4)}\n 40\n${r.toFixed(4)}\n`;
    }
    function text(txt,x,y,z,h,layer,rot=0) {
      const hh=nextH();
      entities += `  0\nTEXT\n  5\n${hh}\n330\n17\n100\nAcDbEntity\n  8\n${layer}\n100\nAcDbText\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n${z.toFixed(4)}\n 40\n${h.toFixed(4)}\n  1\n${txt}\n 50\n${rot.toFixed(4)}\n100\nAcDbText\n`;
    }

    function polyline(pts, layer, elev, closed) {
      const h=nextH();
      const n=pts.length;
      const flag = closed ? 1 : 0;
      let e=`  0\nLWPOLYLINE\n  5\n${h}\n330\n17\n100\nAcDbEntity\n  8\n${layer}\n100\nAcDbPolyline\n 90\n${n}\n 70\n${flag}\n 38\n${elev.toFixed(4)}\n`;
      for(const p of pts) e+=` 10\n${p[0].toFixed(4)}\n 20\n${p[1].toFixed(4)}\n`;
      entities += e;
    }

    // ── Generate contours ─────────────────────────────────────────────────
    const elevMin=Math.floor(minElev/contourInterval)*contourInterval;
    const elevMax=Math.ceil(maxElev/contourInterval)*contourInterval;
    const labeled=new Set();
    let contourCount=0;

    for(let lv=elevMin;lv<=elevMax;lv=Math.round((lv+contourInterval)*1000)/1000){
      const layer=lv%10===0?'CONTOUR_INDEX':lv%5===0?'CONTOUR_MAJOR':'CONTOUR_MINOR';
      const segs=marchingSquares(lv);
      if(segs.length===0) continue;

      // Chain segments into polylines
      const tol=0.01;
      const used=new Array(segs.length).fill(false);
      const chains=[];
      for(let i=0;i<segs.length;i++){
        if(used[i]) continue;
        const chain=[segs[i][0],segs[i][1]];
        used[i]=true;
        let grew=true;
        while(grew){
          grew=false;
          const tail=chain[chain.length-1];
          const head=chain[0];
          for(let j=0;j<segs.length;j++){
            if(used[j]) continue;
            const [a,b]=segs[j];
            const d=(p,q)=>Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1]);
            if(d(tail,a)<tol){chain.push(b);used[j]=true;grew=true;}
            else if(d(tail,b)<tol){chain.push(a);used[j]=true;grew=true;}
            else if(d(head,a)<tol){chain.unshift(b);used[j]=true;grew=true;}
            else if(d(head,b)<tol){chain.unshift(a);used[j]=true;grew=true;}
          }
        }
        chains.push(chain);
      }

      for(const chain of chains){
        polyline(chain, layer, lv);
        contourCount++;
      }

      if(lv%5===0&&!labeled.has(lv)&&segs.length>0){
        const[p1,p2]=segs[0];
        const mx=(p1[0]+p2[0])/2,my=(p1[1]+p2[1])/2;
        const angle=Math.atan2(p2[1]-p1[1],p2[0]-p1[0])*180/Math.PI;
        // DISABLED: text(`${Math.round(lv)}'`,mx,my,lv,0.5,'ELEV_LABELS',isFinite(angle)?angle:0);
        labeled.add(lv);
      }
    }

    // ── Inner 1ft contours (400ft radius) ────────────────────────────────
    if(iGrid && iGridSize) {
      const iCellFt = (2*iRadiusFt)/iGridSize;
      const iOriginN = site.N+iRadiusFt, iOriginE = site.E-iRadiusFt;

      function marchingSquaresInner(level) {
        const segs=[];
        const interp=(v1,v2,lv)=>Math.abs(v2-v1)<1e-10?0.5:(lv-v1)/(v2-v1);
        for(let row=0;row<iGridSize-1;row++){
          for(let col=0;col<iGridSize-1;col++){
            const tl=iGrid[row*iGridSize+col],tr=iGrid[row*iGridSize+col+1];
            const br=iGrid[(row+1)*iGridSize+col+1],bl=iGrid[(row+1)*iGridSize+col];
            if(tl===null||tr===null||br===null||bl===null) continue;
            const nTL=iOriginN-row*iCellFt,eTL=iOriginE+col*iCellFt;
            const nTR=iOriginN-row*iCellFt,eTR=iOriginE+(col+1)*iCellFt;
            const nBR=iOriginN-(row+1)*iCellFt;
            const nBL=iOriginN-(row+1)*iCellFt,eBL=iOriginE+col*iCellFt,eBR=iOriginE+(col+1)*iCellFt;
            let idx=0;
            if(tl>=level)idx|=8;if(tr>=level)idx|=4;
            if(br>=level)idx|=2;if(bl>=level)idx|=1;
            if(idx===0||idx===15) continue;
            const ptT=()=>{const t=interp(tl,tr,level);return[eTL+t*(eTR-eTL),nTL,level];};
            const ptR=()=>{const t=interp(tr,br,level);return[eTR,nTR+t*(nBR-nTR),level];};
            const ptB=()=>{const t=interp(bl,br,level);return[eBL+t*(eBR-eBL),nBL,level];};
            const ptL=()=>{const t=interp(tl,bl,level);return[eTL,nTL+t*(nBL-nTL),level];};
            if(idx===5){segs.push([ptT(),ptL()]);segs.push([ptB(),ptR()]);}
            else if(idx===10){segs.push([ptT(),ptR()]);segs.push([ptB(),ptL()]);}
            else{
              const cases={1:[ptL,ptB],2:[ptB,ptR],3:[ptL,ptR],4:[ptT,ptR],6:[ptT,ptB],
                7:[ptT,ptL],8:[ptT,ptL],9:[ptT,ptB],11:[ptT,ptR],12:[ptL,ptR],
                13:[ptB,ptR],14:[ptL,ptB]};
              const c=cases[idx];if(!c) continue;
              segs.push([c[0](),c[1]()]);
            }
          }
        }
        return segs;
      }

      const iElevMin=Math.floor(minElev)*1, iElevMax=Math.ceil(maxElev)*1;
      for(let lv=iElevMin;lv<=iElevMax;lv=Math.round((lv+1)*1000)/1000){
        const segs=marchingSquaresInner(lv);
        if(segs.length===0) continue;
        const used=new Array(segs.length).fill(false);
        for(let i=0;i<segs.length;i++){
          if(used[i]) continue;
          const chain=[segs[i][0],segs[i][1]]; used[i]=true;
          let grew=true;
          while(grew){ grew=false; const tail=chain[chain.length-1],head=chain[0];
            for(let j=0;j<segs.length;j++){ if(used[j]) continue;
              const[a,b]=segs[j],d=(p,q)=>Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1]);
              if(d(tail,a)<0.01){chain.push(b);used[j]=true;grew=true;}
              else if(d(tail,b)<0.01){chain.push(a);used[j]=true;grew=true;}
              else if(d(head,a)<0.01){chain.unshift(b);used[j]=true;grew=true;}
              else if(d(head,b)<0.01){chain.unshift(a);used[j]=true;grew=true;}
            }
          }
          polyline(chain,'CONTOUR_1FT',lv);
          contourCount++;
        }
      }
    }

    // ── Elevation sampler — bilinear from USGS grid, clamped to grid edge ─
    function sampleElev(E, N) {
      const col = Math.max(0, Math.min(gridSize-2, (E - originE) / cellFt));
      const row = Math.max(0, Math.min(gridSize-2, (originN - N) / cellFt));
      const c0 = Math.floor(col), r0 = Math.floor(row);
      const c1 = c0+1, r1 = r0+1;
      if(c0<0||r0<0||c1>=gridSize||r1>=gridSize) return null;
      const tl=grid[r0*gridSize+c0], tr=grid[r0*gridSize+c1];
      const bl=grid[r1*gridSize+c0], br=grid[r1*gridSize+c1];
      if(tl===null||tr===null||bl===null||br===null) return null;
      const fc=col-c0, fr=row-r0;
      return tl*(1-fc)*(1-fr) + tr*fc*(1-fr) + bl*(1-fc)*fr + br*fc*fr;
    }

    // ── Perpendicular offset — returns left and right edge polylines ──────
    function perpOffset(pts, dist) {
      if(pts.length < 2) return [[], []];
      const left=[], right=[];
      for(let i=0;i<pts.length;i++){
        // Use adjacent segment for bearing
        const prev = pts[i>0?i-1:i];
        const next = pts[i<pts.length-1?i+1:i];
        const dx=next[0]-prev[0], dy=next[1]-prev[1];
        const len=Math.sqrt(dx*dx+dy*dy);
        if(len<0.001) continue;
        const nx=-dy/len, ny=dx/len; // normal vector
        left.push( [pts[i][0]+nx*dist, pts[i][1]+ny*dist]);
        right.push([pts[i][0]-nx*dist, pts[i][1]-ny*dist]);
      }
      return [left, right];
    }

    // ── Densify a segment — insert pts every densifyFt feet ──────────────
    function densifySegment(x1,y1,x2,y2,densifyFt){
      const dx=x2-x1, dy=y2-y1;
      const len=Math.sqrt(dx*dx+dy*dy);
      const pts=[[x1,y1]];
      if(len>densifyFt){
        const steps=Math.floor(len/densifyFt);
        for(let i=1;i<=steps;i++){
          const t=i/steps;
          pts.push([x1+dx*t, y1+dy*t]);
        }
      }
      return pts;
    }

    // ── Draw ways with flat + draped 3D copy within radius ────────────────
    function drawWays(ways, clLayer, cl3dLayer, rowDist, rowLayer, row3dLayer, clipRadiusFt) {
      if(!ways || !ways.length) return;
      const clip = clipRadiusFt || radiusFt;
      for(const way of ways){
        try{
          if(!way.coords || way.coords.length<2) continue;
          // Centroid-based clip: compute SPC coords for all vertices, check centroid distance.
          // If centroid is within clip*1.5, keep ALL vertices (preserves complete trail/road geometry).
          // Avoids broken stripe pattern from per-vertex dropping.
          const allSpc=[];
          for(const c of way.coords){
            const s=latLngToSPC(c[1],c[0]);
            if(!isFinite(s.E)||!isFinite(s.N)) continue;
            allSpc.push([s.E,s.N]);
          }
          if(allSpc.length<2) continue;
          let cx=0, cy=0;
          for(const p of allSpc) { cx+=p[0]; cy+=p[1]; }
          cx/=allSpc.length; cy/=allSpc.length;
          const cdx=cx-site.E, cdy=cy-site.N;
          const centroidDist=Math.sqrt(cdx*cdx+cdy*cdy);
          if(centroidDist>clip*1.5) continue;
          const flatPts=allSpc.slice();
          const drpPts=[];
          // Densify only when draping (cl3dLayer present) — skip for flat-only roads
          let denseFlatPts;
          if(cl3dLayer){
            denseFlatPts=[];
            for(let i=0;i<flatPts.length-1;i++){
              const seg=densifySegment(flatPts[i][0],flatPts[i][1],flatPts[i+1][0],flatPts[i+1][1],50);
              for(const p of seg) denseFlatPts.push(p);
            }
            if(flatPts.length>0) denseFlatPts.push(flatPts[flatPts.length-1]);
          } else {
            denseFlatPts = flatPts;
          }
          // Drape pts = dense pts inside radius
          for(const p of denseFlatPts){
            const dx=p[0]-site.E, dy=p[1]-site.N;
            if(Math.sqrt(dx*dx+dy*dy)<=clip*0.95) drpPts.push(p);
          }
          // Flat CL
          if(flatPts.length>1) polyline(flatPts, clLayer, 0);
          // Draped CL (3D — pts already densified, just sample elevation)
          if(cl3dLayer && drpPts.length>1){
            for(let i=0;i<drpPts.length-1;i++){
              const ea=sampleElev(drpPts[i][0],drpPts[i][1]);
              const eb=sampleElev(drpPts[i+1][0],drpPts[i+1][1]);
              if(ea===null||eb===null) continue;
              if(Math.abs(ea-eb)>500) continue; // skip if elevation jump > 500ft (bad sample)
              line(drpPts[i][0],drpPts[i][1],ea, drpPts[i+1][0],drpPts[i+1][1],eb, cl3dLayer);
            }
          }
          // ROW offsets
          if(rowDist && rowLayer && flatPts.length>1){
            const [lft,rgt]=perpOffset(flatPts,rowDist);
            if(lft.length>1) polyline(lft, rowLayer, 0);
            if(rgt.length>1) polyline(rgt, rowLayer, 0);
          }
          // ROW 3D draped
          if(rowDist && row3dLayer && drpPts.length>1){
            const flatDrp=drpPts.map(p=>[p[0],p[1]]);
            const [lft3,rgt3]=perpOffset(flatDrp,rowDist);
            for(let i=0;i<lft3.length-1;i++){
              const e=sampleElev(lft3[i][0],lft3[i][1]);
              const e2=sampleElev(lft3[i+1][0],lft3[i+1][1]);
              const re=sampleElev(rgt3[i][0],rgt3[i][1]);
              const re2=sampleElev(rgt3[i+1][0],rgt3[i+1][1]);
              if(e===null||e2===null||re===null||re2===null) continue;
              line(lft3[i][0],lft3[i][1],e, lft3[i+1][0],lft3[i+1][1],e2, row3dLayer);
              line(rgt3[i][0],rgt3[i][1],re,rgt3[i+1][0],rgt3[i+1][1],re2,row3dLayer);
            }
          }
        }catch(e){}
      }
    }

    // ── OSM Roads + Hydro ─────────────────────────────────────────────────
    // ── OSM Roads + Hydro + Infrastructure ───────────────────────────────
    const majorTypes = new Set(['motorway','trunk','primary','secondary','tertiary',
                                'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']);
    const trailTypes = new Set(['track','path','footway','cycleway','bridleway','steps']);

    function classifyRoads(data) {
      const major=[], local=[], trail=[];
      if(!data) return {major,local,trail};
      for(const el of (data.elements||[])) {
        if(!el.geometry||el.geometry.length<2) continue;
        const coords=el.geometry.map(p=>[p.lon,p.lat]);
        const hw=(el.tags||{}).highway;
        if(!hw) continue;
        const obj={coords, name:(el.tags.name||''), type:hw};
        if(majorTypes.has(hw))      major.push(obj);
        else if(trailTypes.has(hw)) trail.push(obj);
        else                         local.push(obj);
      }
      return {major,local,trail};
    }
    function extractWays(data) {
      if(!data) return [];
      return (data.elements||[])
        .filter(el=>el.geometry&&el.geometry.length>=2)
        .map(el=>({ coords:el.geometry.map(p=>[p.lon,p.lat]), name:(el.tags&&el.tags.name)||'' }));
    }

    const roads = classifyRoads(roadsData);
    drawWays(roads.major,  'CL_MAJOR',  null, 0, null, null, OSM_CLIP_ROADS);
    drawWays(roads.local,  'CL_LOCAL',  null, 0, null, null, OSM_CLIP_ROADS);
    drawWays(roads.trail,  'CL_TRAIL',  null, 0, null, null, OSM_CLIP_ROADS);

    // ── Road name labels at midpoint of each named way ────────────────────
    const labeledRoads = new Set(); // avoid duplicate labels for same road name
    const roadLabelH = cellFt * 0.25;
    function labelRoad(ways, layer) {
      for(const way of ways) {
        if(!way.name || way.name.trim()==='') continue;
        if(labeledRoads.has(way.name)) continue;
        // Convert coords to SPC and find midpoint
        const spcPts = way.coords
          .map(c=>latLngToSPC(c[1],c[0]))
          .filter(s=>isFinite(s.E)&&isFinite(s.N));
        if(spcPts.length < 2) continue;
        // Check midpoint is within radius
        const mid = spcPts[Math.floor(spcPts.length/2)];
        const dx = mid.E - site.E, dy = mid.N - site.N;
        if(Math.sqrt(dx*dx+dy*dy) > OSM_CLIP_ROADS * 0.9) continue;
        // Compute rotation angle from segment around midpoint
        const i = Math.floor(spcPts.length/2);
        const p1 = spcPts[Math.max(0,i-1)];
        const p2 = spcPts[Math.min(spcPts.length-1,i+1)];
        let angle = Math.atan2(p2.N-p1.N, p2.E-p1.E) * 180/Math.PI;
        // Keep text readable (not upside down)
        if(angle < -90 || angle > 90) angle += 180;
        text(way.name, mid.E, mid.N, 0, roadLabelH, layer, angle);
        labeledRoads.add(way.name);
      }
    }
    labelRoad(roads.major, 'ROAD_LABELS');
    labelRoad(roads.local, 'ROAD_LABELS');
    drawWays(extractWays(hydroData),    'HYDRO',    null, 0, null, null, OSM_CLIP_UTILITIES);
    drawWays(extractWays(powerData),    'POWER',    null, 0, null, null, OSM_CLIP_UTILITIES);
    drawWays(extractWays(pipeData),     'PIPELINE', null, 0, null, null, OSM_CLIP_UTILITIES);
    drawWays(extractWays(railData),     'RAILROAD', null, 0, null, null, OSM_CLIP_UTILITIES);

    // Buildings — flat polygon only
    if(bldgData) {
      for(const el of (bldgData.elements||[])) {
        try {
          if(!el.geometry||el.geometry.length<2) continue;
          const pts=[];
          for(const p of el.geometry){
            const s=latLngToSPC(p.lat,p.lon);
            const dx=s.E-site.E,dy=s.N-site.N;
            if(!isFinite(s.E)||!isFinite(s.N)) continue;
            if(Math.sqrt(dx*dx+dy*dy)>OSM_CLIP_BUILDINGS*1.05) continue;
            pts.push([s.E,s.N]);
          }
          if(pts.length>1) polyline(pts,'BUILDINGS',0,true);
        } catch(e){}
      }
    }

    // ── County Boundary ──────────────────────────────────────────────────
    if (countyBdy && countyBdy.features && countyBdy.features.length > 0) {
      try {
        for (const feat of countyBdy.features) {
          const geom = feat.geometry;
          if (!geom) continue;
          const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
                      : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0])
                      : [];
          for (const ring of rings) {
            if (!ring || ring.length < 2) continue;
            const pts = [];
            for (const c of ring) {
              try {
                const s = latLngToSPC(c[1], c[0]);
                if (isFinite(s.E) && isFinite(s.N)) pts.push([s.E, s.N]);
              } catch(e) {}
            }
            if (pts.length > 1) polyline(pts, 'COUNTY_BOUNDARY', 0);
          }
          // County label — centroid of first ring
          if (feat.properties) {
            const name = feat.properties.NAME || feat.properties.NAMELSAD || feat.properties.name || '';
            if (name) {
              const ring0 = geom.type === 'Polygon' ? geom.coordinates[0]
                          : geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
              if (ring0 && ring0.length > 0) {
                let sumLat = 0, sumLng = 0;
                for (const c of ring0) { sumLng += c[0]; sumLat += c[1]; }
                const cLat = sumLat / ring0.length;
                const cLng = sumLng / ring0.length;
                try {
                  const cs = latLngToSPC(cLat, cLng);
                  if (isFinite(cs.E) && isFinite(cs.N)) {
                    text(name + ' County', cs.E, cs.N, 0, 80, 'COUNTY_LABEL');
                  }
                } catch(e) {}
              }
            }
          }
        }
        console.log('[County] boundary drawn');
      } catch(e) { console.log('[County] draw error:', e.message); }
    }

    // ── OTLS Abstract Surveys (TX only) ──────────────────────────────────
    if (otlsData && otlsData.features && otlsData.features.length > 0) {
      try {
        const txtH = cellFt * 3;
        const minSep = txtH * 20;
        const labelPts = [];
        for (const feat of otlsData.features) {
          const geom = feat.geometry;
          if (!geom) continue;
          const props = feat.properties || {};
          const anum   = (props.ANUM    || '').trim();
          const surnam = (props.L1SURNAM|| '').trim();
          const block  = (props.L2BLOCK || '').trim();
          const surnum = (props.L3SURNUM|| '').trim();
          const parts = [];
          if (surnam) parts.push(surnam);
          if (block)  parts.push('BLK ' + block);
          if (surnum) parts.push('SEC ' + surnum);
          const label = parts.length ? parts.join(' / ') : anum;

          const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
                      : geom.type === 'MultiPolygon' ? geom.coordinates.map(p=>p[0]) : [];
          for (const ring of rings) {
            if (!ring || ring.length < 2) continue;
            const pts = [];
            let sumE = 0, sumN = 0;
            for (const c of ring) {
              try {
                const s = latLngToSPC(c[1], c[0]);
                if (isFinite(s.E) && isFinite(s.N)) { pts.push([s.E,s.N]); sumE+=s.E; sumN+=s.N; }
              } catch(e) {}
            }
            if (pts.length > 1) polyline(pts, 'OTLS_GRID', 0);
            if (pts.length > 0 && label) {
              let cx = sumE/pts.length, cy = sumN/pts.length;
              const dx = cx - site.E, dy = cy - site.N;
              const dist = Math.sqrt(dx*dx+dy*dy);
              if (dist > outerRadius * 0.85) {
                const scale = (outerRadius * 0.6) / dist;
                cx = site.E + dx*scale; cy = site.N + dy*scale;
              }
              const tooClose = labelPts.some(p => Math.sqrt((p[0]-cx)**2+(p[1]-cy)**2) < minSep);
              if (!tooClose) {
                text(label, cx, cy, 0, txtH, 'OTLS_LABELS');
                labelPts.push([cx, cy]);
              }
            }
          }
        }
        console.log('[OTLS] drawn, features:', otlsData.features.length, 'labels:', labelPts.length);
      } catch(e) { console.log('[OTLS] draw error:', e.message); }
    }

    // ── PLSS Section/Township — flat + densified draped within radius ─────
    function drapeRing(coords, type, flatLayer, drapedLayer) {
      if(!coords) return;
      const rings = type==='Polygon' ? [coords[0]] : coords.map(p=>p[0]);
      for(const ring of rings){
        if(!ring||ring.length<2) continue;
        const flatPts=[];
        // Flat ring — just SPC xy
        for(const c of ring){
          try{
            const s=latLngToSPC(c[1],c[0]);
            if(isFinite(s.E)&&isFinite(s.N)) flatPts.push([s.E,s.N]);
          }catch(e){}
        }
        if(flatPts.length>1) polyline(flatPts, flatLayer, 0);

        // Draped — densify each segment to 50ft then sample elevation
        const allDrpPts=[];
        for(let i=0;i<flatPts.length-1;i++){
          const seg=densifySegment(flatPts[i][0],flatPts[i][1],flatPts[i+1][0],flatPts[i+1][1],50);
          for(const pt of seg) allDrpPts.push(pt);
        }
        if(flatPts.length>0) allDrpPts.push(flatPts[flatPts.length-1]);

        for(let i=0;i<allDrpPts.length-1;i++){
          const a=allDrpPts[i], b=allDrpPts[i+1];
          const ea=sampleElev(a[0],a[1]);
          const eb=sampleElev(b[0],b[1]);
          if(ea===null||eb===null) continue;
          line(a[0],a[1],ea, b[0],b[1],eb, drapedLayer);
        }
      }
    }

    if(plssData && plssData.features && plssData.features[0]){
      const sg=plssData.features[0].geometry;
      console.log('[PLSS drape] section coords length:', sg.coordinates && sg.coordinates[0] && sg.coordinates[0].length);
      try{ drapeRing(sg.coordinates, sg.type, 'PLSS_SECTION', 'PLSS_SECTION_3D'); }catch(e){ console.log('[PLSS drape] section err:', e.message); }
    }
    if(twpData && twpData.features && twpData.features[0]){
      const tg=twpData.features[0].geometry;
      console.log('[PLSS drape] twp coords length:', tg.coordinates && tg.coordinates[0] && tg.coordinates[0].length);
      try{ drapeRing(tg.coordinates, tg.type, 'PLSS_TWP', 'PLSS_TWP_3D'); }catch(e){ console.log('[PLSS drape] twp err:', e.message); }
    }


    const ch=cellFt*3;
    line(site.E-ch,site.N,minElev,site.E+ch,site.N,minElev,'CENTER');
    line(site.E,site.N-ch,minElev,site.E,site.N+ch,minElev,'CENTER');
    circle(site.E,site.N,minElev,ch*0.8,'CENTER');
    // ── Image alignment ticks (NEAR 300ft + FAR 1500ft) ───────────────
    function drawAlignCorners(rad, layer, lblSuffix) {
      const tsz = cellFt * 4;
      const corners = [
        { x: site.E - rad, y: site.N + rad, lbl: 'NW' },
        { x: site.E + rad, y: site.N + rad, lbl: 'NE' },
        { x: site.E - rad, y: site.N - rad, lbl: 'SW' },
        { x: site.E + rad, y: site.N - rad, lbl: 'SE' }
      ];
      for (const cnr of corners) {
        line(cnr.x - tsz, cnr.y, minElev, cnr.x + tsz, cnr.y, minElev, layer);
        line(cnr.x, cnr.y - tsz, minElev, cnr.x, cnr.y + tsz, minElev, layer);
        circle(cnr.x, cnr.y, minElev, tsz * 0.6, layer);
        // Labels removed — tick (cross + circle) is the marker, no text needed
      }
    }
    drawAlignCorners(300,  'IMG_ALIGN_NEAR', 'NEAR');
    drawAlignCorners(1500, 'IMG_ALIGN_FAR',  'FAR');

    // ── Limit benchmarks to 5 closest ────────────────────────────────────
    const sortedBMs = benchmarks
      .filter(bm => bm.lat && bm.lng)
      .sort((a,b) => (a.dist||999) - (b.dist||999))
      .slice(0, 5);

    // ── Benchmarks: marker on BENCHMARKS layer, text on BM_LABELS layer ──
    // Marker = cross + circle (INSERT-style block, moves as group in AutoCAD)
    let bmCount=0;
    for(const bm of sortedBMs){
      const bms=latLngToSPC(bm.lat,bm.lng);
      const ep=(bm.elev||'').split('/');
      const elevFt=ep.length>1?parseFloat(ep[1].replace('ft NAVD88','').trim())||0:0;
      const sz=cellFt*1.5;
      // Marker on BENCHMARKS layer
      line(bms.E-sz,bms.N,elevFt,bms.E+sz,bms.N,elevFt,'BENCHMARKS');
      line(bms.E,bms.N-sz,elevFt,bms.E,bms.N+sz,elevFt,'BENCHMARKS');
      circle(bms.E,bms.N,elevFt,sz,'BENCHMARKS');
      // Labels on BM_LABELS layer
      text(`${bm.pid} ${bm.name}`,bms.E+sz*1.2,bms.N+sz*0.3,elevFt,cellFt*0.6,'BM_LABELS');
      text(`${elevFt.toFixed(2)}'`,bms.E+sz*1.2,bms.N-sz*0.5,elevFt,cellFt*0.6,'BM_LABELS');
      bmCount++;
    }

    // ── Site info — positioned outside circle to upper RIGHT ──────────────
    const infoX=site.E+radiusFt*1.05;
    const infoY=site.N+radiusFt*0.95;
    const infoH=cellFt*1.0;
    const infoStep=infoH*1.6;
    const spcZoneLabel = site.zoneName ? `SPC ${site.zoneName} (${site.fips}) NAD83` : 'SPC NAD83';
    [
      'SKYGRID SITE DXF',
      `Lat: ${userLat}  Lng: ${userLng}`,
      spcZoneLabel,
      `N ${site.N.toFixed(2)}  E ${site.E.toFixed(2)} (US ft)`,
      `Elev: ${minElev.toFixed(1)} - ${maxElev.toFixed(1)} ft NAVD88`,
      `Radius: ${radiusFt}ft  Interval: ${contourInterval}ft`,
      'Source: USGS 3DEP + NGS Benchmarks'
    ].forEach((ln,i)=>text(ln,infoX,infoY-i*infoStep,0,infoH,'SITE_INFO'));

    // ── Data tables to right of drawing ──────────────────────────────────
    const tblX = infoX;
    const tblH = infoH * 0.9;       // row height
    const tblStep = tblH * 1.5;     // row spacing
    const hdrH = infoH * 1.0;       // header text size
    const colW1 = radiusFt * 0.18;  // col 1 width
    const colW2 = radiusFt * 0.45;  // col 2 width
    const colW3 = radiusFt * 0.18;  // col 3 width
    const tblTotalW = colW1 + colW2 + colW3;

    function drawTableBox(x, y, w, h) {
      polyline([[x,y],[x+w,y],[x+w,y-h],[x,y-h],[x,y]], 'SITE_INFO', 0);
    }
    function drawTable(startY, title, headers, rows) {
      let y = startY;
      // Title row
      text(title, tblX, y, 0, hdrH, 'SITE_INFO');
      y -= tblStep * 1.4;
      // Header row box
      drawTableBox(tblX, y + tblStep*0.8, tblTotalW, tblStep);
      // Header text
      text(headers[0], tblX + colW1*0.1,          y, 0, tblH*0.8, 'SITE_INFO');
      text(headers[1], tblX + colW1 + colW2*0.05,  y, 0, tblH*0.8, 'SITE_INFO');
      text(headers[2], tblX + colW1 + colW2 + colW3*0.05, y, 0, tblH*0.8, 'SITE_INFO');
      y -= tblStep;
      // Data rows
      for(const row of rows) {
        drawTableBox(tblX, y + tblStep*0.8, tblTotalW, tblStep);
        text(String(row[0]).substring(0,8),  tblX + colW1*0.1,          y, 0, tblH*0.75, 'SITE_INFO');
        text(String(row[1]).substring(0,22), tblX + colW1 + colW2*0.05,  y, 0, tblH*0.75, 'SITE_INFO');
        text(String(row[2]).substring(0,8),  tblX + colW1 + colW2 + colW3*0.05, y, 0, tblH*0.75, 'SITE_INFO');
        y -= tblStep;
      }
      return y - tblStep * 0.5; // return y position below table
    }

    // ── NGS Benchmarks table ──────────────────────────────────────────────
    const bmTableRows = sortedBMs.map(bm => {
      const ep = (bm.elev||'').split('/');
      const elevFtStr = ep.length > 1 ? ep[1].replace('NAVD88','').trim() : '--';
      return [bm.pid, bm.name || '--', elevFtStr];
    });
    const bmStartY = infoY - (7 * infoStep) - infoStep * 2;
    let nextTableY = drawTable(bmStartY, 'NGS BENCHMARKS', ['PID','NAME','ELEV'], bmTableRows);

    // ── CORS Stations table ───────────────────────────────────────────────
    if(corsStations.length > 0) {
      const corsRows = corsStations.slice(0,6).map(c => [c.id, c.name, `${c.dist}mi`]);
      nextTableY = drawTable(nextTableY, 'CORS STATIONS', ['ID','NAME','DIST'], corsRows);
    }

    // ── Parcel Info table ─────────────────────────────────────────────────
    if(parcelData) {
      const parcelRows = [
        ['APN',     parcelData.apn  || '--', ''],
        ['ZONING',  parcelData.zone || '--', ''],
        ['ACRES',   parcelData.acres|| '--', ''],
      ].filter(r => r[1] !== '--');
      if(parcelRows.length > 0) {
        drawTable(nextTableY, 'PARCEL INFO', ['FIELD','VALUE',''], parcelRows);
      }
    }

    // ── North arrow ───────────────────────────────────────────────────────
    const naX=site.E+radiusFt*0.80,naY=site.N+radiusFt*0.75,naH=cellFt*8;
    line(naX,naY-naH/2,0,naX,naY+naH/2,0,'NORTH_ARROW');
    line(naX,naY+naH/2,0,naX-naH*0.2,naY+naH*0.1,0,'NORTH_ARROW');
    line(naX,naY+naH/2,0,naX+naH*0.2,naY+naH*0.1,0,'NORTH_ARROW');
    // DISABLED: text('N',naX-cellFt,naY+naH/2+cellFt*1.5,0,cellFt*3,'NORTH_ARROW');

    // ── PLSS Section + Township polygons ──────────────────────────────────
    function drawPlssPolygon(geojson, layer, labelLayer, labelField) {
      if(!geojson || !geojson.features || !geojson.features.length) return;
      const feat = geojson.features[0];
      if(!feat || !feat.geometry) return;
      const geom = feat.geometry;
      const props = feat.properties || {};

      // Get outer rings only
      let rings = [];
      if(geom.type === 'Polygon') rings = [geom.coordinates[0]];
      else if(geom.type === 'MultiPolygon') rings = geom.coordinates.map(p=>p[0]);
      else return;

      for(const ring of rings) {
        if(!ring || ring.length < 3) continue;
        const pts = [];
        for(const c of ring) {
          try {
            const s = latLngToSPC(c[1], c[0]);
            if(isFinite(s.E) && isFinite(s.N)) pts.push([s.E, s.N]);
          } catch(e) {}
        }
        if(pts.length > 1) polyline(pts, layer, 0);
      }

      // Label at centroid of first ring
      if(rings[0] && rings[0].length > 0) {
        let cx=0, cy=0, cnt=0;
        for(const c of rings[0]) { cx+=c[0]; cy+=c[1]; cnt++; }
        if(cnt > 0) {
          const cs = latLngToSPC(cy/cnt, cx/cnt);
          const label = props[labelField] || '';
          const srvname = props.SRVNAME || '';
          const fullLabel = label + (srvname ? '  ' + srvname : '');
          // DISABLED: if(fullLabel) text(fullLabel, cs.E, cs.N, 0, cellFt*3, labelLayer);
        }
      }
    }

    try { drawPlssPolygon(plssData, 'PLSS_SECTION', 'PLSS_LABELS', 'FRSTDIVLAB'); } catch(e) { console.log('[PLSS] section error:', e.message); }
    try { drawPlssPolygon(twpData,  'PLSS_TWP',     'PLSS_LABELS', 'TWNSHPLAB'); } catch(e) { console.log('[PLSS] twp error:', e.message); }

    // ── Quarter sections ──────────────────────────────────────────────────
    for (const qq of qqList) {
      try {
        if (!qq.coords) continue;
        drapeRing(qq.coords, qq.type, 'PLSS_QQ', 'PLSS_QQ_3D');
      } catch(e) {}
    }


    const DXF_HEADER_RAW = `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1024
  9
$ACADMAINTVER
 70
6
  9
$DWGCODEPAGE
  3
ANSI_1252
  9
$LASTSAVEDBY
  1
ezdxf
  9
$INSBASE
 10
0.0
 20
0.0
 30
0.0
  9
$EXTMIN
 10
1e+20
 20
1e+20
 30
1e+20
  9
$EXTMAX
 10
-1e+20
 20
-1e+20
 30
-1e+20
  9
$LIMMIN
 10
0.0
 20
0.0
  9
$LIMMAX
 10
420.0
 20
297.0
  9
$ORTHOMODE
 70
0
  9
$REGENMODE
 70
1
  9
$FILLMODE
 70
1
  9
$QTEXTMODE
 70
0
  9
$MIRRTEXT
 70
1
  9
$LTSCALE
 40
1.0
  9
$ATTMODE
 70
1
  9
$TEXTSIZE
 40
2.5
  9
$TRACEWID
 40
1.0
  9
$TEXTSTYLE
  7
Standard
  9
$CLAYER
  8
0
  9
$CELTYPE
  6
ByLayer
  9
$CECOLOR
 62
256
  9
$CELTSCALE
 40
1.0
  9
$DISPSILH
 70
0
  9
$DIMSCALE
 40
1.0
  9
$DIMASZ
 40
2.5
  9
$DIMEXO
 40
0.625
  9
$DIMDLI
 40
3.75
  9
$DIMRND
 40
0.0
  9
$DIMDLE
 40
0.0
  9
$DIMEXE
 40
1.25
  9
$DIMTP
 40
0.0
  9
$DIMTM
 40
0.0
  9
$DIMTXT
 40
2.5
  9
$DIMCEN
 40
2.5
  9
$DIMTSZ
 40
0.0
  9
$DIMTOL
 70
0
  9
$DIMLIM
 70
0
  9
$DIMTIH
 70
0
  9
$DIMTOH
 70
0
  9
$DIMSE1
 70
0
  9
$DIMSE2
 70
0
  9
$DIMTAD
 70
1
  9
$DIMZIN
 70
8
  9
$DIMBLK
  1

  9
$DIMASO
 70
1
  9
$DIMSHO
 70
1
  9
$DIMPOST
  1

  9
$DIMAPOST
  1

  9
$DIMALT
 70
0
  9
$DIMALTD
 70
3
  9
$DIMALTF
 40
0.03937007874
  9
$DIMLFAC
 40
1.0
  9
$DIMTOFL
 70
1
  9
$DIMTVP
 40
0.0
  9
$DIMTIX
 70
0
  9
$DIMSOXD
 70
0
  9
$DIMSAH
 70
0
  9
$DIMBLK1
  1

  9
$DIMBLK2
  1

  9
$DIMSTYLE
  2
ISO-25
  9
$DIMCLRD
 70
0
  9
$DIMCLRE
 70
0
  9
$DIMCLRT
 70
0
  9
$DIMTFAC
 40
1.0
  9
$DIMGAP
 40
0.625
  9
$DIMJUST
 70
0
  9
$DIMSD1
 70
0
  9
$DIMSD2
 70
0
  9
$DIMTOLJ
 70
0
  9
$DIMTZIN
 70
8
  9
$DIMALTZ
 70
0
  9
$DIMALTTZ
 70
0
  9
$DIMUPT
 70
0
  9
$DIMDEC
 70
2
  9
$DIMTDEC
 70
2
  9
$DIMALTU
 70
2
  9
$DIMALTTD
 70
3
  9
$DIMTXSTY
  7
Standard
  9
$DIMAUNIT
 70
0
  9
$DIMADEC
 70
0
  9
$DIMALTRND
 40
0.0
  9
$DIMAZIN
 70
0
  9
$DIMDSEP
 70
44
  9
$DIMATFIT
 70
3
  9
$DIMFRAC
 70
0
  9
$DIMLDRBLK
  1

  9
$DIMLUNIT
 70
2
  9
$DIMLWD
 70
-2
  9
$DIMLWE
 70
-2
  9
$DIMTMOVE
 70
0
  9
$DIMFXL
 40
1.0
  9
$DIMFXLON
 70
0
  9
$DIMJOGANG
 40
0.785398163397
  9
$DIMTFILL
 70
0
  9
$DIMTFILLCLR
 70
0
  9
$DIMARCSYM
 70
0
  9
$DIMLTYPE
  6

  9
$DIMLTEX1
  6

  9
$DIMLTEX2
  6

  9
$DIMTXTDIRECTION
 70
0
  9
$LUNITS
 70
2
  9
$LUPREC
 70
4
  9
$SKETCHINC
 40
1.0
  9
$FILLETRAD
 40
10.0
  9
$AUNITS
 70
0
  9
$AUPREC
 70
2
  9
$MENU
  1
.
  9
$ELEVATION
 40
0.0
  9
$PELEVATION
 40
0.0
  9
$THICKNESS
 40
0.0
  9
$LIMCHECK
 70
0
  9
$CHAMFERA
 40
0.0
  9
$CHAMFERB
 40
0.0
  9
$CHAMFERC
 40
0.0
  9
$CHAMFERD
 40
0.0
  9
$SKPOLY
 70
0
  9
$TDCREATE
 40
2461104.255532407
  9
$TDUCREATE
 40
2458532.153996898
  9
$TDUPDATE
 40
2461104.255532407
  9
$TDUUPDATE
 40
2458532.1544311
  9
$TDINDWG
 40
0.0
  9
$TDUSRTIMER
 40
0.0
  9
$USRTIMER
 70
1
  9
$ANGBASE
 50
0.0
  9
$ANGDIR
 70
0
  9
$PDMODE
 70
0
  9
$PDSIZE
 40
0.0
  9
$PLINEWID
 40
0.0
  9
$SPLFRAME
 70
0
  9
$SPLINETYPE
 70
6
  9
$SPLINESEGS
 70
8
  9
$HANDSEED
  5
EA3
  9
$SURFTAB1
 70
6
  9
$SURFTAB2
 70
6
  9
$SURFTYPE
 70
6
  9
$SURFU
 70
6
  9
$SURFV
 70
6
  9
$UCSBASE
  2

  9
$UCSNAME
  2

  9
$UCSORG
 10
0.0
 20
0.0
 30
0.0
  9
$UCSXDIR
 10
1.0
 20
0.0
 30
0.0
  9
$UCSYDIR
 10
0.0
 20
1.0
 30
0.0
  9
$UCSORTHOREF
  2

  9
$UCSORTHOVIEW
 70
0
  9
$UCSORGTOP
 10
0.0
 20
0.0
 30
0.0
  9
$UCSORGBOTTOM
 10
0.0
 20
0.0
 30
0.0
  9
$UCSORGLEFT
 10
0.0
 20
0.0
 30
0.0
  9
$UCSORGRIGHT
 10
0.0
 20
0.0
 30
0.0
  9
$UCSORGFRONT
 10
0.0
 20
0.0
 30
0.0
  9
$UCSORGBACK
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSBASE
  2

  9
$PUCSNAME
  2

  9
$PUCSORG
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSXDIR
 10
1.0
 20
0.0
 30
0.0
  9
$PUCSYDIR
 10
0.0
 20
1.0
 30
0.0
  9
$PUCSORTHOREF
  2

  9
$PUCSORTHOVIEW
 70
0
  9
$PUCSORGTOP
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSORGBOTTOM
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSORGLEFT
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSORGRIGHT
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSORGFRONT
 10
0.0
 20
0.0
 30
0.0
  9
$PUCSORGBACK
 10
0.0
 20
0.0
 30
0.0
  9
$USERI1
 70
0
  9
$USERI2
 70
0
  9
$USERI3
 70
0
  9
$USERI4
 70
0
  9
$USERI5
 70
0
  9
$USERR1
 40
0.0
  9
$USERR2
 40
0.0
  9
$USERR3
 40
0.0
  9
$USERR4
 40
0.0
  9
$USERR5
 40
0.0
  9
$WORLDVIEW
 70
1
  9
$SHADEDGE
 70
3
  9
$SHADEDIF
 70
70
  9
$TILEMODE
 70
1
  9
$MAXACTVP
 70
64
  9
$PINSBASE
 10
0.0
 20
0.0
 30
0.0
  9
$PLIMCHECK
 70
0
  9
$PEXTMIN
 10
1e+20
 20
1e+20
 30
1e+20
  9
$PEXTMAX
 10
-1e+20
 20
-1e+20
 30
-1e+20
  9
$PLIMMIN
 10
0.0
 20
0.0
  9
$PLIMMAX
 10
420.0
 20
297.0
  9
$UNITMODE
 70
0
  9
$VISRETAIN
 70
1
  9
$PLINEGEN
 70
0
  9
$PSLTSCALE
 70
1
  9
$TREEDEPTH
 70
3020
  9
$CMLSTYLE
  2
Standard
  9
$CMLJUST
 70
0
  9
$CMLSCALE
 40
20.0
  9
$PROXYGRAPHICS
 70
1
  9
$MEASUREMENT
 70
1
  9
$CELWEIGHT
370
-1
  9
$ENDCAPS
280
0
  9
$JOINSTYLE
280
0
  9
$LWDISPLAY
290
0
  9
$INSUNITS
 70
6
  9
$HYPERLINKBASE
  1

  9
$STYLESHEET
  1

  9
$XEDIT
290
1
  9
$CEPSNTYPE
380
0
  9
$PSTYLEMODE
290
1
  9
$FINGERPRINTGUID
  2
{FC3ED4C3-033B-4407-958E-9CB1F37DCBD3}
  9
$VERSIONGUID
  2
{28AC3C69-9EF3-4168-BC71-A3B672C4A892}
  9
$EXTNAMES
290
1
  9
$PSVPSCALE
 40
0.0
  9
$OLESTARTUP
290
0
  9
$SORTENTS
280
127
  9
$INDEXCTL
280
0
  9
$HIDETEXT
280
1
  9
$XCLIPFRAME
280
1
  9
$HALOGAP
280
0
  9
$OBSCOLOR
 70
257
  9
$OBSLTYPE
280
0
  9
$INTERSECTIONDISPLAY
280
0
  9
$INTERSECTIONCOLOR
 70
257
  9
$DIMASSOC
280
2
  9
$PROJECTNAME
  1

  9
$CAMERADISPLAY
290
0
  9
$LENSLENGTH
 40
50.0
  9
$CAMERAHEIGHT
 40
0.0
  9
$STEPSPERSEC
 40
24.0
  9
$STEPSIZE
 40
100.0
  9
$3DDWFPREC
 40
2.0
  9
$PSOLWIDTH
 40
0.005
  9
$PSOLHEIGHT
 40
0.08
  9
$LOFTANG1
 40
1.570796326795
  9
$LOFTANG2
 40
1.570796326795
  9
$LOFTMAG1
 40
0.0
  9
$LOFTMAG2
 40
0.0
  9
$LOFTPARAM
 70
7
  9
$LOFTNORMALS
280
1
  9
$LATITUDE
 40
37.795
  9
$LONGITUDE
 40
-122.394
  9
$NORTHDIRECTION
 40
0.0
  9
$TIMEZONE
 70
-8000
  9
$LIGHTGLYPHDISPLAY
280
1
  9
$TILEMODELIGHTSYNCH
280
1
  9
$CMATERIAL
347
20
  9
$SOLIDHIST
280
0
  9
$SHOWHIST
280
1
  9
$DWFFRAME
280
2
  9
$DGNFRAME
280
2
  9
$REALWORLDSCALE
290
1
  9
$INTERFERECOLOR
 62
256
  9
$CSHADOW
280
0
  9
$SHADOWPLANELOCATION
 40
0.0
  0
ENDSEC
  0
SECTION
  2
CLASSES
  0
CLASS
  1
ACDBDICTIONARYWDFLT
  2
AcDbDictionaryWithDefault
  3
ObjectDBX Classes
 90
0
 91
0
280
0
281
0
  0
CLASS
  1
SUN
  2
AcDbSun
  3
SCENEOE
 90
1153
 91
0
280
0
281
0
  0
CLASS
  1
VISUALSTYLE
  2
AcDbVisualStyle
  3
ObjectDBX Classes
 90
4095
 91
0
280
0
281
0
  0
CLASS
  1
MATERIAL
  2
AcDbMaterial
  3
ObjectDBX Classes
 90
1153
 91
0
280
0
281
0
  0
CLASS
  1
SCALE
  2
AcDbScale
  3
ObjectDBX Classes
 90
1153
 91
0
280
0
281
0
  0
CLASS
  1
TABLESTYLE
  2
AcDbTableStyle
  3
ObjectDBX Classes
 90
4095
 91
0
280
0
281
0
  0
CLASS
  1
MLEADERSTYLE
  2
AcDbMLeaderStyle
  3
ACDB_MLEADERSTYLE_CLASS
 90
4095
 91
0
280
0
281
0
  0
CLASS
  1
DICTIONARYVAR
  2
AcDbDictionaryVar
  3
ObjectDBX Classes
 90
0
 91
0
280
0
281
0
  0
CLASS
  1
CELLSTYLEMAP
  2
AcDbCellStyleMap
  3
ObjectDBX Classes
 90
1152
 91
0
280
0
281
0
  0
CLASS
  1
MENTALRAYRENDERSETTINGS
  2
AcDbMentalRayRenderSettings
  3
SCENEOE
 90
1024
 91
0
280
0
281
0
  0
CLASS
  1
ACDBDETAILVIEWSTYLE
  2
AcDbDetailViewStyle
  3
ObjectDBX Classes
 90
1025
 91
0
280
0
281
0
  0
CLASS
  1
ACDBSECTIONVIEWSTYLE
  2
AcDbSectionViewStyle
  3
ObjectDBX Classes
 90
1025
 91
0
280
0
281
0
  0
CLASS
  1
RASTERVARIABLES
  2
AcDbRasterVariables
  3
ISM
 90
0
 91
0
280
0
281
0
  0
CLASS
  1
ACDBPLACEHOLDER
  2
AcDbPlaceHolder
  3
ObjectDBX Classes
 90
0
 91
0
280
0
281
0
  0
CLASS
  1
LAYOUT
  2
AcDbLayout
  3
ObjectDBX Classes
 90
0
 91
0
280
0
281
0
  0
ENDSEC
  0
SECTION
  2
TABLES
  0
TABLE
  2
VPORT
  5
8
330
0
100
AcDbSymbolTable
 70
1
  0
VPORT
  5
23
330
8
100
AcDbSymbolTableRecord
100
AcDbViewportTableRecord
  2
*Active
 70
0
 10
0.0
 20
0.0
 11
1.0
 21
1.0
 12
0.0
 22
0.0
 13
0.0
 23
0.0
 14
0.5
 24
0.5
 15
0.5
 25
0.5
 16
0.0
 26
0.0
 36
1.0
 17
0.0
 27
0.0
 37
0.0
 40
1000.0
 41
1.34
 42
50.0
 43
0.0
 44
0.0
 50
0.0
 51
0.0
 71
0
 72
1000
 73
1
 74
3
 75
0
 76
0
 77
0
 78
0
281
0
 65
0
146
0.0
  0
ENDTAB
  0
TABLE
  2
LTYPE
  5
2
330
0
100
AcDbSymbolTable
 70
3
  0
LTYPE
  5
24
330
2
100
AcDbSymbolTableRecord
100
AcDbLinetypeTableRecord
  2
ByBlock
 70
0
  3

 72
65
 73
0
 40
0.0
  0
LTYPE
  5
25
330
2
100
AcDbSymbolTableRecord
100
AcDbLinetypeTableRecord
  2
ByLayer
 70
0
  3

 72
65
 73
0
 40
0.0
  0
LTYPE
  5
26
330
2
100
AcDbSymbolTableRecord
100
AcDbLinetypeTableRecord
  2
Continuous
 70
0
  3

 72
65
 73
0
 40
0.0
  0
ENDTAB
  0
TABLE
  2
LAYER
  5
1
330
0
100
AcDbSymbolTable
 70
46
  0
LAYER
  5
27
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
0
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
28
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
Defpoints
 70
0
 62
7
  6
Continuous
290
0
370
-3
390
13
347
21
  0
LAYER
  5
2F
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CENTER
 70
0
 62
1
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
30
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CONTOUR_INDEX
 70
0
 62
150
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
31
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CONTOUR_MAJOR
 70
0
 62
92
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
32
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CONTOUR_MINOR
 70
0
 62
253
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
38
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CONTOUR_1FT
 70
0
 62
251
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
33
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ELEV_LABELS
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
34
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
SITE_INFO
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
F07
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROAD_LABELS
 70
0
 62
3
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
F0A
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ADJOINING_LABELS
 70
0
 62
230
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
F0B
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ADJOINING_PARCELS
 70
0
 62
241
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
35
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
NORTH_ARROW
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
36
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
BENCHMARKS
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
37
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
BM_LABELS
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
3B
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_SECTION
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
3C
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_TWP
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
3D
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_LABELS
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
3E
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_QQ
 70
0
 62
8
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
3F
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROADS_MAJOR
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
40
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROADS_LOCAL
 70
0
 62
4
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
41
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROADS_TRAIL
 70
0
 62
6
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
42
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
HYDRO
 70
0
 62
140
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
43
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_MAJOR
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
44
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_MAJOR_3D
 70
0
 62
2
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
45
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_LOCAL
 70
0
 62
4
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
46
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_LOCAL_3D
 70
0
 62
4
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
47
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_TRAIL
 70
0
 62
6
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
48
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CL_TRAIL_3D
 70
0
 62
6
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
49
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROW_MAJOR
 70
0
 62
40
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4A
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROW_MAJOR_3D
 70
0
 62
40
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4B
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROW_LOCAL
 70
0
 62
132
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4C
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
ROW_LOCAL_3D
 70
0
 62
132
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4D
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
HYDRO_3D
 70
0
 62
140
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4E
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_SECTION_3D
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
4F
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_TWP_3D
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
50
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PLSS_QQ_3D
 70
0
 62
7
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
51
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
POWER
 70
0
 62
50
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
52
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
POWER_3D
 70
0
 62
50
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
53
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PIPELINE
 70
0
 62
30
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
54
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
PIPELINE_3D
 70
0
 62
30
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
55
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
RAILROAD
 70
0
 62
5
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
56
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
RAILROAD_3D
 70
0
 62
5
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
57
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
BUILDINGS
 70
0
 62
9
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
58
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
COUNTY_BOUNDARY
 70
0
 62
40
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
59
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
COUNTY_LABEL
 70
0
 62
40
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
5A
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
OTLS_GRID
 70
0
 62
4
  6
Continuous
370
-3
390
13
347
21
  0
LAYER
  5
5B
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
OTLS_LABELS
 70
0
 62
4
  6
Continuous
370
-3
390
13
347
21
  0
ENDTAB
  0
TABLE
  2
STYLE
  5
5
330
0
100
AcDbSymbolTable
 70
1
  0
STYLE
  5
29
330
5
100
AcDbSymbolTableRecord
100
AcDbTextStyleTableRecord
  2
Standard
 70
0
 40
0.0
 41
1.0
 50
0.0
 71
0
 42
2.5
  3
txt
  4

  0
ENDTAB
  0
TABLE
  2
VIEW
  5
7
330
0
100
AcDbSymbolTable
 70
0
  0
ENDTAB
  0
TABLE
  2
UCS
  5
6
330
0
100
AcDbSymbolTable
 70
0
  0
ENDTAB
  0
TABLE
  2
APPID
  5
3
330
0
100
AcDbSymbolTable
 70
3
  0
APPID
  5
2A
330
3
100
AcDbSymbolTableRecord
100
AcDbRegAppTableRecord
  2
ACAD
 70
0
  0
APPID
  5
EA0
330
3
100
AcDbSymbolTableRecord
100
AcDbRegAppTableRecord
  2
HATCHBACKGROUNDCOLOR
 70
0
  0
APPID
  5
EA1
330
3
100
AcDbSymbolTableRecord
100
AcDbRegAppTableRecord
  2
EZDXF
 70
0
  0
ENDTAB
  0
TABLE
  2
DIMSTYLE
  5
4
330
0
100
AcDbSymbolTable
 70
1
100
AcDbDimStyleTable
  0
DIMSTYLE
105
2B
330
4
100
AcDbSymbolTableRecord
100
AcDbDimStyleTableRecord
  2
Standard
 70
0
 40
1.0
 41
2.5
 42
0.625
 43
3.75
 44
1.25
 45
0.0
 46
0.0
 47
0.0
 48
0.0
 49
2.5
140
2.5
141
2.5
142
0.0
143
0.03937007874
144
1.0
145
0.0
146
1.0
147
0.625
148
0.0
 69
0
 70
0
 71
0
 72
0
 73
0
 74
0
 75
0
 76
0
 77
1
 78
8
 79
3
170
0
171
3
172
1
173
0
174
0
175
0
176
0
177
0
178
0
179
2
271
2
272
2
273
2
274
3
275
0
276
0
277
2
278
44
279
0
280
0
281
0
282
0
283
0
284
8
285
0
286
0
288
0
289
3
290
0
371
-2
372
-2
  0
ENDTAB
  0
TABLE
  2
BLOCK_RECORD
  5
9
330
0
100
AcDbSymbolTable
 70
2
  0
BLOCK_RECORD
  5
17
330
9
100
AcDbSymbolTableRecord
100
AcDbBlockTableRecord
  2
*Model_Space
340
1A
 70
0
280
1
281
0
  0
BLOCK_RECORD
  5
1B
330
9
100
AcDbSymbolTableRecord
100
AcDbBlockTableRecord
  2
*Paper_Space
340
1E
 70
0
280
1
281
0
  0
ENDTAB
  0
ENDSEC
  0
SECTION
  2
BLOCKS
  0
BLOCK
  5
18
330
17
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
*Model_Space
 70
0
 10
0.0
 20
0.0
 30
0.0
  3
*Model_Space
  1

  0
ENDBLK
  5
19
330
17
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
BLOCK
  5
1C
330
1B
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
*Paper_Space
 70
0
 10
0.0
 20
0.0
 30
0.0
  3
*Paper_Space
  1

  0
ENDBLK
  5
1D
330
1B
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
ENDSEC
  0
SECTION
`;
    // === PARCEL LAYER ===
    if (parcelData && parcelData.coords) {
      const rings = Array.isArray(parcelData.coords[0][0]) ? parcelData.coords : [parcelData.coords];
      for (const ring of rings) {
        const pts = [];
        for (const c of ring) {
          const s = latLngToSPC(c[1], c[0]);
          pts.push([s.E, s.N, 0]);
        }
        if (pts.length >= 2) polyline(pts, 'PARCEL', 0);
      }
      if (parcelData.apn) {
        let cx=0, cy=0, cnt=0;
        const baseRing = Array.isArray(parcelData.coords[0][0]) ? parcelData.coords[0] : parcelData.coords;
        for (const c of baseRing) { cx+=c[0]; cy+=c[1]; cnt++; }
        const cs = latLngToSPC(cy/cnt, cx/cnt);
        // DISABLED: text(parcelData.apn, cs.E, cs.N, 0, cellFt*3, 'PARCEL');
      }
    }
    // === END PARCEL LAYER ===
    // === ADJOINING PARCELS LAYER ===
    for (const adj of adjoinersData) {
      const rings = Array.isArray(adj.coords[0][0]) ? adj.coords : [adj.coords];
      for (const ring of rings) {
        const pts = [];
        for (const co of ring) {
          const s = latLngToSPC(co[1], co[0]);
          pts.push([s.E, s.N, 0]);
        }
        if (pts.length >= 2) polyline(pts, 'ADJOINING_PARCELS', 0, true);
      }
      // APN label at centroid
      if (adj.apn) {
        let cx=0, cy=0, cnt=0;
        const baseRing = Array.isArray(adj.coords[0][0]) ? adj.coords[0] : adj.coords;
        for (const co of baseRing) { cx+=co[0]; cy+=co[1]; cnt++; }
        if (cnt > 0) {
          const cs = latLngToSPC(cy/cnt, cx/cnt);
          if (isFinite(cs.E) && isFinite(cs.N)) {
            text(adj.apn, cs.E, cs.N, 0, cellFt*0.15, 'ADJOINING_LABELS');
          }
        }
      }
    }
    // === END ADJOINING PARCELS ===
    const DXF_FOOTER = `  0
SECTION
  2
OBJECTS
  0
DICTIONARY
  5
A
330
0
100
AcDbDictionary
281
1
  3
ACAD_COLOR
350
B
  3
ACAD_GROUP
350
C
  3
ACAD_LAYOUT
350
D
  3
ACAD_MATERIAL
350
E
  3
ACAD_MLEADERSTYLE
350
F
  3
ACAD_MLINESTYLE
350
10
  3
ACAD_PLOTSETTINGS
350
11
  3
ACAD_PLOTSTYLENAME
350
12
  3
ACAD_SCALELIST
350
14
  3
ACAD_TABLESTYLE
350
15
  3
ACAD_VISUALSTYLE
350
16
  3
EZDXF_META
350
2D
  0
DICTIONARY
  5
B
330
A
100
AcDbDictionary
281
1
  0
DICTIONARY
  5
C
330
A
100
AcDbDictionary
281
1
  0
DICTIONARY
  5
D
330
A
100
AcDbDictionary
281
1
  3
Model
350
1A
  3
Layout1
350
1E
  0
DICTIONARY
  5
E
330
A
100
AcDbDictionary
281
1
  3
ByBlock
350
1F
  3
ByLayer
350
20
  3
Global
350
21
  0
DICTIONARY
  5
F
330
A
100
AcDbDictionary
281
1
  3
Standard
350
2C
  0
DICTIONARY
  5
10
330
A
100
AcDbDictionary
281
1
  3
Standard
350
22
  0
DICTIONARY
  5
11
330
A
100
AcDbDictionary
281
1
  0
ACDBDICTIONARYWDFLT
  5
12
330
A
100
AcDbDictionary
281
1
  3
Normal
350
13
100
AcDbDictionaryWithDefault
340
13
  0
ACDBPLACEHOLDER
  5
13
330
12
  0
DICTIONARY
  5
14
330
A
100
AcDbDictionary
281
1
  0
DICTIONARY
  5
15
330
A
100
AcDbDictionary
281
1
  0
DICTIONARY
  5
16
330
A
100
AcDbDictionary
281
1
  0
LAYOUT
  5
1A
330
D
100
AcDbPlotSettings
  1

  4
A3
  6

 40
7.5
 41
20.0
 42
7.5
 43
20.0
 44
420.0
 45
297.0
 46
0.0
 47
0.0
 48
0.0
 49
0.0
140
0.0
141
0.0
142
1.0
143
1.0
 70
1024
 72
1
 73
0
 74
5
  7

 75
16
 76
0
 77
2
 78
300
147
1.0
148
0.0
149
0.0
100
AcDbLayout
  1
Model
 70
1
 71
0
 10
0.0
 20
0.0
 11
420.0
 21
297.0
 12
0.0
 22
0.0
 32
0.0
 14
1e+20
 24
1e+20
 34
1e+20
 15
-1e+20
 25
-1e+20
 35
-1e+20
146
0.0
 13
0.0
 23
0.0
 33
0.0
 16
1.0
 26
0.0
 36
0.0
 17
0.0
 27
1.0
 37
0.0
 76
1
330
17
  0
LAYOUT
  5
1E
330
D
100
AcDbPlotSettings
  1

  4
A3
  6

 40
7.5
 41
20.0
 42
7.5
 43
20.0
 44
420.0
 45
297.0
 46
0.0
 47
0.0
 48
0.0
 49
0.0
140
0.0
141
0.0
142
1.0
143
1.0
 70
0
 72
1
 73
0
 74
5
  7

 75
16
 76
0
 77
2
 78
300
147
1.0
148
0.0
149
0.0
100
AcDbLayout
  1
Layout1
 70
1
 71
1
 10
0.0
 20
0.0
 11
420.0
 21
297.0
 12
0.0
 22
0.0
 32
0.0
 14
1e+20
 24
1e+20
 34
1e+20
 15
-1e+20
 25
-1e+20
 35
-1e+20
146
0.0
 13
0.0
 23
0.0
 33
0.0
 16
1.0
 26
0.0
 36
0.0
 17
0.0
 27
1.0
 37
0.0
 76
1
330
1B
  0
MATERIAL
  5
1F
102
{ACAD_REACTORS
330
E
102
}
330
E
100
AcDbMaterial
  1
ByBlock
  2

 70
0
 40
1.0
 71
1
 41
1.0
 91
-1023410177
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 44
0.5
 73
0
 45
1.0
 46
1.0
 77
1
  4

 78
1
 79
1
170
1
 48
1.0
171
1
  6

172
1
173
1
174
1
140
1.0
141
1.0
175
1
  7

176
1
177
1
178
1
143
1.0
179
1
  8

270
1
271
1
272
1
145
1.0
146
1.0
273
1
  9

274
1
275
1
276
1
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 94
63
  0
MATERIAL
  5
20
102
{ACAD_REACTORS
330
E
102
}
330
E
100
AcDbMaterial
  1
ByLayer
  2

 70
0
 40
1.0
 71
1
 41
1.0
 91
-1023410177
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 44
0.5
 73
0
 45
1.0
 46
1.0
 77
1
  4

 78
1
 79
1
170
1
 48
1.0
171
1
  6

172
1
173
1
174
1
140
1.0
141
1.0
175
1
  7

176
1
177
1
178
1
143
1.0
179
1
  8

270
1
271
1
272
1
145
1.0
146
1.0
273
1
  9

274
1
275
1
276
1
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 94
63
  0
MATERIAL
  5
21
102
{ACAD_REACTORS
330
E
102
}
330
E
100
AcDbMaterial
  1
Global
  2

 70
0
 40
1.0
 71
1
 41
1.0
 91
-1023410177
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 44
0.5
 73
0
 45
1.0
 46
1.0
 77
1
  4

 78
1
 79
1
170
1
 48
1.0
171
1
  6

172
1
173
1
174
1
140
1.0
141
1.0
175
1
  7

176
1
177
1
178
1
143
1.0
179
1
  8

270
1
271
1
272
1
145
1.0
146
1.0
273
1
  9

274
1
275
1
276
1
 42
1.0
 72
1
  3

 73
1
 74
1
 75
1
 94
63
  0
MLINESTYLE
  5
22
102
{ACAD_REACTORS
330
10
102
}
330
10
100
AcDbMlineStyle
  2
Standard
 70
0
  3

 62
256
 51
90.0
 52
90.0
 71
2
 49
0.5
 62
256
  6
BYLAYER
 49
-0.5
 62
256
  6
BYLAYER
  0
MLEADERSTYLE
  5
2C
102
{ACAD_REACTORS
330
F
102
}
330
F
100
AcDbMLeaderStyle
179
2
170
2
171
1
172
0
 90
2
 40
0.0
 41
0.0
173
1
 91
-1056964608
 92
-2
290
1
 42
2.0
291
1
 43
8.0
  3
Standard
 44
4.0
300

342
29
174
1
175
1
176
0
178
1
 93
-1056964608
 45
4.0
292
0
297
0
 46
4.0
 94
-1056964608
 47
1.0
 49
1.0
140
1.0
294
1
141
0.0
177
0
142
1.0
295
0
296
0
143
3.75
271
0
272
9
273
9
  0
DICTIONARY
  5
2D
330
A
100
AcDbDictionary
280
1
281
1
  3
CREATED_BY_EZDXF
350
2E
  3
WRITTEN_BY_EZDXF
350
EA2
  0
DICTIONARYVAR
  5
2E
330
2D
100
DictionaryVariables
280
0
  1
1.4.3 @ 2026-03-04T06:07:58.101685+00:00
  0
DICTIONARYVAR
  5
EA2
330
2D
100
DictionaryVariables
280
0
  1
1.4.3 @ 2026-03-04T06:07:58.155053+00:00
  0
ENDSEC
  0
EOF
`;
    // Patch EXTMIN/EXTMAX — use section bbox if available, else site radius
    let extMinE, extMinN, extMaxE, extMaxN;
    if (secBbox) {
      // Convert section bbox corners to SPC
      const bl = latLngToSPC(secBbox[1], secBbox[0]);
      const tr = latLngToSPC(secBbox[3], secBbox[2]);
      const pad2 = 200;
      extMinE = Math.min(bl.E,tr.E) - pad2; extMinN = Math.min(bl.N,tr.N) - pad2;
      extMaxE = Math.max(bl.E,tr.E) + pad2; extMaxN = Math.max(bl.N,tr.N) + pad2;
    } else {
      const pad = radiusFt * 1.1;
      extMinE = site.E - pad; extMinN = site.N - pad;
      extMaxE = site.E + pad; extMaxN = site.N + pad;
    }
    // Compute VPORT center and height from section or site
    const vportCx = secBbox
      ? ((latLngToSPC(secBbox[1],secBbox[0]).E + latLngToSPC(secBbox[3],secBbox[2]).E) / 2)
      : site.E;
    const vportCy = secBbox
      ? ((latLngToSPC(secBbox[1],secBbox[0]).N + latLngToSPC(secBbox[3],secBbox[2]).N) / 2)
      : site.N;
    const vportH = secBbox
      ? (Math.abs(latLngToSPC(secBbox[3],secBbox[2]).N - latLngToSPC(secBbox[1],secBbox[0]).N) * 1.2)
      : (radiusFt * 2.2);
    const DXF_HEADER = DXF_HEADER_RAW
      .replace(` 10\n1e+20\n 20\n1e+20\n 30\n1e+20\n`,   ` 10\n${extMinE.toFixed(4)}\n 20\n${extMinN.toFixed(4)}\n 30\n0.0\n`)
      .replace(` 10\n-1e+20\n 20\n-1e+20\n 30\n-1e+20\n`, ` 10\n${extMaxE.toFixed(4)}\n 20\n${extMaxN.toFixed(4)}\n 30\n0.0\n`)
      .replace(` 12\n0.0\n 22\n0.0\n`, ` 12\n${vportCx.toFixed(4)}\n 22\n${vportCy.toFixed(4)}\n`)
      .replace(` 40\n1000.0\n`, ` 40\n${vportH.toFixed(4)}\n`)
      .replace(` 10\n0.0\n 20\n0.0\n  9\n$LIMMAX`,     ` 10\n${extMinE.toFixed(4)}\n 20\n${extMinN.toFixed(4)}\n  9\n$LIMMAX`)
      .replace(` 10\n420.0\n 20\n297.0\n`,               ` 10\n${extMaxE.toFixed(4)}\n 20\n${extMaxN.toFixed(4)}\n`);
    const dxf = DXF_HEADER + '  2\nENTITIES\n' + entities + '  0\nENDSEC\n' + DXF_FOOTER;

    console.log(`[SkyGrid] site-dxf-v5: ${contourCount} segs, ${bmCount} bm, ${labeled.size} labels`);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/dxf',
        'Content-Disposition': `attachment; filename="skygrid_${userLat}_${userLng}.dxf"` },
      body: dxf
    };

  } catch(e) {
    console.error('[SkyGrid] site-dxf-v5 error:', e.message, e.stack);
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }) };
  }
};
 
 
