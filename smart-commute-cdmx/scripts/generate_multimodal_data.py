import csv
import html
import json
import math
import os
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT_DIR.parent / "docs" / "data"
LOCAL_DATA_CONFIG = ROOT_DIR / "data-source.local"
OUTPUT_DIR = ROOT_DIR / "public" / "data"
MVP_PATH = OUTPUT_DIR / "mvp-data.json"

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}

METRO_LINE_COLORS = {
    "1": "#ec4899",
    "2": "#2563eb",
    "3": "#84cc16",
    "4": "#06b6d4",
    "5": "#eab308",
    "6": "#ef4444",
    "7": "#f97316",
    "8": "#22c55e",
    "9": "#a16207",
    "A": "#7c3aed",
    "B": "#64748b",
    "12": "#d4a017",
}

METROBUS_LINE_COLORS = {
    "1": "#ef4444",
    "2": "#7c3aed",
    "3": "#84cc16",
    "4": "#f59e0b",
    "5": "#38bdf8",
    "6": "#22c55e",
    "7": "#e11d48",
}


def read_data_dir() -> Path:
    env_raw = os.environ.get("SMART_COMMUTE_DATA_DIR", "").strip()
    if env_raw:
        return Path(env_raw)

    if LOCAL_DATA_CONFIG.exists():
        local_value = LOCAL_DATA_CONFIG.read_text(encoding="utf-8").strip()
        if local_value:
            return Path(local_value)

    return DEFAULT_DATA_DIR


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def fix_mojibake(value) -> str:
    trimmed = str(value or "").strip()
    if not trimmed:
        return ""
    if "�" in trimmed or "Ã" in trimmed or "Â" in trimmed:
        try:
            return trimmed.encode("latin1", errors="ignore").decode("utf-8", errors="ignore").strip()
        except Exception:
            return trimmed
    return trimmed


def normalize_text(value) -> str:
    text = fix_mojibake(value)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text


def parse_html_description(description) -> dict:
    decoded = html.unescape(description or "")
    pairs = re.findall(r"<td>([^<]+)</td>\s*<td>([^<]*)</td>", decoded, flags=re.IGNORECASE)
    result = {}
    for key, value in pairs:
        result[fix_mojibake(key).upper()] = fix_mojibake(value)
    return result


def parse_coordinates_text(coords_text: str):
    points = []
    for chunk in re.split(r"\s+", (coords_text or "").strip()):
        if not chunk:
            continue
        parts = chunk.split(",")
        if len(parts) < 2:
            continue
        try:
            points.append([float(parts[0]), float(parts[1])])
        except ValueError:
            continue
    return points


def read_kmz_placemarks(kmz_path: Path):
    with zipfile.ZipFile(kmz_path, "r") as archive:
        kml_name = next(name for name in archive.namelist() if name.lower().endswith(".kml"))
        root = ET.fromstring(archive.read(kml_name))

    placemarks = []
    for pm in root.findall(".//k:Placemark", KML_NS):
        name_node = pm.find("k:name", KML_NS)
        description_node = pm.find("k:description", KML_NS)
        point_node = pm.find(".//k:Point/k:coordinates", KML_NS)
        line_nodes = pm.findall(".//k:LineString/k:coordinates", KML_NS)

        name = fix_mojibake(name_node.text if name_node is not None else "")
        properties = parse_html_description(description_node.text if description_node is not None else "")

        point = None
        if point_node is not None and point_node.text:
            parsed = parse_coordinates_text(point_node.text)
            point = parsed[0] if parsed else None

        lines = []
        for ln in line_nodes:
            parsed = parse_coordinates_text(ln.text or "")
            if len(parsed) >= 2:
                lines.append(parsed)

        placemarks.append(
            {
                "name": name,
                "properties": properties,
                "point": point,
                "lineStrings": lines,
            }
        )

    return placemarks


def parse_date(value: str):
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d")
    except Exception:
        return None


def read_csv_rows(csv_path: Path):
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def to_int(value, default=0):
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return int(text)
    except ValueError:
        try:
            return int(float(text))
        except ValueError:
            return default


