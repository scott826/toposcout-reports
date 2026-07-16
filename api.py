import os
from flask import Flask, request, jsonify, send_file
import requests
import psycopg2

app = Flask(__name__)

# --- /report/<code> hosting endpoint (added session 112, STEP 1) -----------
import os as _os
import project_store as _ps

@app.route('/report/<code>', methods=['GET'])
def serve_report_by_code(code):
    """Stream a saved report PDF by its SG-XXXXXX project code (read-only)."""
    if not _ps.valid_code(code):
        return ('Not found', 404)
    path = _ps.deliverable_path(code, 'pdf') or _ps.deliverable_path(code, 'report')
    if not path or not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='application/pdf', as_attachment=False, download_name='TopoScout_%s.pdf' % code)

# --- /kmz/<code> hosting endpoint (mirrors /report) ------------------------
@app.route('/kmz/<code>', methods=['GET'])
def serve_kmz_by_code(code):
    """Stream a saved project's KMZ by its SG-XXXXXX code (read-only)."""
    if not _ps.valid_code(code):
        return ('Not found', 404)
    path = _ps.deliverable_path(code, 'kmz')
    if not path or not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='application/vnd.google-earth.kmz',
                     as_attachment=True,
                     download_name='TopoScout_%s.kmz' % code)
# --- end /kmz/<code> -------------------------------------------------------

# --- /points/<code> control-points file endpoint (mirrors /kmz) ------------
@app.route('/points/<code>', methods=['GET'])
def serve_points_by_code(code):
    path = _ps.deliverable_path(code, 'points')
    if not path or not os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='text/plain', as_attachment=True,
                     download_name='TopoScout_%s_points.txt' % code)
# --- end /points/<code> ----------------------------------------------------
# --- end /report/<code> ----------------------------------------------------
# --- ACCESS_LINK_V1: customer access page /o/<code> + /dxf/<code> ----------
@app.route('/dxf/<code>', methods=['GET'])
def serve_dxf_by_code(code):
    if not _ps.valid_code(code):
        return ('Not found', 404)
    path = _ps.deliverable_path(code, 'dxf')
    if not path or not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='application/dxf', as_attachment=True,
                     download_name='TopoScout_%s.dxf' % code)
# AUDIO_ROUTE_V1: audio site brief (mp3) -- stream inline (playable) + downloadable name
@app.route('/audio/<code>', methods=['GET'])
def serve_audio_by_code(code):
    if not _ps.valid_code(code):
        return ('Not found', 404)
    import os as _os
    # try the deliverable path first, else the conventional filename
    path = _ps.deliverable_path(code, 'audio')
    if not path or not _os.path.exists(path):
        path = _os.path.join('/mnt/pgdata/skygrid_jobs', code, 'site_brief.mp3')
    if not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='audio/mpeg', as_attachment=False,
                     download_name='TopoScout_%s_brief.mp3' % code)
# NEARFAR_V2: CAD-alignment aerials, served exactly like /dxf/<code>
@app.route('/near/<code>', methods=['GET'])
def serve_near_by_code(code):
    if not _ps.valid_code(code):
        return ('Not found', 404)
    path = _ps.deliverable_path(code, 'near')
    if not path or not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='image/png', as_attachment=True,
                     download_name='TopoScout_%s_near.png' % code)
@app.route('/far/<code>', methods=['GET'])
def serve_far_by_code(code):
    if not _ps.valid_code(code):
        return ('Not found', 404)
    path = _ps.deliverable_path(code, 'far')
    if not path or not _os.path.exists(path):
        return ('Not found', 404)
    return send_file(path, mimetype='image/png', as_attachment=True,
                     download_name='TopoScout_%s_far.png' % code)

# API_USE_CATALOG_V1: /o/ products from single-source CATALOG
def _access_products():
    out = []
    for item, e in _ps.CATALOG.items():
        if not e.get('sellable'):
            continue
        out.append((item, e['label'], e['price_cents'] // 100, e.get('downloads', [])))
    return out

def _access_html(code, p):  # SHARE_BUTTON_V1
    rows = []
    for item, label, price, dls in _access_products():
        paid = _ps.is_paid(code, item)
        if paid:
            links = []
            for dlabel, prefix, key in dls:
                if (p.get('files') or {}).get(key):
                    links.append('<a class="dl" href="' + prefix + code + '">&#8595; ' + dlabel + '</a>')
            inner = ('<div class="links">' + ''.join(links) + '</div>') if links else '<div class="pending">Preparing files&hellip;</div>'
            badge = '<span class="paid">PAID</span>'
        else:
            inner = '<a class="buy" href="/checkout?code=' + code + '&item=' + item + '">Add &mdash; $' + str(price) + '</a>'
            badge = '<span class="price">$' + str(price) + '</span>'
        rows.append('<div class="prod"><div class="phead"><span class="plabel">' + label + '</span>' + badge + '</div>' + inner + '</div>')
    apn = p.get('parcel_apn') or '&mdash;'
    lat = p.get('lat'); lng = p.get('lng')
    css = "*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f1720;background:#f6f8fa}.wrap{max-width:640px;margin:0 auto;padding:28px 20px}.brand{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.06em;font-size:18px}.hex{color:#b8860b}.sub{color:#5b6b7a;font-size:12.5px;letter-spacing:.18em;margin:2px 0 22px}.card{background:#fff;border:1px solid #e4e9ee;border-radius:12px;padding:20px;margin-bottom:14px}.meta{color:#5b6b7a;font-size:13px;margin-bottom:16px}.prod{border-top:1px solid #e4e9ee;padding:16px 0}.prod:first-child{border-top:0;padding-top:0}.phead{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.plabel{font-weight:600}.price{color:#b8860b;font-weight:700}.paid{color:#0b5;font-weight:700;font-size:12px;letter-spacing:.08em}.links{display:flex;flex-wrap:wrap;gap:8px}.dl{display:inline-block;padding:9px 14px;background:#0f1720;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}.buy{display:inline-block;padding:10px 16px;background:#b8860b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}.pending{color:#5b6b7a;font-size:13px}.foot{color:#5b6b7a;font-size:12px;margin-top:8px;text-align:center}.sharewrap{text-align:center;margin-top:14px}.share{display:inline-block;padding:9px 16px;background:#fff;border:1px solid #b8860b;color:#b8860b;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}"
    html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TopoScout ' + code + '</title><style>' + css + '</style></head><body><div class="wrap"><div class="brand"><span class="hex">&#11041;</span> TOPOSCOUT</div><div class="sub">SITE INTELLIGENCE &middot; PROJECT <b>' + code + '</b></div><div class="card"><div class="meta">Coordinates ' + str(lat) + ', ' + str(lng) + ' &nbsp;&middot;&nbsp; APN ' + apn + '</div>' + ''.join(rows) + '</div><div class="sharewrap"><button class="share" onclick="tsCopy(this)">Copy share link</button></div><script>function tsCopy(b){navigator.clipboard.writeText(location.href);var o=b.textContent;b.textContent="Copied!";setTimeout(function(){b.textContent=o;},1800);}</script><div class="foot">Your files stay available at this link. TopoScout &middot; info@toposcout.com</div></div></body></html>'
    return html

@app.route('/o/<code>', methods=['GET'])
def access_page(code):
    if not _ps.valid_code(code):
        return ('Not found', 404)
    p = _ps.get_project(code)
    if p is None:
        return ('Not found', 404)
    return (_access_html(code, p), 200, {'Content-Type': 'text/html; charset=utf-8'})
# --- end ACCESS_LINK_V1 ----------------------------------------------------

# EPQS_PROXY_V1: USGS 3DEP elevation proxy (NAVD88, survey-grade) --------------
import json as _json_epqs
import urllib.request as _ur_epqs
import urllib.parse as _up_epqs
@app.route('/elev', methods=['GET'])
def epqs_elev():
    try:
        lat = float(request.args.get('lat', ''))
        lng = float(request.args.get('lng', ''))
    except Exception:
        return ({'elev_ft': None, 'source': 'error', 'error': 'bad coords'}, 400, {'Access-Control-Allow-Origin': '*'})
    qs = _up_epqs.urlencode({'x': lng, 'y': lat, 'wkid': 4326,
                             'units': 'Feet', 'includeDate': 'false'})
    url = 'https://epqs.nationalmap.gov/v1/json?' + qs
    try:
        req = _ur_epqs.Request(url, headers={'User-Agent': 'TopoScout/1.0'})
        with _ur_epqs.urlopen(req, timeout=12) as r:
            data = _json_epqs.loads(r.read().decode('utf-8', 'replace'))
        # EPQS returns elevation under 'value' (may be a string). No-data sentinels are
        # large negatives like -1000000.
        raw = data.get('value')
        if raw is None and isinstance(data.get('USGS_Elevation_Point_Query_Service'), dict):
            raw = data['USGS_Elevation_Point_Query_Service'].get('Elevation_Query', {}).get('Elevation')
        val = float(raw)
        if val < -999999 or val > 100000:
            return ({'elev_ft': None, 'source': 'epqs', 'note': 'no-data'}, 200, {'Access-Control-Allow-Origin': '*'})
        return ({'elev_ft': round(val, 1), 'source': 'epqs-3dep'}, 200, {'Access-Control-Allow-Origin': '*'})
    except Exception as e:
        return ({'elev_ft': None, 'source': 'epqs', 'error': str(e)[:120]}, 200, {'Access-Control-Allow-Origin': '*'})
# --- end EPQS_PROXY_V1 -------------------------------------------------------

# --- STRIPE_CHECKOUT_V1: hosted Checkout Session (authorize-hold, charge-on-delivery) ---
import stripe as _stripe
def _stripe_key():
    try:
        with open('/opt/skygrid/.stripe_key') as _f:
            return _f.read().strip()
    except Exception:
        return None

# item -> (label, unit_amount cents, stripe product name)
# API_USE_CATALOG_V1: checkout item from single-source CATALOG
def _checkout_item(item):
    it = _ps.CATALOG.get(item)
    if not it:
        return None
    return (it['label'], it['price_cents'], 'TopoScout ' + it['label'])

@app.route('/checkout', methods=['GET'])
def checkout():
    # ENQUEUE_HOOK_V1: NEW purchase (lat/lng, no project yet) or ADD-ON (code).
    # Project is NOT created here; it's born at payment.
    code = request.args.get('code', '')
    item = request.args.get('item', '')
    items_param = request.args.get('items', '')   # MULTI_ITEM_V1: comma-sep list
    if items_param:
        _items = [x.strip() for x in items_param.split(',') if x.strip()]
    elif item:
        _items = [item]
    else:
        _items = []
    # dedupe preserve order
    _seen=set(); _items=[x for x in _items if not (x in _seen or _seen.add(x))]
    lat  = request.args.get('lat', '')
    lng  = request.args.get('lng', '')
    company  = request.args.get('company', '')   # API_JOBINFO_V1
    job_name = request.args.get('job_name', '')
    if not _items:
        return ('Invalid item', 400)
    for _it in _items:
        if _it not in _ps.CATALOG or not _ps.CATALOG[_it].get('sellable'):
            return ('Invalid item', 400)
    item = _items[0]   # primary (for add-on/paid checks below)
    if code:
        p = _ps.get_project(code)
        if p is None:
            return ('No such project', 404)
        if _ps.is_paid(code, item):
            return _redirect('/o/' + code)
        if not lat: lat = str(p.get('lat'))
        if not lng: lng = str(p.get('lng'))
    else:
        if not lat or not lng:
            return ('Coordinates required', 400)
    key = _stripe_key()
    if not key:
        return ('Payment not configured', 500)
    _stripe.api_key = key
    label, cents, prod = _checkout_item(item)
    base = request.host_url.rstrip('/')          # e.g. https://api.toposcout.com
    try:
        sess = _stripe.checkout.Session.create(
            mode='payment',
            payment_intent_data={'capture_method': 'manual'},   # authorize, capture later
            allow_promotion_codes=True,
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'product_data': {'name': _ps.catalog_label(_it)},
                    'unit_amount': _ps.catalog_price_cents(_it),
                },
                'quantity': 1,
            } for _it in _items],
            custom_fields=[
                {'key': 'company', 'label': {'type': 'custom', 'custom': 'Company'},
                 'type': 'text', 'optional': True},
                {'key': 'job', 'label': {'type': 'custom', 'custom': 'Job title'},
                 'type': 'text', 'optional': True},
            ],
            metadata={'code': code, 'item': item, 'items': ','.join(_items), 'lat': lat, 'lng': lng, 'company': company, 'job_name': job_name},
            client_reference_id=(code or None),
            success_url=base + '/checkout-return?session_id={CHECKOUT_SESSION_ID}',
            cancel_url=base + ('/o/' + code if code else '/'),
        )
    except Exception as e:
        return ('Checkout error: ' + str(e), 500)
    return _redirect(sess.url)

