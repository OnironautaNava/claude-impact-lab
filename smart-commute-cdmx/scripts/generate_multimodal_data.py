import csv
import html
import io
import json
import math
import os
import re
import shutil
import statistics
import tempfile
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

import shapefile
from pyproj import CRS, Transformer


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT_DIR.parent / "docs" / "data"
LOCAL_DATA_CONFIG = ROOT_DIR / "data-source.local"
OUTPUT_DIR = ROOT_DIR / "public" / "data"
MVP_PATH = OUTPUT_DIR / "mvp-data.json"
GTFS_CANDIDATES = [Path("raw-data/gtfs/gtfs_cdmx.zip")]

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

SYSTEM_COLORS = {
    "metro": "#2563eb",
    "metrobus": "#0ea5e9",
    "trolebus": "#1d4ed8",
    "trenligero": "#16a34a",
    "cablebus": "#6d28d9",
}

SYSTEM_LABELS = {
    "metro": "Metro",
    "metrobus": "Metrobus",
    "trolebus": "Trolebus",
    "trenligero": "Tren Ligero",
    "cablebus": "Cablebus",
}

GTFS_AGENCY_TO_MODE = {
    "METRO": "metro",
    "MB": "metrobus",
    "TROLE": "trolebus",
    "CBB": "cablebus",
    "TL": "trenligero",
    "RTP": "rtp",
}

DEDUP_DISTANCE_BY_MODE = {
    "metrobus": 75,
    "trolebus": 60,
    "cablebus": 45,
    "trenligero": 45,
}

VARIANT_ASSIGN_DISTANCE_BY_MODE = {
    "metro": 160,
    "metrobus": 140,
    "trolebus": 120,
    "cablebus": 120,
    "trenligero": 120,
}

MAX_STEP_DISTANCE_BY_MODE = {
    "metro": 2600,
    "metrobus": 3200,
    "trolebus": 2500,
    "cablebus": 3200,
    "trenligero": 1800,
}

MIN_STEP_DISTANCE_BY_MODE = {
    "metro": 60,
    "metrobus": 55,
    "trolebus": 45,
    "cablebus": 80,
    "trenligero": 80,
}

ELECTRIC_SUBSYSTEMS = [
    {
        "mode": "trolebus",
        "label": "Trolebus",
        "ridership_candidates": [Path("raw-data/transportes-electricos/ste-trolebus/ridership/afluencia_desglosada_trolebus_03_2026.csv")],
        "shp_candidates": {
            "stations": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_trolebus_shp.zip")],
            "lines": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_trolebus_shp.zip")],
            "station_keywords": ["paradas"],
            "line_keywords": ["lineas"],
        },
        "cartography_globs": {
            "stations": [
                "raw-data/transportes-electricos/ste-trolebus/**/*estacion*.kmz",
                "raw-data/transportes-electricos/ste-trolebus/**/*parada*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*estacion*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*parada*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*kmz.zip",
            ],
            "lines": [
                "raw-data/transportes-electricos/ste-trolebus/**/*linea*.kmz",
                "raw-data/transportes-electricos/ste-trolebus/**/*ruta*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*linea*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*ruta*.kmz",
                "raw-data/transportes-electricos/cartography/**/*trole*kmz.zip",
            ],
        },
        "archive_members": {
            "stations": ["*paradas.kmz", "*estaciones.kmz"],
            "lines": ["*lineas.kmz", "*rutas.kmz"],
        },
    },
    {
        "mode": "cablebus",
        "label": "Cablebus",
        "ridership_candidates": [Path("raw-data/transportes-electricos/cablebus/ridership/afluencia_desglosada_cb_03_2026.csv")],
        "shp_candidates": {
            "stations": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_cablebus_shp.zip")],
            "lines": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_cablebus_shp.zip")],
            "station_keywords": ["estaciones"],
            "line_keywords": ["lineas"],
        },
        "cartography_globs": {
            "stations": [
                "raw-data/transportes-electricos/cablebus/**/*estacion*.kmz",
                "raw-data/transportes-electricos/cartography/**/*cable*estacion*.kmz",
                "raw-data/transportes-electricos/cartography/**/*cable*kmz.zip",
            ],
            "lines": [
                "raw-data/transportes-electricos/cablebus/**/*linea*.kmz",
                "raw-data/transportes-electricos/cartography/**/*cable*linea*.kmz",
                "raw-data/transportes-electricos/cartography/**/*cable*kmz.zip",
            ],
        },
        "archive_members": {
            "stations": ["*estaciones.kmz"],
            "lines": ["*lineas.kmz"],
        },
    },
    {
        "mode": "trenligero",
        "label": "Tren Ligero",
        "ridership_candidates": [Path("raw-data/transportes-electricos/tren-ligero/ridership/afluencia_desglosada_tl_03_2026.csv")],
        "shp_candidates": {
            "stations": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_tren_ligero_shp.zip")],
            "lines": [Path("raw-data/transportes-electricos/cartography/ste_shp/ste_tren_ligero_shp.zip")],
            "station_keywords": ["estaciones"],
            "line_keywords": ["linea"],
        },
        "cartography_globs": {
            "stations": [
                "raw-data/transportes-electricos/tren-ligero/**/*estacion*.kmz",
                "raw-data/transportes-electricos/cartography/**/*tren*estacion*.kmz",
                "raw-data/transportes-electricos/cartography/**/*tren*kmz.zip",
            ],
            "lines": [
                "raw-data/transportes-electricos/tren-ligero/**/*linea*.kmz",
                "raw-data/transportes-electricos/cartography/**/*tren*linea*.kmz",
                "raw-data/transportes-electricos/cartography/**/*tren*trazo*.kmz",
                "raw-data/transportes-electricos/cartography/**/*tren*kmz.zip",
            ],
        },
        "archive_members": {
            "stations": ["*estaciones.kmz"],
            "lines": ["*lineas.kmz", "*trazo*.kmz"],
        },
        "line_code": "1",
    },
]


