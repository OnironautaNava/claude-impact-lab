import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const defaultDataDir = path.resolve(rootDir, '..', 'docs', 'data');
const localDataConfigPath = path.resolve(rootDir, 'data-source.local');
const outputDir = path.resolve(rootDir, 'public', 'data');
const existingMvpPath = path.resolve(outputDir, 'mvp-data.json');

const lineColors = {
  'Linea 1': '#ec4899',
  'Linea 2': '#2563eb',
  'Linea 3': '#84cc16',
  'Linea 4': '#06b6d4',
  'Linea 5': '#eab308',
  'Linea 6': '#ef4444',
  'Linea 7': '#f97316',
  'Linea 8': '#22c55e',
  'Linea 9': '#a16207',
  'Linea A': '#7c3aed',
  'Linea B': '#64748b',
  'Linea 12': '#d4a017',
};

const resolveDataDir = (configuredPath) => {
  if (!configuredPath) {
    return defaultDataDir;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(rootDir, configuredPath);
};

const readLocalDataDir = () => {
  if (!fs.existsSync(localDataConfigPath)) {
    return '';
  }

  return fs.readFileSync(localDataConfigPath, 'utf8').trim();
};

const configuredDataDir = process.env.SMART_COMMUTE_DATA_DIR?.trim() || readLocalDataDir();
const dataDir = resolveDataDir(configuredDataDir);

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const findInputFile = (baseDir, candidates) => {
  for (const relativePath of candidates) {
    const resolved = path.resolve(baseDir, relativePath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return path.resolve(baseDir, candidates[0]);
};

const fixMojibake = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('A?') || trimmed.includes('A')) {
    try {
      return Buffer.from(trimmed, 'latin1').toString('utf8').trim();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
};

const slugify = (value) =>
  fixMojibake(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
};

const parseCsv = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((acc, key, index) => {
      acc[key] = values[index] ?? '';
      return acc;
    }, {});
  });
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const haversineMeters = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
};

const toLineLabel = (routeShortName, routeLongName) => {
  const raw = `${routeShortName ?? ''} ${routeLongName ?? ''}`;
  const matchNumber = raw.match(/\b([1-9]|1[0-2])\b/);
  const matchLetter = raw.match(/\b([AB])\b/i);

  if (matchNumber) {
    return `Linea ${matchNumber[1]}`;
  }

  if (matchLetter) {
    return `Linea ${matchLetter[1].toUpperCase()}`;
  }

  return null;
};

const resolveGtfsDir = (baseDir) => {
  const candidates = [
    path.resolve(baseDir, 'raw-data', 'stc-metro', 'gtfs'),
    path.resolve(baseDir, 'gtfs'),
    path.resolve(baseDir, 'GTFS'),
    baseDir,
  ];
  const required = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'];

  for (const candidate of candidates) {
    const complete = required.every((fileName) => fs.existsSync(path.resolve(candidate, fileName)));
    if (complete) {
      return candidate;
    }
  }

  return null;
};

const loadMetroRidershipByStation = (baseDir) => {
  const csvPath = findInputFile(baseDir, [
    'raw-data/stc-metro/ridership/afluenciastc_desglosado_03_2026.csv',
    'afluenciastc_desglosado_03_2026.csv',
  ]);
  if (!fs.existsSync(csvPath)) {
    return new Map();
  }

  const rows = parseCsv(csvPath).map((row) => ({
    date: row.fecha,
    station: fixMojibake(row.estacion),
    ridership: Number.parseInt(row.afluencia, 10) || 0,
  }));

  const latest = rows.reduce((acc, row) => (row.date > acc ? row.date : acc), '');
  const cutoff = new Date(latest);
  cutoff.setDate(cutoff.getDate() - 89);

  const totals = new Map();
  const dailyBuckets = new Set();

  for (const row of rows) {
    const rowDate = new Date(row.date);
    if (rowDate < cutoff) {
      continue;
    }

    dailyBuckets.add(row.date);
    const stationId = slugify(row.station);
    totals.set(stationId, (totals.get(stationId) ?? 0) + row.ridership);
  }

  const days = Math.max(1, dailyBuckets.size);
  return new Map(Array.from(totals.entries()).map(([key, value]) => [key, Math.round(value / days)]));
};