def _payment_received_html(code, item):
    label = {'report':'Site Report','dxf':'DXF CAD File'}.get(item, 'order')
    return ('<!doctype html><html><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width,initial-scale=1">'
      '<title>Payment received &middot; TopoScout</title><style>'
      '*{box-sizing:border-box}body{margin:0;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;'
      'color:#0f1720;background:#f6f8fa}.wrap{max-width:560px;margin:0 auto;padding:48px 20px}'
      '.brand{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.06em;font-size:18px;justify-content:center}'
      '.hex{color:#b8860b}.card{background:#fff;border:1px solid #e4e9ee;border-radius:14px;padding:32px;margin-top:24px;text-align:center}'
      '.check{width:56px;height:56px;border-radius:50%;background:#0b5;color:#fff;font-size:30px;line-height:56px;margin:0 auto 12px}'
      '.h{font-size:20px;font-weight:700;margin:0 0 10px}.p{color:#3a4753;margin:10px 0}'
      '.note{color:#5b6b7a;font-size:13.5px;background:#f2f6f4;border:1px solid #dfeae4;border-radius:9px;padding:12px 14px;margin:18px 0 6px}'
      '.pid{color:#5b6b7a;font-size:13px;margin-top:18px}.pid b{color:#0f1720}'
      '.link{display:inline-block;margin-top:18px;color:#0b5;text-decoration:none;font-weight:600;font-size:14px}'
      '</style></head><body><div class="wrap">'
      '<div class="brand"><span class="hex">&#11041;</span> TOPOSCOUT</div>'
      '<div class="card"><div class="check">&#10003;</div>'
      '<div class="h">Payment received</div>'
      '<div class="p">Thanks &mdash; your <b>' + label + '</b> is confirmed and being prepared now. '
      'We will email you a download link as soon as it is ready.</div>'
      '<div class="note">You have not been charged yet &mdash; your card is only charged once your report is delivered.</div>'
      '<div class="pid">Project <b>' + code + '</b></div>'

      '</div></div></body></html>')

@app.route('/checkout-return', methods=['GET'])
def checkout_return():
    sid = request.args.get('session_id', '')
    item = 'order'
    key = _stripe_key()
    if sid and key:
        _stripe.api_key = key
        try:
            s = _stripe.checkout.Session.retrieve(sid, expand=['payment_intent'])
            item = (s.get('metadata') or {}).get('item', 'order')
            _enqueue_paid_session(s)
        except Exception as e:
            try:
                print('[checkout-return] %s' % e)
            except Exception:
                pass
    return (_payment_received_html('your order', item), 200,
            {'Content-Type': 'text/html; charset=utf-8'})

def _redirect(url):
    from flask import redirect as _rd
    return _rd(url, code=303)
# --- end STRIPE_CHECKOUT_V1 ------------------------------------------------
# --- ENQUEUE_HOOK_V1: project born at Stripe authorization -----------------
# Nothing is created until the card is authorized. Both /checkout-return (fast
# path) and the Stripe webhook (backstop) call _enqueue_paid_session(), which is
# DEDUPE-GUARDED so a payment enqueues exactly once. Coords + item ride in the
# session metadata; email/name/company/job come from Stripe customer_details +
# custom_fields. Capture-on-delivery is handled later by the worker.
import json as _json

def _job_exists_for_pi(payment_intent):
    """Dedupe: has this payment_intent already produced a job?"""
    if not payment_intent:
        return False
    try:
        with _ps._conn() as c:
            r = c.execute("SELECT 1 FROM jobs WHERE payment_intent=? LIMIT 1",
                          (payment_intent,)).fetchone()
            return bool(r)
    except Exception:
        return False

def _enqueue_paid_session(sess):
    """Given a completed Stripe Checkout Session, create the project + enqueue the
    job + send the 'we're on it' email. Idempotent per payment_intent. Returns the
    project code, or None. ENQUEUE_STRIPEOBJ_V1: normalize Stripe objects to plain
    dicts so .get() works on nested fields."""
    try:
        # normalize Stripe object -> plain nested dict
        if hasattr(sess, 'to_dict'):
            sess = sess.to_dict()
        elif not isinstance(sess, dict):
            try:
                import json as _j
                sess = _j.loads(str(sess))
            except Exception:
                pass
        md = sess.get('metadata') or {}
        item = md.get('item')
        # MULTI_ITEM_V1: prefer the items list; fall back to single item
        _items_csv = md.get('items') or (item or '')
        _job_items = [x.strip() for x in _items_csv.split(',') if x.strip()] or ([item] if item else [])
        lat = md.get('lat'); lng = md.get('lng')
        if not item or lat is None or lng is None:
            return None
        pi = sess.get('payment_intent')
        if isinstance(pi, dict):
            pi = pi.get('id')
        if _job_exists_for_pi(pi):
            return None                      # already handled (dedupe)
        # customer details from Stripe (authoritative)
        cust = sess.get('customer_details') or {}
        email = cust.get('email')
        name  = cust.get('name')
        company = job_title = None
        for f in (sess.get('custom_fields') or []):
            key = f.get('key')
            val = (f.get('text') or {}).get('value')
            if key == 'company': company = val
            elif key == 'job':   job_title = val
        # build a "prepared for" string for the report cover
        prepared = name or ''
        if company:
            prepared = (prepared + ' / ' + company) if prepared else company
        # ADDON_FIX_V2: if checkout carried an existing project code, this is an
        # ADD-ON (e.g. DXF upsell from the /o/ page). The file already exists in the
        # project folder (generated with the report), so just capture + unlock +
        # email -- do NOT create a new project or regenerate.
        existing = (md.get('code') or '').strip()
        if existing and _ps.get_project(existing) is not None:
            try:
                if pi and str(pi).startswith('pi_'):
                    try:
                        _stripe.PaymentIntent.capture(pi)
                    except Exception:
                        pass
                _cents = _ps.catalog_price_cents(item)
                _ps.record_purchase(existing, item,
                                    (_cents/100.0) if _cents is not None else None)
                try:
                    import emailer
                    _to = email or (_ps.get_project(existing) or {}).get('email')
                    if _to:
                        emailer.send_ready(_to, existing, [item])
                except Exception:
                    pass
            except Exception:
                pass
            return existing
        # create the project NOW (born at authorization)
        code = _ps.new_code()
        _company  = md.get('company') or None   # API_JOBINFO_V1
        _job_name = md.get('job_name') or None
        _ps.save_project(float(lat), float(lng), 2226, {},
                         email=email, code=code,
                         address=(prepared or None),
                         company=_company, job_name=_job_name)
        # enqueue for the worker
        _ps.enqueue_job(code, float(lat), float(lng), _job_items,
                        payment_intent=pi, email=email)
        # "we're on it" email
        try:
            import emailer
            if email:
                emailer.send_received(email, code, _job_items)
        except Exception as _e:
            pass
        return code
    except Exception as _e:
        try:
            print('[enqueue] error: %s' % _e)
        except Exception:
            pass
        return None
# --- end ENQUEUE_HOOK_V1 ---------------------------------------------------

# --- ENQUEUE_WEBHOOK_V1: Stripe webhook (bulletproof backstop) --------------
@app.route('/stripe-webhook', methods=['POST'])
def stripe_webhook():
    """Stripe calls this server-to-server on payment events. On a completed/
    authorized checkout session we enqueue (dedupe-guarded). Verifies signature
    if a webhook secret is present."""
    payload = request.get_data()
    sig = request.headers.get('Stripe-Signature', '')
    secret = None
    try:
        with open('/opt/skygrid/.stripe_webhook_secret') as _f:
            secret = _f.read().strip()
    except Exception:
        secret = None
    key = _stripe_key()
    if key:
        _stripe.api_key = key
    event = None
    if secret:
        try:
            event = _stripe.Webhook.construct_event(payload, sig, secret)
        except Exception as e:
            return ('bad signature: %s' % e, 400)
    else:
        # no secret configured yet -> parse unverified (dev only)
        try:
            import json as _j
            event = _j.loads(payload.decode())
        except Exception:
            return ('bad payload', 400)
    etype = event.get('type') if isinstance(event, dict) else getattr(event, 'type', '')
    obj = (event.get('data') or {}).get('object') if isinstance(event, dict) else event['data']['object']
    if etype in ('checkout.session.completed', 'checkout.session.async_payment_succeeded'):
        # expand payment_intent id if needed
        try:
            code = _enqueue_paid_session(obj)
            print('[webhook] %s -> project %s' % (etype, code))
        except Exception as e:
            print('[webhook] enqueue error: %s' % e)
    return ('', 200)
# --- end ENQUEUE_WEBHOOK_V1 ------------------------------------------------




DB = "dbname=skygrid user=postgres password=skygrid2026 host=localhost"

def get_conn():
    return psycopg2.connect(DB)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'server': 'skygrid-server-1'})

