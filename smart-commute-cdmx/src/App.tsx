import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSourceSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LayerState, MvpData, StationImpact } from './types';

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

const stationSourceFromData = (
  stations: StationImpact[],
  activeClosures: Set<string>,
  selectedId: string | null,
): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: stations.map<Feature<Point>>((station) => ({
    type: 'Feature',
    properties: {
      id: station.id,
      name: station.name,
      lineColor: station.lineColor,
      active: activeClosures.has(station.id) ? 1 : 0,
      selected: station.id === selectedId ? 1 : 0,
      commuteDeltaPct: station.commuteDeltaPct,
      impactedPeople: station.impactedPeople,
    },
    geometry: {
      type: 'Point',
      coordinates: station.coordinates,
    },
  })),
});

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [data, setData] = useState<MvpData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeClosureIds, setActiveClosureIds] = useState<string[]>([]);
  const [layers, setLayers] = useState<LayerState>(defaultLayers);

  useEffect(() => {
    let active = true;

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
        console.error('No se pudo cargar el dataset del MVP', error);
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

  const aggregate = useMemo(() => {
    const activeStations = (data?.stations ?? []).filter((station) => activeClosures.has(station.id));
    const totalDailyRidership = activeStations.reduce((sum, station) => sum + station.dailyRidership, 0);
    const totalImpactedPeople = activeStations.reduce((sum, station) => sum + station.impactedPeople, 0);
    const totalVulnerablePeople = activeStations.reduce((sum, station) => sum + station.vulnerablePeople, 0);
    const averageCommuteDelta = activeStations.length
      ? Math.round(activeStations.reduce((sum, station) => sum + station.commuteDeltaPct, 0) / activeStations.length)
      : 0;

    return {
      count: activeStations.length,
      totalDailyRidership,
      totalImpactedPeople,
      totalVulnerablePeople,
      averageCommuteDelta,
    };
  }, [activeClosures, data]);

  const stationSource = useMemo(
    () => stationSourceFromData(data?.stations ?? [], activeClosures, selectedStation?.id ?? null),
    [activeClosures, data, selectedStation?.id],
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
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 10, 7],
          'circle-color': ['coalesce', ['get', 'lineColor'], '#ec4899'],
          'circle-stroke-color': ['case', ['==', ['get', 'active'], 1], '#fef3c7', '#f8fafc'],
          'circle-stroke-width': ['case', ['==', ['get', 'active'], 1], 3, 2],
        },
      });

      map.on('click', 'station-core', (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === 'string') {
          setSelectedId(id);
        }
      });

      map.on('mouseenter', 'station-core', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'station-core', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data, stationSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !data) {
      return;
    }

    const stationGeoJson = map.getSource('stations') as maplibregl.GeoJSONSource | undefined;
    stationGeoJson?.setData(stationSource);
  }, [data, stationSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    map.setLayoutProperty('ecobici', 'visibility', layers.ecobici ? 'visible' : 'none');
    map.setLayoutProperty('cycle-infra', 'visibility', layers.cycleInfra ? 'visible' : 'none');
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
    setActiveClosureIds((current) =>
      current.includes(stationId) ? current.filter((value) => value !== stationId) : [...current, stationId],
    );
  };

  const toggleLayer = (key: keyof LayerState) => {
    setLayers((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  if (!data) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Smart Commute CDMX</p>
          <h1>Cargando MVP geoespacial...</h1>
          <p>Procesando cierres de Metro, Ecobici y red ciclista para la primera lectura del sistema.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="hero-card">
          <p className="eyebrow">MVP rapido con data real</p>
          <h1>Smart Commute CDMX</h1>
          <p className="lede">Simula cierres de nodos criticos del Metro y lee la resiliencia ciclista alrededor de cada zona.</p>
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
        </section>

        <section className="system-card">
          <div>
            <span className="section-label">Pulso del sistema</span>
            <strong>Metro diario: {formatCompact(data.summary.averageMetroDaily)}</strong>
          </div>
          <div>
            <span className="section-label">Contexto Metrobus</span>
            <strong>{formatCompact(data.summary.averageMetrobusDaily)} viajes/dia</strong>
          </div>
          <div className="system-tags">
            <span>{data.summary.ecobiciStations} cicloestaciones</span>
            <span>{data.summary.totalCycleKm} km ciclistas</span>
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
          </div>
        </section>

        <section className="station-list">
          <div className="list-header">
            <span className="section-label">Nodos de cierre</span>
            <button type="button" className="clear-button" onClick={() => setActiveClosureIds([])}>
              Limpiar
            </button>
          </div>

          {data.stations.map((station) => {
            const isActive = activeClosures.has(station.id);
            const isSelected = selectedStation?.id === station.id;

            return (
              <article key={station.id} className={isSelected ? 'station-card selected' : 'station-card'}>
                <button type="button" className="station-hitbox" onClick={() => setSelectedId(station.id)}>
                  <div className="station-title-row">
                    <span className="line-dot" style={{ backgroundColor: station.lineColor }} />
                    <strong>{station.name}</strong>
                  </div>
                  <small>{station.lines.join(' · ')}</small>
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
      </main>
    </div>
  );
}

export default App;