const buildFromGtfs = (gtfsDir, ridershipByStation) => {
  const stops = parseCsv(path.resolve(gtfsDir, 'stops.txt'));
  const routes = parseCsv(path.resolve(gtfsDir, 'routes.txt'));
  const trips = parseCsv(path.resolve(gtfsDir, 'trips.txt'));
  const stopTimes = parseCsv(path.resolve(gtfsDir, 'stop_times.txt'));

  const metroRoutes = routes
    .map((route) => {
      const lineLabel = toLineLabel(route.route_short_name, route.route_long_name);
      return {
        routeId: String(route.route_id ?? ''),
        lineLabel,
        routeShortName: fixMojibake(route.route_short_name ?? ''),
      };
    })
    .filter((route) => Boolean(route.routeId) && Boolean(route.lineLabel));

  if (metroRoutes.length === 0) {
    return { stations: [], routes: [] };
  }

  const routeById = new Map(metroRoutes.map((route) => [route.routeId, route]));
  const tripByRoute = new Map();
  for (const trip of trips) {
    const routeId = String(trip.route_id ?? '');
    if (!routeById.has(routeId) || tripByRoute.has(routeId)) {
      continue;
    }
    tripByRoute.set(routeId, String(trip.trip_id ?? ''));
  }

  const stopRowsByTrip = new Map();
  for (const row of stopTimes) {
    const tripId = String(row.trip_id ?? '');
    if (!tripId) {
      continue;
    }
    if (!stopRowsByTrip.has(tripId)) {
      stopRowsByTrip.set(tripId, []);
    }
    stopRowsByTrip.get(tripId).push(row);
  }

  const stopById = new Map(
    stops.map((stop) => [
      String(stop.stop_id ?? ''),
      {
        stopId: String(stop.stop_id ?? ''),
        name: fixMojibake(stop.stop_name ?? ''),
        lat: toNumber(stop.stop_lat, Number.NaN),
        lng: toNumber(stop.stop_lon, Number.NaN),
      },
    ]),
  );

  const stationMap = new Map();
  const routeSegments = [];

  for (const [routeId, tripId] of tripByRoute.entries()) {
    const routeInfo = routeById.get(routeId);
    const stopSequence = (stopRowsByTrip.get(tripId) ?? [])
      .slice()
      .sort((a, b) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0))
      .map((row) => String(row.stop_id ?? ''));

    const lineStops = stopSequence
      .map((stopId) => stopById.get(stopId))
      .filter((stop) => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng));

    for (const stop of lineStops) {
      const key = slugify(stop.name);
      const stationId = stationMap.has(key) ? stationMap.get(key).id : key;
      const existing = stationMap.get(key);
      const dailyRidership = ridershipByStation.get(key) ?? 0;

      if (!existing) {
        stationMap.set(key, {
          id: stationId,
          name: stop.name,
          type: 'metro',
          coordinates: [stop.lng, stop.lat],
          lines: [routeInfo.lineLabel],
          lineColor: lineColors[routeInfo.lineLabel] ?? '#22c55e',
          dailyRidership,
        });
      } else if (!existing.lines.includes(routeInfo.lineLabel)) {
        existing.lines.push(routeInfo.lineLabel);
      }
    }

    for (let index = 0; index < lineStops.length - 1; index += 1) {
      const from = lineStops[index];
      const to = lineStops[index + 1];
      const fromKey = slugify(from.name);
      const toKey = slugify(to.name);
      if (!stationMap.has(fromKey) || !stationMap.has(toKey)) {
        continue;
      }

      routeSegments.push({
        type: 'Feature',
        properties: {
          mode: 'metro',
          line: routeInfo.lineLabel,
          lineColor: lineColors[routeInfo.lineLabel] ?? '#64748b',
          from: stationMap.get(fromKey).id,
          to: stationMap.get(toKey).id,
          distanceM: Math.round(haversineMeters(stationMap.get(fromKey).coordinates, stationMap.get(toKey).coordinates)),
        },
        geometry: {
          type: 'LineString',
          coordinates: [stationMap.get(fromKey).coordinates, stationMap.get(toKey).coordinates],
        },
      });
    }
  }

  const stations = Array.from(stationMap.values())
    .filter((station) => station.dailyRidership > 0)
    .sort((a, b) => b.dailyRidership - a.dailyRidership);

  return {
    stations,
    routes: routeSegments,
  };
};

const loadFallbackFromMvp = () => {
  if (!fs.existsSync(existingMvpPath)) {
    throw new Error(
      `No GTFS source detected and fallback file not found: ${existingMvpPath}. Run npm run generate:data first.`,
    );
  }

  const payload = JSON.parse(fs.readFileSync(existingMvpPath, 'utf8'));
  const stations = payload.stations.map((station) => ({
    id: station.id,
    name: station.name,
    type: 'metro',
    coordinates: station.coordinates,
    lines: station.lines,
    lineColor: station.lineColor,
    dailyRidership: station.dailyRidership,
  }));

  return {
    stations,
    routes: payload.metroNetwork?.features ?? [],
    fallbackMetrics: payload.stations,
  };
};

