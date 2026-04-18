import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson';

export interface StationImpact {
  id: string;
  name: string;
  lines: string[];
  lineColor: string;
  coordinates: [lng: number, lat: number];
  dailyRidership: number;
  impactedPeople: number;
  vulnerablePeople: number;
  commuteDeltaPct: number;
  nearbyEcobici: number;
  cycleKmNearby: number;
  nearestAlternative: string;
  nearestAlternativeDistanceM: number;
  resilienceScore: number;
}

export interface MetrobusLineSummary {
  line: string;
  averageDailyRidership: number;
}

export interface MvpData {
  generatedAt: string;
  scopeNote: string;
  methodologyNote: string;
  summary: {
    latestMetroDate: string;
    latestMetrobusDate: string;
    averageMetroDaily: number;
    averageMetrobusDaily: number;
    ecobiciStations: number;
    totalCycleKm: number;
    topMetrobusLines: MetrobusLineSummary[];
  };
  stations: StationImpact[];
  ecobici: FeatureCollection<Point>;
  cycleInfra: FeatureCollection<LineString | MultiLineString>;
}

export interface LayerState {
  ecobici: boolean;
  cycleInfra: boolean;
}
