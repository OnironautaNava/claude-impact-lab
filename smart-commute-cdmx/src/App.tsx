import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSourceSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LayerState, MvpData, StationImpact, SystemRidershipSummary } from './types';

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
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
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


const normalizeLineKey = (line: string) => {
  const ascii = line
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/linea|linea\.?|line|troncal/g, '')
    .trim();
  const match = ascii.match(/\d+|[a-z]+/);
  return match?.[0] ?? ascii;
};

const getLineBadgeColor = (station: StationImpact, lineLabel: string) => {
  const system = inferSystemKey(station);
  const lineKey = normalizeLineKey(lineLabel);
  if (system === 'metro') return metroLineColorByKey[lineKey] ?? station.lineColor;
  if (system === 'metrobus') return metrobusLineColorByKey[lineKey] ?? station.lineColor;
  return station.lineColor;
};

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const inferSystemKey = (station: StationImpact) => {
  const raw = (station.mode ?? station.id.split('-')[0] ?? 'otro').toLowerCase().trim();
  if (raw === 'mb') return 'metrobus';
  if (raw === 'tren ligero' || raw === 'tren-ligero') return 'trenligero';
  if (raw === 'trolebus' || raw === 'trolebuses') return 'trolebus';
  if (raw in systemLabelByKey) return raw;
  return 'otro';
};

const sortByName = (a: StationImpact, b: StationImpact) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

const numberFormatter = new Intl.NumberFormat('es-MX');
const formatCompact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return numberFormatter.format(value);
};
const formatPct = (value: number) => `${value.toFixed(1)}%`;

const fallbackSystemSummaries = (data: MvpData | null): SystemRidershipSummary[] => {
  if (!data) return [];
  return [
    {
      key: 'metro', label: 'Metro',
      averageDailyRidership: data.summary.averageMetroDaily,
      stationCount: data.stations.filter((s) => inferSystemKey(s) === 'metro').length,
      lineCount: new Set(data.stations.filter((s) => inferSystemKey(s) === 'metro').flatMap((s) => s.lines)).size,
      hasGeography: true,
    },
    {
      key: 'metrobus', label: 'Metrobus',
      averageDailyRidership: data.summary.averageMetrobusDaily,
      stationCount: data.stations.filter((s) => inferSystemKey(s) === 'metrobus').length,
      lineCount: data.summary.topMetrobusLines.length,
      hasGeography: true,
    },
  ];
};


const networkAffectThreshold = 0.3;
type NetworkEdge = { id: string; mode: string };

const hopWeightFor = (mode: string, depth: number) => {
  const n = mode.toLowerCase();
  if (depth === 1) {
    if (n === 'metro') return 0.62;
    if (n === 'metrobus') return 0.56;
    return 0.5;
  }
  if (n === 'metro') return 0.35;
  if (n === 'metrobus') return 0.3;
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
      if (!current || current.depth >= 2) continue;
      const nextDepth = current.depth + 1;
      for (const edge of adjacency.get(current.id) ?? []) {
        let hopWeight = hopWeightFor(edge.mode, nextDepth);
        if (current.viaMode && current.viaMode !== edge.mode) hopWeight = Math.max(0, hopWeight - 0.08);
        const existing = weights.get(edge.id) ?? 0;
        if (hopWeight > existing) weights.set(edge.id, hopWeight);
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
    return { type: 'Feature', properties: { ...feature.properties, affected }, geometry: feature.geometry };
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
      geometry: { type: 'Point', coordinates: station.coordinates },
    };
  }),
});

// ============================================================
// UI SUB-COMPONENTS
// ============================================================

// ---------- HEADER ----------
interface HeaderProps {
  closedCount: number;
  totalStations: number;
  onClear: () => void;
}

function AppHeader({ closedCount, totalStations, onClear }: HeaderProps) {
  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="header-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0A0E1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2-8 4 16 2-8h6"/>
          </svg>
        </div>
        <div>
          <div className="header-title">Smart Commute <span>CDMX</span></div>
          <div className="header-subtitle">Simulador de impacto en movilidad · Ciudad de México</div>
        </div>
      </div>
      <div className="header-actions">
        <div className="header-legend" role="status" aria-label="Resumen del estado de la red">
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--red)', boxShadow: '0 0 6px var(--red)' }} />
            <span>Cierre transporte</span>
            <span className="legend-count f-mono">{closedCount}</span>
          </div>
          <div className="divider-v" aria-hidden="true" />
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--amber)', boxShadow: '0 0 6px var(--amber)' }} />
            <span>Cierre vial</span>
            <span className="legend-count f-mono">0</span>
          </div>
          <div className="divider-v" aria-hidden="true" />
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
            <span>OK</span>
            <span className="legend-count f-mono">{totalStations - closedCount}</span>
          </div>
        </div>
        <button className="header-btn" onClick={onClear} aria-label="Limpiar escenario actual">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 0 0-15-3M4 14a8 8 0 0 0 15 3"/>
          </svg>
          Limpiar
        </button>
        <button className="header-btn header-btn-primary">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Nuevo escenario
        </button>
      </div>
    </header>
  );
}