def unique_list(items):
    seen = set()
    result = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def parse_line_codes(raw_value, mode):
    text = fix_mojibake(raw_value).upper().strip()
    if not text:
        return []

    if mode == "metro":
        tokens = re.findall(r"(?:1[0-2]|[1-9]|A|B)", text)
    else:
        tokens = re.findall(r"\d+", text)

    return unique_list([(token.lstrip("0") or "0") for token in tokens])


def line_label(mode, code):
    return f"Linea {code}" if mode == "metro" else f"MB {code}"


def haversine_meters(a, b):
    lng1, lat1 = a
    lng2, lat2 = b
    to_rad = math.pi / 180
    dlat = (lat2 - lat1) * to_rad
    dlng = (lng2 - lng1) * to_rad
    lat1 = lat1 * to_rad
    lat2 = lat2 * to_rad
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def compute_metro_ridership_by_station(csv_path: Path):
    rows = read_csv_rows(csv_path)
    parsed = []
    for row in rows:
        dt = parse_date(row.get("fecha", ""))
        if not dt:
            continue
        parsed.append(
            {
                "date": dt,
                "station": fix_mojibake(row.get("estacion", "")),
                "ridership": to_int(row.get("afluencia", "0"), 0),
            }
        )

    if not parsed:
        return {}

    latest = max(item["date"] for item in parsed)
    cutoff = latest - timedelta(days=89)
    buckets = defaultdict(int)
    days = set()

    for item in parsed:
        if item["date"] < cutoff:
            continue
        days.add(item["date"].strftime("%Y-%m-%d"))
        buckets[normalize_text(item["station"])] += item["ridership"]

    denominator = max(1, len(days))
    return {station: round(total / denominator) for station, total in buckets.items()}


def compute_metrobus_ridership_by_line(csv_path: Path):
    rows = read_csv_rows(csv_path)
    parsed = []
    for row in rows:
        dt = parse_date(row.get("fecha", ""))
        if not dt:
            continue
        parsed.append(
            {
                "date": dt,
                "line": (str(row.get("linea", "")).strip().lstrip("0") or "0"),
                "ridership": to_int(row.get("afluencia", "0"), 0),
            }
        )

    if not parsed:
        return {}

    latest = max(item["date"] for item in parsed)
    cutoff = latest - timedelta(days=89)
    buckets = defaultdict(int)
    days = set()

    for item in parsed:
        if item["date"] < cutoff:
            continue
        days.add(item["date"].strftime("%Y-%m-%d"))
        buckets[item["line"]] += item["ridership"]

    denominator = max(1, len(days))
    return {line: round(total / denominator) for line, total in buckets.items()}


def build_metro_stations(stations_kmz: Path, ridership_by_station: dict):
    placemarks = read_kmz_placemarks(stations_kmz)
    by_station = {}

    for pm in placemarks:
        point = pm["point"]
        if not point:
            continue

        props = pm["properties"]
        name = props.get("NOMBRE") or pm["name"]
        line_codes = parse_line_codes(props.get("LINEA") or "", "metro")
        if not line_codes:
            continue

        code = line_codes[0]
        station_key = normalize_text(name)
        color = METRO_LINE_COLORS.get(code.upper(), "#94a3b8")

        if station_key not in by_station:
            by_station[station_key] = {
                "id": f"metro-{station_key}",
                "name": fix_mojibake(name),
                "mode": "metro",
                "coordinates": point,
                "lines": [],
                "lineColor": color,
                "dailyRidership": ridership_by_station.get(station_key, 0),
            }

        station = by_station[station_key]
        label = line_label("metro", code)
        if label not in station["lines"]:
            station["lines"].append(label)

    return list(by_station.values())


