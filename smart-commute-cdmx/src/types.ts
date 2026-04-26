import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson';

export interface StationImpact {
  id: string;
  name: string;
  mode?: string;
  lines: string[];
  lineColor: string;
  coordinates: [lng: number, lat: number];
  dailyRidership: number;
  impactedPeople: number;
  vulnerablePeople: number;
  commuteDeltaPct: number;
  impactSharePct: number;
  vulnerabilitySharePct: number;
  transferPenalty: number;
  nearbyEcobici: number;
  cycleKmNearby: number;
  nearestAlternative: string;
  nearestAlternativeDistanceM: number;
  resilienceScore: number;
  territorial: {
    agebCode: string;
    agebPopulation: number;
    socialPressurePct: number;
    roadBarrierScorePct: number;
    primaryRoadKmNearby: number;
    primaryRoadCount: number;
    accessControlledRoadCount: number;
    territorialCoverage: number;
    territorialMatchType: 'exact' | 'nearest' | 'none';
  };
}

export interface LineRidershipSummary {
  systemKey?: string;
  systemLabel?: string;
  line: string;
  averageDailyRidership: number;
  hasGeography?: boolean;
}

export interface SystemRidershipSummary {
  key: string;
  label: string;
  averageDailyRidership: number;
  stationCount: number;
  lineCount: number;
  hasGeography: boolean;
}

export interface MvpData {
  generatedAt: string;
  scopeNote: string;
  methodologyNote: string;
  summary: {
    impactModelVersion: string;
    latestMetroDate: string;
    latestMetrobusDate: string;
    averageMetroDaily: number;
    averageMetrobusDaily: number;
    ecobiciStations: number;
    totalCycleKm: number;
    metroNetworkSegments: number;
    metroNetworkKm: number;
    networkRidershipDaily: number;
    topMetrobusLines: LineRidershipSummary[];
    systemDailyRidership?: SystemRidershipSummary[];
    topNetworkLines?: LineRidershipSummary[];
    territorialEnrichment?: {
      agebDemographics: number;
      primaryRoadSegments: number;
      cycleInfraSegments: number;
      ecobiciStations: number;
    };
  };
  stations: StationImpact[];
  ecobici: FeatureCollection<Point>;
  cycleInfra: FeatureCollection<LineString | MultiLineString>;
  metroNetwork: FeatureCollection<LineString>;
}

export interface LayerState {
  impactImmediate: boolean;
  impactSystemic: boolean;
  ecobici: boolean;
  cycleInfra: boolean;
  networkSystems: Record<string, boolean>;
}
