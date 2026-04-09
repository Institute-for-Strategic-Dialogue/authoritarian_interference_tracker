"""AIT Public Frontend — fetches from Incident Manager API, serves visualizations."""

import os
import time
from collections import Counter, defaultdict
from datetime import datetime, date
from io import BytesIO, StringIO

import httpx
import pandas as pd
from flask import (
    Flask, Response, jsonify, redirect, render_template, request,
    send_file, session, url_for,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

IM_URL = os.environ.get("INCIDENT_MANAGER_URL", "http://localhost:6003")
REVIEW_UI_URL = os.environ.get("REVIEW_UI_URL", "http://localhost:6004")

# Persistent HTTP client — reuses connections instead of leaking them
_http_client = httpx.Client(timeout=30.0, limits=httpx.Limits(max_connections=10, max_keepalive_connections=5))

# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

TOOL_DISPLAY = {
    "cyber_operations": "Cyber Operations",
    "kinetic_operations": "Kinetic Operations",
    "information_manipulation": "Information Operations",
    "malign_finance": "Malign Finance",
    "civil_society_subversion": "Civil Society Subversion",
    "economic_coercion": "Economic Coercion",
}

ACTOR_DISPLAY = {
    "russia": "Russia", "china": "China", "iran": "Iran",
    "north_korea": "North Korea", "belarus": "Belarus",
}

COUNTRY_NAMES = {
    "AL": "Albania", "AT": "Austria", "AU": "Australia", "BA": "Bosnia and Herzegovina",
    "BE": "Belgium", "BG": "Bulgaria", "BY": "Belarus", "CA": "Canada",
    "CH": "Switzerland", "CY": "Cyprus", "CZ": "Czech Republic", "DE": "Germany",
    "DK": "Denmark", "EE": "Estonia", "ES": "Spain", "FI": "Finland",
    "FR": "France", "GB": "United Kingdom", "GE": "Georgia", "GR": "Greece",
    "HR": "Croatia", "HU": "Hungary", "IE": "Ireland", "IS": "Iceland",
    "IT": "Italy", "LT": "Lithuania", "LU": "Luxembourg", "LV": "Latvia",
    "MD": "Moldova", "ME": "Montenegro", "MK": "North Macedonia", "MT": "Malta",
    "NL": "Netherlands", "NO": "Norway", "NZ": "New Zealand", "PL": "Poland",
    "PT": "Portugal", "RO": "Romania", "RS": "Serbia", "SE": "Sweden",
    "SI": "Slovenia", "SK": "Slovakia", "TR": "Turkey", "UA": "Ukraine",
    "US": "United States", "XK": "Kosovo",
    "AE": "United Arab Emirates", "AF": "Afghanistan", "AM": "Armenia",
    "AZ": "Azerbaijan", "BR": "Brazil", "CN": "China", "EG": "Egypt",
    "ID": "Indonesia", "IQ": "Iraq", "IR": "Iran", "JP": "Japan",
    "KP": "North Korea", "KR": "South Korea", "KZ": "Kazakhstan",
    "MX": "Mexico", "PK": "Pakistan", "RU": "Russia", "SA": "Saudi Arabia",
    "SG": "Singapore", "SY": "Syria", "TW": "Taiwan", "UZ": "Uzbekistan",
    "VN": "Vietnam", "ZA": "South Africa",
}

COUNTRY_CENTROIDS = {
    "Albania": {"lat": 41.15, "lon": 20.17}, "Austria": {"lat": 47.52, "lon": 14.55},
    "Australia": {"lat": -25.27, "lon": 133.78}, "Bosnia and Herzegovina": {"lat": 43.92, "lon": 17.68},
    "Belgium": {"lat": 50.50, "lon": 4.47}, "Bulgaria": {"lat": 42.73, "lon": 25.49},
    "Belarus": {"lat": 53.71, "lon": 27.95}, "Canada": {"lat": 56.13, "lon": -106.35},
    "Switzerland": {"lat": 46.82, "lon": 8.23}, "Cyprus": {"lat": 35.13, "lon": 33.43},
    "Czech Republic": {"lat": 49.82, "lon": 15.47}, "Germany": {"lat": 51.17, "lon": 10.45},
    "Denmark": {"lat": 56.26, "lon": 9.50}, "Estonia": {"lat": 58.60, "lon": 25.01},
    "Spain": {"lat": 40.46, "lon": -3.75}, "Finland": {"lat": 61.92, "lon": 25.75},
    "France": {"lat": 46.23, "lon": 2.21}, "United Kingdom": {"lat": 55.38, "lon": -3.44},
    "Georgia": {"lat": 42.32, "lon": 43.36}, "Greece": {"lat": 39.07, "lon": 21.82},
    "Croatia": {"lat": 45.10, "lon": 15.20}, "Hungary": {"lat": 47.16, "lon": 19.50},
    "Ireland": {"lat": 53.14, "lon": -7.69}, "Iceland": {"lat": 64.96, "lon": -19.02},
    "Italy": {"lat": 41.87, "lon": 12.57}, "Lithuania": {"lat": 55.17, "lon": 23.88},
    "Luxembourg": {"lat": 49.82, "lon": 6.13}, "Latvia": {"lat": 56.88, "lon": 24.60},
    "Moldova": {"lat": 47.41, "lon": 28.37}, "Montenegro": {"lat": 42.71, "lon": 19.37},
    "North Macedonia": {"lat": 41.51, "lon": 21.75}, "Malta": {"lat": 35.94, "lon": 14.38},
    "Netherlands": {"lat": 52.13, "lon": 5.29}, "Norway": {"lat": 60.47, "lon": 8.47},
    "New Zealand": {"lat": -40.90, "lon": 174.89}, "Poland": {"lat": 51.92, "lon": 19.15},
    "Portugal": {"lat": 39.40, "lon": -8.22}, "Romania": {"lat": 45.94, "lon": 24.97},
    "Serbia": {"lat": 44.02, "lon": 21.01}, "Sweden": {"lat": 60.13, "lon": 18.64},
    "Slovenia": {"lat": 46.15, "lon": 14.99}, "Slovakia": {"lat": 48.67, "lon": 19.70},
    "Turkey": {"lat": 38.96, "lon": 35.24}, "Ukraine": {"lat": 48.38, "lon": 31.17},
    "United States": {"lat": 37.09, "lon": -95.71}, "Kosovo": {"lat": 42.60, "lon": 20.90},
}

REGION_GROUPS = {
    "EU": ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE",
           "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"],
    "NATO": ["AL","BE","BG","CA","HR","CZ","DK","EE","FR","DE","GR","HU","IS","IT",
             "LV","LT","LU","ME","NL","MK","NO","PL","PT","RO","SK","SI","ES","TR",
             "GB","US"],
    "OSCE": ["AL","AT","BA","BE","BG","CA","CH","CY","CZ","DE","DK","EE","ES","FI",
             "FR","GB","GE","GR","HR","HU","IE","IS","IT","LT","LU","LV","MD","ME",
             "MK","MT","NL","NO","NZ","PL","PT","RO","RS","SE","SI","SK","TR","UA","US"],
    "Five Eyes": ["AU","CA","GB","NZ","US"],
    "Europe": ["AL","AT","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI",
               "FR","GB","GE","GR","HR","HU","IE","IS","IT","LT","LU","LV","MD","ME",
               "MK","MT","NL","NO","PL","PT","RO","RS","SE","SI","SK","TR","UA","XK"],
    "North America": ["US","CA"],
}