def build_metrobus_stations(stations_kmz: Path, ridership_by_line: dict):
    placemarks = read_kmz_placemarks(stations_kmz)
    raw = []

    for index, pm in enumerate(placemarks):
        point = pm["point"]
        if not point:
            continue

        props = pm["properties"]
        name = props.get("NOMBRE") or pm["name"] or f"Estacion MB {index + 1}"
        codes = parse_line_codes(props.get("LINEA") or "", "metrobus")
        code = codes[0] if codes else "0"
        est_code = normalize_text(props.get("EST") or "")
        base_slug = normalize_text(name)

        raw.append(
            {
                "id": f"mb-{code}-{est_code or base_slug}-{index}",
                "name": fix_mojibake(name),
                "mode": "metrobus",
                "coordinates": point,
                "lines": [line_label("metrobus", code)],
                "lineColor": METROBUS_LINE_COLORS.get(code, "#0ea5e9"),
                "lineCode": code,
                "dailyRidership": 0,
            }
        )

    stations_per_line = defaultdict(list)
    for station in raw:
        stations_per_line[station["lineCode"]].append(station)

    for code, stations in stations_per_line.items():
        line_daily = ridership_by_line.get(code, 0)
        per_station = round(line_daily / max(1, len(stations)))
        for station in stations:
            station["dailyRidership"] = per_station

    for station in raw:
        station.pop("lineCode", None)

    return raw


def build_line_geometries(lines_kmz: Path, mode):
    placemarks = read_kmz_placemarks(lines_kmz)
    by_line = defaultdict(list)

    for pm in placemarks:
        props = pm["properties"]
        codes = parse_line_codes(props.get("LINEA") or pm["name"], mode)
        if not codes:
            continue

        segments = [coords for coords in pm["lineStrings"] if len(coords) >= 2]
        if not segments:
            continue

        for code in codes:
            by_line[(mode, line_label(mode, code))].extend(segments)

    return by_line


def project_point_to_segment(point, start, end):
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    denom = dx * dx + dy * dy
    if denom == 0:
        return start, 0.0

    t = ((px - x1) * dx + (py - y1) * dy) / denom
    t = max(0.0, min(1.0, t))
    proj = [x1 + t * dx, y1 + t * dy]
    return proj, t


def project_point_to_polyline(point, polyline):
    best_distance = float("inf")
    best_along = 0.0
    cumulative = 0.0

    for idx in range(len(polyline) - 1):
        start = polyline[idx]
        end = polyline[idx + 1]
        segment_length = haversine_meters(start, end)
        projected, ratio = project_point_to_segment(point, start, end)
        distance = haversine_meters(point, projected)
        along = cumulative + segment_length * ratio

        if distance < best_distance:
            best_distance = distance
            best_along = along

        cumulative += segment_length

    return {"distance": best_distance, "along": best_along}


def order_stations_by_topology(line_stations, line_segments):
    if not line_segments:
        return sorted(line_stations, key=lambda item: (item["coordinates"][0], item["coordinates"][1]))

    ranked = []
    for station in line_stations:
        best = None
        for segment in line_segments:
            projection = project_point_to_polyline(station["coordinates"], segment)
            if not best or projection["distance"] < best["distance"]:
                best = projection

        if best is None:
            ranked.append((station, float("inf"), float("inf")))
        else:
            ranked.append((station, best["along"], best["distance"]))

    ranked.sort(key=lambda item: (item[1], item[2], item[0]["id"]))
    return [item[0] for item in ranked]


def build_routes_from_stations(stations, line_geometries):
    grouped = defaultdict(list)
    for station in stations:
        for line in station["lines"]:
            grouped[(station["mode"], line)].append(station)

    features = []
    edge_keys = set()
    max_step_distance = {"metro": 3500, "metrobus": 4000}

    for (mode, line), line_stations in grouped.items():
        ordered = order_stations_by_topology(line_stations, line_geometries.get((mode, line), []))
        for idx in range(len(ordered) - 1):
            a = ordered[idx]
            b = ordered[idx + 1]
            if a["id"] == b["id"]:
                continue

            distance_m = round(haversine_meters(a["coordinates"], b["coordinates"]))
            if distance_m > max_step_distance.get(mode, 4000):
                continue

            edge_key = (mode, line, a["id"], b["id"])
            if edge_key in edge_keys:
                continue
            edge_keys.add(edge_key)

            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "mode": mode,
                        "line": line,
                        "lineColor": a["lineColor"],
                        "from": a["id"],
                        "to": b["id"],
                        "distanceM": distance_m,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [a["coordinates"], b["coordinates"]],
                    },
                }
            )

    return {"type": "FeatureCollection", "features": features}