const resolveAgebSources = (baseDir) => {
  const geoCandidates = [
    'raw-data/urban-context/ageb/ageb_urbanas.geojson',
    'raw-data/urban-context/ageb/ageb-urbanas.geojson',
    'raw-data/urban-context/ageb/ageb_urbanas.json',
    'raw-data/urban-context/ageb/ageb-urbanas.json',
    'ageb_urbanas.geojson',
    'ageb-urbanas.geojson',
    'ageb_urbanas.json',
    'ageb-urbanas.json',
  ];
  const censoCandidates = [
    'raw-data/urban-context/ageb/censo_2020_ageb.csv',
    'raw-data/urban-context/ageb/censo-ageb-2020.csv',
    'raw-data/urban-context/ageb/inegi_censo_ageb_2020.csv',
    'censo_2020_ageb.csv',
    'censo-ageb-2020.csv',
    'inegi_censo_ageb_2020.csv',
  ];

  const agebGeoJsonPath = geoCandidates
    .map((fileName) => path.resolve(baseDir, fileName))
    .find((candidate) => fs.existsSync(candidate));
  const censoCsvPath = censoCandidates
    .map((fileName) => path.resolve(baseDir, fileName))
    .find((candidate) => fs.existsSync(candidate));

  return {
    agebGeoJsonPath,
    censoCsvPath,
  };
};

const getPolygonCentroid = (coordinates) => {
  const ring = coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) {
    return null;
  }

  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += toNumber(lng, 0);
    y += toNumber(lat, 0);
  }

  return [x / ring.length, y / ring.length];
};