@app.route('/fcc', methods=['GET'])
def fcc():
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
        radius_mi = float(request.args.get('radius', 50))
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT call_sign, lat, lng, h_agl, h_amsl, city, state, site_name,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography)/1609.34
            FROM fcc_towers
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, %s)
            ORDER BY 9 LIMIT 200
        """, (lng, lat, lng, lat, radius_mi * 1609.34))
        rows = cur.fetchall()
        cur.close(); conn.close()
        towers = [{'call_sign':r[0],'lat':r[1],'lng':r[2],'h_agl':r[3],'h_amsl':r[4],'city':r[5],'state':r[6],'site_name':r[7],'dist_mi':round(r[8],2)} for r in rows]
        return jsonify({'status':'ok','count':len(towers),'towers':towers})
    except Exception as e:
        return jsonify({'status':'error','message':str(e)}), 500

@app.route('/lidar', methods=['GET'])
def lidar():
    return jsonify({'status': 'ready', 'lat': request.args.get('lat'), 'lng': request.args.get('lng')})

@app.route('/test-img')
def test_img():
    from flask import send_file
    return send_file('/tmp/lidar_test.png', mimetype='image/png')


# ── SITE ALIGNMENT IMAGES — NAIP aerials matched to IMG_ALIGN ticks ─────
@app.route('/site-image-near')
def site_image_near():
    return _site_image(300)

@app.route('/site-image-far')
def site_image_far():
    return _site_image(1500)

def _site_image(rad_ft):
    """Return NAIP aerial PNG with bbox matching IMG_ALIGN tick corners.
    rad_ft = 300 (NEAR) or 1500 (FAR). Bbox is a square in feet centered on subject.
    Image edges = tick corner positions → ALIGN command in AutoCAD picks image corners."""
    import urllib.request as _ur
    from io import BytesIO
    from PIL import Image, ImageDraw
    import math
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
    except (TypeError, ValueError):
        return jsonify({'error': 'lat,lng required'}), 400

    # Convert radius in feet to degrees of lat/lng
    lat_deg_per_ft = 1.0 / 364000.0
    lng_deg_per_ft = 1.0 / (364000.0 * math.cos(math.radians(lat)))
    dlat = rad_ft * lat_deg_per_ft
    dlng = rad_ft * lng_deg_per_ft

    minLng = lng - dlng
    maxLng = lng + dlng
    minLat = lat - dlat
    maxLat = lat + dlat
    bbox = f"{minLng},{minLat},{maxLng},{maxLat}"

    # Google Static Maps — request zoom that covers MORE than needed, then crop precisely
    import os as _os
    METERS_PER_FOOT = 0.3048
    coverage_m = 2 * rad_ft * METERS_PER_FOOT
    PX_SIZE = 640
    mpp_needed = coverage_m / PX_SIZE
    zoom_exact = math.log2((156543.03 * math.cos(math.radians(lat))) / mpp_needed)
    # Round UP to zoom in MORE (smaller mpp = less coverage per pixel = tighter zoom)
    # We want a zoom that gives MORE pixel density than mpp_needed, so we crop to exact coverage
    zoom = max(0, min(21, int(round(zoom_exact))))

    api_key = _os.environ.get('GOOGLE_MAPS_API_KEY', '')
    if not api_key:
        return jsonify({'error': 'GOOGLE_MAPS_API_KEY not set in environment'}), 500

    url = (f"https://maps.googleapis.com/maps/api/staticmap"
           f"?center={lat},{lng}"
           f"&zoom={zoom}"
           f"&size={PX_SIZE}x{PX_SIZE}"
           f"&scale=2"
           f"&maptype=satellite"
           f"&key={api_key}")
    try:
        req = _ur.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with _ur.urlopen(req, timeout=30) as resp:
            img_bytes = resp.read()
    except Exception as e:
        return jsonify({'error': f'Google Static Maps fetch failed: {str(e)}'}), 502

    # Compute SPC convergence angle (rotation of SPC grid from true north)
    # Hardcoded CA Zone 2 (EPSG:2226) for now — generalize after verified
    try:
        from pyproj import CRS, Transformer
        crs_spc = CRS.from_epsg(2226)
        crs_wgs = CRS.from_epsg(4326)
        to_spc = Transformer.from_crs(crs_wgs, crs_spc, always_xy=True)
        # Point at subject and 0.001deg north of subject — diff gives grid north direction
        e0, n0 = to_spc.transform(lng, lat)
        e1, n1 = to_spc.transform(lng, lat + 0.001)
        # Grid north vector = (e1-e0, n1-n0). Angle from true north = atan2(dx, dy)
        grid_north_angle_deg = math.degrees(math.atan2(e1 - e0, n1 - n0))
        # Rotate image so SPC grid up points straight up
        rotation_deg = -grid_north_angle_deg
    except Exception as e:
        rotation_deg = 0.0

    # Draw thin white frame around image so alignment edges are unambiguous
    try:
        img = Image.open(BytesIO(img_bytes)).convert('RGB')

        # Crop image to exact tick coverage
        # Google delivered image covers more meters than we want — crop to subset that exactly fits ticks
        actual_mpp = (156543.03 * math.cos(math.radians(lat))) / (2 ** zoom)  # scale=2 doubles density not area
        want_m = 2 * rad_ft * 0.3048  # total meters we want (= 914.4m for FAR, 182.9m for NEAR)
        # Pixels in 1280-px image that span want_m
        want_px = int(round(want_m / actual_mpp * 2))  # ×2 because scale=2 doubled pixel count
        src_cx = img.size[0] // 2
        src_cy = img.size[1] // 2
        half = want_px // 2
        img = img.crop((src_cx - half, src_cy - half, src_cx + half, src_cy + half))

        # Rotate to align with SPC grid (negligible at CA latitudes)
        if abs(rotation_deg) > 0.01:
            img = img.rotate(rotation_deg, resample=Image.BICUBIC, expand=False, fillcolor=(0,0,0))
        draw = ImageDraw.Draw(img)
        W, H = img.size
        # Frame removed — no visual markers on image
        # Image returned clean — no frame, no corner ticks, no center mark.
        # Image edges = tick corners in CAD via ALIGN command.
        out = BytesIO()
        img.save(out, 'PNG', optimize=True)
        out.seek(0)
        from flask import make_response
        resp = make_response(out.getvalue())
        resp.headers['Content-Type'] = 'image/png'
        resp.headers['Content-Disposition'] = f'attachment; filename=skygrid_site_{rad_ft}ft.png'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        return resp
    except Exception as e:
        return jsonify({'error': f'image processing failed: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)

@app.route('/fcc-paths', methods=['GET'])
def fcc_paths():
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
        radius_ft = float(request.args.get('radius_ft', 1320))
        radius_m = radius_ft * 0.3048
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT p.tx_call, p.rx_call, p.tx_lat, p.tx_lng, p.rx_lat, p.rx_lng,
                   p.path_mi, p.path_type,
                   ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography) AS closest_ft
            FROM fcc_paths p
            WHERE ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, %s)
            ORDER BY closest_ft
            LIMIT 50
        """, (lng, lat, lng, lat, radius_m))
        rows = cur.fetchall()
        cur.close(); conn.close()
        paths = [{'tx_call':r[0],'rx_call':r[1],'tx_lat':r[2],'tx_lng':r[3],
                  'rx_lat':r[4],'rx_lng':r[5],'path_mi':round(r[6],1),
                  'path_type':r[7],'closest_ft':round(r[8]*3.28084)} for r in rows]
        return jsonify({'status':'ok','count':len(paths),'radius_ft':radius_ft,'paths':paths})
    except Exception as e:
        return jsonify({'status':'error','message':str(e)}), 500

@app.route('/elevation')
def elevation():
    try:
        lat = request.args.get('lat', type=float)
        lng = request.args.get('lng', type=float)
        if lat is None or lng is None:
            return jsonify({'error': 'lat/lng required'}), 400
        url = f'https://epqs.nationalmap.gov/v1/json?x={lng}&y={lat}&wkid=4326&units=Feet&includeDate=false'
        r = requests.get(url, timeout=10)
        d = r.json()
        val = d.get('value')
        if val is None or val == -1000000:
            return jsonify({'elev_ft': None})
        ft = round(float(val))
        return jsonify({'elev_ft': ft})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/dxf-preview', methods=['POST'])
def dxf_preview():
    try:
        import tempfile, os, base64, io
        import ezdxf
        from ezdxf.addons.drawing import RenderContext, Frontend
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        data = request.get_json()
        if not data or 'dxf' not in data:
            return jsonify({'error': 'dxf string required'}), 400

        dxf_str = data['dxf']
        fmt     = data.get('format', 'png')
        site_n  = data.get('site_n')
        site_e  = data.get('site_e')
        radius  = float(data.get('radius', 500))
        county_fips = data.get('county_fips', '00000')
        if str(county_fips).startswith('09') and len(str(county_fips)) == 5 and str(county_fips) not in ['09001','09003','09005','09007','09009','09011','09013','09015']: county_fips = '09003'

        HIDE_LAYERS = {
            'COUNTY_BOUNDARY','COUNTY_LABEL',
            'PLSS_TWP','PLSS_TWP_3D','PLSS_LABELS',
            'OTLS_GRID','OTLS_LABELS',
            'NORTH_ARROW','SITE_INFO','ELEV_LABELS',
            'IMG_ALIGN_NEAR','IMG_ALIGN_FAR'
        }

        with tempfile.NamedTemporaryFile(suffix='.dxf', mode='w', delete=False, encoding='utf-8') as f:
            f.write(dxf_str)
            tmp_dxf = f.name

        try:
            doc = ezdxf.readfile(tmp_dxf)
        except Exception as e:
            os.unlink(tmp_dxf)
            return jsonify({'error': 'DXF parse failed: ' + str(e)}), 400

        for layer_name in HIDE_LAYERS:
            try:
                layer = doc.layers.get(layer_name)
                if layer: layer.off()
            except: pass
            try:
                _hide = {'IMG_ALIGN_NEAR', 'IMG_ALIGN_FAR'}
                _msp_tmp = doc.modelspace()
                for _e in list(_msp_tmp.query('*')):
                    try:
                        if _e.dxf.layer in _hide: _msp_tmp.delete_entity(_e)
                    except: pass
            except: pass

        msp = doc.modelspace()

        fig = plt.figure(figsize=(17, 11), facecolor='white')
        ax  = fig.add_axes([0.04, 0.04, 0.92, 0.88])
        ax.set_aspect('equal')
        ax.axis('off')
        ax.set_facecolor('white')

        ctx = RenderContext(doc)
        ctx.current_layout_properties.set_colors(bg='#ffffff')
        out = MatplotlibBackend(ax)
        Frontend(ctx, out).draw_layout(msp, finalize=True)

        if site_n is not None and site_e is not None:
            sn, se = float(site_n), float(site_e)
            ax.set_xlim(se - radius, se + radius)
            ax.set_ylim(sn - radius, sn + radius)

        for spine in ax.spines.values():
            spine.set_visible(True)
            spine.set_linewidth(2)
            spine.set_edgecolor('#1e293b')

        fig.suptitle('TOPOSCOUT  SITE PLAN PREVIEW',
                    fontsize=8, fontfamily='monospace', color='#1e293b', y=0.97)

        buf = io.BytesIO()
        if fmt == 'pdf':
            fig.savefig(buf, format='pdf', bbox_inches='tight', facecolor='white', edgecolor='none')
            mime = 'application/pdf'
        else:
            fig.savefig(buf, format='png', dpi=180, bbox_inches='tight', facecolor='white', edgecolor='none')
            mime = 'image/png'

        plt.close(fig)
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode('utf-8')
        os.unlink(tmp_dxf)

        return jsonify({'status': 'ok', 'format': fmt, 'mime': mime, 'data': b64})

    except Exception as e:
        import traceback
        return jsonify({'error': str(e), 'trace': traceback.format_exc()}), 500


