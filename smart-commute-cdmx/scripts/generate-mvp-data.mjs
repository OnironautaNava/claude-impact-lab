import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const defaultDataDir = path.resolve(rootDir, '..', 'docs', 'data');
const configuredDataDir = process.env.SMART_COMMUTE_DATA_DIR?.trim();
const docsDataDir = configuredDataDir
  ? path.resolve(rootDir, configuredDataDir)
  : defaultDataDir;
const outputDir = path.resolve(rootDir, 'public', 'data');
const requiredFiles = [
  'afluenciastc_desglosado_03_2026.csv',
  'afluenciamb_desglosado_03_2026.csv',
  'cicloestaciones_ecobici.csv',
  'infraestructura-vial-ciclista.json',
];

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

const stationSeeds = [
  { id: 'constitucion-1917', name: 'Constitucion de 1917', displayName: 'Constitucion de 1917', lines: ['Linea 8'], coordinates: [-99.0744, 19.3561] },
  { id: 'cuatro-caminos', name: 'Cuatro Caminos', displayName: 'Cuatro Caminos', lines: ['Linea 2'], coordinates: [-99.2153, 19.4583] },
  { id: 'indios-verdes', name: 'Indios Verdes', displayName: 'Indios Verdes', lines: ['Linea 3'], coordinates: [-99.1142, 19.4952] },
  { id: 'universidad', name: 'Universidad', displayName: 'Universidad', lines: ['Linea 3'], coordinates: [-99.1629, 19.3242] },
  { id: 'tlahuac', name: 'Tlahuac', displayName: 'Tlahuac', lines: ['Linea 12'], coordinates: [-99.0157, 19.2866] },
  { id: 'tasquena', name: 'Tasquena', displayName: 'Tasquena', lines: ['Linea 2'], coordinates: [-99.1398, 19.3433] },
  { id: 'buenavista', name: 'Buenavista', displayName: 'Buenavista', lines: ['Linea B'], coordinates: [-99.1527, 19.4451] },
  { id: 'tacubaya', name: 'Tacubaya', displayName: 'Tacubaya', lines: ['Linea 1', 'Linea 7', 'Linea 9'], coordinates: [-99.1879, 19.4025] },
  { id: 'pantitlan', name: 'Pantitlan', displayName: 'Pantitlan', lines: ['Linea 1', 'Linea 5', 'Linea 9', 'Linea A'], coordinates: [-99.0721, 19.4151] },
  { id: 'ciudad-azteca', name: 'Ciudad Azteca', displayName: 'Ciudad Azteca', lines: ['Linea B'], coordinates: [-99.0356, 19.5346] },
  { id: 'chapultepec', name: 'Chapultepec', displayName: 'Chapultepec', lines: ['Linea 1'], coordinates: [-99.176, 19.4207] },
  { id: 'polanco', name: 'Polanco', displayName: 'Polanco', lines: ['Linea 7'], coordinates: [-99.1883, 19.4326] },
  { id: 'la-paz', name: 'La Paz', displayName: 'La Paz', lines: ['Linea A'], coordinates: [-98.9927, 19.3506] },
  { id: 'santa-marta', name: 'Santa Marta', displayName: 'Santa Marta', lines: ['Linea A'], coordinates: [-99.0173, 19.3601] },
  { id: 'observatorio', name: 'Observatorio', displayName: 'Observatorio', lines: ['Linea 1'], coordinates: [-99.2007, 19.3984] },
  { id: 'insurgentes', name: 'Insurgentes', displayName: 'Insurgentes', lines: ['Linea 1'], coordinates: [-99.1627, 19.4236] },
  { id: 'merced', name: 'Merced', displayName: 'Merced', lines: ['Linea 1'], coordinates: [-99.1247, 19.425] },
  { id: 'copilco', name: 'Copilco', displayName: 'Copilco', lines: ['Linea 3'], coordinates: [-99.1764, 19.3366] },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const assertDataDir = () => {
  if (!fs.existsSync(docsDataDir)) {
    throw new Error(
      `Data directory not found: ${docsDataDir}. Set SMART_COMMUTE_DATA_DIR to your external raw-data folder.`,
    );
  }

  const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.resolve(docsDataDir, file)));
  if (missingFiles.length > 0) {
    throw new Error(
      `Missing required data files in ${docsDataDir}: ${missingFiles.join(', ')}`,
    );
  }
};