# ---------------------------------------------------------------------------
# Caches (avoid hitting IM API on every request)
# ---------------------------------------------------------------------------

# Stats cache — context processor hits this on every page load
_stats_cache = {"data": None, "ts": 0}
STATS_CACHE_TTL = 120  # seconds


def _fetch_stats() -> dict:
    """Cached stats fetch for the context processor."""
    now = time.time()
    if _stats_cache["data"] is not None and (now - _stats_cache["ts"]) < STATS_CACHE_TTL:
        return _stats_cache["data"]
    try:
        resp = _http_client.get(f"{IM_URL}/incidents/stats")
        resp.raise_for_status()
        _stats_cache["data"] = resp.json()
        _stats_cache["ts"] = now
    except Exception:
        pass
    return _stats_cache["data"] or {}


# Incident data cache

_cache = {"data": None, "ts": 0}
CACHE_TTL = 60  # seconds


def _fetch_all_incidents() -> list[dict]:
    """Fetch all approved non-hidden incidents from Incident Manager, with caching."""
    now = time.time()
    if _cache["data"] is not None and (now - _cache["ts"]) < CACHE_TTL:
        return _cache["data"]

    try:
        resp = _http_client.get(
            f"{IM_URL}/incidents/export",
            params={"status": "approved"},
        )
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        app.logger.error(f"Failed to fetch incidents: {e}")
        return _cache["data"] or []

    incidents = []
    for inc in raw:
        if inc.get("hidden"):
            continue
        incidents.append(_transform(inc))

    # Sort reverse chronological
    incidents.sort(key=lambda x: x.get("start_year") or 0, reverse=True)

    _cache["data"] = incidents
    _cache["ts"] = now
    return incidents