def _inject_layer_states_global(_dxf, _states, _lh, dxf_src=None):
    """Inject AutoCAD layer states XRECORD into DXF. dxf_src used for SURVEY color scan."""
    import re as _re
    if dxf_src is None: dxf_src = _dxf
    _all_h = _re.findall(r'\n  5\n([0-9A-Fa-f]+)\n', _dxf)
    _mx = max([int(h,16) for h in _all_h if h.strip()], default=0)
    def _nh():
        nonlocal _mx; _mx+=1; return format(_mx,'X')
    _ld = _nh(); _xh = {n:_nh() for n in _states}; _xd = {n:_nh() for n in _states}; _ld2 = _nh()
    _lb = f'  0\nDICTIONARY\n  5\n{_ld}\n330\n1\n100\nAcDbDictionary\n280\n     1\n281\n     1\n  3\nACAD_LAYERSTATES\n360\n{_ld2}\n'
    _lb += f'  0\nDICTIONARY\n  5\n{_ld2}\n102\n{{ACAD_REACTORS\n330\n{_ld}\n102\n}}\n330\n{_ld}\n100\nAcDbDictionary\n281\n     1\n'
    for _sn,_xv in _xh.items(): _lb += f'  3\n{_sn}\n350\n{_xv}\n'
    _xb = ''
    for _sn,_vis in _states.items():
        _xv=_xh[_sn]; _xdv=_xd[_sn]
        _xr = f'  0\nXRECORD\n  5\n{_xv}\n102\n{{ACAD_XDICTIONARY\n360\n{_xdv}\n102\n}}\n102\n{{ACAD_REACTORS\n330\n{_ld2}\n102\n}}\n330\n{_ld2}\n100\nAcDbXrecord\n280\n     1\n 91\n{67583:>8}\n301\n\n290\n     0\n'
        for _ln,_lhv in sorted(_lh.items()):
            if _ln in ('0','Defpoints'): continue
            _on = _ln in _vis; _fl = 8 if _on else 1
            _c=None; _lw=-3
            if _sn=='SURVEY':
                _lt_pat = f'\n  2\n{_ln}\n 70\n'
                _lt_idx = dxf_src.find(_lt_pat)
                if _lt_idx != -1:
                    _c62 = dxf_src.find('\n 62\n', _lt_idx)
                    _c6e = dxf_src.find('\n', _c62+5)
                    if _c62 != -1 and _c62 - _lt_idx < 200:
                        try: _c = int(dxf_src[_c62+5:_c6e].strip())
                        except: _c = None
                    _lw370 = dxf_src.find('\n370\n', _lt_idx)
                    _lw37e = dxf_src.find('\n', _lw370+6)
                    if _lw370 != -1 and _lw370 - _lt_idx < 200:
                        try:
                            _lw_raw = int(dxf_src[_lw370+6:_lw37e].strip())
                            _lw = _lw_raw if _lw_raw in [-3,0,5,9,13,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211] else -3
                        except: _lw = -3
            if _sn=='PRESENTATION':
                _pc={'BUILDINGS':(7,25),'ROADS_MAJOR':(8,30),'ROADS_LOCAL':(8,18),'ROADS_TRAIL':(9,13),'ROW_MAJOR':(9,13),'ROW_LOCAL':(9,9),'CL_MAJOR':(9,9),'CL_TRAIL':(6,9),'CL_LOCAL':(9,9),'CONTOUR_INDEX':(8,18),'CONTOUR_MAJOR':(253,13),'CONTOUR_MINOR':(254,9),'CONTOUR_1FT':(254,9),'ELEV_LABELS':(253,9),'COUNTY_BOUNDARY':(5,25),'COUNTY_LABEL':(5,9),'CIVIL_TWP':(5,18),'CIVIL_TWP_LABEL':(5,9),'HYDRO':(5,18),'NORTH_ARROW':(7,18),'SITE_INFO':(7,13),'ROAD_LABELS':(8,9),'BENCHMARKS':(7,25),'BM_LABELS':(7,9),'PLSS_SECTION':(8,13),'PLSS_TWP':(8,18),'PLSS_LABELS':(8,9),'PLSS_QQ':(9,9),'RAILROAD':(7,25),'POWER':(8,13),'PIPELINE':(8,13)}
                if _ln in _pc: _c,_lw=_pc[_ln]
                else: _fl=1
            elif _sn=='ARCHITECTURAL':
                _pc={'BUILDINGS':(7,25),'CIVIL_TWP':(8,9),'CL_LOCAL':(254,9),'CL_MAJOR':(253,13),'CL_TRAIL':(241,25),'CONTOUR_1FT':(41,9),'CONTOUR_INDEX':(40,13),'CONTOUR_MAJOR':(40,9),'CONTOUR_MINOR':(41,9),'COUNTY_BOUNDARY':(8,13),'ELEV_LABELS':(40,9),'HYDRO':(140,18),'LANDUSE':(7,9),'LEISURE':(7,9),'NATURAL':(7,9),'NORTH_ARROW':(7,18),'PIPELINE':(9,9),'PLSS_SECTION':(253,9),'PLSS_TWP':(253,9),'POWER':(9,9),'RAILROAD':(9,13),'ROAD_LABELS':(14,5),'ROADS_LOCAL':(253,13),'ROADS_MAJOR':(9,18),'ROADS_TRAIL':(254,9),'ROW_MAJOR':(253,9)}
                if _ln in _pc: _c,_lw=_pc[_ln]
                else: _fl=1
            elif _sn=='FIELD':
                _pc={'ROADS_MAJOR':(2,50),'ROADS_LOCAL':(2,30),'ROADS_TRAIL':(2,18),'ROW_MAJOR':(2,18),'CL_MAJOR':(2,18),'CL_LOCAL':(2,13),'CONTOUR_INDEX':(7,25),'CONTOUR_MAJOR':(8,18),'CONTOUR_MINOR':(9,9),'ELEV_LABELS':(7,13),'BENCHMARKS':(1,25),'BM_LABELS':(1,9),'CIVIL_TWP':(4,30),'CIVIL_TWP_LABEL':(4,13),'COUNTY_BOUNDARY':(4,18),'COUNTY_LABEL':(4,9),'HYDRO':(140,30),'NORTH_ARROW':(7,18),'SITE_INFO':(7,18),'ROAD_LABELS':(2,13),'PLSS_SECTION':(8,13),'PLSS_TWP':(8,18),'PLSS_LABELS':(8,9),'RAILROAD':(6,25),'POWER':(6,18),'PIPELINE':(6,13)}
                if _ln in _pc: _c,_lw=_pc[_ln]
                else: _fl=1
            _clr = f' 62\n{_c:>7}\n' if _c is not None else ''
            _TRANSP_MAP = {}
            if _sn=='ARCHITECTURAL':
                _TRANSP_MAP = {'CONTOUR_INDEX':33554559,'CONTOUR_MAJOR':33554559,'CONTOUR_MINOR':33554559,'CONTOUR_1FT':33554559,'BUILDINGS_SHADOW':33554559}
            _transp = _TRANSP_MAP.get(_ln, 0)
            _xr += f'302\n{_ln}\n330\n{_lhv}\n 90\n        {_fl}\n{_clr}370\n{_lw:>6}\n440\n{_transp:>9}\n'
        _xb += _xr
        _xb += f'  0\nDICTIONARY\n  5\n{_xdv}\n330\n{_xv}\n100\nAcDbDictionary\n281\n     1\n'
    _layer_tbl = '\n  2\nLAYER\n  5\n1\n'
    _xdict_inject = f'\n  2\nLAYER\n  5\n1\n102\n{{ACAD_XDICTIONARY\n360\n{_ld}\n102\n}}\n'
    if _layer_tbl in _dxf: _dxf = _dxf.replace(_layer_tbl, _xdict_inject, 1)
    _endsec = '\n  0\nENDSEC\n  0\nEOF\n'
    if _endsec in _dxf:
        _dxf = _dxf.replace(_endsec, '\n'+_lb+_xb.rstrip('\n')+'\n  0\nENDSEC\n  0\nEOF\n', 1)
    else:
        _eof = '\n  0\nEOF\n'
        if _eof in _dxf: _dxf = _dxf.replace(_eof, '\n'+_lb+_xb.rstrip('\n')+_eof, 1)
    return _dxf