const fixMojibake = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('Ã') || trimmed.includes('Â')) {
    return Buffer.from(trimmed, 'latin1').toString('utf8').trim();
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

const parseCsv = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',');

  return lines.map((line) => {
    const values = line.split(',');
    return header.reduce((acc, key, index) => {
      acc[key] = values[index] ?? '';
      return acc;
    }, {});
  });
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

const minDistanceToCoordinates = (target, coordinates) => {
  let min = Number.POSITIVE_INFINITY;

  for (const coordinate of coordinates) {
    const pair = Array.isArray(coordinate[0]) ? coordinate : [coordinate];
    for (const point of pair) {
      const current = haversineMeters(target, [point[0], point[1]]);
      if (current < min) {
        min = current;
      }
    }
  }

  return min;
};

assertDataDir();

const stationAverageMap = new Map();
const stationSeedMap = new Map(stationSeeds.map((seed) => [slugify(seed.name), seed]));

const metroRows = parseCsv(path.resolve(docsDataDir, 'afluenciastc_desglosado_03_2026.csv')).map((row) => ({
  date: row.fecha,
  line: fixMojibake(row.linea),
  station: fixMojibake(row.estacion),
  ridership: Number.parseInt(row.afluencia, 10) || 0,
}));

const latestMetroDate = metroRows.reduce((latest, row) => (row.date > latest ? row.date : latest), '');
const metroCutoff = new Date(latestMetroDate);
metroCutoff.setDate(metroCutoff.getDate() - 89);

const metroDailyTotals = new Map();

for (const row of metroRows) {
  const rowDate = new Date(row.date);
  if (rowDate < metroCutoff) {
    continue;
  }

  metroDailyTotals.set(row.date, (metroDailyTotals.get(row.date) ?? 0) + row.ridership);

  const seed = stationSeedMap.get(slugify(row.station));
  if (!seed) {
    continue;
  }

  const key = seed.id;
  stationAverageMap.set(key, (stationAverageMap.get(key) ?? 0) + row.ridership);
}

const metroDays = metroDailyTotals.size || 1;
const averageMetroDaily =
  Math.round(Array.from(metroDailyTotals.values()).reduce((sum, value) => sum + value, 0) / metroDays);

const metrobusRows = parseCsv(path.resolve(docsDataDir, 'afluenciamb_desglosado_03_2026.csv')).map((row) => ({
  date: row.fecha,
  line: fixMojibake(row.linea),
  ridership: Number.parseInt(row.afluencia, 10) || 0,
}));

const latestMetrobusDate = metrobusRows.reduce((latest, row) => (row.date > latest ? row.date : latest), '');
const metrobusCutoff = new Date(latestMetrobusDate);
metrobusCutoff.setDate(metrobusCutoff.getDate() - 89);

const metrobusDailyTotals = new Map();
const metrobusLineTotals = new Map();

for (const row of metrobusRows) {
  const rowDate = new Date(row.date);
  if (rowDate < metrobusCutoff) {
    continue;
  }

  metrobusDailyTotals.set(row.date, (metrobusDailyTotals.get(row.date) ?? 0) + row.ridership);
  metrobusLineTotals.set(row.line, (metrobusLineTotals.get(row.line) ?? 0) + row.ridership);
}

const metrobusDays = metrobusDailyTotals.size || 1;
const averageMetrobusDaily = Math.round(
  Array.from(metrobusDailyTotals.values()).reduce((sum, value) => sum + value, 0) / metrobusDays,
);

const topMetrobusLines = Array.from(metrobusLineTotals.entries())
  .map(([line, total]) => ({ line, averageDailyRidership: Math.round(total / metrobusDays) }))
  .sort((a, b) => b.averageDailyRidership - a.averageDailyRidership)
  .slice(0, 4);

const ecobiciRows = parseCsv(path.resolve(docsDataDir, 'cicloestaciones_ecobici.csv'));
const ecobiciFeatures = ecobiciRows
  .filter((row) => row.estatus === 'Instalada')
  .map((row) => ({
    type: 'Feature',
    properties: {
      id: String(row.num_cicloe),
      name: `${fixMojibake(row.calle_prin)} / ${fixMojibake(row.calle_secu)}`,
      colonia: fixMojibake(row.colonia),
      alcaldia: fixMojibake(row.alcaldia),
    },
    geometry: {
      type: 'Point',
      coordinates: [Number.parseFloat(row.longitud), Number.parseFloat(row.latitud)],
    },
  }));

const cycleInfraSource = JSON.parse(
  fs.readFileSync(path.resolve(docsDataDir, 'infraestructura-vial-ciclista.json'), 'utf8'),
);