def _transform(inc: dict) -> dict:
    """Transform an Incident Manager API response into frontend format."""
    actors = [ACTOR_DISPLAY.get(a, a.title()) for a in (inc.get("threat_actors") or [])]
    countries = [COUNTRY_NAMES.get(c, c) for c in (inc.get("target_countries") or [])]
    tools = [TOOL_DISPLAY.get(t, t.replace("_", " ").title()) for t in (inc.get("incident_types") or [])]

    start_date = inc.get("start_date")
    end_date = inc.get("end_date")
    start_year = int(start_date[:4]) if start_date else None
    end_year = int(end_date[:4]) if end_date else None

    return {
        "id": inc.get("id"),
        "title": inc.get("title", ""),
        "summary": inc.get("summary", ""),
        "slug": _slugify(inc.get("title", "")),
        "actors": actors,
        "countries": countries,
        "country_codes": inc.get("target_countries") or [],
        "tools": tools,
        "start_year": start_year,
        "end_year": end_year,
        "date_display": _date_display(start_year, end_year),
        "source_urls": inc.get("source_urls") or [],
        "source_count": inc.get("source_count", 0),
        "confidence_score": inc.get("confidence_score"),
        "campaign_name": inc.get("campaign_name"),
        "attribution_basis": inc.get("attribution_basis"),
        "review_status": inc.get("review_status"),
        "source": inc.get("source"),
        "ttps": inc.get("ttps") or [],
        "entities": inc.get("entities") or [],
    }


def _date_display(start_year, end_year):
    if start_year and end_year:
        return f"{start_year} — {end_year}" if start_year != end_year else str(start_year)
    if start_year:
        return f"{start_year} — ongoing"
    return "Unknown"


def _slugify(s):
    import re
    s = s.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    return s.strip("-")[:80]


def _year_range(start_year, end_year):
    """Return list of years an incident spans (for volume-over-time)."""
    current_year = datetime.now().year
    s = start_year or current_year
    e = end_year or current_year
    return list(range(s, e + 1))


def _filter_incidents(incidents, filters):
    out = []
    for inc in incidents:
        if filters.get("q"):
            entity_names = " ".join(e.get("name", "") for e in (inc.get("entities") or []))
            hay = f"{inc['title']} {inc['summary']} {entity_names}".lower()
            if filters["q"].lower() not in hay:
                continue
        if filters.get("entities"):
            inc_entity_names = {e.get("normalized_name", e.get("name", "")).lower() for e in (inc.get("entities") or [])}
            if not any(en.lower() in inc_entity_names for en in filters["entities"]):
                continue
        if filters.get("actors"):
            if not set(inc["actors"]).intersection(filters["actors"]):
                continue
        if filters.get("countries"):
            if not set(inc["countries"]).intersection(filters["countries"]):
                continue
        if filters.get("tools"):
            if not set(inc["tools"]).intersection(filters["tools"]):
                continue
        if filters.get("start"):
            if (inc["start_year"] or 9999) < filters["start"]:
                continue
        if filters.get("end"):
            if (inc["start_year"] or 0) > filters["end"]:
                continue
        if filters.get("region"):
            region_codes = set(REGION_GROUPS.get(filters["region"], []))
            if not set(inc.get("country_codes", [])).intersection(region_codes):
                continue
        out.append(inc)
    return out


