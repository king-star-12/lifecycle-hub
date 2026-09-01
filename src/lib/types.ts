/**
 * Shared domain types for Clustral.
 *
 * Provenance is a first-class field on every record. Water distribution is
 * safety-critical, so nothing in this system is allowed to be ambiguous about
 * whether a number was measured, derived, predicted or simulated.
 */

export const PROVENANCE = ['observed', 'inferred', 'predicted', 'recommended'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const PIPE_MATERIALS = [
  'cast_iron',
  'ductile_iron',
  'pvc',
  'hdpe',
  'steel',
  'asbestos_cement',
] as const;
export type PipeMaterial = (typeof PIPE_MATERIALS)[number];

export type LatLng = { lat: number; lng: number };

export type Asset = {
  asset_id: string;
  street: string;
  neighborhood: string;
  material: PipeMaterial;
  diameter_in: number;
  install_year: number;
  length_ft: number;
  /** Segment endpoints, for map rendering. */
  geometry: [LatLng, LatLng];
  /** Segment midpoint, for spatial queries. */
  centroid: LatLng;
  pressure_zone: string;
  /** 0-1. Population served, critical facilities, arterial road, transmission role. */
  criticality: number;
  population_served: number;
  /** Hospitals, schools, fire stations on the segment's service area. */
  critical_facilities: string[];
  /** Whether a pressure/flow sensor actually covers this segment. */
  has_sensor: boolean;
  /** Arterial roads carry traffic loading, a real degradation stressor. */
  road_class: 'arterial' | 'collector' | 'local';
};

export type PressureZone = {
  zone_id: string;
  name: string;
  /** Nominal static pressure, psi. */
  nominal_psi: number;
  /** Feeding pump station. */
  pump_station: string;
  reservoir: string;
};

/** One day of environment for the whole service area. */
export type WeatherDay = {
  date: string;
  temp_min_c: number;
  temp_max_c: number;
  precip_mm: number;
  /** 0-1 leaky integrator of precipitation minus evapotranspiration. */
  soil_moisture: number;
  /** Temperature crossed 0 C in both directions within the day. */
  freeze_thaw: boolean;
  /** Ground frost depth proxy, drives winter break season. */
  frost_index: number;
};

/** Per-asset daily telemetry summary — the observation layer. */
export type TelemetrySeries = {
  asset_id: string;
  start_date: string;
  days: number;
  /** Daily mean pressure, psi. Empty when the asset has no sensor. */
  pressure_mean: number[];
  /** Daily pressure standard deviation, psi. The key precursor channel. */
  pressure_std: number[];
  /** Daily mean flow, gpm. */
  flow_mean: number[];
  /** Daily count of transients beyond the operating envelope. */
  transients: number[];
};

export type FailureEvent = {
  event_id: string;
  asset_id: string;
  date: string;
  /** Which physical mechanism the simulator used. Ground truth, hidden from the engine. */
  archetype: FailureArchetype;
  severity: 'minor' | 'moderate' | 'major';
  /** Gallons lost before isolation. */
  water_lost_gal: number;
  customers_affected: number;
  repair_completed_date: string;
};

export const FAILURE_ARCHETYPES = [
  'corrosion',
  'freeze_thaw',
  'pressure_transient',
  'soil_movement',
  'aging_repeat_repair',
] as const;
export type FailureArchetype = (typeof FAILURE_ARCHETYPES)[number];

export type RepairRecord = {
  repair_id: string;
  asset_id: string;
  date: string;
  type: 'clamp' | 'spot_replacement' | 'full_replacement' | 'valve_service';
  crew_notes: string;
  cost_usd: number;
};

export type Complaint = {
  complaint_id: string;
  date: string;
  /** Complaints are geolocated to an address, not to a pipe — the engine must associate them. */
  location: LatLng;
  category: 'low_pressure' | 'discoloration' | 'noise' | 'street_water' | 'no_water';
  notes: string;
};

/** Evidence extracted from an inspection or maintenance document. */
export type DocumentFinding = {
  finding_id: string;
  asset_id: string;
  document: string;
  page: number;
  date: string;
  finding:
    | 'external_corrosion'
    | 'internal_tuberculation'
    | 'joint_leakage'
    | 'prior_excavation'
    | 'bedding_defect'
    | 'no_defect_observed';
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  /** Extraction confidence reported by the document pipeline. */
  confidence: number;
  excerpt: string;
};

export type NetworkBundle = {
  meta: {
    seed: string;
    generated_at: string;
    /** Loudly synthetic. Never let this render without a badge. */
    data_class: 'synthetic';
    city: string;
    utility: string;
    start_date: string;
    end_date: string;
    days: number;
  };
  zones: PressureZone[];
  assets: Asset[];
  /** asset_id -> neighbouring asset_ids within 500 m, precomputed. */
  neighbors: Record<string, string[]>;
  weather: WeatherDay[];
  failures: FailureEvent[];
  repairs: RepairRecord[];
  complaints: Complaint[];
  findings: DocumentFinding[];
};