@app.route('/generate-dxf', methods=['POST'])
def generate_dxf():
    try:
        import subprocess, base64, io, json, tempfile, os
        import ezdxf
        from ezdxf.addons.drawing import RenderContext, Frontend
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        data = request.get_json() or {}
        lat     = data.get('lat')
        lng     = data.get('lng')
        fmt     = data.get('format', 'both')  # dxf, png, or both
        site_n  = data.get('site_n')
        site_e  = data.get('site_e')
        radius  = float(data.get('radius', 500))
        county_fips = data.get('county_fips', '00000')
        if str(county_fips).startswith('09') and len(str(county_fips)) == 5 and str(county_fips) not in ['09001','09003','09005','09007','09009','09011','09013','09015']: county_fips = '09003'

        if not lat or not lng:
            return jsonify({'error': 'lat and lng required'}), 400

        # Fetch civil township server-side
        import requests as _req, json as _cjson, tempfile as _tf2
        _civil_twp_name = None
        _civil_twp_rings = []
        _NON_PLSS = {'09','10','13','15','21','23','24','25','33','34','36','37','42','44','45','47','50','51','54'}
        _state_fips = str(county_fips)[:2]
        if _state_fips in _NON_PLSS:
            try:
                _ct_url = f'https://skygrid-v31.netlify.app/.netlify/functions/civil-twp?lat={lat}&lng={lng}&state_fips={_state_fips}'
                _ct_res = _req.get(_ct_url, timeout=8)
                if _ct_res.ok:
                    _ct_data = _ct_res.json()
                    if _ct_data.get('found'):
                        _civil_twp_name = _ct_data.get('name')
                        _civil_twp_rings = _ct_data.get('rings', [])
            except Exception as _e:
                print('[generate-dxf] civil-twp fetch failed:', _e)
        _ctwp_f = f'/tmp/civil_twp_gen_{lat}_{lng}.json'
        with open(_ctwp_f, 'w') as _cf: _cjson.dump(_civil_twp_rings or [], _cf)
        # Run Node.js DXF generator
        result = subprocess.run(
            ['node', '/opt/skygrid/dxf/dxf-server.js', str(lat), str(lng), '5', str(county_fips), str(_civil_twp_name or ''), _ctwp_f],
            capture_output=True, text=True, timeout=120,
            cwd='/opt/skygrid/dxf'
        )

        if result.returncode != 0:
            return jsonify({'error': 'DXF generation failed', 'stderr': result.stderr[-500:]}), 500

        # Read generated DXF from temp file
        dxf_path = '/tmp/test_output.dxf'
        if not os.path.exists(dxf_path):
            return jsonify({'error': 'DXF output not found'}), 500

        # Add NEAR + FAR paperspace layouts before reading back
        import re as _re
        with open("/tmp/skygrid_layouts.log", "a") as _lf:
            _lf.write("=== call ===\n")
            _lf.write("stdout tail: " + (result.stdout or "")[-400:] + "\n")
        _site_E = None
        _site_N = None
        _m = _re.search(r'SPC:.*?"N"\s*:\s*([-\d.]+).*?"E"\s*:\s*([-\d.]+)', result.stdout or "")
        if _m:
            _site_N = float(_m.group(1))
            _site_E = float(_m.group(2))
        with open("/tmp/skygrid_layouts.log", "a") as _lf:
            _lf.write(f"regex match={_m is not None} site_E={_site_E} site_N={_site_N}\n")

        # Fallback: regex returned zeros -> use 48-state Node SPC router (single source of truth)
        if (not _site_E) or (not _site_N) or _site_E == 0 or _site_N == 0:
            try:
                _spc_cmd = ['node', '/opt/skygrid/dxf/spc_lookup.js',
                            str(lat), str(lng), str(county_fips)]
                _spc_run = subprocess.run(_spc_cmd, capture_output=True, text=True, timeout=10)
                if _spc_run.returncode == 0:
                    import json as _spcj
                    _spc_data = _spcj.loads(_spc_run.stdout.strip())
                    _site_E = float(_spc_data.get("E", 0))
                    _site_N = float(_spc_data.get("N", 0))
                    with open("/tmp/skygrid_layouts.log", "a") as _lf:
                        _lf.write(f"node spc fips={county_fips} zone={_spc_data.get('zone')} site_E={_site_E} site_N={_site_N}\n")
                else:
                    with open("/tmp/skygrid_layouts.log", "a") as _lf:
                        _lf.write(f"node spc failed rc={_spc_run.returncode} stderr={_spc_run.stderr[-200:]}\n")
            except Exception as _pe:
                with open("/tmp/skygrid_layouts.log", "a") as _lf:
                    _lf.write(f"node spc exception: {_pe}\n")

        if _site_E and _site_N and _site_E != 0:
            _layouts_path = "/tmp/test_output_layouts.dxf"
            _add = subprocess.run(
                ["python3", "/opt/skygrid/dxf/add_layouts.py", dxf_path, _layouts_path, str(_site_E), str(_site_N)],
                capture_output=True, text=True, timeout=60
            )
            with open("/tmp/skygrid_layouts.log", "a") as _lf:
                _lf.write(f"add_layouts rc={_add.returncode} stdout={_add.stdout.strip()} stderr={_add.stderr[-200:]}\n")
            if _add.returncode == 0 and os.path.exists(_layouts_path):
                dxf_path = _layouts_path

        with open(dxf_path, 'r', encoding='utf-8') as f:
            dxf_str = f.read()

        response = {'status': 'ok', 'dxf_len': len(dxf_str)}

        # Include DXF string if requested
        if fmt in ('dxf', 'both'):
            response['dxf_b64'] = base64.b64encode(dxf_str.encode('utf-8')).decode('utf-8')

        # Render PNG preview if requested
        if fmt in ('png', 'both'):
            HIDE_LAYERS = {
                'COUNTY_BOUNDARY','COUNTY_LABEL',
                'PLSS_TWP','PLSS_TWP_3D','PLSS_LABELS',
                'OTLS_GRID','OTLS_LABELS',
                'NORTH_ARROW','SITE_INFO','ELEV_LABELS',
                'IMG_ALIGN_NEAR','IMG_ALIGN_FAR'
            }
            with tempfile.NamedTemporaryFile(suffix='.dxf', mode='w', delete=False, encoding='utf-8') as tf:
                tf.write(dxf_str)
                tmp_dxf = tf.name

            doc = ezdxf.readfile(tmp_dxf)
            for ln in HIDE_LAYERS:
                try:
                    layer = doc.layers.get(ln)
                    if layer: layer.off()
                except: pass
                try:
                    _hide = {'IMG_ALIGN_NEAR', 'IMG_ALIGN_FAR'}
                    _msp_tmp = doc.modelspace()
                    for _e in list(_msp_tmp.query('*')):
                        try:
                            if _e.dxf.layer in _hide: _msp_tmp.delete_entity(_e)
                        except: pass
                except: pass

            msp = doc.modelspace()
            fig = plt.figure(figsize=(17, 11), facecolor='white')
            ax  = fig.add_axes([0.04, 0.04, 0.92, 0.88])
            ax.set_aspect('equal')
            ax.axis('off')
            ax.set_facecolor('white')
            ctx = RenderContext(doc)
            ctx.current_layout_properties.set_colors(bg='#ffffff')
            out = MatplotlibBackend(ax)
            Frontend(ctx, out).draw_layout(msp, finalize=True)

            if site_n and site_e:
                ax.set_xlim(float(site_e) - radius, float(site_e) + radius)
                ax.set_ylim(float(site_n) - radius, float(site_n) + radius)

            # Force road labels to black
            try:
                rl = doc.layers.get('ROAD_LABELS')
                if rl: rl.color = 7
            except: pass

            # Thick parcel outline + hatch
            if site_n and site_e:
                try:
                    from matplotlib.patches import Polygon as MPoly
                    from matplotlib.collections import PatchCollection
                    parcel_pts = []
                    for e in msp:
                        if e.dxf.layer == 'PARCEL' and e.dxftype() == 'LWPOLYLINE':
                            pts = [(p[0], p[1]) for p in e.get_points()]
                            if len(pts) > 2:
                                parcel_pts = pts
                                break
                    if parcel_pts:
                        poly = MPoly(parcel_pts, closed=True)
                        pc = PatchCollection([poly], facecolor='none',
                            edgecolor='#000000', linewidth=3, hatch='///', alpha=0.2)
                        ax.add_collection(pc)
                        xs = [p[0] for p in parcel_pts] + [parcel_pts[0][0]]
                        ys = [p[1] for p in parcel_pts] + [parcel_pts[0][1]]
                        ax.plot(xs, ys, color='#000000', linewidth=3, zorder=10)
                except Exception as pe:
                    print('[parcel]', pe)



            # Scale bar — bottom center using AnchoredSizeBar
            # Scale bar — draw after axis limits set
            try:
                from matplotlib.transforms import blended_transform_factory
                # Get current axis limits
                xl = ax.get_xlim(); yl = ax.get_ylim()
                xspan = xl[1]-xl[0]; yspan = yl[1]-yl[0]
                # Scale bar at bottom center
                sb_len = float(radius) * 0.5
                sb_cx = xl[0] + xspan*0.5
                sb_y  = yl[0] + yspan*0.04
                sb_x0 = sb_cx - sb_len/2
                sb_x1 = sb_cx + sb_len/2
                tick_h = yspan*0.015
                ax.plot([sb_x0,sb_x1],[sb_y,sb_y],'k-',lw=3,zorder=20)
                ax.plot([sb_x0,sb_x0],[sb_y-tick_h,sb_y+tick_h],'k-',lw=2,zorder=20)
                ax.plot([sb_x1,sb_x1],[sb_y-tick_h,sb_y+tick_h],'k-',lw=2,zorder=20)
                ax.text(sb_cx, sb_y-tick_h*2, str(int(sb_len))+' ft',
                    ha='center',va='top',fontsize=9,
                    fontfamily='monospace',color='black',zorder=20)
                ax.text(sb_x0, sb_y-tick_h*2, '0',
                    ha='center',va='top',fontsize=8,
                    fontfamily='monospace',color='black',zorder=20)
            except Exception as se:
                print('[scalebar]', se)

            for spine in ax.spines.values():
                spine.set_visible(True)
                spine.set_linewidth(2)
                spine.set_edgecolor('#1e293b')

            fig.suptitle('TOPOSCOUT  SITE PLAN PREVIEW',
                        fontsize=8, fontfamily='monospace', color='#1e293b', y=0.97)

            buf = io.BytesIO()
            fig.savefig(buf, format='png', dpi=180, bbox_inches='tight', facecolor='white', edgecolor='none')
            plt.close(fig)
            buf.seek(0)
            response['png_b64'] = base64.b64encode(buf.read()).decode('utf-8')
            os.unlink(tmp_dxf)

        return jsonify(response)

    except Exception as e:
        import traceback
        return jsonify({'error': str(e), 'trace': traceback.format_exc()}), 500

import threading, json as _json, os as _os

import uuid as _uuid
import json as _json_log
import os as _os_log

_dxf_jobs = {}  # in-memory job store: key=job_id, value={status, png_b64, meta}
_JOBS_LOG = '/opt/skygrid/logs/jobs.jsonl'
_os_log.makedirs('/opt/skygrid/logs', exist_ok=True)

def _log_job(record):
    try:
        with open(_JOBS_LOG, 'a') as f:
            f.write(_json_log.dumps(record) + '\n')
    except: pass