const cycleInfraFeatures = cycleInfraSource.features.map((feature) => {
  const geometry = feature.geometry.type === 'LineString'
    ? {
        type: 'LineString',
        coordinates: feature.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
      }
    : {
        type: 'MultiLineString',
        coordinates: feature.geometry.coordinates.map((line) => line.map(([lng, lat]) => [lng, lat])),
      };

  return {
    type: 'Feature',
    properties: {
      name: fixMojibake(feature.properties.NOMBRE),
      type: fixMojibake(feature.properties.TIPO_IC),
      alcaldia: fixMojibake(feature.properties.ALCALDIA),
      longKm: Number(feature.properties.LONG_KM) || 0,
    },
    geometry,
  };
});

const totalCycleKm = Math.round(
  cycleInfraFeatures.reduce((sum, feature) => sum + Number(feature.properties.longKm || 0), 0),
);

const stations = stationSeeds
  .map((seed) => {
    const totalRidership = stationAverageMap.get(seed.id) ?? 0;
    const dailyRidership = Math.round(totalRidership / metroDays);
    const nearbyEcobici = ecobiciFeatures.filter((feature) => {
      const distance = haversineMeters(seed.coordinates, feature.geometry.coordinates);
      return distance <= 800;
    });

    const nearestEcobici = ecobiciFeatures.reduce(
      (nearest, feature) => {
        const distance = haversineMeters(seed.coordinates, feature.geometry.coordinates);
        return distance < nearest.distance ? { feature, distance } : nearest;
      },
      { feature: null, distance: Number.POSITIVE_INFINITY },
    );

    const cycleKmNearby = cycleInfraFeatures.reduce((sum, feature) => {
      const geometryCoordinates =
        feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates;
      const distance = minDistanceToCoordinates(seed.coordinates, geometryCoordinates);
      return distance <= 1000 ? sum + Number(feature.properties.longKm || 0) : sum;
    }, 0);

    const resilienceScore = clamp(
      Math.round(nearbyEcobici.length * 4 + cycleKmNearby * 9),
      8,
      100,
    );
    const commuteDeltaPct = clamp(
      Math.round(38 - resilienceScore * 0.18 + Math.max(0, seed.lines.length - 1) * 2),
      12,
      42,
    );
    const impactedPeople = Math.round(dailyRidership * (2.45 - resilienceScore / 220));
    const vulnerablePeople = Math.round(impactedPeople * 0.18);

    return {
      id: seed.id,
      name: seed.displayName,
      lines: seed.lines,
      lineColor: lineColors[seed.lines[0]] ?? '#22c55e',
      coordinates: seed.coordinates,
      dailyRidership,
      impactedPeople,
      vulnerablePeople,
      commuteDeltaPct,
      nearbyEcobici: nearbyEcobici.length,
      cycleKmNearby: Number(cycleKmNearby.toFixed(1)),
      nearestAlternative: nearestEcobici.feature?.properties?.name ?? 'Cobertura ciclista cercana',
      nearestAlternativeDistanceM: Math.round(nearestEcobici.distance),
      resilienceScore,
    };
  })
  .filter((station) => station.dailyRidership > 0)
  .sort((a, b) => b.dailyRidership - a.dailyRidership);

const payload = {
  generatedAt: new Date().toISOString(),
  scopeNote:
    'MVP rapido enfocado en cierres de Metro con STC real, usando Ecobici y red ciclista como capas de resiliencia. Metrobus y vias primarias quedan como contexto del sistema, no como cierres interactivos en esta version.',
  methodologyNote:
    'Las personas impactadas y el delta de commute son proxys calculados con afluencia reciente, densidad de alternativas ciclistas y cobertura cercana. No sustituyen un modelo AGEB/INEGI.',
  summary: {
    latestMetroDate,
    latestMetrobusDate,
    averageMetroDaily,
    averageMetrobusDaily,
    ecobiciStations: ecobiciFeatures.length,
    totalCycleKm,
    topMetrobusLines,
  },
  stations,
  ecobici: {
    type: 'FeatureCollection',
    features: ecobiciFeatures,
  },
  cycleInfra: {
    type: 'FeatureCollection',
    features: cycleInfraFeatures,
  },
};

ensureDir(outputDir);
fs.writeFileSync(path.resolve(outputDir, 'mvp-data.json'), JSON.stringify(payload, null, 2));

console.log(`Generated MVP data with ${stations.length} metro closure nodes from ${docsDataDir}.`);