// ---------- SIDEBAR ----------
interface SidebarProps {
  data: MvpData;
  selectedScenario: ScenarioKey;
  onScenarioChange: (s: ScenarioKey) => void;
  aggregate: AggregateMetrics;
  systemRidership: SystemRidershipSummary[];
  closedStations: StationImpact[];
  openStations: StationImpact[];
  filteredClosedStations: StationImpact[];
  filteredOpenStations: StationImpact[];
  nodeQuery: string;
  nodeSystemFilter: string;
  nodeSystemOptions: Array<{ key: string; label: string; count: number }>;
  activeClosures: Set<string>;
  selectedStation: StationImpact | null;
  onSelectStation: (id: string) => void;
  onToggleClosure: (id: string) => void;
  onClearScenario: () => void;
  onQueryChange: (value: string) => void;
  onSystemChange: (value: string) => void;
}

function Sidebar({
  data,
  selectedScenario,
  onScenarioChange,
  aggregate,
  systemRidership,
  closedStations,
  openStations,
  filteredClosedStations,
  filteredOpenStations,
  nodeQuery,
  nodeSystemFilter,
  nodeSystemOptions,
  activeClosures,
  selectedStation,
  onSelectStation,
  onToggleClosure,
  onClearScenario,
  onQueryChange,
  onSystemChange,
}: SidebarProps) {
  const maxRidership = Math.max(...systemRidership.map((s) => s.averageDailyRidership), 1);
  const totalStations = data.stations.length;
  const filteredNodeCount = filteredClosedStations.length + filteredOpenStations.length;

  const barColor = (i: number) => {
    const colors = ['var(--red)', 'var(--amber)', 'var(--cyan)', 'var(--green)', 'var(--orange)'];
    return colors[i % colors.length];
  };

  const renderStationCards = (stations: StationImpact[]) =>
    stations.map((station) => {
      const systemKey = inferSystemKey(station);
      const systemLabel = systemLabelByKey[systemKey] ?? systemKey;
      const isSelected = selectedStation?.id === station.id;
      const isClosed = activeClosures.has(station.id);
      const lines = station.lines.length > 0 ? station.lines : ['Sin linea'];

      return (
        <article key={station.id} className={`selector-card${isSelected ? ' selected' : ''}${isClosed ? ' closed' : ''}`}>
          <button type="button" className="selector-main" onClick={() => onSelectStation(station.id)}>
            <div className="selector-topline">
              <span className="selector-system" style={{ color: systemColorByKey[systemKey] ?? 'var(--cyan)' }}>
                {systemLabel}
              </span>
              <span className={`selector-status${isClosed ? ' closed' : ''}`}>{isClosed ? 'Apagada' : 'Encendida'}</span>
            </div>
            <strong>{station.name}</strong>
            <small>{lines.join(' · ')}</small>
            <div className="selector-meta">
              <span>{formatCompact(station.dailyRidership)} viajes/día</span>
              <span>+{station.commuteDeltaPct}% commute</span>
            </div>
            <div className="selector-lines" aria-hidden="true">
              {Array.from(new Set(lines)).map((lineLabel) => (
                <span
                  key={`${station.id}-${lineLabel}`}
                  className="selector-line-dot"
                  style={{ backgroundColor: getLineBadgeColor(station, lineLabel) }}
                />
              ))}
            </div>
          </button>
          <button
            type="button"
            className={`selector-action${isClosed ? ' active' : ''}`}
            onClick={() => onToggleClosure(station.id)}
            aria-pressed={isClosed}
            aria-label={`${isClosed ? 'Reactivar' : 'Apagar'} ${station.name} en escenario ${selectedScenario}`}
          >
            {isClosed ? 'Reactivar' : 'Apagar'}
          </button>
        </article>
      );
    });

  return (
    <aside className="sidebar" aria-label="Panel de control del escenario">

      {/* ── Scenario header ── */}
      <div className="sidebar-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p className="eyebrow">Escenario activo</p>
          <div className="scenario-live" aria-label="Simulación en vivo">
            <span className="blink" style={{ width: 7, height: 7, borderRadius: '999px', background: 'var(--red)', display: 'inline-block' }} aria-hidden="true" />
            EN VIVO
          </div>
        </div>
        <h1 className="scenario-title">SCN‑03{selectedScenario === 'A' ? '17' : '18'} · Escenario {selectedScenario}</h1>
        <p className="scenario-sub">{aggregate.count} cierre(s) activo(s) · simulación hora pico</p>
      </div>

      {/* ── Scenario selector ── */}
      <div className="sidebar-section">
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Comparar escenarios
        </p>
        <div className="chip-row" role="group" aria-label="Seleccionar escenario">
          {scenarioOrder.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${selectedScenario === s ? ' active' : ''}`}
              onClick={() => onScenarioChange(s)}
              aria-pressed={selectedScenario === s}
            >
              Escenario {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Options (add closure, road closure, etc.) ── */}
      <div className="sidebar-section">
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Opciones
        </p>
        <div className="options-list">
          <OptionRow icon="plus" label="Nuevo cierre" hint="Seleccionar nodo en el mapa" />
          <OptionRow icon="road" label="Cierre vial" hint="Dibujar segmento de calle" />
          <OptionRow icon="clock" label="Hora del día" hint="08:42 · hora pico" />
          <OptionRow icon="save" label="Exportar escenario" hint="Descargar como JSON" />
        </div>
      </div>

      {/* ── Impact summary ── */}
      <div className="sidebar-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p className="eyebrow">Resumen</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>Impacto total</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="blink" style={{ width: 7, height: 7, borderRadius: '999px', background: 'var(--green)', display: 'inline-block' }} aria-hidden="true" />
            <span style={{ fontSize: 10, color: 'var(--ink-dim)' }}>hace 4 s</span>
          </div>
        </div>

        {/* Big numbers */}
        <div className="impact-grid">
          <div className="impact-cell">
            <p className="impact-label">Personas afectadas</p>
            <p className="big-num" style={{ fontSize: 28, color: 'var(--ink)' }}>
              {formatCompact(aggregate.totalImpactedPeople)}
            </p>
            <p className="impact-sub">≈ {((aggregate.totalImpactedPeople / Math.max(data.summary.networkRidershipDaily, 1)) * 100).toFixed(1)}% red</p>
          </div>
          <div className="impact-cell">
            <p className="impact-label">Retraso prom.</p>
            <p className="big-num" style={{ fontSize: 28, color: 'var(--amber)' }}>
              {aggregate.averageCommuteDelta > 0 ? `+${aggregate.averageCommuteDelta}%` : '0%'}
            </p>
            <p className="impact-sub">delta commute</p>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="stat-row-grid">
          <StatTile
            label="Transporte cerrado"
            value={aggregate.count}
            total={totalStations}
            color="var(--red)"
          />
          <StatTile
            label="Nodos afectados red"
            value={aggregate.networkAffectedStations}
            total={totalStations}
            color="var(--amber)"
          />
        </div>

        {/* System bars */}
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Impacto por sistema
        </p>
        {systemRidership.slice(0, 5).map((s, i) => {
          const pct = s.averageDailyRidership / maxRidership;
          const color = barColor(i);
          return (
            <div key={s.key} className="system-bar-row">
              <span className="system-bar-name">{s.label}</span>
              <div className="system-bar-track" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="system-bar-fill" style={{ width: `${Math.max(4, pct * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
              </div>
              <span className="system-bar-pct big-num" style={{ color }}>{Math.round(pct * 100)}%</span>
            </div>
          );
        })}
      </div>

      {/* ── Station list ── */}
      <div className="sidebar-section">
        <div className="station-list-header">
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Nodos · Escenario {selectedScenario}
          </p>
          <button type="button" className="clear-button" onClick={onClearScenario}>
            Limpiar
          </button>
        </div>

        <div className="station-selector-shell">
          <div className="station-selector-copy">
            <p className="eyebrow">Selector de nodos</p>
            <h2 className="station-selector-title">Administra estaciones del escenario {selectedScenario} sin salir del panel</h2>
            <p className="station-selector-sub">Busca por nombre, línea o sistema; luego separa rápidamente entre apagadas y encendidas.</p>
          </div>

          <div className="station-selector-toolbar">
            <label className="node-search" aria-label="Buscar nodo de transporte">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={nodeQuery}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Busca por nombre, línea o sistema"
              />
            </label>

            <div className="node-filter-row" role="tablist" aria-label="Filtrar nodos por sistema">
              <button
                type="button"
                className={`node-filter-chip${nodeSystemFilter === 'all' ? ' active' : ''}`}
                onClick={() => onSystemChange('all')}
              >
                Todos
                <span>{filteredNodeCount}</span>
              </button>
              {nodeSystemOptions.map((system) => (
                <button
                  key={system.key}
                  type="button"
                  className={`node-filter-chip${nodeSystemFilter === system.key ? ' active' : ''}`}
                  onClick={() => onSystemChange(system.key)}
                >
                  {system.label}
                  <span>{system.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="selector-group">
            <div className="selector-group-head">
              <span className="tree-title">Apagadas en escenario {selectedScenario}</span>
              <span className="selector-group-count f-mono">{filteredClosedStations.length}/{closedStations.length}</span>
            </div>
            <div className="node-selector-list sidebar-node-list">
              {filteredClosedStations.length > 0
                ? renderStationCards(filteredClosedStations)
                : <p className="node-selector-empty">No hay estaciones apagadas que coincidan con ese filtro en el escenario {selectedScenario}.</p>}
            </div>
          </div>

          <div className="selector-group selector-group-open">
            <div className="selector-group-head">
              <span className="tree-title">Encendidas en escenario {selectedScenario}</span>
              <span className="selector-group-count f-mono">{filteredOpenStations.length}/{openStations.length}</span>
            </div>
            <div className="node-selector-list sidebar-node-list">
              {filteredOpenStations.length > 0
                ? renderStationCards(filteredOpenStations)
                : <p className="node-selector-empty">No hay estaciones encendidas que coincidan con ese filtro en el escenario {selectedScenario}.</p>}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function OptionRow({ icon, label, hint }: { icon: 'plus' | 'road' | 'clock' | 'save'; label: string; hint: string }) {
  const icons = {
    plus: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    ),
    road: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3v18M16 3v18"/><path d="M12 5v2M12 11v2M12 17v2"/>
      </svg>
    ),
    clock: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
      </svg>
    ),
    save: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 13h8v8H8z"/>
      </svg>
    ),
  };
  return (
    <button type="button" className="option-row">
      <span className="option-icon" aria-hidden="true">{icons[icon]}</span>
      <div style={{ flex: 1 }}>
        <span className="option-label">{label}</span>
        <span className="option-hint">{hint}</span>
      </div>
      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ color: 'var(--ink-mute)' }} aria-hidden="true">
        <path d="M9 6l6 6-6 6"/>
      </svg>
    </button>
  );
}

