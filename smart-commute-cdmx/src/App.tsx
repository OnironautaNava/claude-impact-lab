import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSourceSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LayerState, LineRidershipSummary, MvpData, StationImpact, SystemRidershipSummary } from './types';

type ScenarioKey = 'A' | 'B';

interface AggregateMetrics {
  count: number;
  totalDailyRidership: number;
  totalImpactedPeople: number;
  totalVulnerablePeople: number;
  averageCommuteDelta: number;
  totalNetworkRidershipAtRisk: number;
  networkAffectedStations: number;
}

interface LineGroup {
  line: string;
  stations: StationImpact[];
}

interface SystemGroup {
  system: string;
  label: string;
  lines: LineGroup[];
  totalStations: number;
}

const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};

const defaultLayers: LayerState = {
  ecobici: true,
  cycleInfra: true,
  metroNetwork: true,
};

const scenarioOrder: ScenarioKey[] = ['A', 'B'];

const systemOrder = ['metro', 'metrobus', 'ecobici', 'trolebus', 'trenligero', 'cablebus', 'rtp', 'otro'];

const systemLabelByKey: Record<string, string> = {
  metro: 'Metro',
  metrobus: 'Metrobus',
  ecobici: 'Ecobici',
  trolebus: 'Trolebus',
  trenligero: 'Tren Ligero',
  cablebus: 'Cablebus',
  rtp: 'RTP',
  otro: 'Otros',
};

const systemMarkerCodeByKey: Record<string, string> = {
  metro: 'M',
  metrobus: 'MB',
  ecobici: 'E',
  trolebus: 'TB',
  trenligero: 'TL',
  cablebus: 'CB',
  rtp: 'RTP',
  otro: 'TP',
};

const systemColorByKey: Record<string, string> = {
  metro: '#ef4444',
  metrobus: '#a21caf',
  ecobici: '#14b8a6',
  trolebus: '#1d4ed8',
  trenligero: '#16a34a',
  cablebus: '#6d28d9',
  rtp: '#ca8a04',
  otro: '#64748b',
};

const metroLineColorByKey: Record<string, string> = {
  '1': '#ec4899',
  '2': '#2563eb',
  '3': '#84cc16',
  '4': '#06b6d4',
  '5': '#f59e0b',
  '6': '#ef4444',
  '7': '#f97316',
  '8': '#16a34a',
  '9': '#92400e',
  a: '#7c3aed',
  b: '#9ca3af',
  '12': '#d4a017',
};

const metrobusLineColorByKey: Record<string, string> = {
  '1': '#ec4899',
  '2': '#7c3aed',
  '3': '#65a30d',
  '4': '#f59e0b',
  '5': '#1d4ed8',
  '6': '#dc2626',
  '7': '#0f766e',
};

const metroLineLegendOrder = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', '12'];
const metrobusLineLegendOrder = ['1', '2', '3', '4', '5', '6', '7'];

const normalizeLineKey = (line: string) => {
  const ascii = line
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/linea|linea\.?|line|troncal/g, '')
    .trim();

  const match = ascii.match(/\d+|[a-z]+/);
  return match?.[0] ?? ascii;
};

const getLineBadgeColor = (station: StationImpact, lineLabel: string) => {
  const system = inferSystemKey(station);
  const lineKey = normalizeLineKey(lineLabel);

  if (system === 'metro') {
    return metroLineColorByKey[lineKey] ?? station.lineColor;
  }
  if (system === 'metrobus') {
    return metrobusLineColorByKey[lineKey] ?? station.lineColor;
  }
  return station.lineColor;
};

const normalizeLineLabel = (line: string) => {
  const normalized = line.trim().replace(/\s+/g, ' ');
  return normalized || 'Sin linea';
};

const inferSystemKey = (station: StationImpact) => {
  const raw = (station.mode ?? station.id.split('-')[0] ?? 'otro').toLowerCase().trim();

  if (raw === 'mb') {
    return 'metrobus';
  }
  if (raw === 'tren ligero' || raw === 'tren-ligero') {
    return 'trenligero';
  }
  if (raw === 'trolebus' || raw === 'trolebuses') {
    return 'trolebus';
  }
  if (raw in systemLabelByKey) {
    return raw;
  }

  return 'otro';
};

const sortByName = (a: StationImpact, b: StationImpact) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

const sortByLine = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