def _collect_meta(incidents):
    actors, countries, tools, years = Counter(), Counter(), Counter(), Counter()
    for inc in incidents:
        for a in inc["actors"]: actors[a] += 1
        for c in inc["countries"]: countries[c] += 1
        for t in inc["tools"]: tools[t] += 1
        if inc["start_year"]: years[inc["start_year"]] += 1
    return {
        "actors": sorted(actors.items(), key=lambda x: (-x[1], x[0])),
        "countries": sorted(countries.items(), key=lambda x: (-x[1], x[0])),
        "tools": sorted(tools.items(), key=lambda x: (-x[1], x[0])),
        "years": sorted(years.items()),
        "regions": list(REGION_GROUPS.keys()),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    is_admin = session.get("admin", False)
    return render_template("index.html", is_admin=is_admin)


@app.route("/api/config")
def api_config():
    return jsonify({
        "colors": {
            "primary": "#C7074D",
            "accent_orange": "#E76863", "accent_yellow": "#D4A843",
            "accent_green": "#3A8A6E", "accent_teal": "#2B7A6B",
            "accent_lightblue": "#5B9FCC", "accent_blue": "#0068B2",
            "accent_purple": "#4C4193", "accent_pink": "#D4587A",
            "ta_russia": "#0068B2", "ta_china": "#C7074D",
        },
        "actor_palette": {
            "Russia": "#0068B2", "China": "#C7074D",
            "Iran": "#3A8A6E", "North Korea": "#D4A843",
            "Belarus": "#5C6771", "Other": "#B4B2B1", "Unknown": "#B4B2B1",
        },
    })


@app.route("/api/meta")
def api_meta():
    incidents = _fetch_all_incidents()
    return jsonify(_collect_meta(incidents))


@app.route("/api/incidents")
def api_incidents():
    start_raw = request.args.get("start")
    end_raw = request.args.get("end")

    def parse_multi(name):
        v = request.args.get(name, "").strip()
        return [s.strip() for s in v.split(",") if s.strip()] if v else []

    filters = {
        "start": int(start_raw) if start_raw else None,
        "end": int(end_raw) if end_raw else None,
        "actors": parse_multi("actors"),
        "countries": parse_multi("countries"),
        "tools": parse_multi("tools"),
        "entities": parse_multi("entities"),
        "q": request.args.get("q", "").strip() or None,
        "region": request.args.get("region", "").strip() or None,
    }

    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, int(request.args.get("page_size", 25)))

    all_incidents = _fetch_all_incidents()
    filtered = _filter_incidents(all_incidents, filters)

    # --- Volume over time (replaces heatmap) ---
    vol = defaultdict(lambda: defaultdict(int))
    for inc in filtered:
        years = _year_range(inc["start_year"], inc["end_year"])
        for y in years:
            for a in (inc["actors"] or ["Unknown"]):
                vol[y][a] += 1
    volume_rows = [{"year": y, "actor": a, "count": c}
                   for y, bucket in sorted(vol.items()) for a, c in bucket.items()]

    # --- Stacked bar: tools x actor ---
    tba = defaultdict(lambda: defaultdict(int))
    for inc in filtered:
        for t in (inc["tools"] or ["Unspecified"]):
            for a in (inc["actors"] or ["Unknown"]):
                tba[t][a] += 1
    stacked_rows = [{"tool": t, "actor": a, "count": c}
                    for t, bucket in tba.items() for a, c in bucket.items()]

    # --- Country x actor (for map) ---
    cxa = defaultdict(lambda: defaultdict(int))
    for inc in filtered:
        for c in (inc["countries"] or []):
            for a in (inc["actors"] or ["Unknown"]):
                cxa[c][a] += 1
    country_rows = [{"country": c, "actor": a, "count": cnt}
                    for c, bucket in cxa.items() for a, cnt in bucket.items()]

    # Pagination
    total = len(filtered)
    start_idx = (page - 1) * page_size
    page_items = filtered[start_idx: start_idx + page_size]

    return jsonify({
        "total": total,
        "page": page,
        "page_size": page_size,
        "incidents": page_items,
        "volume_over_time": volume_rows,
        "stacked": stacked_rows,
        "country_actor": country_rows,
        "country_meta": COUNTRY_CENTROIDS,
    })


@app.route("/incident/<path:identifier>")
def incident_detail(identifier):
    """Individual incident page — matches by UUID or slug."""
    incidents = _fetch_all_incidents()
    # Try UUID match first, then slug match
    inc = next((i for i in incidents if i["id"] == identifier), None)
    if inc is None:
        inc = next((i for i in incidents if i.get("slug") == identifier), None)
    if inc is None:
        return "Incident not found", 404
    if "application/json" in (request.headers.get("Accept") or ""):
        return jsonify(inc)
    return render_template("index.html", is_admin=session.get("admin", False),
                           prefill_incident=inc)


@app.route("/sitemap.xml")
def sitemap():
    incidents = _fetch_all_incidents()
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml.append(f'  <url><loc>{request.host_url}</loc><priority>1.0</priority></url>')
    for inc in incidents:
        slug = inc.get("slug") or inc["id"]
        xml.append(f'  <url><loc>{request.host_url}incident/{slug}</loc></url>')
    xml.append('</urlset>')
    return Response("\n".join(xml), mimetype="application/xml")