def read_data_dir() -> Path:
    env_raw = os.environ.get("SMART_COMMUTE_DATA_DIR", "").strip()
    if env_raw:
        return Path(env_raw)

    if LOCAL_DATA_CONFIG.exists():
        local_value = LOCAL_DATA_CONFIG.read_text(encoding="utf-8").strip()
        if local_value:
            return Path(local_value)

    return DEFAULT_DATA_DIR


def first_existing_path(data_dir: Path, candidates):
    for relative in candidates:
        candidate = data_dir / relative
        if candidate.exists():
            return candidate
    return data_dir / candidates[0]


def first_matching_glob(data_dir: Path, patterns):
    for pattern in patterns:
        matches = sorted(data_dir.glob(pattern))
        if matches:
            return matches[0]
    return None


def match_archive_member(name: str, patterns) -> bool:
    lowered = name.lower()
    return any(Path(lowered).match(pattern.lower()) for pattern in patterns)


def ensure_extracted_kmz(candidate: Path, member_patterns, cache_dir: Path):
    if candidate.suffix.lower() == ".kmz":
        return candidate
    if candidate.suffix.lower() != ".zip":
        return None

    with zipfile.ZipFile(candidate, "r") as archive:
        for member in archive.namelist():
            if member.endswith("/") or not match_archive_member(member, member_patterns):
                continue

            target_dir = cache_dir / candidate.stem
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / Path(member).name
            with archive.open(member) as source, target_path.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            return target_path
    return None


def extract_zip_once(candidate: Path, cache_dir: Path):
    target_dir = cache_dir / candidate.stem
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)

    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(candidate, "r") as archive:
        archive.extractall(target_dir)
    return target_dir


def ensure_extracted_shp(candidate: Path, shp_keywords, cache_dir: Path):
    if candidate.suffix.lower() == ".shp":
        return candidate
    if candidate.suffix.lower() != ".zip":
        return None

    extracted_dir = extract_zip_once(candidate, cache_dir)
    shp_files = sorted(extracted_dir.rglob("*.shp"))
    if not shp_files:
        return None

    lowered_keywords = [keyword.lower() for keyword in shp_keywords]
    for shp_file in shp_files:
        lowered_name = shp_file.name.lower()
        if any(keyword in lowered_name for keyword in lowered_keywords):
            return shp_file
    return shp_files[0]


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


def transform_coordinates(points, transformer):
    if transformer is None:
        return [[round(point[0], 6), round(point[1], 6)] for point in points]
    transformed = []
    for point in points:
        lng, lat = transformer.transform(point[0], point[1])
        transformed.append([round(lng, 6), round(lat, 6)])
    return transformed


def read_shp_features(shp_path: Path):
    prj_path = shp_path.with_suffix(".prj")
    transformer = None
    if prj_path.exists():
        try:
            source_crs = CRS.from_wkt(prj_path.read_text(encoding="utf-8", errors="ignore"))
            if source_crs.to_epsg() != 4326:
                transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)
        except Exception:
            transformer = None

    reader = shapefile.Reader(str(shp_path), encoding="latin1")
    field_names = [field[0] for field in reader.fields[1:]]
    features = []

    for index in range(int(reader.numRecords or 0)):
        shape = reader.shape(index)
        record_values = reader.record(index)
        if shape is None or record_values is None:
            continue
        record = {}
        for key, value in zip(field_names, list(record_values)):
            record[key] = fix_mojibake(value) if isinstance(value, str) else value

        if shape.shapeType in {1, 11, 21}:
            coordinates = transform_coordinates([[shape.points[0][0], shape.points[0][1]]], transformer)
            geometry = {"type": "Point", "coordinates": coordinates[0]}
        elif shape.shapeType in {3, 13, 23}:
            parts = list(shape.parts) + [len(shape.points)]
            lines = []
            for index in range(len(parts) - 1):
                raw_points = [[point[0], point[1]] for point in shape.points[parts[index] : parts[index + 1]]]
                transformed_points = transform_coordinates(raw_points, transformer)
                if len(transformed_points) >= 2:
                    lines.append(transformed_points)
            if not lines:
                continue
            geometry = {"type": "MultiLineString", "coordinates": lines}
        else:
            continue

        features.append({"properties": record, "geometry": geometry})

    return features