def nearest_alternative(station, stations):
    best = None
    best_distance = float("inf")
    for other in stations:
        if other["id"] == station["id"]:
            continue
        distance = haversine_meters(station["coordinates"], other["coordinates"])
        if distance < best_distance:
            best = other
            best_distance = distance
    if not best:
        return "Alternativa de red", 1500
    return best["name"], round(best_distance)


def station_metrics(station, stations):
    daily = station["dailyRidership"]
    transfer_penalty = max(0, len(station["lines"]) - 1)
    mode_base = 0.74 if station["mode"] == "metro" else 0.62
    impact_share = max(0.35, min(0.9, mode_base + transfer_penalty * 0.04))
    impacted = round(daily * impact_share)
    vulnerable_share = 0.21 if station["mode"] == "metro" else 0.18
    vulnerable = round(impacted * vulnerable_share)
    commute_delta = min(46, max(12, 18 + transfer_penalty * 6 + (8 if station["mode"] == "metro" else 4)))
    nearest_name, nearest_distance = nearest_alternative(station, stations)

    return {
        "id": station["id"],
        "name": station["name"],
        "mode": station["mode"],
        "lines": station["lines"],
        "lineColor": station["lineColor"],
        "coordinates": station["coordinates"],
        "dailyRidership": daily,
        "impactedPeople": impacted,
        "vulnerablePeople": vulnerable,
        "commuteDeltaPct": commute_delta,
        "impactSharePct": round(impact_share * 100, 1),
        "vulnerabilitySharePct": round(vulnerable_share * 100, 1),
        "transferPenalty": transfer_penalty,
        "nearbyEcobici": 0,
        "cycleKmNearby": 0,
        "nearestAlternative": nearest_name,
        "nearestAlternativeDistanceM": nearest_distance,
        "resilienceScore": 35 if station["mode"] == "metro" else 42,
    }


def load_mvp_context():
    if not MVP_PATH.exists():
        return {
            "ecobici": {"type": "FeatureCollection", "features": []},
            "cycleInfra": {"type": "FeatureCollection", "features": []},
            "summary": {"ecobiciStations": 0, "totalCycleKm": 0},
        }

    payload = json.loads(MVP_PATH.read_text(encoding="utf-8"))
    return {
        "ecobici": payload.get("ecobici", {"type": "FeatureCollection", "features": []}),
        "cycleInfra": payload.get("cycleInfra", {"type": "FeatureCollection", "features": []}),
        "summary": payload.get("summary", {}),
    }