const featureCentroid = (feature) => {
  const geometry = feature?.geometry;
  if (!geometry) {
    return null;
  }

  if (geometry.type === 'Polygon') {
    return getPolygonCentroid(geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return getPolygonCentroid(geometry.coordinates?.[0]);
  }

  return null;
};

const normalizeCvegeo = (value) => String(value ?? '').trim().toUpperCase();

const toFirstNumberByKeys = (row, keys) => {
  for (const key of keys) {
    if (key in row) {
      return toNumber(row[key], 0);
    }
  }
  return 0;
};

const loadAgebPopulationModel = (baseDir) => {
  const { agebGeoJsonPath, censoCsvPath } = resolveAgebSources(baseDir);
  if (!agebGeoJsonPath) {
    return null;
  }

  const agebGeoJson = JSON.parse(fs.readFileSync(agebGeoJsonPath, 'utf8'));
  const censoByCvegeo = new Map();

  if (censoCsvPath) {
    for (const row of parseCsv(censoCsvPath)) {
      const cvegeo = normalizeCvegeo(
        row.CVEGEO ?? row.cvegeo ?? row.cve_geo ?? row.CVE_GEO,
      );
      if (!cvegeo) {
        continue;
      }

      const population = toFirstNumberByKeys(row, ['POBTOT', 'pobtot', 'pob_total', 'population']);
      const olderAdults = toFirstNumberByKeys(row, ['P_60YMAS', 'p_60ymas', 'adultos_mayores']);
      const disability = toFirstNumberByKeys(row, ['PCON_DISC', 'pcon_disc', 'discapacidad']);

      censoByCvegeo.set(cvegeo, {
        population,
        vulnerable: olderAdults + disability,
      });
    }
  }

  const agebs = (agebGeoJson.features ?? [])
    .map((feature) => {
      const properties = feature.properties ?? {};
      const cvegeo = normalizeCvegeo(properties.CVEGEO ?? properties.cvegeo);
      const centroid = featureCentroid(feature);
      const censo = censoByCvegeo.get(cvegeo);
      const population =
        censo?.population ??
        toFirstNumberByKeys(properties, ['POBTOT', 'pobtot', 'population']);
      const vulnerable =
        censo?.vulnerable ??
        toFirstNumberByKeys(properties, ['P_60YMAS', 'PCON_DISC', 'vulnerable']);

      return {
        cvegeo,
        centroid,
        population,
        vulnerable,
      };
    })
    .filter((ageb) => ageb.centroid && ageb.population > 0);

  return {
    agebGeoJsonPath,
    censoCsvPath: censoCsvPath ?? null,
    agebs,
  };
};

const attachAgebMetricsToStations = (stations, agebModel) => {
  if (!agebModel) {
    return null;
  }

  const byStationId = new Map();
  for (const station of stations) {
    let populationInBuffer = 0;
    let vulnerableInBuffer = 0;

    for (const ageb of agebModel.agebs) {
      const distance = haversineMeters(station.coordinates, ageb.centroid);
      if (distance <= 800) {
        populationInBuffer += ageb.population;
        vulnerableInBuffer += ageb.vulnerable;
      }
    }

    byStationId.set(station.id, {
      populationInBuffer: Math.round(populationInBuffer),
      vulnerableInBuffer: Math.round(vulnerableInBuffer),
    });
  }

  return byStationId;
};

const buildPrecomputedImpact = ({ stations, fallbackMetrics, agebByStation }) => {
  const byId = {};

  for (const station of stations) {
    const fallback = fallbackMetrics?.find((item) => item.id === station.id);
    const ageb = agebByStation?.get(station.id);
    const impactedPeople = ageb?.populationInBuffer ?? fallback?.impactedPeople ?? Math.round(station.dailyRidership * 0.72);
    const vulnerablePeople = ageb?.vulnerableInBuffer ?? fallback?.vulnerablePeople ?? Math.round(impactedPeople * 0.22);
    const commuteDeltaPct = fallback?.commuteDeltaPct ?? 26;
    const nearestAlternative = fallback?.nearestAlternative ?? 'Alternativa de red cercana';
    const nearestAlternativeDistanceM = fallback?.nearestAlternativeDistanceM ?? 900;

    byId[station.id] = {
      stationId: station.id,
      stationName: station.name,
      mode: station.type,
      impact: {
        dailyRidership: station.dailyRidership,
        impactedPeople,
        vulnerablePeople,
        commuteDeltaPct,
      },
      alternatives: {
        nearest: nearestAlternative,
        distanceM: nearestAlternativeDistanceM,
      },
      methodology: ageb
        ? 'ageb-centroid-buffer-800m'
        : fallback
          ? 'fallback-calibrated'
          : 'ridership-ratio-estimate',
    };
  }

  return byId;
};

const writeJson = (fileName, payload) => {
  ensureDir(outputDir);
  fs.writeFileSync(path.resolve(outputDir, fileName), `${JSON.stringify(payload, null, 2)}\n`);
};

const run = () => {
  const ridershipByStation = loadMetroRidershipByStation(dataDir);
  const gtfsDir = resolveGtfsDir(dataDir);

  let stations = [];
  let routes = [];
  let fallbackMetrics = [];
  let sourceMode = 'fallback';

  if (gtfsDir) {
    const gtfsBuild = buildFromGtfs(gtfsDir, ridershipByStation);
    if (gtfsBuild.stations.length > 0) {
      stations = gtfsBuild.stations;
      routes = gtfsBuild.routes;
      sourceMode = 'gtfs';
    }
  }

  if (stations.length === 0) {
    const fallback = loadFallbackFromMvp();
    stations = fallback.stations;
    routes = fallback.routes;
    fallbackMetrics = fallback.fallbackMetrics ?? [];
    sourceMode = 'fallback';
  }

  const agebModel = loadAgebPopulationModel(dataDir);
  const agebByStation = attachAgebMetricsToStations(stations, agebModel);

  const precomputedImpact = buildPrecomputedImpact({ stations, fallbackMetrics, agebByStation });

  writeJson('stations.json', {
    generatedAt: new Date().toISOString(),
    sourceMode,
    count: stations.length,
    stations,
  });

  writeJson('routes.json', {
    generatedAt: new Date().toISOString(),
    sourceMode,
    type: 'FeatureCollection',
    features: routes,
  });

  writeJson('precomputed_impact.json', {
    generatedAt: new Date().toISOString(),
    sourceMode,
    methodology: agebModel
      ? 'ageb-centroid-buffer-800m-with-ridership-support'
      : sourceMode === 'gtfs'
        ? 'gtfs-stations-with-ridership-and-estimated-impact'
        : 'fallback-from-mvp-metrics',
    stations: precomputedImpact,
  });

  writeJson('etl-manifest.json', {
    generatedAt: new Date().toISOString(),
    sourceMode,
    inputs: {
      dataDir,
      gtfsDetected: Boolean(gtfsDir),
      metroRidershipDetected: fs.existsSync(
        findInputFile(dataDir, [
          'raw-data/stc-metro/ridership/afluenciastc_desglosado_03_2026.csv',
          'afluenciastc_desglosado_03_2026.csv',
        ]),
      ),
      agebDetected: Boolean(agebModel?.agebGeoJsonPath),
      censoDetected: Boolean(agebModel?.censoCsvPath),
      fallbackMvpDetected: fs.existsSync(existingMvpPath),
    },
    outputs: ['stations.json', 'routes.json', 'precomputed_impact.json'],
  });

  console.log(
    `[sprint1-etl] Generated stations=${stations.length} routes=${routes.length} sourceMode=${sourceMode}`,
  );
};

run();