def read_gtfs_feed(gtfs_zip_path: Path):
    with zipfile.ZipFile(gtfs_zip_path, "r") as archive:
        tables = {}
        for name in ["agency.txt", "routes.txt", "trips.txt", "stop_times.txt", "stops.txt", "shapes.txt"]:
            with archive.open(name, "r") as handle:
                tables[name] = list(csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8-sig")))
    return tables


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


def parse_variant_hints(mode, properties):
    if mode != "trolebus":
        return []

    circuito = fix_mojibake(properties.get("circuito") or properties.get("CIRCUITO") or "")
    tokens = re.findall(r"\b\d+\b", circuito)
    return unique_list([f"circuito:{token}" for token in tokens])


def build_variant_metadata(mode, properties, fallback_name=""):
    ruta = fix_mojibake(properties.get("RUTA") or fallback_name or "")
    tramo = fix_mojibake(properties.get("TRAMO") or "")
    circuito = fix_mojibake(properties.get("circuito") or properties.get("CIRCUITO") or "")
    hints = parse_variant_hints(mode, properties)

    if mode == "trolebus":
        label_parts = [part for part in [f"Circuito {circuito}" if circuito else "", ruta] if part]
        key_parts = hints + [normalize_text(ruta)]
    elif mode == "metrobus":
        label_parts = [part for part in [ruta, tramo] if part]
        key_parts = [normalize_text(ruta), normalize_text(tramo or ruta)]
    else:
        label_parts = [part for part in [ruta, tramo] if part]
        key_parts = [normalize_text(part) for part in label_parts]

    clean_key_parts = [part for part in key_parts if part]
    variant_key = "|".join(clean_key_parts) if clean_key_parts else "default"
    variant_label = " | ".join(label_parts) if label_parts else "Ruta principal"
    return {
        "variantKey": variant_key,
        "variantLabel": variant_label,
        "variantHints": hints,
        "routeName": ruta,
        "segmentName": tramo,
        "circuito": circuito,
    }


def line_label(mode, code):
    cleaned = str(code or "").strip()
    if mode == "metro":
        return f"Linea {cleaned}"
    if mode == "metrobus":
        return f"MB {cleaned}"
    if mode == "trolebus":
        return f"TB {cleaned}"
    if mode == "cablebus":
        return f"CB {cleaned}"
    if mode == "trenligero":
        return "TL" if cleaned in {"", "0", "1"} else f"TL {cleaned}"
    return cleaned or SYSTEM_LABELS.get(mode, "Linea")


def color_for_mode(mode, line_code=""):
    if mode == "metro":
        return METRO_LINE_COLORS.get(str(line_code).upper(), "#94a3b8")
    if mode == "metrobus":
        return METROBUS_LINE_COLORS.get(str(line_code), "#0ea5e9")
    return SYSTEM_COLORS.get(mode, "#64748b")


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
    return compute_average_ridership_by_key(csv_path, key_field="linea")


def compute_average_ridership_by_key(csv_path: Path, key_field: str | None = None, default_key="0"):
    rows = read_csv_rows(csv_path)
    parsed = []
    for row in rows:
        dt = parse_date(row.get("fecha", ""))
        if not dt:
            continue
        if key_field:
            parsed_key = (fix_mojibake(row.get(key_field, "")).strip().lstrip("0") or default_key)
            codes = parse_line_codes(parsed_key, "metrobus")
            bucket_key = codes[0] if codes else parsed_key
        else:
            bucket_key = default_key
        parsed.append(
            {
                "date": dt,
                "key": bucket_key,
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
        buckets[item["key"]] += item["ridership"]

    denominator = max(1, len(days))
    return {line: round(total / denominator) for line, total in buckets.items()}


def build_station_record(mode: str, point, props: dict, default_name: str, line_code: str, index: int, ridership=0):
    name = props.get("NOMBRE") or props.get("NAME") or default_name
    station_code = fix_mojibake(props.get("CVE_EST") or props.get("EST") or props.get("stop_id") or "")
    base_slug = normalize_text(name)
    return {
        "id": f"{mode}-{line_code}-{normalize_text(station_code or base_slug)}-{index}",
        "name": fix_mojibake(name),
        "mode": mode,
        "coordinates": point,
        "lines": [line_label(mode, line_code)],
        "lineColor": color_for_mode(mode, line_code),
        "lineCode": line_code,
        "nameKey": normalize_text(name),
        "stationCode": station_code,
        "variantHints": parse_variant_hints(mode, props),
        "sourceCount": 1,
        "dailyRidership": ridership,
    }


def finalize_line_station_ridership(stations, ridership_by_line):
    stations_per_line = defaultdict(list)
    for station in stations:
        stations_per_line[station["lineCode"]].append(station)

    for code, line_stations in stations_per_line.items():
        line_daily = ridership_by_line.get(code, 0)
        per_station = round(line_daily / max(1, len(line_stations)))
        for station in line_stations:
            station["dailyRidership"] = per_station

    for station in stations:
        station.pop("lineCode", None)
        station.pop("nameKey", None)
        station.pop("stationCode", None)

    return stations


def build_metro_stations_from_shp(stations_shp: Path, ridership_by_station: dict):
    features = read_shp_features(stations_shp)
    by_station = {}

    for feature in features:
        if feature["geometry"]["type"] != "Point":
            continue
        point = feature["geometry"]["coordinates"]
        props = feature["properties"]
        name = props.get("NOMBRE") or f"Estacion Metro {len(by_station) + 1}"
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


def build_distributed_shp_stations(stations_shp: Path, ridership_by_line: dict, mode: str, default_line_code="0"):
    features = read_shp_features(stations_shp)
    raw = []

    for index, feature in enumerate(features):
        if feature["geometry"]["type"] != "Point":
            continue
        point = feature["geometry"]["coordinates"]
        props = feature["properties"]
        raw_line = props.get("LINEA") or props.get("LINE") or ""
        codes = parse_line_codes(raw_line, mode)
        code = codes[0] if codes else default_line_code
        default_name = f"Estacion {SYSTEM_LABELS.get(mode, mode)} {index + 1}"
        raw.append(build_station_record(mode, point, props, default_name, code, index))

    collapsed = collapse_stations_by_line(raw, mode)
    return finalize_line_station_ridership(collapsed, ridership_by_line)


def build_metro_stations(stations_kmz: Path, ridership_by_station: dict):
    if stations_kmz.suffix.lower() == ".shp":
        return build_metro_stations_from_shp(stations_kmz, ridership_by_station)

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
    return build_distributed_kmz_stations(stations_kmz, ridership_by_line, "metrobus")


def build_distributed_kmz_stations(stations_kmz: Path, ridership_by_line: dict, mode: str, default_line_code="0"):
    if stations_kmz.suffix.lower() == ".shp":
        return build_distributed_shp_stations(stations_kmz, ridership_by_line, mode, default_line_code=default_line_code)

    placemarks = read_kmz_placemarks(stations_kmz)
    raw = []

    for index, pm in enumerate(placemarks):
        point = pm["point"]
        if not point:
            continue

        props = pm["properties"]
        default_name = f"Estacion {SYSTEM_LABELS.get(mode, mode)} {index + 1}"
        name = props.get("NOMBRE") or pm["name"] or default_name
        raw_line = props.get("LINEA") or props.get("LINE") or pm["name"] or ""
        codes = parse_line_codes(raw_line, mode)
        code = codes[0] if codes else default_line_code
        est_code = normalize_text(props.get("EST") or "")
        base_slug = normalize_text(name)

        raw.append(
            {
                "id": f"{mode}-{code}-{est_code or base_slug}-{index}",
                "name": fix_mojibake(name),
                "mode": mode,
                "coordinates": point,
                "lines": [line_label(mode, code)],
                "lineColor": color_for_mode(mode, code),
                "lineCode": code,
                "nameKey": normalize_text(name),
                "stationCode": fix_mojibake(props.get("CVE_EST") or props.get("EST") or ""),
                "variantHints": parse_variant_hints(mode, props),
                "sourceCount": 1,
                "dailyRidership": 0,
            }
        )

    raw = collapse_stations_by_line(raw, mode)

    return finalize_line_station_ridership(raw, ridership_by_line)


def collapse_station_cluster(target, station):
    count = target.get("sourceCount", 1)
    target["coordinates"] = [
        round(((target["coordinates"][0] * count) + station["coordinates"][0]) / (count + 1), 6),
        round(((target["coordinates"][1] * count) + station["coordinates"][1]) / (count + 1), 6),
    ]
    target["variantHints"] = unique_list(target.get("variantHints", []) + station.get("variantHints", []))
    target["sourceCount"] = count + station.get("sourceCount", 1)
    target["name"] = min([target["name"], station["name"]], key=lambda value: (len(value), value))
    if not target.get("stationCode") and station.get("stationCode"):
        target["stationCode"] = station["stationCode"]


def collapse_stations_by_line(stations, mode):
    threshold = DEDUP_DISTANCE_BY_MODE.get(mode, 50)
    grouped = defaultdict(list)
    for station in stations:
        grouped[station["lineCode"]].append(station)

    collapsed = []
    for line_code, line_stations in grouped.items():
        clusters = []
        ordered = sorted(line_stations, key=lambda item: (item["nameKey"], item["coordinates"][0], item["coordinates"][1], item["id"]))
        for station in ordered:
            match = None
            for candidate in clusters:
                same_name = station["nameKey"] == candidate["nameKey"]
                same_code = station.get("stationCode") and station["stationCode"] == candidate.get("stationCode")
                if not same_name and not same_code:
                    continue
                if haversine_meters(station["coordinates"], candidate["coordinates"]) <= threshold:
                    match = candidate
                    break

            if match:
                collapse_station_cluster(match, station)
                continue

            base_slug = station["stationCode"] or station["nameKey"] or f"linea-{line_code}"
            station_copy = dict(station)
            station_copy["id"] = f"{mode}-{line_code}-{normalize_text(base_slug)}-{len(clusters)}"
            clusters.append(station_copy)

        collapsed.extend(clusters)

    return collapsed


def build_line_geometries(lines_kmz: Path, mode):
    if lines_kmz.suffix.lower() == ".shp":
        return build_line_geometries_from_shp(lines_kmz, mode)

    placemarks = read_kmz_placemarks(lines_kmz)
    by_line = defaultdict(dict)

    for pm in placemarks:
        props = pm["properties"]
        codes = parse_line_codes(props.get("LINEA") or pm["name"], mode)
        if not codes:
            continue

        segments = [coords for coords in pm["lineStrings"] if len(coords) >= 2]
        if not segments:
            continue

        for code in codes:
            line = line_label(mode, code)
            variant_meta = build_variant_metadata(mode, props, pm["name"])
            line_bucket = by_line[(mode, line)]
            variant_bucket = line_bucket.setdefault(
                variant_meta["variantKey"],
                {
                    "mode": mode,
                    "line": line,
                    "variantKey": variant_meta["variantKey"],
                    "variantLabel": variant_meta["variantLabel"],
                    "variantHints": variant_meta["variantHints"],
                    "routeName": variant_meta["routeName"],
                    "segmentName": variant_meta["segmentName"],
                    "circuito": variant_meta["circuito"],
                    "segments": [],
                },
            )
            variant_bucket["segments"].extend(segments)

    return {key: list(variants.values()) for key, variants in by_line.items()}


def build_line_geometries_from_shp(lines_shp: Path, mode):
    features = read_shp_features(lines_shp)
    by_line = defaultdict(dict)

    for feature in features:
        if feature["geometry"]["type"] != "MultiLineString":
            continue
        props = feature["properties"]
        codes = parse_line_codes(props.get("LINEA") or props.get("LINE") or props.get("RUTA") or "", mode)
        if not codes:
            continue

        segments = [coords for coords in feature["geometry"]["coordinates"] if len(coords) >= 2]
        if not segments:
            continue

        for code in codes:
            line = line_label(mode, code)
            variant_meta = build_variant_metadata(mode, props, props.get("RUTA") or "")
            line_bucket = by_line[(mode, line)]
            variant_bucket = line_bucket.setdefault(
                variant_meta["variantKey"],
                {
                    "mode": mode,
                    "line": line,
                    "variantKey": variant_meta["variantKey"],
                    "variantLabel": variant_meta["variantLabel"],
                    "variantHints": variant_meta["variantHints"],
                    "routeName": variant_meta["routeName"],
                    "segmentName": variant_meta["segmentName"],
                    "circuito": variant_meta["circuito"],
                    "segments": [],
                },
            )
            variant_bucket["segments"].extend(segments)

    return {key: list(variants.values()) for key, variants in by_line.items()}


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


def project_station_to_variant(station, variant):
    best = None
    for segment in variant.get("segments", []):
        projection = project_point_to_polyline(station["coordinates"], segment)
        if not best or projection["distance"] < best["distance"]:
            best = projection
    return best


def assign_stations_to_variants(line_stations, variants, mode):
    if not variants:
        return {"default": line_stations}
    if len(variants) == 1:
        return {variants[0]["variantKey"]: line_stations}

    threshold = VARIANT_ASSIGN_DISTANCE_BY_MODE.get(mode, 120)
    tolerance = 35 if mode in {"metrobus", "trolebus"} else 25
    grouped = defaultdict(list)

    for station in line_stations:
        scored = []
        for variant in variants:
            projection = project_station_to_variant(station, variant)
            if projection is None:
                continue
            scored.append(
                {
                    "variantKey": variant["variantKey"],
                    "distance": projection["distance"],
                    "hintMatch": bool(set(station.get("variantHints", [])) & set(variant.get("variantHints", []))),
                }
            )

        if not scored:
            grouped[variants[0]["variantKey"]].append(station)
            continue

        hinted = [item for item in scored if item["hintMatch"]]
        pool = hinted or scored
        best_distance = min(item["distance"] for item in pool)
        selected = [
            item
            for item in pool
            if item["distance"] <= threshold and item["distance"] <= best_distance + tolerance
        ]
        if not selected:
            selected = [min(pool, key=lambda item: item["distance"])]

        for item in selected:
            grouped[item["variantKey"]].append(station)

    return grouped


def line_distance_limit(mode, distances):
    cap = MAX_STEP_DISTANCE_BY_MODE.get(mode, 3000)
    if not distances:
        return cap
    baseline = MIN_STEP_DISTANCE_BY_MODE.get(mode, 50) * 8
    return min(cap, max(baseline, statistics.median(distances) * 3.5))


def should_skip_short_edge(a, b, mode, distance_m):
    if distance_m <= 15:
        return True

    same_name = normalize_text(a["name"]) == normalize_text(b["name"])
    min_distance = MIN_STEP_DISTANCE_BY_MODE.get(mode, 50)
    return same_name and distance_m <= min_distance


def gtfs_line_code(mode, route_short_name):
    codes = parse_line_codes(route_short_name, mode)
    if codes:
        return codes[0]
    if mode == "trenligero":
        return "1"
    return normalize_text(route_short_name)


def build_station_lookup(stations):
    by_line = defaultdict(list)
    by_id = {}
    for station in stations:
        by_id[station["id"]] = station
        for line in station["lines"]:
            by_line[(station["mode"], line)].append(station)
    return by_line, by_id


def match_gtfs_stop_to_station(stop, candidates):
    if not candidates:
        return None

    stop_name_key = normalize_text(stop.get("stop_name", ""))
    stop_point = [float(stop.get("stop_lon", 0) or 0), float(stop.get("stop_lat", 0) or 0)]
    exact = [candidate for candidate in candidates if normalize_text(candidate["name"]) == stop_name_key]
    pool = exact or candidates
    best = min(pool, key=lambda candidate: haversine_meters(stop_point, candidate["coordinates"]))
    return best


def build_routes_from_gtfs(stations, gtfs_data):
    station_lookup, stations_by_id = build_station_lookup(stations)
    routes_by_id = {route["route_id"]: route for route in gtfs_data["routes.txt"]}
    route_trips = defaultdict(list)
    for trip in gtfs_data["trips.txt"]:
        route = routes_by_id.get(trip["route_id"])
        if not route:
            continue
        route_trips[trip["route_id"]].append(trip)

    stop_times_by_trip = defaultdict(list)
    for stop_time in gtfs_data["stop_times.txt"]:
        stop_times_by_trip[stop_time["trip_id"]].append(stop_time)
    for trip_id in stop_times_by_trip:
        stop_times_by_trip[trip_id].sort(key=lambda item: int(item.get("stop_sequence", "0") or 0))

    stops_by_id = {stop["stop_id"]: stop for stop in gtfs_data["stops.txt"]}
    features_by_pair = {}

    for route_id, route in sorted(routes_by_id.items()):
        agency_id = route.get("agency_id", "")
        if agency_id not in GTFS_AGENCY_TO_MODE:
            continue
        mode = GTFS_AGENCY_TO_MODE[agency_id]
        if mode not in {station["mode"] for station in stations}:
            continue

        line_code = gtfs_line_code(mode, route.get("route_short_name", ""))
        line = line_label(mode, line_code)
        candidates = station_lookup.get((mode, line), [])
        if not candidates:
            continue

        variants = {}
        for trip in route_trips.get(route_id, []):
            variant_key = "|".join(
                [
                    route_id,
                    trip.get("direction_id", "0"),
                    trip.get("shape_id", "shape"),
                    normalize_text(trip.get("trip_headsign", "") or route.get("route_long_name", "")) or "default",
                ]
            )
            variants.setdefault(variant_key, trip)

        for variant_key, trip in variants.items():
            sequence = []
            for stop_time in stop_times_by_trip.get(trip["trip_id"], []):
                stop = stops_by_id.get(stop_time.get("stop_id", ""))
                if not stop:
                    continue
                station = match_gtfs_stop_to_station(stop, candidates)
                if not station:
                    continue
                if sequence and sequence[-1]["id"] == station["id"]:
                    continue
                sequence.append(station)

            if len(sequence) < 2:
                continue

            for index in range(len(sequence) - 1):
                a = sequence[index]
                b = sequence[index + 1]
                distance_m = round(haversine_meters(a["coordinates"], b["coordinates"]))
                if should_skip_short_edge(a, b, mode, distance_m):
                    continue
                if distance_m > MAX_STEP_DISTANCE_BY_MODE.get(mode, 3000):
                    continue

                pair = tuple(sorted([a["id"], b["id"]]))
                edge_key = (mode, line, pair[0], pair[1])
                variant_label = trip.get("trip_headsign", "") or route.get("route_long_name", "") or "Ruta principal"
                feature = features_by_pair.get(edge_key)
                if feature is None:
                    features_by_pair[edge_key] = {
                        "type": "Feature",
                        "properties": {
                            "mode": mode,
                            "line": line,
                            "variant": variant_key,
                            "variantLabel": variant_label,
                            "variantLabels": [variant_label],
                            "variantCount": 1,
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
                    continue

                labels = set(feature["properties"].get("variantLabels", []))
                labels.add(variant_label)
                feature["properties"]["variantLabels"] = sorted(labels)
                feature["properties"]["variantCount"] = len(labels)
                feature["properties"]["variantLabel"] = " | ".join(feature["properties"]["variantLabels"])

    return {"type": "FeatureCollection", "features": list(features_by_pair.values())}


def build_routes_from_stations(stations, line_geometries):
    grouped = defaultdict(list)
    for station in stations:
        for line in station["lines"]:
            grouped[(station["mode"], line)].append(station)

    features = []
    edge_keys = set()

    for (mode, line), line_stations in grouped.items():
        variants = line_geometries.get((mode, line), [])
        assigned = assign_stations_to_variants(line_stations, variants, mode)
        variant_index = {variant["variantKey"]: variant for variant in variants}

        for variant_key, variant_stations in assigned.items():
            variant = variant_index.get(variant_key, {"segments": [], "variantKey": variant_key, "variantLabel": "Ruta principal"})
            ordered = order_stations_by_topology(variant_stations, variant.get("segments", []))
            candidate_edges = []
            for idx in range(len(ordered) - 1):
                a = ordered[idx]
                b = ordered[idx + 1]
                if a["id"] == b["id"]:
                    continue

                distance_m = round(haversine_meters(a["coordinates"], b["coordinates"]))
                if should_skip_short_edge(a, b, mode, distance_m):
                    continue

                candidate_edges.append((a, b, distance_m))

            distance_limit = line_distance_limit(mode, [distance for _, _, distance in candidate_edges])
            for a, b, distance_m in candidate_edges:
                if distance_m > distance_limit:
                    continue

                pair = tuple(sorted([a["id"], b["id"]]))
                edge_key = (mode, line, pair[0], pair[1])
                if edge_key in edge_keys:
                    continue
                edge_keys.add(edge_key)

                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "mode": mode,
                            "line": line,
                            "variant": variant.get("variantKey", variant_key),
                            "variantLabel": variant.get("variantLabel", "Ruta principal"),
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


def build_optional_subsystem(data_dir: Path, config: dict):
    ridership_csv = first_existing_path(data_dir, config["ridership_candidates"])
    ridership_exists = ridership_csv.exists()
    ridership_by_line = (
        compute_average_ridership_by_key(ridership_csv, key_field="linea", default_key=config.get("line_code", "0"))
        if ridership_exists and config["mode"] != "trenligero"
        else compute_average_ridership_by_key(ridership_csv, default_key=config.get("line_code", "1"))
        if ridership_exists
        else {}
    )

    shp_cache_dir = Path(tempfile.gettempdir()) / "smart-commute-cdmx-electric-shp"
    kmz_cache_dir = Path(tempfile.gettempdir()) / "smart-commute-cdmx-electric-kmz"
    stations_shp_candidate = first_existing_path(data_dir, config["shp_candidates"]["stations"])
    lines_shp_candidate = first_existing_path(data_dir, config["shp_candidates"]["lines"])
    stations_candidate = first_matching_glob(data_dir, config["cartography_globs"]["stations"])
    lines_candidate = first_matching_glob(data_dir, config["cartography_globs"]["lines"])
    stations_source = None
    lines_source = None

    if stations_shp_candidate.exists() and lines_shp_candidate.exists():
        stations_source = ensure_extracted_shp(stations_shp_candidate, config["shp_candidates"]["station_keywords"], shp_cache_dir)
        lines_source = ensure_extracted_shp(lines_shp_candidate, config["shp_candidates"]["line_keywords"], shp_cache_dir)

    if stations_source is None or lines_source is None:
        stations_source = (
            ensure_extracted_kmz(stations_candidate, config["archive_members"]["stations"], kmz_cache_dir)
            if stations_candidate is not None
            else None
        )
        lines_source = (
            ensure_extracted_kmz(lines_candidate, config["archive_members"]["lines"], kmz_cache_dir)
            if lines_candidate is not None
            else None
        )

    has_geography = stations_source is not None and lines_source is not None

    stations = []
    line_geometries = {}
    if has_geography and stations_source is not None and lines_source is not None:
        try:
            stations = build_distributed_kmz_stations(
                stations_source,
                ridership_by_line,
                config["mode"],
                default_line_code=config.get("line_code", "0"),
            )
            line_geometries = build_line_geometries(lines_source, config["mode"])
        except Exception:
            stations_source = (
                ensure_extracted_kmz(stations_candidate, config["archive_members"]["stations"], kmz_cache_dir)
                if stations_candidate is not None
                else None
            )
            lines_source = (
                ensure_extracted_kmz(lines_candidate, config["archive_members"]["lines"], kmz_cache_dir)
                if lines_candidate is not None
                else None
            )
            has_geography = stations_source is not None and lines_source is not None
            if has_geography and stations_source is not None and lines_source is not None:
                stations = build_distributed_kmz_stations(
                    stations_source,
                    ridership_by_line,
                    config["mode"],
                    default_line_code=config.get("line_code", "0"),
                )
                line_geometries = build_line_geometries(lines_source, config["mode"])

    return {
        "mode": config["mode"],
        "label": config["label"],
        "ridershipCsv": ridership_csv,
        "ridershipByLine": ridership_by_line,
        "stationsKmz": stations_source,
        "linesKmz": lines_source,
        "hasGeography": has_geography,
        "stations": stations,
        "lineGeometries": line_geometries,
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


def build_network_diagnostics(stations, routes):
    stations_by_id = {station["id"]: station for station in stations}
    suspicious_lines = []
    summary_by_mode = {}

    line_buckets = defaultdict(list)
    for feature in routes["features"]:
        props = feature["properties"]
        line_buckets[(props["mode"], props["line"])].append(feature)

    for mode in sorted({station["mode"] for station in stations}):
        mode_routes = [feature for feature in routes["features"] if feature["properties"]["mode"] == mode]
        distances = sorted(feature["properties"]["distanceM"] for feature in mode_routes)
        summary_by_mode[mode] = {
            "stationCount": sum(1 for station in stations if station["mode"] == mode),
            "edgeCount": len(mode_routes),
            "medianDistanceM": round(statistics.median(distances)) if distances else 0,
            "maxDistanceM": max(distances) if distances else 0,
        }

    for (mode, line), features in sorted(line_buckets.items()):
        distances = [feature["properties"]["distanceM"] for feature in features]
        short_edges = []
        long_edges = []
        for feature in sorted(features, key=lambda item: item["properties"]["distanceM"]):
            props = feature["properties"]
            from_station = stations_by_id[props["from"]]
            to_station = stations_by_id[props["to"]]
            record = {
                "variant": props.get("variantLabel") or props.get("variant") or "Ruta principal",
                "distanceM": props["distanceM"],
                "from": from_station["name"],
                "to": to_station["name"],
            }
            if should_skip_short_edge(from_station, to_station, mode, props["distanceM"]):
                short_edges.append(record)
            if props["distanceM"] > line_distance_limit(mode, distances):
                long_edges.append(record)

        line_stations = [station for station in stations if station["mode"] == mode and line in station["lines"]]
        duplicate_groups = []
        by_name = defaultdict(list)
        for station in line_stations:
            by_name[normalize_text(station["name"])].append(station)

        duplicate_threshold = DEDUP_DISTANCE_BY_MODE.get(mode, 50) * 2
        for name_key, named_stations in by_name.items():
            if len(named_stations) < 2:
                continue

            min_distance = min(
                haversine_meters(named_stations[left]["coordinates"], named_stations[right]["coordinates"])
                for left in range(len(named_stations))
                for right in range(left + 1, len(named_stations))
            )
            if min_distance > duplicate_threshold:
                continue

            duplicate_groups.append(
                {
                    "name": named_stations[0]["name"],
                    "count": len(named_stations),
                    "minDistanceM": round(min_distance),
                }
            )

        suspicious_score = len(short_edges) + len(long_edges) + len(duplicate_groups)
        if suspicious_score == 0:
            continue

        suspicious_lines.append(
            {
                "mode": mode,
                "line": line,
                "stationCount": len(line_stations),
                "edgeCount": len(features),
                "medianDistanceM": round(statistics.median(distances)) if distances else 0,
                "maxDistanceM": max(distances) if distances else 0,
                "duplicateStationNames": sorted(duplicate_groups, key=lambda item: (-item["count"], item["minDistanceM"], item["name"]))[:12],
                "shortEdges": short_edges[:12],
                "longEdges": sorted(long_edges, key=lambda item: item["distanceM"], reverse=True)[:12],
            }
        )

    suspicious_lines.sort(
        key=lambda item: (
            -(len(item["shortEdges"]) + len(item["longEdges"]) + len(item["duplicateStationNames"])),
            -item["maxDistanceM"],
            item["mode"],
            item["line"],
        )
    )

    return {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "summaryByMode": summary_by_mode,
        "suspiciousLines": suspicious_lines,
    }


def main():
    data_dir = read_data_dir()
    if not data_dir.exists():
        raise SystemExit(f"Data directory not found: {data_dir}")

    gtfs_zip = first_existing_path(data_dir, GTFS_CANDIDATES)

    metro_stations_shp = first_existing_path(data_dir, [Path("raw-data/stc-metro/cartography/shp/STC_Metro_estaciones_utm14n.shp")])
    metro_lines_shp = first_existing_path(data_dir, [Path("raw-data/stc-metro/cartography/shp/STC_Metro_lineas_utm14n.shp")])
    metro_stations_kmz = first_existing_path(data_dir, [Path("raw-data/stc-metro/cartography/kmz/STC_Metro_estaciones.kmz"), Path("stcmetro_kmz/STC_Metro_estaciones.kmz")])
    metro_lines_kmz = first_existing_path(data_dir, [Path("raw-data/stc-metro/cartography/kmz/STC_Metro_lineas.kmz"), Path("stcmetro_kmz/STC_Metro_lineas.kmz")])
    metrobus_stations_shp = first_existing_path(data_dir, [Path("raw-data/metrobus/cartography/shp/Metrobus_estaciones.shp")])
    metrobus_lines_shp = first_existing_path(data_dir, [Path("raw-data/metrobus/cartography/shp/Metrobus_lineas.shp")])
    metrobus_stations_kmz = first_existing_path(data_dir, [Path("raw-data/metrobus/cartography/kmz/Metrobus_estaciones.kmz"), Path("mb_kmz/Metrobus_estaciones.kmz")])
    metrobus_lines_kmz = first_existing_path(data_dir, [Path("raw-data/metrobus/cartography/kmz/Metrobus_lineas.kmz"), Path("mb_kmz/Metrobus_lineas.kmz")])

    metro_stations_source = metro_stations_shp if metro_stations_shp.exists() else metro_stations_kmz
    metro_lines_source = metro_lines_shp if metro_lines_shp.exists() else metro_lines_kmz
    metrobus_stations_source = metrobus_stations_shp if metrobus_stations_shp.exists() else metrobus_stations_kmz
    metrobus_lines_source = metrobus_lines_shp if metrobus_lines_shp.exists() else metrobus_lines_kmz
    metro_ridership_csv = first_existing_path(
        data_dir,
        [
            Path("raw-data/stc-metro/ridership/afluenciastc_desglosado_03_2026.csv"),
            Path("afluenciastc_desglosado_03_2026.csv"),
        ],
    )
    metrobus_ridership_csv = first_existing_path(
        data_dir,
        [
            Path("raw-data/metrobus/ridership/afluenciamb_desglosado_03_2026.csv"),
            Path("afluenciamb_desglosado_03_2026.csv"),
        ],
    )

    required = [
        gtfs_zip,
        metro_stations_source,
        metro_lines_source,
        metrobus_stations_source,
        metrobus_lines_source,
        metro_ridership_csv,
        metrobus_ridership_csv,
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit(f"Missing required files: {', '.join(missing)}")

    gtfs_data = read_gtfs_feed(gtfs_zip)
    metro_ridership = compute_metro_ridership_by_station(metro_ridership_csv)
    metrobus_ridership = compute_metrobus_ridership_by_line(metrobus_ridership_csv)
    electric_subsystems = [build_optional_subsystem(data_dir, subsystem) for subsystem in ELECTRIC_SUBSYSTEMS]

    try:
        metro_stations = build_metro_stations(metro_stations_source, metro_ridership)
        metro_line_geometries = build_line_geometries(metro_lines_source, "metro")
    except Exception:
        metro_stations = build_metro_stations(metro_stations_kmz, metro_ridership)
        metro_line_geometries = build_line_geometries(metro_lines_kmz, "metro")

    try:
        metrobus_stations = build_metrobus_stations(metrobus_stations_source, metrobus_ridership)
        metrobus_line_geometries = build_line_geometries(metrobus_lines_source, "metrobus")
    except Exception:
        metrobus_stations = build_metrobus_stations(metrobus_stations_kmz, metrobus_ridership)
        metrobus_line_geometries = build_line_geometries(metrobus_lines_kmz, "metrobus")

    electric_stations = [station for subsystem in electric_subsystems for station in subsystem["stations"]]
    all_stations = sorted(metro_stations + metrobus_stations + electric_stations, key=lambda item: item["dailyRidership"], reverse=True)

    line_geometries = {
        **metro_line_geometries,
        **metrobus_line_geometries,
        **{key: value for subsystem in electric_subsystems for key, value in subsystem["lineGeometries"].items()},
    }
    routes = build_routes_from_gtfs(all_stations, gtfs_data)
    if not routes["features"]:
        routes = build_routes_from_stations(all_stations, line_geometries)
    diagnostics = build_network_diagnostics(all_stations, routes)

    station_payload = [station_metrics(station, all_stations) for station in all_stations]
    network_ridership = sum(item["dailyRidership"] for item in station_payload)

    mvp_context = load_mvp_context()
    metrobus_top = sorted(
        [
            {
                "systemKey": "metrobus",
                "systemLabel": "Metrobus",
                "line": f"Línea {line}",
                "averageDailyRidership": value,
                "hasGeography": True,
            }
            for line, value in metrobus_ridership.items()
        ],
        key=lambda item: item["averageDailyRidership"],
        reverse=True,
    )[:6]
    electric_top_lines = sorted(
        [
            {
                "systemKey": subsystem["mode"],
                "systemLabel": subsystem["label"],
                "line": line_label(subsystem["mode"], line_code),
                "averageDailyRidership": value,
                "hasGeography": subsystem["hasGeography"],
            }
            for subsystem in electric_subsystems
            for line_code, value in subsystem["ridershipByLine"].items()
        ],
        key=lambda item: item["averageDailyRidership"],
        reverse=True,
    )[:8]
    system_daily_ridership = [
        {
            "key": "metro",
            "label": "Metro",
            "averageDailyRidership": sum(metro_ridership.values()),
            "stationCount": len(metro_stations),
            "lineCount": len({line for station in metro_stations for line in station["lines"]}),
            "hasGeography": True,
        },
        {
            "key": "metrobus",
            "label": "Metrobus",
            "averageDailyRidership": sum(metrobus_ridership.values()),
            "stationCount": len(metrobus_stations),
            "lineCount": len(metrobus_ridership),
            "hasGeography": True,
        },
        *[
            {
                "key": subsystem["mode"],
                "label": subsystem["label"],
                "averageDailyRidership": sum(subsystem["ridershipByLine"].values()),
                "stationCount": len(subsystem["stations"]),
                "lineCount": len(subsystem["ridershipByLine"]),
                "hasGeography": subsystem["hasGeography"],
            }
            for subsystem in electric_subsystems
            if subsystem["ridershipByLine"]
        ],
    ]
    multimodal_modes = ", ".join(summary["label"] for summary in system_daily_ridership)
    electric_context_note = " Los subsistemas electricos se resuelven con GTFS para secuencia/sentido y SHP local para geometria cuando esta disponible." if any(subsystem["hasGeography"] for subsystem in electric_subsystems) else ""

    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    multimodal = {
        "generatedAt": generated_at,
        "scopeNote": f"Dataset multimodal generado con afluencia 2026 para {multimodal_modes}. Metro y Metrobus ya operan con cobertura geoespacial completa; la solucion tambien incorpora Transportes Electricos desde raw-data/transportes-electricos.{electric_context_note}",
        "methodologyNote": "GTFS define variantes, secuencia y sentido; SHP local define la geometria y el catalogo de estaciones cuando existe; la afluencia solo enriquece la capa analitica. Cuando falta GTFS o una reconciliacion suficiente, el ETL conserva fallback topologico desde cartografia oficial.",
        "summary": {
            "impactModelVersion": "v4.0-gtfs-shp-topology",
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
            "systemDailyRidership": system_daily_ridership,
            "topNetworkLines": metrobus_top + electric_top_lines,
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
            "sourceMode": "gtfs-shp-multimodal",
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
            "sourceMode": "gtfs-shp-multimodal",
            "type": "FeatureCollection",
            "features": routes["features"],
        },
    )

    write_json(
        "precomputed_impact.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "gtfs-shp-multimodal",
            "methodology": "gtfs-sequence-shp-geometry-ridership-enrichment",
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

    write_json("network-diagnostics.json", diagnostics)

    write_json(
        "etl-manifest.json",
        {
            "generatedAt": generated_at,
            "sourceMode": "gtfs-shp-multimodal",
            "inputs": {
                "dataDir": str(data_dir),
                "gtfsZip": gtfs_zip.exists(),
                "metroStationsSource": str(metro_stations_source),
                "metroLinesSource": str(metro_lines_source),
                "metrobusStationsSource": str(metrobus_stations_source),
                "metrobusLinesSource": str(metrobus_lines_source),
                "metroRidershipCsv": metro_ridership_csv.exists(),
                "metrobusRidershipCsv": metrobus_ridership_csv.exists(),
                "electricSubsystems": {
                    subsystem["mode"]: {
                        "ridershipCsv": subsystem["ridershipCsv"].exists(),
                        "stationsSource": str(subsystem["stationsKmz"]) if subsystem["stationsKmz"] is not None else "",
                        "linesSource": str(subsystem["linesKmz"]) if subsystem["linesKmz"] is not None else "",
                        "hasGeography": subsystem["hasGeography"],
                    }
                    for subsystem in electric_subsystems
                },
            },
            "outputs": [
                "multimodal-data.json",
                "stations.json",
                "routes.json",
                "precomputed_impact.json",
                "network-diagnostics.json",
            ],
        },
    )

    print(
        f"[multimodal-etl] stations={len(all_stations)} metro={len(metro_stations)} metrobus={len(metrobus_stations)} electric={len(electric_stations)} routes={len(routes['features'])}"
    )


if __name__ == "__main__":
    main()