@app.route('/dxf-job-start', methods=['POST'])
def dxf_job_start():
    try:
        data = request.get_json() or {}
        lat    = data.get('lat')
        lng    = data.get('lng')
        county_fips     = data.get('county_fips', '00000')
        # CT uses planning regions (091xx) — remap to real county for SPC lookup
        if str(county_fips).startswith('09') and len(str(county_fips)) == 5 and str(county_fips) not in ['09001','09003','09005','09007','09009','09011','09013','09015']:
            county_fips = '09003'
        civil_twp_name  = data.get('civil_twp_name', None)
        civil_twp_rings = data.get('civil_twp_rings', None)
        site_n = data.get('site_n')
        site_e = data.get('site_e')
        scale  = float(data.get('scale', 100))   # map scale: 1"=scale feet
        radius = (17.0 / 2.0) * scale            # 17" wide figure, radius = half width
        # If SPC not provided, compute from lat/lng
        if (not site_n or not site_e) and lat and lng:
            try:
                import subprocess as _sp, json as _js
                _r = _sp.run(['node','-e',
                    f"const {{latLngToSPC}}=require('./spc-zones');const r=latLngToSPC({lat},{lng},'{county_fips}');console.log(JSON.stringify(r));"],
                    capture_output=True, text=True, timeout=10, cwd='/opt/skygrid/dxf')
                if _r.returncode == 0:
                    _spc = _js.loads(_r.stdout.strip())
                    site_n = _spc.get('N')
                    site_e = _spc.get('E')
            except Exception as _se:
                print('[SPC compute]', _se)
        if not lat or not lng:
            return jsonify({'error': 'lat and lng required'}), 400

        job_id = _uuid.uuid4().hex[:10]
        job_key = job_id
        _dxf_jobs[job_key] = {
            'status': 'pending',
            'lat': float(lat), 'lng': float(lng),
            'created': __import__('time').time()
        }
        _log_job({'job_id': job_id, 'lat': float(lat), 'lng': float(lng),
                  'status': 'started',
                  'ts': __import__('datetime').datetime.utcnow().isoformat()})

        def run_job():
            try:
                import subprocess, base64, io, tempfile
                import ezdxf
                from ezdxf.addons.drawing import RenderContext, Frontend
                from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
                import matplotlib
                matplotlib.use('Agg')
                import matplotlib.pyplot as plt

                import json as _cjson
                _ctwp_f = f'/tmp/civil_twp_{job_key}.json'
                with open(_ctwp_f,'w') as _cf: _cjson.dump(civil_twp_rings or [], _cf)
                _node_cmd = ['node', '/opt/skygrid/dxf/dxf-server.js', str(lat), str(lng), '5', str(county_fips), str(civil_twp_name or ''), _ctwp_f]
                result = subprocess.run(
                    _node_cmd,
                    capture_output=True, text=True, timeout=120,
                    cwd='/opt/skygrid/dxf'
                )
                if result.returncode != 0:
                    _dxf_jobs[job_key] = {'status': 'error', 'error': result.stderr[-200:]}
                    return

                dxf_path = f'/tmp/dxf_{job_key}.dxf'
                # Copy from Node output to unique path
                import shutil as _shutil
                _shutil.copy("/tmp/test_output.dxf", dxf_path)
                import json as _json
                try:
                    with open("/tmp/test_output_spc.json") as _sf:
                        _spc = _json.load(_sf)
                except: _spc = {}

                # Add NEAR + FAR paperspace layouts to the cached DXF
                try:
                    # Use 48-state Node SPC router (single source of truth)
                    _spc_run2 = subprocess.run(
                        ['node', '/opt/skygrid/dxf/spc_lookup.js',
                         str(lat), str(lng), str(county_fips)],
                        capture_output=True, text=True, timeout=10
                    )
                    if _spc_run2.returncode != 0:
                        raise Exception(f"spc_lookup failed: {_spc_run2.stderr[-200:]}")
                    import json as _spcj2
                    _spc_data2 = _spcj2.loads(_spc_run2.stdout.strip())
                    _jE = float(_spc_data2.get("E", 0))
                    _jN = float(_spc_data2.get("N", 0))
                    _layouts_path = f'/tmp/dxf_{job_key}_layouts.dxf'
                    _add_layouts = subprocess.run(
                        ['python3', '/opt/skygrid/dxf/add_layouts.py', dxf_path, _layouts_path, str(_jE), str(_jN)],
                        capture_output=True, text=True, timeout=60
                    )
                    if _add_layouts.returncode == 0 and __import__('os').path.exists(_layouts_path):
                        # Replace cached DXF with the version that has layouts
                        _shutil.move(_layouts_path, dxf_path)
                        with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                            _llf.write(f'[job-start] layouts added to {dxf_path}\n')
                    else:
                        with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                            _llf.write(f'[job-start] add_layouts failed rc={_add_layouts.returncode} stderr={_add_layouts.stderr[-200:]}\n')
                except Exception as _le:
                    with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                        _llf.write(f'[job-start] layout exception: {_le}\n')

                # Add NEAR + FAR paperspace layouts to the cached DXF
                try:
                    # Use 48-state Node SPC router (single source of truth)
                    _spc_run2 = subprocess.run(
                        ['node', '/opt/skygrid/dxf/spc_lookup.js',
                         str(lat), str(lng), str(county_fips)],
                        capture_output=True, text=True, timeout=10
                    )
                    if _spc_run2.returncode != 0:
                        raise Exception(f"spc_lookup failed: {_spc_run2.stderr[-200:]}")
                    import json as _spcj2
                    _spc_data2 = _spcj2.loads(_spc_run2.stdout.strip())
                    _jE = float(_spc_data2.get("E", 0))
                    _jN = float(_spc_data2.get("N", 0))
                    _layouts_path = f'/tmp/dxf_{job_key}_layouts.dxf'
                    _add_layouts = subprocess.run(
                        ['python3', '/opt/skygrid/dxf/add_layouts.py', dxf_path, _layouts_path, str(_jE), str(_jN)],
                        capture_output=True, text=True, timeout=60
                    )
                    if _add_layouts.returncode == 0 and __import__('os').path.exists(_layouts_path):
                        # Replace cached DXF with the version that has layouts
                        _shutil.move(_layouts_path, dxf_path)
                        with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                            _llf.write(f'[job-start] layouts added to {dxf_path}\n')
                    else:
                        with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                            _llf.write(f'[job-start] add_layouts failed rc={_add_layouts.returncode} stderr={_add_layouts.stderr[-200:]}\n')
                except Exception as _le:
                    with open('/tmp/skygrid_layouts.log', 'a') as _llf:
                        _llf.write(f'[job-start] layout exception: {_le}\n')
                with open(dxf_path, 'r', encoding='utf-8') as f:
                    dxf_str = f.read()

                HIDE_LAYERS = {
                    'COUNTY_BOUNDARY','COUNTY_LABEL',
                    'PLSS_TWP','PLSS_TWP_3D','PLSS_LABELS',
                    'OTLS_GRID','OTLS_LABELS',
                    'NORTH_ARROW','SITE_INFO','ELEV_LABELS',
                    'BENCHMARKS','BM_LABELS',
        'IMG_ALIGN_NEAR', 'IMG_ALIGN_FAR'
                }
                with tempfile.NamedTemporaryFile(suffix='.dxf', mode='w', delete=False, encoding='utf-8') as tf:
                    tf.write(dxf_str)
                    tmp_dxf = tf.name
                doc = ezdxf.readfile(tmp_dxf)
                for ln in HIDE_LAYERS:
                    try:
                        layer = doc.layers.get(ln)
                        if layer: layer.off()
                    except: pass
                try:
                    _hide = {'IMG_ALIGN_NEAR', 'IMG_ALIGN_FAR'}
                    _msp_tmp = doc.modelspace()
                    for _e in list(_msp_tmp.query('*')):
                        try:
                            if _e.dxf.layer in _hide: _msp_tmp.delete_entity(_e)
                        except: pass
                except: pass
                msp = doc.modelspace()

                # Layer color overrides for white background
                COLOR_MAP = {
                    'CL_MAJOR':      (30,30,30),
                    'CL_LOCAL':      (60,60,60),
                    'CL_TRAIL':      (120,120,120),
                    'ROAD_LABELS':   (0,0,0),
                    'BUILDINGS':     (80,80,80),
                    'CONTOUR_INDEX': (160,125,40),
                    'CONTOUR_1FT':   (200,170,100),
                    'CONTOUR_MAJOR': (175,138,55),
                    'NATURAL':       (26,110,168),
                    'LANDUSE':       (200,230,200),
                    'LEISURE':       (180,220,180),
                    'POWER':         (180,100,0),
                }
                for lname,(r,g,b) in COLOR_MAP.items():
                    try:
                        layer = doc.layers.get(lname)
                        if layer: layer.rgb = (r,g,b)
                    except: pass

                fig = plt.figure(figsize=(17, 11), facecolor='white')
                ax  = fig.add_axes([0.04, 0.04, 0.92, 0.88])
                ax.set_aspect('equal')
                ax.axis('off')
                ax.set_facecolor('white')

                # Aerial base at 20% opacity
                try:
                    import urllib.request as _ur2
                    from PIL import Image as _PI2
                    import io as _io3
                    import numpy as _np2
                    import math as _math2
                    _sn2 = float(site_n) if site_n else None
                    _se2 = float(site_e) if site_e else None
                    if _sn2 and _se2 and lat and lng:
                        _ra = radius * 1.1
                        _dlat2 = _ra / 364000.0
                        _dlng2 = _ra / (364000.0 * _math2.cos(float(lat)*3.14159/180))
                        _bb = f"{float(lng)-_dlng2},{float(lat)-_dlat2},{float(lng)+_dlng2},{float(lat)+_dlat2}"
                        _nu = f"https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage?bbox={_bb}&bboxSR=4326&size=1700,1100&imageSR=4326&format=jpg&pixelType=U8&noDataInterpretation=esriNoDataMatchAny&interpolation=+RSP_NearestNeighbor&f=image"
                        _rq2 = _ur2.Request(_nu, headers={'User-Agent':'Mozilla/5.0'})
                        with _ur2.urlopen(_rq2, timeout=15) as _rs2:
                            _ai = _PI2.open(_io3.BytesIO(_rs2.read())).convert('RGB')
                            ax.imshow(_ai, extent=[_se2-_ra, _se2+_ra, _sn2-_ra, _sn2+_ra],
                                     aspect='equal', alpha=0.30, zorder=0)
                except Exception as _ae2: print('[aerial]', _ae2)

                # Pink tree layer from NAIP vegetation mask
                try:
                    import urllib.request as _ur
                    from PIL import Image as _PILImage
                    import io as _io2
                    import numpy as _np
                    import math as _math
                    _sn = float(site_n) if site_n else None
                    _se = float(site_e) if site_e else None
                    if _sn and _se and lat and lng:
                        _r2 = radius * 1.1
                        _dlat = _r2 / 364000.0
                        _dlng = _r2 / (364000.0 * _math.cos(float(lat)*3.14159/180))
                        _bbox = f"{float(lng)-_dlng},{float(lat)-_dlat},{float(lng)+_dlng},{float(lat)+_dlat}"
                        _naip_url = f"https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage?bbox={_bbox}&bboxSR=4326&size=1700,1100&imageSR=4326&format=jpg&pixelType=U8&noDataInterpretation=esriNoDataMatchAny&interpolation=+RSP_NearestNeighbor&f=image"
                        _req = _ur.Request(_naip_url, headers={'User-Agent':'Mozilla/5.0'})
                        with _ur.urlopen(_req, timeout=15) as _resp:
                            _img = _PILImage.open(_io2.BytesIO(_resp.read())).convert('RGB')
                            _arr = _np.array(_img, dtype=float)
                            _r_ch = _arr[:,:,0]
                            _g_ch = _arr[:,:,1]
                            _b_ch = _arr[:,:,2]
                            # Vegetation mask — green dominant
                            _veg = (_g_ch > _r_ch * 1.05) & (_g_ch > _b_ch * 1.05) & (_g_ch > 60)
                            # Build RGBA image — pink only where vegetation
                            _h, _w = _arr.shape[:2]
                            _rgba = _np.zeros((_h, _w, 4), dtype=_np.uint8)
                            _rgba[_veg, 0] = 200  # R - pink
                            _rgba[_veg, 1] = 110  # G
                            _rgba[_veg, 2] = 120  # B
                            _rgba[_veg, 3] = 255  # A - opaque where veg
                            _tree_img = _PILImage.fromarray(_rgba, 'RGBA')
                            _r2y = _r2 * (1100/1700)
                            ax.imshow(_tree_img, extent=[_se-_r2, _se+_r2, _sn-_r2y, _sn+_r2y],
                                     aspect='equal', alpha=0.35, zorder=2)
                except Exception as _te: print('[trees]', _te)

                # Road surface layer — transparent bg, roads only
                try:
                    _roads = {'CL_MAJOR':[],'CL_LOCAL':[],'CL_TRAIL':[]}
                    for _e in msp:
                        if _e.dxf.layer in _roads and _e.dxftype()=='LWPOLYLINE':
                            _pts = [(_p[0],_p[1]) for _p in _e.get_points()]
                            if len(_pts)>1: _roads[_e.dxf.layer].append(_pts)
                    _pxft = (17.0 * 180.0 / 2.0) / radius
                    _rlw = {'CL_MAJOR':10,'CL_LOCAL':3,'CL_TRAIL':1.5}
                    _rcol = {'CL_MAJOR':'#5a5550','CL_LOCAL':'#7a7570','CL_TRAIL':'#8a8580'}
                    for _layer,_segs in _roads.items():
                        for _seg in _segs:
                            ax.plot([_p[0] for _p in _seg],[_p[1] for _p in _seg],
                                color=_rcol[_layer],linewidth=_rlw[_layer],
                                solid_capstyle='round',solid_joinstyle='round',
                                alpha=0.35,zorder=3)
                except Exception as _re: print('[roads]',_re)

                # Draw DXF
                ctx = RenderContext(doc)
                ctx.current_layout_properties.set_colors(bg='#ffffff')
                out = MatplotlibBackend(ax)
                Frontend(ctx, out).draw_layout(msp, finalize=True)

                # Zoom to site
                if site_n and site_e:
                    ax.set_xlim(float(site_e) - radius, float(site_e) + radius)
                    ax.set_ylim(float(site_n) - radius, float(site_n) + radius)

                # Thin all lines
                for collection in ax.collections:
                    try:
                        lw = collection.get_linewidth()
                        if lw is not None and len(lw) > 0 and lw[0] > 0.15:
                            collection.set_linewidth([min(lw[0], 0.08)])
                    except: pass

                # Building shadows — solar offset NW direction
                try:
                    import math as _sm
                    from matplotlib.patches import Polygon as _SPoly
                    from matplotlib.collections import PatchCollection as _SPC
                    # Solar azimuth ~135deg (SE sun) so shadows go NW (315deg)
                    _shadow_dist = 12.0  # feet
                    _shadow_az = 315.0   # degrees NW
                    _dx = _shadow_dist * _sm.sin(_sm.radians(_shadow_az))
                    _dy = _shadow_dist * _sm.cos(_sm.radians(_shadow_az))
                    _shadow_polys = []
                    for _e in msp:
                        if _e.dxf.layer == 'BUILDINGS' and _e.dxftype() == 'LWPOLYLINE':
                            _pts = [(_p[0],_p[1]) for _p in _e.get_points()]
                            if len(_pts) > 2:
                                _spts = [(_p[0]+_dx, _p[1]+_dy) for _p in _pts]
                                _shadow_polys.append(_SPoly(_spts, closed=True))
                    if _shadow_polys:
                        _shpc = _SPC(_shadow_polys, facecolor='#2a2820',
                            edgecolor='none', alpha=0.35, zorder=4)
                        ax.add_collection(_shpc)
                except Exception as _se2: print('[shadows]', _se2)

                # Building hatch
                try:
                    from matplotlib.patches import Polygon as _MPoly2
                    from matplotlib.collections import PatchCollection as _PC2
                    bps = []
                    for e in msp:
                        if e.dxf.layer == 'BUILDINGS' and e.dxftype() == 'LWPOLYLINE':
                            pts = [(p[0],p[1]) for p in e.get_points()]
                            if len(pts) > 2: bps.append(_MPoly2(pts, closed=True))
                    if bps:
                        ax.add_collection(_PC2(bps, facecolor='#aaaaaa', edgecolor='#444444',
                            linewidth=1.0, hatch='...', alpha=0.6, zorder=5))
                except Exception as be: print('[bldg]', be)

                # Custom BM symbols from browser payload
                try:
                    import matplotlib.patches as _mp2
                    _bms = data.get('benchmarks', [])
                    for _bm in _bms:
                        try:
                            _blat = float(_bm.get('lat',0))
                            _blng = float(_bm.get('lng',0))
                            _bpid = _bm.get('pid','')
                            if not _blat or not _blng: continue
                            # Convert lat/lng to SPC using same node script
                            import subprocess as _bsp, json as _bjs
                            _br = _bsp.run(['node','-e',
                                f"const {{latLngToSPC}}=require('./spc-zones');const r=latLngToSPC({_blat},{_blng},'{county_fips}');console.log(JSON.stringify(r));"],
                                capture_output=True,text=True,timeout=5,cwd='/opt/skygrid/dxf')
                            if _br.returncode==0:
                                _bspc = _bjs.loads(_br.stdout.strip())
                                _bx = float(_bspc.get('E',0))
                                _by = float(_bspc.get('N',0))
                                if _bx and _by:
                                    ax.add_patch(_mp2.Circle((_bx,_by),8,color='#cc0000',fill=False,linewidth=0.8,zorder=14))
                                    ax.plot([_bx-12,_bx+12],[_by,_by],color='#cc0000',linewidth=0.6,zorder=14)
                                    ax.plot([_bx,_bx],[_by-12,_by+12],color='#cc0000',linewidth=0.6,zorder=14)
                                    ax.text(_bx+14,_by+6,_bpid,fontsize=3.5,color='#8B0000',zorder=14,fontfamily='monospace')
                        except: pass
                except Exception as _bme2: print('[BM draw]',_bme2)
                # OLD BM symbols from DXF
                try:
                    import matplotlib.patches as _mp2
                    for e in msp:
                        if e.dxf.layer == 'BENCHMARKS':
                            try:
                                pt = None
                                if e.dxftype() == 'INSERT': pt = e.dxf.insert
                                elif e.dxftype() == 'POINT': pt = e.dxf.location
                                if pt:
                                    bx,by = float(pt[0]),float(pt[1])
                                    ax.add_patch(_mp2.Circle((bx,by), 8, color='#cc0000',
                                        fill=False, linewidth=0.8, zorder=12))
                                    ax.plot([bx-12,bx+12],[by,by], color='#cc0000', linewidth=0.6, zorder=12)
                                    ax.plot([bx,bx],[by-12,by+12], color='#cc0000', linewidth=0.6, zorder=12)
                            except: pass
                except Exception as bme: print('[BM sym]', bme)

                # Parcel outline
                try:
                    from matplotlib.patches import Polygon as _MPoly3
                    from matplotlib.collections import PatchCollection as _PC3
                    parcel_pts = []
                    for e in msp:
                        if e.dxf.layer == 'PARCEL' and e.dxftype() == 'LWPOLYLINE':
                            pts = [(p[0], p[1]) for p in e.get_points()]
                            if len(pts) > 2: parcel_pts = pts; break
                    if parcel_pts:
                        poly = _MPoly3(parcel_pts, closed=True)
                        ax.add_collection(_PC3([poly], facecolor='none',
                            edgecolor='#000000', linewidth=2.5, zorder=10))
                        xs = [p[0] for p in parcel_pts] + [parcel_pts[0][0]]
                        ys = [p[1] for p in parcel_pts] + [parcel_pts[0][1]]
                        ax.plot(xs, ys, color='#000000', linewidth=2.5, zorder=10)
                except Exception as pe: print('[parcel]', pe)

                for spine in ax.spines.values():
                    spine.set_visible(True)
                    spine.set_linewidth(2)
                    spine.set_edgecolor('#1e293b')

                fig.suptitle('TOPOSCOUT  SITE PLAN PREVIEW',
                    fontsize=8, fontfamily='monospace', color='#1e293b', y=0.97)

                buf = io.BytesIO()
                fig.savefig(buf, format='png', dpi=180, bbox_inches='tight', facecolor='white', edgecolor='none')
                plt.close(fig)
                buf.seek(0)
                png_b64 = base64.b64encode(buf.read()).decode('utf-8')
                import os
                os.unlink(tmp_dxf)

                                # Count layers for audit log
                try:
                    import ezdxf as _ezdxf2
                    _doc2 = _ezdxf2.readfile(dxf_path)
                    _msp2 = _doc2.modelspace()
                    _lyrs = {}
                    for _e in _msp2:
                        _l = _e.dxf.layer
                        _lyrs[_l] = _lyrs.get(_l, 0) + 1
                    _layer_count = len(_lyrs)
                    _osm_roads = _lyrs.get('CL_MAJOR',0) + _lyrs.get('CL_LOCAL',0)
                    _has_osm = _osm_roads > 0
                except: _layer_count=0; _osm_roads=0; _has_osm=False

                _dxf_jobs[job_key] = {'status': 'done', 'png_b64': png_b64,
                    'layer_count': _layer_count, 'osm_roads': _osm_roads, 'statePlane': _spc,
                    'dxf_path': dxf_path, 'lat': lat, 'lng': lng}
                # Write metadata to file for cross-worker access
                import json as _jmeta
                with open(f'/tmp/dxf_meta_{job_key}.json','w') as _mf:
                    _jmeta.dump({'status':'done','dxf_path':dxf_path,'lat':lat,'lng':lng}, _mf)
                _log_job({'job_id': job_key, 'status': 'done',
                    'layer_count': _layer_count, 'osm_roads': _osm_roads,
                    'has_osm': _has_osm,
                    'ts': __import__('datetime').datetime.utcnow().isoformat()})
                # DXF file kept for /dxf-download endpoint (auto-cleaned after 7 days)
                print('[DXF job] Done:', job_key, 'layers:', _layer_count, 'osm_roads:', _osm_roads)

            except Exception as e:
                import traceback
                _dxf_jobs[job_key] = {'status': 'error', 'error': str(e)}
                _log_job({'job_id': job_key, 'status': 'error', 'error': str(e)[:200],
                    'ts': __import__('datetime').datetime.utcnow().isoformat()})
                print('[DXF job] Error:', e)

        t = threading.Thread(target=run_job, daemon=True)
        t.start()

        return jsonify({'status': 'started', 'job_id': job_key, 'job_key': job_key})

    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/dxf-download', methods=['POST'])