def write_json(name: str, payload):
    ensure_output_dir()
    (OUTPUT_DIR / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    data_dir = read_data_dir()
    if not data_dir.exists():
        raise SystemExit(f"Data directory not found: {data_dir}")

    metro_stations_kmz = data_dir / "stcmetro_kmz" / "STC_Metro_estaciones.kmz"
    metro_lines_kmz = data_dir / "stcmetro_kmz" / "STC_Metro_lineas.kmz"
    metrobus_stations_kmz = data_dir / "mb_kmz" / "Metrobus_estaciones.kmz"
    metrobus_lines_kmz = data_dir / "mb_kmz" / "Metrobus_lineas.kmz"
    metro_ridership_csv = data_dir / "afluenciastc_desglosado_03_2026.csv"
    metrobus_ridership_csv = data_dir / "afluenciamb_desglosado_03_2026.csv"

    required = [
        metro_stations_kmz,
        metro_lines_kmz,
        metrobus_stations_kmz,
        metrobus_lines_kmz,
        metro_ridership_csv,
        metrobus_ridership_csv,
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit(f"Missing required files: {', '.join(missing)}")

    metro_ridership = compute_metro_ridership_by_station(metro_ridership_csv)
    metrobus_ridership = compute_metrobus_ridership_by_line(metrobus_ridership_csv)

    metro_stations = build_metro_stations(metro_stations_kmz, metro_ridership)
    metrobus_stations = build_metrobus_stations(metrobus_stations_kmz, metrobus_ridership)
    all_stations = sorted(metro_stations + metrobus_stations, key=lambda item: item["dailyRidership"], reverse=True)

    line_geometries = {
        **build_line_geometries(metro_lines_kmz, "metro"),
        **build_line_geometries(metrobus_lines_kmz, "metrobus"),
    }
    routes = build_routes_from_stations(all_stations, line_geometries)

    station_payload = [station_metrics(station, all_stations) for station in all_stations]
    network_ridership = sum(item["dailyRidership"] for item in station_payload)

    mvp_context = load_mvp_context()
    metrobus_top = sorted(
        [{"line": f"Línea {line}", "averageDailyRidership": value} for line, value in metrobus_ridership.items()],
        key=lambda item: item["averageDailyRidership"],
        reverse=True,
    )[:6]

    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    multimodal = {
        "generatedAt": generated_at,
        "scopeNote": "Dataset multimodal generado desde cartografía oficial STC/Metrobús (KMZ) con afluencia 2026 para cobertura de estaciones completa en Metro y Metrobús.",
        "methodologyNote": "Ridership por estación Metro se calibra con afluencia STC; en Metrobús se distribuye afluencia promedio por línea entre estaciones de la línea. La topología de rutas usa orden por proyección de estaciones sobre geometría oficial de línea (snapping).",
        "summary": {
            "impactModelVersion": "v3.1-multimodal-kmz-snapped",
            "latestMetroDate": "2026-03-31",
            "latestMetrobusDate": "2026-03-31",
            "averageMetroDaily": sum(metro_ridership.values()),
            "averageMetrobusDaily": sum(metrobus_ridership.values()),
            "ecobiciStations": mvp_context["summary"].get("ecobiciStations", 0),
            "totalCycleKm": mvp_context["summary"].get("totalCycleKm", 0),
            "metroNetworkSegments": len(routes["features"]),
            "metroNetworkKm": round(sum(f["properties"]["distanceM"] for f in routes["features"]) / 1000, 1),
            "networkRidershipDaily": network_ridership,
            "topMetrobusLines": metrobus_top,
        },
        "stations": station_payload,
        "ecobici": mvp_context["ecobici"],
        "cycleInfra": mvp_context["cycleInfra"],
        "metroNetwork": routes,
    }

    write_json("multimodal-data.json", multimodal)

    write_json(
        "stations.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "kmz-multimodal",
            "count": len(all_stations),
            "stations": [
                {
                    "id": s["id"],
                    "name": s["name"],
                    "type": s["mode"],
                    "coordinates": s["coordinates"],
                    "lines": s["lines"],
                    "lineColor": s["lineColor"],
                    "dailyRidership": s["dailyRidership"],
                }
                for s in all_stations
            ],
        },
    )

    write_json(
        "routes.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "kmz-multimodal",
            "type": "FeatureCollection",
            "features": routes["features"],
        },
    )

    write_json(
        "precomputed_impact.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "kmz-multimodal",
            "methodology": "station-ridership-with-line-level-metrobus-distribution",
            "stations": {
                s["id"]: {
                    "stationId": s["id"],
                    "stationName": s["name"],
                    "mode": s["mode"],
                    "impact": {
                        "dailyRidership": s["dailyRidership"],
                        "impactedPeople": s["impactedPeople"],
                        "vulnerablePeople": s["vulnerablePeople"],
                        "commuteDeltaPct": s["commuteDeltaPct"],
                    },
                    "alternatives": {
                        "nearest": s["nearestAlternative"],
                        "distanceM": s["nearestAlternativeDistanceM"],
                    },
                    "methodology": "kmz-topology-ridership-estimation",
                }
                for s in station_payload
            },
        },
    )

    write_json(
        "etl-manifest.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "kmz-multimodal",
            "inputs": {
                "dataDir": str(data_dir),
                "metroStationsKmz": metro_stations_kmz.exists(),
                "metroLinesKmz": metro_lines_kmz.exists(),
                "metrobusStationsKmz": metrobus_stations_kmz.exists(),
                "metrobusLinesKmz": metrobus_lines_kmz.exists(),
                "metroRidershipCsv": metro_ridership_csv.exists(),
                "metrobusRidershipCsv": metrobus_ridership_csv.exists(),
            },
            "outputs": [
                "multimodal-data.json",
                "stations.json",
                "routes.json",
                "precomputed_impact.json",
            ],
        },
    )

    print(
        f"[multimodal-etl] stations={len(all_stations)} metro={len(metro_stations)} metrobus={len(metrobus_stations)} routes={len(routes['features'])}"
    )


if __name__ == "__main__":
    main()