@app.route("/api/entities/network")
def api_entity_network():
    """Proxy to incident-manager entity network endpoint."""
    try:
        resp = _http_client.get(f"{IM_URL}/entities/network", params={"status": "approved"})
        resp.raise_for_status()
        return jsonify(resp.json())
    except Exception as e:
        app.logger.error(f"Entity network fetch failed: {e}")
        return jsonify({"nodes": [], "edges": []})


@app.route("/ait_admin")
def ait_admin():
    return redirect(REVIEW_UI_URL)


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------

def _build_export_df(filters):
    all_inc = _fetch_all_incidents()
    filtered = _filter_incidents(all_inc, filters)
    return pd.DataFrame([{
        "id": inc["id"],
        "title": inc["title"],
        "start_year": inc["start_year"],
        "end_year": inc["end_year"],
        "actors": "; ".join(inc["actors"]),
        "countries": "; ".join(inc["countries"]),
        "incident_types": "; ".join(inc["tools"]),
        "source_urls": "; ".join(inc["source_urls"]),
        "source_count": inc["source_count"],
        "summary": inc["summary"],
        "attribution_basis": inc["attribution_basis"],
        "campaign_name": inc["campaign_name"],
        "confidence_score": inc["confidence_score"],
        "source": inc.get("source"),
    } for inc in filtered])


def _parse_export_filters():
    def pm(n):
        v = request.args.get(n, "").strip()
        return [s.strip() for s in v.split(",") if s.strip()] if v else []
    s = request.args.get("start")
    e = request.args.get("end")
    return {
        "start": int(s) if s else None, "end": int(e) if e else None,
        "actors": pm("actors"), "countries": pm("countries"),
        "tools": pm("tools"), "entities": pm("entities"),
        "q": request.args.get("q", "").strip() or None,
        "region": request.args.get("region", "").strip() or None,
    }


@app.route("/export/incidents.csv")
def export_csv():
    df = _build_export_df(_parse_export_filters())
    buf = StringIO()
    df.to_csv(buf, index=False)
    return Response(buf.getvalue().encode("utf-8-sig"), headers={
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="ait_incidents.csv"',
    })


@app.route("/export/incidents.xlsx")
def export_xlsx():
    df = _build_export_df(_parse_export_filters())
    bio = BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name="incidents")
        ws = w.sheets["incidents"]
        ws.auto_filter.ref = ws.dimensions
        ws.freeze_panes = "A2"
    bio.seek(0)
    return send_file(bio, as_attachment=True, download_name="ait_incidents.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------------------------------------------------------------------------
# Debug / monitoring endpoints
# ---------------------------------------------------------------------------

@app.route("/debug/health")
def debug_health():
    """Quick health check — no external calls."""
    import gc
    import resource
    mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux: KB -> MB
    return jsonify({
        "status": "ok",
        "memory_mb": round(mem_mb, 1),
        "cache_incidents": len(_cache.get("data") or []),
        "cache_age_s": round(time.time() - _cache["ts"], 1) if _cache["ts"] else None,
        "stats_cache_age_s": round(time.time() - _stats_cache["ts"], 1) if _stats_cache["ts"] else None,
        "gc_counts": gc.get_count(),
        "gc_objects": len(gc.get_objects()),
    })


@app.route("/debug/memory")
def debug_memory():
    """Memory snapshot using tracemalloc."""
    import tracemalloc
    if not tracemalloc.is_tracing():
        tracemalloc.start()
        return jsonify({"status": "tracemalloc started, refresh in 30s for snapshot"})

    snapshot = tracemalloc.take_snapshot()
    top = snapshot.statistics("lineno")[:20]
    return jsonify({
        "current_mb": round(tracemalloc.get_traced_memory()[0] / 1024 / 1024, 2),
        "peak_mb": round(tracemalloc.get_traced_memory()[1] / 1024 / 1024, 2),
        "top_allocations": [
            {"file": str(s.traceback), "size_kb": round(s.size / 1024, 1), "count": s.count}
            for s in top
        ],
    })


@app.route("/debug/connections")
def debug_connections():
    """Check httpx connection pool status."""
    pool = _http_client._transport._pool
    return jsonify({
        "connections_in_pool": len(pool._connections) if hasattr(pool, '_connections') else "unknown",
        "requests_count": getattr(pool, '_request_count', 'unknown'),
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