const groupStationsAsTree = (stations: StationImpact[]): SystemGroup[] => {
  const groupedBySystem = new Map<string, Map<string, StationImpact[]>>();

  for (const station of [...stations].sort(sortByName)) {
    const systemKey = inferSystemKey(station);
    if (!groupedBySystem.has(systemKey)) {
      groupedBySystem.set(systemKey, new Map());
    }

    const lines = station.lines.length > 0 ? station.lines : ['Sin linea'];
    const uniqueLines = Array.from(new Set(lines.map(normalizeLineLabel)));

    for (const line of uniqueLines) {
      const lineMap = groupedBySystem.get(systemKey);
      if (!lineMap) {
        continue;
      }

      if (!lineMap.has(line)) {
        lineMap.set(line, []);
      }

      lineMap.get(line)?.push(station);
    }
  }

  return Array.from(groupedBySystem.entries())
    .sort(([systemA], [systemB]) => {
      const indexA = systemOrder.indexOf(systemA);
      const indexB = systemOrder.indexOf(systemB);
      const safeIndexA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
      const safeIndexB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
      return safeIndexA - safeIndexB;
    })
    .map(([system, linesMap]) => {
      const lines = Array.from(linesMap.entries())
        .sort(([lineA], [lineB]) => sortByLine(lineA, lineB))
        .map(([line, stationsByLine]) => ({
          line,
          stations: [...stationsByLine].sort(sortByName),
        }));

      const uniqueIds = new Set(lines.flatMap((lineGroup) => lineGroup.stations.map((station) => station.id)));
      return {
        system,
        label: systemLabelByKey[system] ?? system,
        lines,
        totalStations: uniqueIds.size,
      } satisfies SystemGroup;
    });
};

const numberFormatter = new Intl.NumberFormat('es-MX');

const formatCompact = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }

  return numberFormatter.format(value);
};

const formatPct = (value: number) => `${value.toFixed(1)}%`;
const formatSigned = (value: number) => (value > 0 ? `+${formatCompact(value)}` : formatCompact(value));

const fallbackSystemSummaries = (data: MvpData | null): SystemRidershipSummary[] => {
  if (!data) {
    return [];
  }

  return [
    {
      key: 'metro',
      label: 'Metro',
      averageDailyRidership: data.summary.averageMetroDaily,
      stationCount: data.stations.filter((station) => inferSystemKey(station) === 'metro').length,
      lineCount: new Set(
        data.stations.filter((station) => inferSystemKey(station) === 'metro').flatMap((station) => station.lines),
      ).size,
      hasGeography: true,
    },
    {
      key: 'metrobus',
      label: 'Metrobus',
      averageDailyRidership: data.summary.averageMetrobusDaily,
      stationCount: data.stations.filter((station) => inferSystemKey(station) === 'metrobus').length,
      lineCount: data.summary.topMetrobusLines.length,
      hasGeography: true,
    },
  ];
};

const fallbackTopLines = (data: MvpData | null): LineRidershipSummary[] => {
  if (!data) {
    return [];
  }

  return data.summary.topMetrobusLines.map((line) => ({
    ...line,
    systemKey: line.systemKey ?? 'metrobus',
    systemLabel: line.systemLabel ?? 'Metrobus',
    hasGeography: line.hasGeography ?? true,
  }));
};

const networkAffectThreshold = 0.3;

type NetworkEdge = {
  id: string;
  mode: string;
};

const hopWeightFor = (mode: string, depth: number) => {
  const normalized = mode.toLowerCase();
  if (depth === 1) {
    if (normalized === 'metro') {
      return 0.62;
    }
    if (normalized === 'metrobus') {
      return 0.56;
    }
    return 0.5;
  }

  if (normalized === 'metro') {
    return 0.35;
  }
  if (normalized === 'metrobus') {
    return 0.3;
  }
  return 0.26;
};

const buildNetworkWeights = (closureIds: string[], adjacency: Map<string, NetworkEdge[]>) => {
  const weights = new Map<string, number>();

  for (const closureId of closureIds) {
    weights.set(closureId, Math.max(weights.get(closureId) ?? 0, 1));

    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number; viaMode: string | null }> = [{ id: closureId, depth: 0, viaMode: null }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth >= 2) {
        continue;
      }

      const nextDepth = current.depth + 1;

      for (const edge of adjacency.get(current.id) ?? []) {
        let hopWeight = hopWeightFor(edge.mode, nextDepth);
        if (current.viaMode && current.viaMode !== edge.mode) {
          hopWeight = Math.max(0, hopWeight - 0.08);
        }

        const existing = weights.get(edge.id) ?? 0;
        if (hopWeight > existing) {
          weights.set(edge.id, hopWeight);
        }

        const visitKey = `${edge.id}|${nextDepth}|${edge.mode}`;
        if (!visited.has(visitKey)) {
          visited.add(visitKey);
          queue.push({ id: edge.id, depth: nextDepth, viaMode: edge.mode });
        }
      }
    }
  }

  return weights;
};