@app.route('/dxf-download', methods=['POST'])
def dxf_download():
    """Serve pre-built DXF from job cache with ezdxf HATCH + raw layer states."""
    try:
        data = request.get_json() or {}
        job_id = data.get('job_id')
        if not job_id:
            return jsonify({'error': 'job_id required'}), 400
        job = _dxf_jobs.get(job_id)
        if not job:
            import json as _jdl, os as _odl
            meta_path = f'/tmp/dxf_meta_{job_id}.json'
            if _odl.path.exists(meta_path):
                with open(meta_path) as _mf: job = _jdl.load(_mf)
            else:
                return jsonify({'error': 'job not found'}), 404
        if job.get('status') != 'done':
            return jsonify({'error': 'job not ready', 'status': job.get('status')}), 202
        dxf_path = job.get('dxf_path')
        lat = float(job.get('lat', 39.0))
        if not dxf_path or not __import__('os').path.exists(dxf_path):
            return jsonify({'error': 'DXF file not found'}), 404
        # ── Step 1: ezdxf adds HATCH correctly ──
        import ezdxf, io, math, base64 as _b64dl
        _doc = ezdxf.readfile(dxf_path)
        _doc.header['$INSUNITS'] = 21  # US Survey Feet (SPC); was defaulting to 6 (meters) -- INSUNITS_FIX
        _msp = _doc.modelspace()
        # Sun angle
        _lat_r = math.radians(lat)
        _ha = math.radians(-30)
        _sin_alt = math.cos(_lat_r) * math.cos(_ha)
        _alt = math.asin(_sin_alt)
        _cos_az = (-math.sin(_lat_r) * _sin_alt) / (math.cos(_lat_r) * math.cos(_alt))
        _cos_az = max(-1, min(1, _cos_az))
        _sun_az = math.degrees(math.acos(_cos_az))
        _shad_az = (_sun_az + 180) % 360
        _sdx = math.sin(math.radians(_shad_az)) * 10.0
        _sdy = math.cos(math.radians(_shad_az)) * 10.0
        _blds = [e for e in _msp if e.dxf.layer=='BUILDINGS' and e.dxftype()=='LWPOLYLINE']
        for _bld in _blds:
            try:
                _pts = [(p[0],p[1]) for p in _bld.get_points()]
                if len(_pts)<3: continue
                if abs(_pts[0][0]-_pts[-1][0])<0.001 and abs(_pts[0][1]-_pts[-1][1])<0.001: _pts=_pts[:-1]
                if len(_pts)<3: continue
                _h=_msp.add_hatch(color=251,dxfattribs={'layer':'BUILDINGS_HATCH'})
                _h.paths.add_polyline_path(_pts,is_closed=True)
                _spts=[(x+_sdx,y+_sdy) for x,y in _pts]
                _sh=_msp.add_hatch(color=8,dxfattribs={'layer':'BUILDINGS_SHADOW'})
                _sh.set_pattern_fill('ANSI31',scale=5.0)
                _sh.paths.add_polyline_path(_spts,is_closed=True)
            except: pass
        _out = io.StringIO()
        _doc.write(_out)
        dxf_str = _out.getvalue()
        # ── Step 2: AC1027 + LWDISPLAY ──
        dxf_str = dxf_str.replace('\n  1\nAC1024\n', '\n  1\nAC1027\n', 1)
        dxf_str = dxf_str.replace('\n$LWDISPLAY\n290\n0\n', '\n$LWDISPLAY\n290\n1\n', 1)
        # ── Step 3: raw layer state injection ──
        _lns = dxf_str.split('\n'); _li = 0; _lh = {}
        while _li < len(_lns):
            if _lns[_li].strip()=='LAYER' and _li>0 and _lns[_li-1].strip()=='0':
                _h2=_n2=None
                for _j in range(_li,min(len(_lns),_li+20)):
                    if _lns[_j].strip()=='5' and not _h2 and _j+1<len(_lns): _h2=_lns[_j+1].strip()
                    if _lns[_j].strip()=='2' and not _n2 and _j+1<len(_lns): _n2=_lns[_j+1].strip()
                    if _h2 and _n2: break
                if _n2 and _h2: _lh[_n2]=_h2
            _li+=1
        _ALL=set(_lh.keys())-{'0','Defpoints'}
        _STATES={
            'SURVEY': _ALL-{'BUILDINGS_HATCH','BUILDINGS_SHADOW'},
            'PRESENTATION': {'BUILDINGS','CL_MAJOR','CL_LOCAL','CIVIL_TWP','CIVIL_TWP_LABEL','CONTOUR_INDEX','CONTOUR_MAJOR','COUNTY_BOUNDARY','COUNTY_LABEL','SITE_INFO','NORTH_ARROW','ROAD_LABELS','TICK_MARKS_OUTER','CL_TRAIL','BUILDINGS_HATCH','BUILDINGS_SHADOW','HYDRO','BENCHMARKS','BM_LABELS','PLSS_SECTION','PLSS_TWP','PLSS_LABELS','RAILROAD','POWER','PIPELINE','ROADS_LOCAL','ROADS_MAJOR','ROADS_TRAIL','ROW_MAJOR','ELEV_LABELS','CONTOUR_MINOR','CONTOUR_1FT'}&_ALL,
            'ARCHITECTURAL': {'BUILDINGS','CIVIL_TWP','CL_LOCAL','CL_MAJOR','CL_TRAIL','CONTOUR_1FT','CONTOUR_INDEX','CONTOUR_MAJOR','CONTOUR_MINOR','COUNTY_BOUNDARY','ELEV_LABELS','HYDRO','LANDUSE','LEISURE','NATURAL','NORTH_ARROW','PIPELINE','PLSS_SECTION','PLSS_TWP','POWER','RAILROAD','ROAD_LABELS','ROADS_LOCAL','ROADS_MAJOR','ROADS_TRAIL','ROW_MAJOR','TICK_MARKS_OUTER','TICK_MARKS_INNER','BUILDINGS_HATCH','BUILDINGS_SHADOW'}&_ALL,
            'FIELD': {'CL_MAJOR','CL_LOCAL','BENCHMARKS','BM_LABELS','SITE_INFO','NORTH_ARROW','CONTOUR_INDEX','CONTOUR_MAJOR','CIVIL_TWP','CIVIL_TWP_LABEL','COUNTY_BOUNDARY','TICK_MARKS_OUTER','TICK_MARKS_INNER'}&_ALL,
        }
        try:
            dxf_str = _inject_layer_states_global(dxf_str, _STATES, _lh)
        except Exception as _lse: print(f'[DL layer states] {_lse}')
        # HANDSEED fix after layer states
        _hs_f = '$HANDSEED' + chr(10) + '  5' + chr(10)
        _hs_i = dxf_str.find(_hs_f)
        if _hs_i > 0:
            _hs_s = _hs_i + len(_hs_f)
            _hs_e = dxf_str.find(chr(10), _hs_s)
            import re as _rhs3
            _bef = dxf_str[:_hs_i]; _aft = dxf_str[_hs_e:]
            _allh = _rhs3.findall(r'\n  5\n([0-9A-Fa-f]+)\n', _bef + _aft)
            _seed = format(max([int(h,16) for h in _allh if h.strip()], default=0) + 0x1000, 'X')
            dxf_str = _bef + _hs_f + _seed + _aft
        dxf_b64 = _b64dl.b64encode(dxf_str.encode('utf-8')).decode('utf-8')
        return jsonify({'status':'ok','dxf_b64':dxf_b64,'dxf_len':len(dxf_str)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/dxf-job-ready', methods=['GET'])
def dxf_job_ready():
    job_id = request.args.get('job_id')
    lat    = request.args.get('lat')
    lng    = request.args.get('lng')
    if job_id:
        job = _dxf_jobs.get(job_id, {'status': 'not_found'})
    elif lat and lng:
        job_key = str(round(float(lat),4)) + '_' + str(round(float(lng),4))
        job = _dxf_jobs.get(job_key, {'status': 'not_found'})
    else:
        return jsonify({'error': 'job_id or lat/lng required'}), 400
    return jsonify(job)


@app.route('/osm-query', methods=['GET'])
def osm_query():
    try:
        lat_min = float(request.args.get('lat_min'))
        lat_max = float(request.args.get('lat_max'))
        lng_min = float(request.args.get('lng_min'))
        lng_max = float(request.args.get('lng_max'))
        layers  = request.args.get('layers', 'roads,buildings,waterways').split(',')
    except Exception as e:
        return jsonify({'error': f'Bad params: {e}'}), 400
    if (lat_max - lat_min) > 0.1 or (lng_max - lng_min) > 0.1:
        return jsonify({'error': 'Bbox too large'}), 400
    import psycopg2, psycopg2.extras
    DB = {'dbname':'skygrid','user':'postgres','password':'skygrid2026','host':'localhost','port':5432}
    ENV = f"ST_Transform(ST_MakeEnvelope({lng_min},{lat_min},{lng_max},{lat_max},4326),3857)"
    QUERIES = {
        'roads':     f"SELECT name, highway, ST_AsGeoJSON(ST_Transform(way,4326))::json as geometry FROM planet_osm_line WHERE ST_Intersects(way,{ENV}) AND highway IS NOT NULL LIMIT 2000",
        'buildings': f"SELECT name, building, ST_AsGeoJSON(ST_Transform(way,4326))::json as geometry FROM planet_osm_polygon WHERE ST_Intersects(way,{ENV}) AND building IS NOT NULL LIMIT 1000",
        'waterways': f"SELECT name, waterway, ST_AsGeoJSON(ST_Transform(way,4326))::json as geometry FROM planet_osm_line WHERE ST_Intersects(way,{ENV}) AND waterway IS NOT NULL LIMIT 500",
        'power':     f"SELECT name, power, ST_AsGeoJSON(ST_Transform(way,4326))::json as geometry FROM planet_osm_line WHERE ST_Intersects(way,{ENV}) AND power IS NOT NULL LIMIT 200",
        'railway':   f"SELECT name, railway, ST_AsGeoJSON(ST_Transform(way,4326))::json as geometry FROM planet_osm_line WHERE ST_Intersects(way,{ENV}) AND railway IS NOT NULL LIMIT 200",
    }
    result = {}
    try:
        conn = psycopg2.connect(**DB)
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for layer in layers:
            layer = layer.strip()
            if layer not in QUERIES:
                continue
            cur.execute(QUERIES[layer])
            rows = cur.fetchall()
            features = []
            for row in rows:
                geom = row.get('geometry')
                if not geom:
                    continue
                props = {k: v for k, v in row.items() if k != 'geometry'}
                features.append({'type':'Feature','geometry':geom,'properties':props})
            result[layer] = {'type':'FeatureCollection','features':features}
        cur.close()
        conn.close()
    except Exception as e:
        return jsonify({'error': f'DB error: {str(e)}'}), 500
    return jsonify(result)

@app.route('/spc', methods=['GET'])
def spc_endpoint():
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
        fips = request.args.get('fips', '00000')
        result = subprocess.run(
            ['node', '-e', f"""
const {{latLngToSPC}} = require('./spc-zones');
const r = latLngToSPC({lat}, {lng}, '{fips}');
console.log(JSON.stringify(r));
"""],
            capture_output=True, text=True, timeout=10,
            cwd='/opt/skygrid/dxf'
        )
        if result.returncode != 0:
            return jsonify({{'error': result.stderr}}), 500
        import json
        data = json.loads(result.stdout.strip())
        return jsonify({{'status': 'ok', 'E': data.get('E'), 'N': data.get('N'), 'zone': data.get('zone'), 'fipsZone': data.get('fipsZone'), 'intlFeet': data.get('intlFeet')}})
    except Exception as e:
        return jsonify({{'error': str(e)}}), 500

@app.route('/spc2', methods=['GET'])
def spc_endpoint2():
    import subprocess, json
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
        fips = request.args.get('fips', '00000')
        script = "const {latLngToSPC}=require('./spc-zones');const r=latLngToSPC(" + str(lat) + "," + str(lng) + ",'" + fips + "');console.log(JSON.stringify(r));"
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=10, cwd='/opt/skygrid/dxf')
        if result.returncode != 0:
            return jsonify({'error': result.stderr}), 500
        data = json.loads(result.stdout.strip())
        return jsonify({'status': 'ok', 'E': data.get('E'), 'N': data.get('N'), 'zone': data.get('zone'), 'fipsZone': data.get('fipsZone'), 'intlFeet': data.get('intlFeet')})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/control', methods=['GET'])
def control_endpoint():
    import psycopg2, math
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
        radius_mi = float(request.args.get('radius', 50))
        radius_m = radius_mi * 1609.34

        DB = "host=localhost dbname=skygrid user=postgres password=skygrid2026"
        conn = psycopg2.connect(DB)
        cur = conn.cursor()

        cur.execute("""
            SELECT station_id, lat, lng, elev_m,
                   ST_Distance(geom::geography, ST_MakePoint(%s,%s)::geography)/1609.34 AS dist_mi,
                   url
            FROM ngs_cors
            WHERE ST_DWithin(geom::geography, ST_MakePoint(%s,%s)::geography, %s)
            ORDER BY dist_mi LIMIT 6
        """, (lng, lat, lng, lat, radius_m))
        cors_rows = cur.fetchall()
        cors_stations = [{'id': r[0], 'lat': r[1], 'lng': r[2], 'elevFt': round(r[3]*3.28084) if r[3] else None, 'dist': round(r[4],1), 'url': r[5], 'name': r[0], 'source': 'PostGIS'} for r in cors_rows]

        cur.execute("""
            SELECT pid, name, ortho_ht, dec_lat, dec_lon,
                   ST_Distance(geom::geography, ST_MakePoint(%s,%s)::geography)/1609.34 AS dist_mi,
                   vert_order
            FROM ngs_benchmarks
            WHERE ST_DWithin(geom::geography, ST_MakePoint(%s,%s)::geography, %s)
            AND ortho_ht IS NOT NULL AND ortho_ht != ''
            ORDER BY dist_mi LIMIT 8
        """, (lng, lat, lng, lat, radius_m))
        bm_rows = cur.fetchall()
        benchmarks = [{'pid': r[0], 'name': r[1], 'elev': f"{r[2]}m / {round(float(r[2])*3.28084,1)}ft NAVD88" if r[2] else 'N/A', 'dist': round(r[5],1), 'lat': r[3], 'lng': r[4], 'url': f"https://www.ngs.noaa.gov/cgi-bin/ds_mark.prl?PidBox={r[0]}", 'order': (r[6].strip() if len(r) > 6 and r[6] and str(r[6]).strip() else '\u2014'), 'source': 'PostGIS'} for r in bm_rows]

        cur.close()
        conn.close()
        return jsonify({'corsStations': cors_stations, 'benchmarks': benchmarks, 'source': 'postgis'})
    except Exception as e:
        return jsonify({'error': str(e), 'corsStations': [], 'benchmarks': []}), 500

@app.route('/igs-anchors', methods=['GET'])
def igs_anchors():
    import psycopg2, json
    try:
        conn = psycopg2.connect(host='localhost', dbname='skygrid', user='postgres', password='skygrid2026')
        cur = conn.cursor()
        cur.execute("""
            SELECT station_id, country, lat, lon, alt_m, ecef_x, ecef_y, ecef_z
            FROM igs_stations
            WHERE ecef_x IS NOT NULL
            ORDER BY station_id
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        stations = [{'id':r[0],'country':r[1],'lat':r[2],'lon':r[3],'alt_m':r[4],'ecef':[r[5],r[6],r[7]]} for r in rows]
        return app.response_class(
            response=json.dumps({'count':len(stations),'source':'PostGIS igs_stations','stations':stations}),
            status=200, mimetype='application/json'
        )
    except Exception as e:
        return app.response_class(response=json.dumps({'error':str(e)}),status=500,mimetype='application/json')