function StatTile({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? value / total : 0;
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <div className="stat-tile-nums">
        <span className="stat-tile-num big-num" style={{ color }}>{value}</span>
        <span className="stat-tile-total">/{total}</span>
      </div>
      <div className="stat-tile-bar" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="stat-tile-fill" style={{ width: `${Math.max(4, pct * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ---------- NODE POPUP ----------
interface NodePopupProps {
  station: StationImpact;
  isActive: boolean;
  networkWeight: number;
  onToggleClosure: (id: string) => void;
  onClose: () => void;
}

function NodePopup({ station, isActive, networkWeight, onToggleClosure, onClose }: NodePopupProps) {
  const systemKey = inferSystemKey(station);
  const systemLabel = systemLabelByKey[systemKey] ?? systemKey;

  return (
    <aside className="node-popup" aria-label={`Detalles del nodo ${station.name}`}>
      {/* Head */}
      <div className="node-popup-head">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <span className="pill pill-system">{systemLabel.toUpperCase()}</span>
              {station.transferPenalty > 1 && (
                <span className="pill pill-transfer">Intercambio</span>
              )}
            </div>
            <h2 className="node-name">{station.name}</h2>
            <p className="node-sub">{systemLabel} · {station.lines.join(' / ') || 'Sin línea'}</p>
            <div className="node-lines">
              {(station.lines.length > 0 ? station.lines : ['Sin línea']).map((line) => {
                const color = getLineBadgeColor(station, line);
                return (
                  <span
                    key={line}
                    className="pill"
                    style={{
                      color,
                      border: `1px solid ${color}55`,
                      background: `${color}1A`,
                    }}
                  >
                    {line}
                  </span>
                );
              })}
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Cerrar panel de nodo">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6l-12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Closure toggle */}
      <div
        className="closure-status-bar"
        style={{ background: isActive ? 'rgba(244,63,94,0.06)' : 'transparent' }}
      >
        <div>
          <p className="closure-status-label">Estado del cierre</p>
          <p className="closure-status-value" style={{ color: isActive ? 'var(--ink)' : 'var(--ink-dim)' }}>
            {isActive ? 'Activo' : 'Inactivo'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? 'var(--red)' : 'var(--ink-dim)' }}>
            {isActive ? 'ON' : 'OFF'}
          </span>
          <button
            className={`switch ${isActive ? 'on' : 'off'}`}
            onClick={() => onToggleClosure(station.id)}
            role="switch"
            aria-checked={isActive}
            aria-label={`${isActive ? 'Desactivar' : 'Activar'} cierre de ${station.name}`}
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="node-popup-body">
        {/* 2×2 metrics */}
        <div className="metrics-2x2">
          <MetricTile
            icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="7" r="4"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>
              </svg>
            }
            color="var(--red)"
            label="Personas"
            value={formatCompact(station.impactedPeople)}
            sub={`+${formatCompact(station.vulnerablePeople)} vuln.`}
          />
          <MetricTile
            icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
              </svg>
            }
            color="var(--amber)"
            label="Retraso"
            value={`~${station.commuteDeltaPct}%`}
            sub="delta commute"
          />
          <MetricTile
            icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20l5-5 4 4 7-9"/>
              </svg>
            }
            color="var(--cyan)"
            label="Alternativa"
            value={station.nearestAlternative}
            sub={`${station.nearestAlternativeDistanceM} m`}
          />
          <MetricTile
            icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3l10 18H2L12 3z"/>
              </svg>
            }
            color="var(--orange)"
            label="Red expuesta"
            value={`${Math.round(networkWeight * 100)}%`}
            sub={`resiliencia ${station.resilienceScore}/100`}
          />
        </div>

        {/* Impacted routes */}
        {station.lines.length > 0 && (
          <div className="node-section">
            <span className="node-section-title">Rutas impactadas</span>
            <div className="routes-tags">
              {station.lines.map((line, i) => (
                <span key={i} className="route-pill">{line}</span>
              ))}
            </div>
          </div>
        )}

        {/* Nearby mobility */}
        <div className="node-section">
          <span className="node-section-title">Movilidad cercana</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              ['Ecobici a 800m', String(station.nearbyEcobici), 'var(--green)'],
              ['Km ciclistas', `${station.cycleKmNearby} km`, 'var(--cyan)'],
              ['Transbordo', String(station.transferPenalty), 'var(--amber)'],
              ['Demanda/día', formatCompact(station.dailyRidership), 'var(--ink-2)'],
            ].map(([k, v, c]) => (
              <div key={k} style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--line)' }}>
                <p style={{ fontSize: 9, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{k}</p>
                <p className="big-num" style={{ fontSize: 16, color: c, marginTop: 4 }}>{v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trazabilidad */}
        <div className="trace-card">
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            Trazabilidad
          </p>
          <p>
            Impactadas = {numberFormatter.format(station.dailyRidership)} × factor {formatPct(station.impactSharePct)}
          </p>
          <p>
            Vulnerables = {numberFormatter.format(station.impactedPeople)} × factor social {formatPct(station.vulnerabilitySharePct)}
          </p>
        </div>

        {/* Actions */}
        <div className="node-actions">
          <button className="btn-primary">Ver reporte</button>
          <button
            className={`btn-secondary${isActive ? ' btn-danger' : ''}`}
            onClick={() => onToggleClosure(station.id)}
          >
            {isActive ? 'Reabrir estación' : 'Simular cierre'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function MetricTile({
  icon, color, label, value, sub,
}: { icon: React.ReactNode; color: string; label: string; value: string; sub: string }) {
  return (
    <div className="metric-tile">
      <div className="metric-tile-head">
        <span style={{ color }}>{icon}</span>
        <span className="metric-tile-label">{label}</span>
      </div>
      <p className="metric-tile-value" style={{ color }}>{value}</p>
      <p className="metric-tile-sub">{sub}</p>
    </div>
  );
}

// ---------- LAYERS PANEL ----------
interface LayersPanelProps {
  layers: LayerState;
  onToggle: (key: keyof LayerState) => void;
}

function LayersPanel({ layers, onToggle }: LayersPanelProps) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(layers).filter(Boolean).length;

  const transitItems: { k: keyof LayerState | '__placeholder__'; label: string; meta: string }[] = [
    { k: 'metroNetwork', label: 'Red multimodal', meta: '12 líneas · 195 est.' },
    { k: 'ecobici',      label: 'Ecobici',         meta: 'cicloestaciones' },
    { k: 'cycleInfra',  label: 'Red ciclista',    meta: 'infraestructura ciclista' },
  ];

  return (
    <div className="layers-wrapper">
      {open && (
        <div className="layers-popup" role="dialog" aria-label="Control de capas del mapa">
          <div className="layers-popup-head">
            <p className="eyebrow">Capas del mapa</p>
            <button
              onClick={() => setOpen(false)}
              style={{ color: 'var(--ink-dim)', display: 'flex', alignItems: 'center' }}
              aria-label="Cerrar panel de capas"
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6l-12 12"/>
              </svg>
            </button>
          </div>
          <div className="layers-popup-body">
            <span className="layers-group-label">Transporte y red</span>
            {transitItems.map((it) => {
              const isOn = it.k !== '__placeholder__' ? layers[it.k as keyof LayerState] : false;
              const color = 'var(--cyan)';
              return (
                <button
                  key={it.k}
                  type="button"
                  className="layer-row"
                  onClick={() => it.k !== '__placeholder__' && onToggle(it.k as keyof LayerState)}
                  aria-pressed={isOn}
                >
                  <span
                    className="layer-dot"
                    style={{
                      background: isOn ? color : '#2E3A55',
                      boxShadow: isOn ? `0 0 8px ${color}` : 'none',
                    }}
                    aria-hidden="true"
                  />
                  <div className="layer-row-info">
                    <span className="layer-row-label">{it.label}</span>
                    <span className="layer-row-meta">{it.meta}</span>
                  </div>
                  <span
                    className="layer-badge"
                    style={{
                      color:       isOn ? 'var(--green)' : 'var(--ink-dim)',
                      background:  isOn ? 'rgba(16,217,107,0.12)' : 'rgba(255,255,255,0.03)',
                      border:      `1px solid ${isOn ? 'rgba(16,217,107,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    {isOn ? 'ON' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button className="layers-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="layers-popup">
        <svg width="15" height="15" fill="none" stroke="var(--cyan)" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l10 6-10 6-10-6 10-6zM2 16l10 6 10-6M2 12l10 6 10-6"/>
        </svg>
        <span>Capas</span>
        <span className="f-mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>{activeCount} activas</span>
        <svg
          width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"
          style={{ color: 'var(--ink-dim)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
          aria-hidden="true"
        >
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </button>
    </div>
  );
}

// ---------- BOTTOM STATUS ----------
function BottomStatus() {
  return (
    <div className="bottom-status f-mono" aria-hidden="true">
      <span>MapLibre GL · OSM</span>
      <span style={{ width: 1, height: 10, background: 'var(--line)', display: 'inline-block' }} />
      <span>19°25′N · 99°11′W</span>
    </div>
  );
}

// ============================================================
// APP
// ============================================================
function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previousSelectedIdRef = useRef<string | null>(null);
  const [data, setData] = useState<MvpData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>('A');
  const [closuresByScenario, setClosuresByScenario] = useState<Record<ScenarioKey, string[]>>({ A: [], B: [] });
  const [layers, setLayers] = useState<LayerState>(defaultLayers);
  const [nodeQuery, setNodeQuery] = useState('');
  const [nodeSystemFilter, setNodeSystemFilter] = useState('all');

  const activeClosureIds = closuresByScenario[selectedScenario];

  useEffect(() => {
    let active = true;
    fetch('/data/multimodal-data.json')
      .then((r) => {
        if (!r.ok) throw new Error('multimodal-data.json no disponible');
        return r.json();
      })
      .then((payload: MvpData) => {
        if (!active) return;
        setData(payload);
        setSelectedId(payload.stations[0]?.id ?? null);
      })
      .catch(() => {
        fetch('/data/mvp-data.json')
          .then((r) => r.json())
          .then((payload: MvpData) => {
            if (!active) return;
            setData(payload);
            setSelectedId(payload.stations[0]?.id ?? null);
          })
          .catch((err) => console.error('No se pudo cargar los datos', err));
      });
    return () => { active = false; };
  }, []);

  const selectedStation = useMemo(
    () => data?.stations.find((s) => s.id === selectedId) ?? data?.stations[0] ?? null,
    [data, selectedId],
  );

  const activeClosures = useMemo(() => new Set(activeClosureIds), [activeClosureIds]);

  const networkAdjacency = useMemo(() => {
    const adjacency = new Map<string, Map<string, string>>();
    for (const feature of data?.metroNetwork.features ?? []) {
      const from = String(feature.properties?.from ?? '');
      const to = String(feature.properties?.to ?? '');
      const mode = String(feature.properties?.mode ?? 'unknown').toLowerCase();
      if (!from || !to) continue;
      if (!adjacency.has(from)) adjacency.set(from, new Map());
      if (!adjacency.has(to)) adjacency.set(to, new Map());
      adjacency.get(from)?.set(to, mode);
      adjacency.get(to)?.set(from, mode);
    }
    const normalized = new Map<string, NetworkEdge[]>();
    for (const [stationId, neighborMap] of adjacency.entries()) {
      normalized.set(stationId, Array.from(neighborMap.entries()).map(([id, m]) => ({ id, mode: m })));
    }
    return normalized;
  }, [data]);

  const networkStationWeights = useMemo(
    () => buildNetworkWeights(activeClosureIds, networkAdjacency),
    [activeClosureIds, networkAdjacency],
  );

  const scenarioAggregates = useMemo(() => {
    const stations = data?.stations ?? [];
    const computeAggregate = (closureIds: string[]) => {
      const closureSet = new Set(closureIds);
      const active = stations.filter((s) => closureSet.has(s.id));
      const totalDailyRidership = active.reduce((sum, s) => sum + s.dailyRidership, 0);
      const totalImpactedPeople = active.reduce((sum, s) => sum + s.impactedPeople, 0);
      const totalVulnerablePeople = active.reduce((sum, s) => sum + s.vulnerablePeople, 0);
      const averageCommuteDelta = active.length
        ? Math.round(active.reduce((sum, s) => sum + s.commuteDeltaPct, 0) / active.length)
        : 0;
      const weights = buildNetworkWeights(closureIds, networkAdjacency);
      const totalNetworkRidershipAtRisk = stations.reduce((sum, s) => sum + s.dailyRidership * (weights.get(s.id) ?? 0), 0);
      const networkAffectedStations = Array.from(weights.values()).filter((w) => w >= networkAffectThreshold).length;
      return {
        count: active.length,
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
  const systemRidership = useMemo(
    () => data?.summary.systemDailyRidership ?? fallbackSystemSummaries(data),
    [data],
  );

  const stationSource = useMemo(
    () => stationSourceFromData(data?.stations ?? [], activeClosures, selectedStation?.id ?? null),
    [activeClosures, data, selectedStation?.id],
  );

  const closedStations = useMemo(
    () => (data?.stations ?? []).filter((s) => activeClosures.has(s.id)).sort(sortByName),
    [activeClosures, data?.stations],
  );

  const openStations = useMemo(
    () => (data?.stations ?? []).filter((s) => !activeClosures.has(s.id)).sort(sortByName),
    [activeClosures, data?.stations],
  );

  const nodeSystemOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const station of data?.stations ?? []) {
      const systemKey = inferSystemKey(station);
      counts.set(systemKey, (counts.get(systemKey) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        const ia = systemOrder.indexOf(a);
        const ib = systemOrder.indexOf(b);
        return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
      })
      .map(([key, count]) => ({ key, count, label: systemLabelByKey[key] ?? key }));
  }, [data?.stations]);

  const filteredNodeStations = useMemo(() => {
    const query = normalizeSearchText(nodeQuery);
    const matchesQuery = (station: StationImpact) => {
      if (!query) return true;
      const haystack = normalizeSearchText([
        station.name,
        station.mode ?? '',
        inferSystemKey(station),
        ...(station.lines.length > 0 ? station.lines : ['Sin linea']),
      ].join(' '));
      return haystack.includes(query);
    };

    return (data?.stations ?? [])
      .filter((station) => nodeSystemFilter === 'all' || inferSystemKey(station) === nodeSystemFilter)
      .filter(matchesQuery)
      .sort((a, b) => {
        const selectedBoost = Number(b.id === selectedId) - Number(a.id === selectedId);
        if (selectedBoost !== 0) return selectedBoost;
        const closedBoost = Number(activeClosures.has(b.id)) - Number(activeClosures.has(a.id));
        if (closedBoost !== 0) return closedBoost;
        return sortByName(a, b);
      });
  }, [activeClosures, data?.stations, nodeQuery, nodeSystemFilter, selectedId]);

  const filteredClosedStations = useMemo(
    () => filteredNodeStations.filter((station) => activeClosures.has(station.id)),
    [activeClosures, filteredNodeStations],
  );

  const filteredOpenStations = useMemo(
    () => filteredNodeStations.filter((station) => !activeClosures.has(station.id)),
    [activeClosures, filteredNodeStations],
  );

  const networkSource = useMemo(
    () =>
      networkSourceFromData(
        data?.metroNetwork ?? { type: 'FeatureCollection', features: [] },
        networkStationWeights,
        activeClosures,
      ),
    [activeClosures, data, networkStationWeights],
  );

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !data) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyle,
      center: [-99.1425, 19.412],
      zoom: 11.1,
      pitch: 26,
      bearing: -10,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    map.on('load', () => {
      map.addSource('cycle-infra', { type: 'geojson', data: data.cycleInfra } satisfies GeoJSONSourceSpecification);
      map.addLayer({ id: 'cycle-infra', type: 'line', source: 'cycle-infra', paint: { 'line-color': '#22c55e', 'line-width': 2.5, 'line-opacity': 0.8 } });

      map.addSource('metro-network', { type: 'geojson', data: networkSource } satisfies GeoJSONSourceSpecification);
      map.addLayer({
        id: 'metro-network-base', type: 'line', source: 'metro-network',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'lineColor'], '#64748b'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.2, 12, 4.1, 16, 4.8], 'line-opacity': 0.62 },
      });
      map.addLayer({
        id: 'metro-network-affected', type: 'line', source: 'metro-network',
        filter: ['==', ['get', 'affected'], 1],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'lineColor'], '#f97316'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5.4, 12, 6.3, 16, 7.2], 'line-opacity': 0.9 },
      });

      map.addSource('ecobici', { type: 'geojson', data: data.ecobici } satisfies GeoJSONSourceSpecification);
      map.addLayer({ id: 'ecobici', type: 'circle', source: 'ecobici', paint: { 'circle-radius': 3, 'circle-color': '#2dd4bf', 'circle-opacity': 0.72, 'circle-stroke-width': 1, 'circle-stroke-color': '#06221d' } });

      map.addSource('stations', { type: 'geojson', data: stationSource } satisfies GeoJSONSourceSpecification);
      map.addLayer({ id: 'station-shadow', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 12, 12, 15, 16], 'circle-color': '#020617', 'circle-opacity': 0.35, 'circle-blur': 0.65 } });
      map.addLayer({ id: 'station-halo', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'selected'], 1], 16, ['==', ['get', 'active'], 1], 13, 11], 12, ['case', ['==', ['get', 'selected'], 1], 23, ['==', ['get', 'active'], 1], 19, 16], 15, ['case', ['==', ['get', 'selected'], 1], 30, ['==', ['get', 'active'], 1], 24, 20]], 'circle-color': ['coalesce', ['get', 'systemColor'], '#22d3ee'], 'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.55, ['==', ['get', 'active'], 1], 0.42, 0.28], 'circle-blur': 0.35 } });
      map.addLayer({ id: 'station-hit-area', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 18, 15, 24], 'circle-color': '#ffffff', 'circle-opacity': 0.01 } });
      map.addLayer({ id: 'station-core', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'selected'], 1], 6.5, ['==', ['get', 'active'], 1], 5.5, 5], 12, ['case', ['==', ['get', 'selected'], 1], 8.5, ['==', ['get', 'active'], 1], 7, 6.2], 15, ['case', ['==', ['get', 'selected'], 1], 10.5, ['==', ['get', 'active'], 1], 8.5, 7.2]], 'circle-color': ['coalesce', ['get', 'systemColor'], '#64748b'], 'circle-stroke-color': '#f8fafc', 'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.6, 2.1] } });
      map.addLayer({ id: 'station-center-dot', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'selected'], 1], 2.5, 1.9], 12, ['case', ['==', ['get', 'selected'], 1], 3.2, 2.4], 15, ['case', ['==', ['get', 'selected'], 1], 4.2, 3.2]], 'circle-color': '#ffffff', 'circle-opacity': 0.96 } });
      map.addLayer({ id: 'station-closed-ring', type: 'circle', source: 'stations', filter: ['==', ['get', 'active'], 1], paint: { 'circle-radius': ['case', ['==', ['get', 'selected'], 1], 18, 14], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2.4, 'circle-opacity': 0.95 } });
      map.addLayer({ id: 'station-selected-ring', type: 'circle', source: 'stations', filter: ['==', ['get', 'selected'], 1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 16, 12, 22, 15, 28], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#67e8f9', 'circle-stroke-width': 3, 'circle-opacity': 0.95 } });
      map.addLayer({ id: 'station-badge', type: 'symbol', source: 'stations', minzoom: 11, layout: { 'text-field': ['coalesce', ['get', 'modeShort'], 'TP'], 'text-font': ['Open Sans Semibold'], 'text-size': ['case', ['==', ['get', 'selected'], 1], 11.5, 9.5], 'text-offset': [0, 0], 'text-anchor': 'center', 'text-allow-overlap': true }, paint: { 'text-color': '#0f172a', 'text-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.82] } });
      map.addLayer({ id: 'station-label', type: 'symbol', source: 'stations', minzoom: 10.8, layout: { 'text-field': ['case', ['==', ['get', 'selected'], 1], ['get', 'name'], ['==', ['get', 'active'], 1], ['get', 'name'], ''], 'text-font': ['Open Sans Semibold'], 'text-size': ['case', ['==', ['get', 'selected'], 1], 14, 11], 'text-offset': [0, 1.55], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-max-width': 10 }, paint: { 'text-color': '#f8fafc', 'text-halo-color': 'rgba(10,14,26,0.95)', 'text-halo-width': 1.6, 'text-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.92] } });

      const handleClick = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') {
          setSelectedId(id);
          setPopupOpen(true);
        }
      };
      const setCursor = (cursor: string) => () => { map.getCanvas().style.cursor = cursor; };

      for (const layer of ['station-hit-area', 'station-core', 'station-center-dot', 'station-badge', 'station-closed-ring', 'station-selected-ring']) {
        map.on('click', layer, handleClick);
        map.on('mouseenter', layer, setCursor('pointer'));
        map.on('mouseleave', layer, setCursor(''));
      }
    });

    return () => {
      selectedMarkerRef.current?.remove();
      selectedMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  // Update map sources when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !data) return;
    (map.getSource('stations') as maplibregl.GeoJSONSource | undefined)?.setData(stationSource);
    (map.getSource('metro-network') as maplibregl.GeoJSONSource | undefined)?.setData(networkSource);
  }, [data, networkSource, stationSource]);

  useEffect(() => {
    const map = mapRef.current;
    const coordinates = selectedStation?.coordinates;
    const hasValidCoordinates =
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      Number.isFinite(coordinates[0]) &&
      Number.isFinite(coordinates[1]);

    if (!map || !selectedStation || !hasValidCoordinates) {
      selectedMarkerRef.current?.remove();
      selectedMarkerRef.current = null;
      return;
    }

    if (!selectedMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'selected-map-marker';
      element.innerHTML = '<span class="selected-map-marker__ring"></span><span class="selected-map-marker__ring selected-map-marker__ring--delay"></span><span class="selected-map-marker__core"></span>';
      selectedMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' });
      selectedMarkerRef.current.setLngLat(coordinates).addTo(map);
      return;
    }

    selectedMarkerRef.current.setLngLat(coordinates);
  }, [selectedStation]);

  // Toggle map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer('ecobici')) map.setLayoutProperty('ecobici', 'visibility', layers.ecobici ? 'visible' : 'none');
    if (map.getLayer('cycle-infra')) map.setLayoutProperty('cycle-infra', 'visibility', layers.cycleInfra ? 'visible' : 'none');
    if (map.getLayer('metro-network-base')) map.setLayoutProperty('metro-network-base', 'visibility', layers.metroNetwork ? 'visible' : 'none');
    if (map.getLayer('metro-network-affected')) map.setLayoutProperty('metro-network-affected', 'visibility', layers.metroNetwork ? 'visible' : 'none');
  }, [layers]);

  // Pan to selected station
  useEffect(() => {
    const map = mapRef.current;
    const coordinates = selectedStation?.coordinates;
    const hasValidCoordinates =
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      Number.isFinite(coordinates[0]) &&
      Number.isFinite(coordinates[1]);

    if (!map || !selectedStation || !hasValidCoordinates) {
      previousSelectedIdRef.current = selectedStation?.id ?? null;
      return;
    }

    const selectedChanged = previousSelectedIdRef.current !== selectedStation.id;
    previousSelectedIdRef.current = selectedStation.id;
    if (!selectedChanged) return;

    const currentZoom = map.getZoom();
    map.easeTo({
      center: coordinates,
      zoom: Math.max(currentZoom, 12.1),
      duration: 700,
      essential: true,
    });
  }, [selectedStation?.id]);

  const toggleClosure = (stationId: string) => {
    setClosuresByScenario((current) => {
      const currentScenario = current[selectedScenario];
      const nextScenario = currentScenario.includes(stationId)
        ? currentScenario.filter((v) => v !== stationId)
        : [...currentScenario, stationId];
      return { ...current, [selectedScenario]: nextScenario };
    });
  };

  const toggleLayer = (key: keyof LayerState) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  const clearScenario = () => {
    setClosuresByScenario((current) => ({ ...current, [selectedScenario]: [] }));
  };

  const clearAll = () => {
    setClosuresByScenario({ A: [], B: [] });
  };

  if (!data) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Smart Commute CDMX</p>
          <h1>Cargando datos geoespaciales…</h1>
          <p>Procesando Metro, Metrobús, Transportes Eléctricos, Ecobici y red ciclista.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        closedCount={aggregate.count}
        totalStations={data.stations.length}
        onClear={clearAll}
      />
      <div className="content-area">
        <Sidebar
          data={data}
          selectedScenario={selectedScenario}
          onScenarioChange={setSelectedScenario}
          aggregate={aggregate}
          systemRidership={systemRidership}
          closedStations={closedStations}
          openStations={openStations}
          filteredClosedStations={filteredClosedStations}
          filteredOpenStations={filteredOpenStations}
          nodeQuery={nodeQuery}
          nodeSystemFilter={nodeSystemFilter}
          nodeSystemOptions={nodeSystemOptions}
          activeClosures={activeClosures}
          selectedStation={selectedStation}
          onSelectStation={(id) => { setSelectedId(id); setPopupOpen(true); }}
          onToggleClosure={toggleClosure}
          onClearScenario={clearScenario}
          onQueryChange={setNodeQuery}
          onSystemChange={setNodeSystemFilter}
        />

        <main className="map-stage" aria-label="Mapa de la red de movilidad">
          <div ref={mapContainerRef} className="map-canvas" aria-hidden="true" />

          {selectedStation !== null && popupOpen && (
            <NodePopup
              station={selectedStation}
              isActive={activeClosures.has(selectedStation.id)}
              networkWeight={networkStationWeights.get(selectedStation.id) ?? 0}
              onToggleClosure={toggleClosure}
              onClose={() => setPopupOpen(false)}
            />
          )}

          <LayersPanel layers={layers} onToggle={toggleLayer} />
          <BottomStatus />
        </main>
      </div>
    </div>
  );
}

export default App;