const networkSourceFromData = (
  metroNetwork: FeatureCollection<LineString>,
  stationWeights: Map<string, number>,
  activeClosures: Set<string>,
): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: metroNetwork.features.map<Feature<LineString>>((feature) => {
    const fromId = String(feature.properties?.from ?? '');
    const toId = String(feature.properties?.to ?? '');
    const fromWeight = stationWeights.get(fromId) ?? 0;
    const toWeight = stationWeights.get(toId) ?? 0;
    const isClosedSegment = activeClosures.has(fromId) || activeClosures.has(toId);
    const affected = isClosedSegment || fromWeight >= networkAffectThreshold || toWeight >= networkAffectThreshold ? 1 : 0;

    return {
      type: 'Feature',
      properties: {
        ...feature.properties,
        affected,
      },
      geometry: feature.geometry,
    };
  }),
});

const stationSourceFromData = (
  stations: StationImpact[],
  activeClosures: Set<string>,
  selectedId: string | null,
): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: stations.map<Feature<Point>>((station) => {
    const systemKey = inferSystemKey(station);
    return {
      type: 'Feature',
      properties: {
        id: station.id,
        name: station.name,
        lineColor: station.lineColor,
        systemColor: systemColorByKey[systemKey] ?? '#64748b',
        modeShort: systemMarkerCodeByKey[systemKey] ?? 'TP',
        active: activeClosures.has(station.id) ? 1 : 0,
        selected: station.id === selectedId ? 1 : 0,
        commuteDeltaPct: station.commuteDeltaPct,
        impactedPeople: station.impactedPeople,
      },
      geometry: {
        type: 'Point',
        coordinates: station.coordinates,
      },
    };
  }),
});

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [data, setData] = useState<MvpData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>('A');
  const [closuresByScenario, setClosuresByScenario] = useState<Record<ScenarioKey, string[]>>({ A: [], B: [] });
  const [layers, setLayers] = useState<LayerState>(defaultLayers);

  const activeClosureIds = closuresByScenario[selectedScenario];

  useEffect(() => {
    let active = true;

    fetch('/data/multimodal-data.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('multimodal-data.json no disponible');
        }
        return response.json();
      })
      .then((payload: MvpData) => {
        if (!active) {
          return;
        }

        setData(payload);
        setSelectedId(payload.stations[0]?.id ?? null);
      })
      .catch(() => {
        fetch('/data/mvp-data.json')
          .then((response) => response.json())
          .then((payload: MvpData) => {
            if (!active) {
              return;
            }

            setData(payload);
            setSelectedId(payload.stations[0]?.id ?? null);
          })
          .catch((error) => {
            console.error('No se pudo cargar ni multimodal-data ni mvp-data', error);
          });
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedStation = useMemo(
    () => data?.stations.find((station) => station.id === selectedId) ?? data?.stations[0] ?? null,
    [data, selectedId],
  );

  const activeClosures = useMemo(() => new Set(activeClosureIds), [activeClosureIds]);

  const networkAdjacency = useMemo(() => {
    const adjacency = new Map<string, Map<string, string>>();

    for (const feature of data?.metroNetwork.features ?? []) {
      const from = String(feature.properties?.from ?? '');
      const to = String(feature.properties?.to ?? '');
      const mode = String(feature.properties?.mode ?? 'unknown').toLowerCase();
      if (!from || !to) {
        continue;
      }

      if (!adjacency.has(from)) {
        adjacency.set(from, new Map());
      }
      if (!adjacency.has(to)) {
        adjacency.set(to, new Map());
      }

      adjacency.get(from)?.set(to, mode);
      adjacency.get(to)?.set(from, mode);
    }

    const normalized = new Map<string, NetworkEdge[]>();
    for (const [stationId, neighborMap] of adjacency.entries()) {
      normalized.set(
        stationId,
        Array.from(neighborMap.entries()).map(([id, neighborMode]) => ({ id, mode: neighborMode })),
      );
    }

    return normalized;
  }, [data]);

  const networkStationWeights = useMemo(() => {
    return buildNetworkWeights(activeClosureIds, networkAdjacency);
  }, [activeClosureIds, networkAdjacency]);

  const scenarioAggregates = useMemo(() => {
    const stations = data?.stations ?? [];
    const computeAggregate = (closureIds: string[]) => {
      const closureSet = new Set(closureIds);
      const activeStations = stations.filter((station) => closureSet.has(station.id));
      const totalDailyRidership = activeStations.reduce((sum, station) => sum + station.dailyRidership, 0);
      const totalImpactedPeople = activeStations.reduce((sum, station) => sum + station.impactedPeople, 0);
      const totalVulnerablePeople = activeStations.reduce((sum, station) => sum + station.vulnerablePeople, 0);
      const averageCommuteDelta = activeStations.length
        ? Math.round(activeStations.reduce((sum, station) => sum + station.commuteDeltaPct, 0) / activeStations.length)
        : 0;

      const weights = buildNetworkWeights(closureIds, networkAdjacency);
      const totalNetworkRidershipAtRisk = stations.reduce((sum, station) => {
        const weight = weights.get(station.id) ?? 0;
        return sum + station.dailyRidership * weight;
      }, 0);
      const networkAffectedStations = Array.from(weights.values()).filter((weight) => weight >= networkAffectThreshold).length;

      return {
        count: activeStations.length,
        totalDailyRidership,
        totalImpactedPeople,
        totalVulnerablePeople,
        averageCommuteDelta,
        totalNetworkRidershipAtRisk: Math.round(totalNetworkRidershipAtRisk),
        networkAffectedStations,
      } satisfies AggregateMetrics;
    };

    return {
      baseline: computeAggregate([]),
      A: computeAggregate(closuresByScenario.A),
      B: computeAggregate(closuresByScenario.B),
    };
  }, [closuresByScenario, data, networkAdjacency]);

  const aggregate = scenarioAggregates[selectedScenario];
  const comparisonScenario: ScenarioKey = selectedScenario === 'A' ? 'B' : 'A';
  const comparisonAggregate = scenarioAggregates[comparisonScenario];
  const baselineAggregate = scenarioAggregates.baseline;
  const systemRidership = useMemo(
    () => data?.summary.systemDailyRidership ?? fallbackSystemSummaries(data),
    [data],
  );
  const topNetworkLines = useMemo(
    () => data?.summary.topNetworkLines ?? fallbackTopLines(data),
    [data],
  );

  const decisionBrief = useMemo(() => {
    const metrics: Record<ScenarioKey, AggregateMetrics> = {
      A: scenarioAggregates.A,
      B: scenarioAggregates.B,
    };

    const maxImpacted = Math.max(metrics.A.totalImpactedPeople, metrics.B.totalImpactedPeople, 1);
    const maxVulnerable = Math.max(metrics.A.totalVulnerablePeople, metrics.B.totalVulnerablePeople, 1);
    const maxNetworkRisk = Math.max(metrics.A.totalNetworkRidershipAtRisk, metrics.B.totalNetworkRidershipAtRisk, 1);
    const maxCommuteDelta = Math.max(metrics.A.averageCommuteDelta, metrics.B.averageCommuteDelta, 1);

    const scoreFor = (scenario: ScenarioKey) => {
      const current = metrics[scenario];
      return (
        (current.totalImpactedPeople / maxImpacted) * 0.45 +
        (current.totalVulnerablePeople / maxVulnerable) * 0.3 +
        (current.totalNetworkRidershipAtRisk / maxNetworkRisk) * 0.2 +
        (current.averageCommuteDelta / maxCommuteDelta) * 0.05
      );
    };

    const scoreA = scoreFor('A');
    const scoreB = scoreFor('B');
    const winner: ScenarioKey = scoreA <= scoreB ? 'A' : 'B';
    const loser: ScenarioKey = winner === 'A' ? 'B' : 'A';
    const winnerMetrics = metrics[winner];
    const loserMetrics = metrics[loser];

    return {
      winner,
      loser,
      scoreA,
      scoreB,
      scoreGapPct: Math.abs(scoreA - scoreB) * 100,
      impactedGap: loserMetrics.totalImpactedPeople - winnerMetrics.totalImpactedPeople,
      vulnerableGap: loserMetrics.totalVulnerablePeople - winnerMetrics.totalVulnerablePeople,
      networkGap: loserMetrics.totalNetworkRidershipAtRisk - winnerMetrics.totalNetworkRidershipAtRisk,
      commuteGap: loserMetrics.averageCommuteDelta - winnerMetrics.averageCommuteDelta,
    };
  }, [scenarioAggregates]);

  const stationSource = useMemo(
    () => stationSourceFromData(data?.stations ?? [], activeClosures, selectedStation?.id ?? null),
    [activeClosures, data, selectedStation?.id],
  );

  const closedStations = useMemo(
    () => (data?.stations ?? []).filter((station) => activeClosures.has(station.id)).sort(sortByName),
    [activeClosures, data?.stations],
  );

  const openStations = useMemo(
    () => (data?.stations ?? []).filter((station) => !activeClosures.has(station.id)).sort(sortByName),
    [activeClosures, data?.stations],
  );

  const closedTree = useMemo(() => groupStationsAsTree(closedStations), [closedStations]);
  const openTree = useMemo(() => groupStationsAsTree(openStations), [openStations]);

  const networkSource = useMemo(
    () =>
      networkSourceFromData(
        data?.metroNetwork ?? { type: 'FeatureCollection', features: [] },
        networkStationWeights,
        activeClosures,
      ),
    [activeClosures, data, networkStationWeights],
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !data) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyle,
      center: [-99.1425, 19.412],
      zoom: 10.8,
      pitch: 48,
      bearing: -22,
      antialias: true,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on('load', () => {
      map.addSource('cycle-infra', {
        type: 'geojson',
        data: data.cycleInfra,
      } satisfies GeoJSONSourceSpecification);

      map.addLayer({
        id: 'cycle-infra',
        type: 'line',
        source: 'cycle-infra',
        paint: {
          'line-color': '#22c55e',
          'line-width': 2.5,
          'line-opacity': 0.8,
        },
      });

      map.addSource('metro-network', {
        type: 'geojson',
        data: networkSource,
      } satisfies GeoJSONSourceSpecification);

      map.addLayer({
        id: 'metro-network-base',
        type: 'line',
        source: 'metro-network',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'lineColor'], '#64748b'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.2, 12, 4.1, 16, 4.8],
          'line-opacity': 0.62,
        },
      });

      map.addLayer({
        id: 'metro-network-affected',
        type: 'line',
        source: 'metro-network',
        filter: ['==', ['get', 'affected'], 1],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'lineColor'], '#f97316'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5.4, 12, 6.3, 16, 7.2],
          'line-opacity': 0.9,
        },
      });

      map.addSource('ecobici', {
        type: 'geojson',
        data: data.ecobici,
      } satisfies GeoJSONSourceSpecification);

      map.addLayer({
        id: 'ecobici',
        type: 'circle',
        source: 'ecobici',
        paint: {
          'circle-radius': 3,
          'circle-color': '#2dd4bf',
          'circle-opacity': 0.72,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#06221d',
        },
      });

      map.addSource('stations', {
        type: 'geojson',
        data: stationSource,
      } satisfies GeoJSONSourceSpecification);

      map.addLayer({
        id: 'station-halo',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'impactedPeople'],
            70000,
            16,
            220000,
            30,
          ],
          'circle-color': ['coalesce', ['get', 'lineColor'], '#ec4899'],
          'circle-opacity': ['case', ['==', ['get', 'active'], 1], 0.24, 0.08],
        },
      });

      map.addLayer({
        id: 'station-core',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 13, 10],
          'circle-color': '#f8fafc',
          'circle-stroke-color': ['coalesce', ['get', 'systemColor'], '#64748b'],
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3.4, 2.6],
        },
      });

      map.addLayer({
        id: 'station-closed-ring',
        type: 'circle',
        source: 'stations',
        filter: ['==', ['get', 'active'], 1],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 16, 13],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'station-badge',
        type: 'symbol',
        source: 'stations',
        layout: {
          'text-field': ['coalesce', ['get', 'modeShort'], 'TP'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': ['case', ['==', ['get', 'selected'], 1], 11, 10],
          'text-offset': [0, 0],
          'text-anchor': 'center',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#0f172a',
        },
      });

      map.on('click', 'station-core', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === 'string') {
          setSelectedId(id);
        }
      });

      map.on('click', 'station-badge', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === 'string') {
          setSelectedId(id);
        }
      });

      map.on('click', 'station-closed-ring', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === 'string') {
          setSelectedId(id);
        }
      });

      map.on('mouseenter', 'station-core', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseenter', 'station-badge', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseenter', 'station-closed-ring', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'station-core', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseleave', 'station-badge', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseleave', 'station-closed-ring', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data, networkSource, stationSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !data) {
      return;
    }

    const stationGeoJson = map.getSource('stations') as maplibregl.GeoJSONSource | undefined;
    const networkGeoJson = map.getSource('metro-network') as maplibregl.GeoJSONSource | undefined;
    stationGeoJson?.setData(stationSource);
    networkGeoJson?.setData(networkSource);
  }, [data, networkSource, stationSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    if (map.getLayer('ecobici')) {
      map.setLayoutProperty('ecobici', 'visibility', layers.ecobici ? 'visible' : 'none');
    }
    if (map.getLayer('cycle-infra')) {
      map.setLayoutProperty('cycle-infra', 'visibility', layers.cycleInfra ? 'visible' : 'none');
    }
    if (map.getLayer('metro-network-base')) {
      map.setLayoutProperty('metro-network-base', 'visibility', layers.metroNetwork ? 'visible' : 'none');
    }
    if (map.getLayer('metro-network-affected')) {
      map.setLayoutProperty('metro-network-affected', 'visibility', layers.metroNetwork ? 'visible' : 'none');
    }
  }, [layers]);

  useEffect(() => {
    if (!selectedStation || !mapRef.current) {
      return;
    }

    mapRef.current.easeTo({
      center: selectedStation.coordinates,
      zoom: 12.5,
      duration: 900,
    });
  }, [selectedStation]);

  const toggleClosure = (stationId: string) => {
    setClosuresByScenario((current) => {
      const currentScenario = current[selectedScenario];
      const nextScenario = currentScenario.includes(stationId)
        ? currentScenario.filter((value) => value !== stationId)
        : [...currentScenario, stationId];

      return {
        ...current,
        [selectedScenario]: nextScenario,
      };
    });
  };

  const toggleLayer = (key: keyof LayerState) => {
    setLayers((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const renderStationTree = (groups: SystemGroup[], listType: 'closed' | 'open') => {
    return groups.map((systemGroup) => (
      <details key={`${listType}-${systemGroup.system}`} className="tree-group" open>
        <summary>
          <span>{systemGroup.label}</span>
          <small>{systemGroup.totalStations}</small>
        </summary>

        <div className="tree-children">
          {systemGroup.lines.map((lineGroup) => (
            <details key={`${listType}-${systemGroup.system}-${lineGroup.line}`} className="tree-group line-group" open>
              <summary>
                <span>{lineGroup.line}</span>
                <small>{lineGroup.stations.length}</small>
              </summary>

              <div className="tree-children station-nodes">
                {lineGroup.stations.map((station) => {
                  const isActive = activeClosures.has(station.id);
                  const isSelected = selectedStation?.id === station.id;

                  return (
                    <article key={`${listType}-${systemGroup.system}-${lineGroup.line}-${station.id}`} className={isSelected ? 'station-card selected' : 'station-card'}>
                      <button type="button" className="station-hitbox" onClick={() => setSelectedId(station.id)}>
                        <div className="station-title-row">
                          <strong>{station.name}</strong>
                        </div>
                        <div className="line-dot-stack" aria-label={`Lineas de ${station.name}`}>
                          {Array.from(new Set(station.lines.length > 0 ? station.lines : ['Sin linea'])).map((lineLabel) => (
                            <span
                              key={`${station.id}-${lineLabel}`}
                              className="line-dot line-dot-line"
                              style={{ backgroundColor: getLineBadgeColor(station, lineLabel) }}
                              title={lineLabel}
                            />
                          ))}
                        </div>
                        <small>{(station.lines.length > 0 ? station.lines : ['Sin linea']).join(' · ')}</small>
                        <div className="mini-metrics">
                          <span>{formatCompact(station.dailyRidership)} viajes/dia</span>
                          <span>+{station.commuteDeltaPct}% commute</span>
                        </div>
                      </button>
                      <button type="button" className={isActive ? 'closure-button active' : 'closure-button'} onClick={() => toggleClosure(station.id)}>
                        {isActive ? 'Reabrir' : 'Cerrar'}
                      </button>
                    </article>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </details>
    ));
  };

  if (!data) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Smart Commute CDMX</p>
          <h1>Cargando MVP geoespacial...</h1>
          <p>Procesando Metro, Metrobus, Transportes Electricos, Ecobici y red ciclista para la lectura multimodal.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="hero-card">
          <p className="eyebrow">Plataforma abierta para movilidad urbana</p>
          <h1>Smart Commute CDMX</h1>
          <p className="lede">Analiza escenarios de cierre de estaciones con datos reales y encuentra alternativas de viaje más resilientes en CDMX, para equipos técnicos y ciudadanía.</p>
          <p className="disclaimer">{data.scopeNote}</p>
        </div>

        <section className="summary-grid">
          <article>
            <span>Cierres activos</span>
            <strong>{aggregate.count}</strong>
          </article>
          <article>
            <span>Demanda diaria en riesgo</span>
            <strong>{formatCompact(aggregate.totalDailyRidership)}</strong>
          </article>
          <article>
            <span>Personas impactadas</span>
            <strong>{formatCompact(aggregate.totalImpactedPeople)}</strong>
          </article>
          <article>
            <span>Delta promedio</span>
            <strong>{aggregate.averageCommuteDelta ? `+${aggregate.averageCommuteDelta}%` : '0%'}</strong>
          </article>
          <article>
            <span>Demanda extendida en red</span>
            <strong>{formatCompact(aggregate.totalNetworkRidershipAtRisk)}</strong>
          </article>
          <article>
            <span>Nodos afectados en red</span>
            <strong>{aggregate.networkAffectedStations}</strong>
          </article>
        </section>

        <section className="scenario-card">
          <div className="list-header">
            <span className="section-label">Escenarios comparables</span>
          </div>
          <div className="chip-row">
            {scenarioOrder.map((scenario) => (
              <button
                key={scenario}
                type="button"
                className={selectedScenario === scenario ? 'chip active' : 'chip'}
                onClick={() => setSelectedScenario(scenario)}
              >
                Escenario {scenario}
              </button>
            ))}
          </div>
          <div className="scenario-diff-grid">
            <article>
              <span>Vs baseline (sin cierre)</span>
              <strong>{formatSigned(aggregate.totalImpactedPeople - baselineAggregate.totalImpactedPeople)} impactadas</strong>
            </article>
            <article>
              <span>Vs escenario {comparisonScenario}</span>
              <strong>{formatSigned(aggregate.totalImpactedPeople - comparisonAggregate.totalImpactedPeople)} impactadas</strong>
            </article>
            <article>
              <span>Vs baseline (red)</span>
              <strong>{formatSigned(aggregate.totalNetworkRidershipAtRisk - baselineAggregate.totalNetworkRidershipAtRisk)} viajes/dia</strong>
            </article>
            <article>
              <span>Vs escenario {comparisonScenario} (red)</span>
              <strong>{formatSigned(aggregate.totalNetworkRidershipAtRisk - comparisonAggregate.totalNetworkRidershipAtRisk)} viajes/dia</strong>
            </article>
          </div>
        </section>

        <section className="decision-card">
          <span className="section-label">Lectura ejecutiva</span>
          <strong>Recomendacion: Escenario {decisionBrief.winner}</strong>
          <p>
            Reduce el indice compuesto de impacto en {decisionBrief.scoreGapPct.toFixed(1)}% frente al escenario {decisionBrief.loser}.
          </p>
          <div className="scenario-diff-grid">
            <article>
              <span>Impactadas evitadas</span>
              <strong>{formatCompact(decisionBrief.impactedGap)}</strong>
            </article>
            <article>
              <span>Vulnerables evitadas</span>
              <strong>{formatCompact(decisionBrief.vulnerableGap)}</strong>
            </article>
            <article>
              <span>Riesgo de red evitado</span>
              <strong>{formatCompact(decisionBrief.networkGap)} viajes/dia</strong>
            </article>
            <article>
              <span>Delta commute evitado</span>
              <strong>{decisionBrief.commuteGap > 0 ? `+${decisionBrief.commuteGap}%` : `${decisionBrief.commuteGap}%`}</strong>
            </article>
          </div>
          <p className="decision-note">
            Criterio: 45% personas impactadas, 30% poblacion vulnerable, 20% demanda extendida en red, 5% delta promedio de commute.
          </p>
        </section>

        <section className="system-card">
          <div>
            <span className="section-label">Pulso del sistema</span>
            <strong>{formatCompact(data.summary.networkRidershipDaily)} viajes/dia modelados</strong>
          </div>
          <div className="system-summary-grid">
            {systemRidership.map((system) => (
              <article key={system.key}>
                <span>{system.label}</span>
                <strong>{formatCompact(system.averageDailyRidership)} viajes/dia</strong>
                <small>
                  {system.stationCount > 0
                    ? `${system.stationCount} nodos · ${system.lineCount} lineas`
                    : `${system.lineCount} lineas · sin cartografia KMZ aun`}
                </small>
              </article>
            ))}
          </div>
          {topNetworkLines.length > 0 ? (
            <div>
              <span className="section-label">Lineas con mayor demanda</span>
              <div className="system-tags">
                {topNetworkLines.slice(0, 8).map((line) => (
                  <span key={`${line.systemKey ?? 'network'}-${line.line}`}>
                    {(line.systemLabel ?? 'Red') + ' · ' + line.line}: {formatCompact(line.averageDailyRidership)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="system-tags">
            <span>{data.summary.ecobiciStations} cicloestaciones</span>
            <span>{data.summary.totalCycleKm} km ciclistas</span>
            <span>Modelo {data.summary.impactModelVersion}</span>
            <span>Red multimodal: {data.summary.metroNetworkSegments} tramos</span>
          </div>
        </section>

        <section className="layer-card">
          <span className="section-label">Capas visibles</span>
          <div className="chip-row">
            <button type="button" className={layers.cycleInfra ? 'chip active' : 'chip'} onClick={() => toggleLayer('cycleInfra')}>
              Red ciclista
            </button>
            <button type="button" className={layers.ecobici ? 'chip active' : 'chip'} onClick={() => toggleLayer('ecobici')}>
              Ecobici
            </button>
            <button type="button" className={layers.metroNetwork ? 'chip active' : 'chip'} onClick={() => toggleLayer('metroNetwork')}>
              Red multimodal
            </button>
          </div>
        </section>

        <section className="station-list">
          <div className="list-header">
            <span className="section-label">Nodos de cierre · Escenario {selectedScenario}</span>
            <button
              type="button"
              className="clear-button"
              onClick={() =>
                setClosuresByScenario((current) => ({
                  ...current,
                  [selectedScenario]: [],
                }))
              }
            >
              Limpiar
            </button>
          </div>

          <div className="tree-section">
            <span className="tree-title">Nodos cerrados ({closedStations.length})</span>
            {closedStations.length > 0 ? (
              <div className="tree-surface">{renderStationTree(closedTree, 'closed')}</div>
            ) : (
              <p className="tree-empty">Sin nodos cerrados en este escenario.</p>
            )}
          </div>

          <details className="tree-disclosure">
            <summary>
              <span>Nodos abiertos</span>
              <small>{openStations.length}</small>
            </summary>
            <div className="tree-surface">{renderStationTree(openTree, 'open')}</div>
          </details>
        </section>
      </aside>

      <main className="map-stage">
        <div ref={mapContainerRef} className="map-canvas" />

        <section className="floating-panel">
          <p className="eyebrow">Lectura del nodo</p>
          <h2>{selectedStation?.name}</h2>
          <p className="panel-copy">{data.methodologyNote}</p>

          {selectedStation ? (
            <>
              <div className="metrics-grid">
                <article>
                  <span>Demanda diaria</span>
                  <strong>{numberFormatter.format(selectedStation.dailyRidership)}</strong>
                </article>
                <article>
                  <span>Personas impactadas</span>
                  <strong>{numberFormatter.format(selectedStation.impactedPeople)}</strong>
                </article>
                <article>
                  <span>Poblacion vulnerable</span>
                  <strong>{numberFormatter.format(selectedStation.vulnerablePeople)}</strong>
                </article>
                <article>
                  <span>Resiliencia cercana</span>
                  <strong>{selectedStation.resilienceScore}/100</strong>
                </article>
              </div>

              <div className="detail-grid">
                <div>
                  <span>Delta commute</span>
                  <strong>+{selectedStation.commuteDeltaPct}%</strong>
                </div>
                <div>
                  <span>Complejidad transbordo</span>
                  <strong>{selectedStation.transferPenalty}</strong>
                </div>
                <div>
                  <span>Exposicion en red</span>
                  <strong>{Math.round((networkStationWeights.get(selectedStation.id) ?? 0) * 100)}%</strong>
                </div>
                <div>
                  <span>Ecobici a 800m</span>
                  <strong>{selectedStation.nearbyEcobici}</strong>
                </div>
                <div>
                  <span>Km ciclistas a 1km</span>
                  <strong>{selectedStation.cycleKmNearby}</strong>
                </div>
                <div>
                  <span>Alternativa mas cercana</span>
                  <strong>{selectedStation.nearestAlternativeDistanceM} m</strong>
                </div>
              </div>

              <div className="trace-card">
                <span className="section-label">Trazabilidad del calculo</span>
                <p>
                  Impactadas = demanda ({numberFormatter.format(selectedStation.dailyRidership)}) x factor de impacto
                  ({formatPct(selectedStation.impactSharePct)}).
                </p>
                <p>
                  Vulnerables = impactadas ({numberFormatter.format(selectedStation.impactedPeople)}) x factor social
                  ({formatPct(selectedStation.vulnerabilitySharePct)}).
                </p>
              </div>

              <div className="bottom-strip">
                <div>
                  <span>Alternativa visible</span>
                  <strong>{selectedStation.nearestAlternative}</strong>
                </div>
                <button
                  type="button"
                  className={activeClosures.has(selectedStation.id) ? 'primary-button active' : 'primary-button'}
                  onClick={() => toggleClosure(selectedStation.id)}
                >
                  {activeClosures.has(selectedStation.id) ? 'Reabrir nodo' : 'Simular cierre'}
                </button>
              </div>
            </>
          ) : null}
        </section>

        <aside className="map-legend" aria-label="Leyenda del mapa">
          <p className="section-label">Sistemas</p>
          <div className="legend-badge-grid">
            {['metro', 'metrobus', 'trolebus', 'trenligero', 'cablebus', 'ecobici', 'rtp'].map((systemKey) => (
              <div key={systemKey} className="legend-badge-item">
                <span className="legend-system-badge" style={{ borderColor: systemColorByKey[systemKey] }}>
                  {systemMarkerCodeByKey[systemKey]}
                </span>
                <small>{systemLabelByKey[systemKey]}</small>
              </div>
            ))}
          </div>

          <p className="section-label">Lineas Metro</p>
          <div className="legend-line-grid">
            {metroLineLegendOrder.map((lineKey) => (
              <span key={`metro-${lineKey}`} className="legend-line-chip">
                <i style={{ backgroundColor: metroLineColorByKey[lineKey] }} />L{lineKey.toUpperCase()}
              </span>
            ))}
          </div>

          <p className="section-label">Lineas Metrobus</p>
          <div className="legend-line-grid">
            {metrobusLineLegendOrder.map((lineKey) => (
              <span key={`metrobus-${lineKey}`} className="legend-line-chip">
                <i style={{ backgroundColor: metrobusLineColorByKey[lineKey] }} />MB {lineKey}
              </span>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
