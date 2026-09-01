export type MapFeature = {
  id: string;
  p: [number, number][];
  st: string;
  nb: string;
  mt: string;
  dia: number;
  yr: number;
  zn: string;
  sen: 0 | 1;
  cr: number;
  pop: number;
  risk: number;
  conf: number;
  traj: string;
  hz: string | null;
  fam: number;
  top: string | null;
  brk: string | null;
};

export type MapPayload = {
  meta: {
    seed: string;
    data_class: string;
    city: string;
    utility: string;
    start_date: string;
    end_date: string;
    days: number;
    as_of: string;
  };
  zones: { zone_id: string; name: string; nominal_psi: number; pump_station: string; reservoir: string }[];
  distribution: { band: string; n: number }[];
  features: MapFeature[];
};

export type RiskFactor = {
  key: string;
  label: string;
  family: string;
  contribution: number;
  strength: number;
  detail: string;
  provenance: string;
};

export type AssetDetail = {
  asset: {
    asset_id: string;
    street: string;
    neighborhood: string;
    material: string;
    diameter_in: number;
    install_year: number;
    length_ft: number;
    pressure_zone: string;
    criticality: number;
    population_served: number;
    critical_facilities: string[];
    has_sensor: boolean;
    road_class: string;
  };
  score: {
    risk: number;
    confidence: number;
    trajectory: string;
    horizon: string | null;
    as_of: string;
    factors: RiskFactor[];
    convergence: { families: number; bonus: number };
    confidence_reasons: { positive: string[]; negative: string[] };
    data_gaps: string[];
  };
  series: {
    dates: string[];
    pressure_std: number[];
    pressure_mean: number[];
    flow_mean: number[];
    soil_moisture: number[];
    freeze_thaw: number[];
    temp_min: number[];
  };
  nearby_failures: { date: string; distance_m: number }[];
  complaints: { date: string; category: string }[];
  findings: {
    finding_id: string;
    document: string;
    page: number;
    date: string;
    finding: string;
    severity: string;
    confidence: number;
    excerpt: string;
    evidence_source?: 'nutrient_dws' | 'simulated_record';
    no_active_leak?: boolean;
  }[];
  documents: { document_id: string; filename: string; title: string; date: string; text: string }[];
  failures: { event_id: string; date: string; severity: string; water_lost_gal: number; customers_affected: number }[];
  repairs: { repair_id: string; date: string; type: string; crew_notes: string; cost_usd: number }[];
  neighbor_count: number;
  zone: { zone_id: string; name: string; nominal_psi: number; pump_station: string; reservoir: string } | null;
};

export type ExternalContext = {
  items: {
    title: string;
    url: string;
    snippet: string;
    source: string;
    published?: string | null;
    query: string;
    signal: string;
  }[];
  queries: string[];
  retrieved_at: string;
  live: boolean;
  configured: boolean;
  strength: number;
  detail: string;
  note: string;
  boundary: string;
};
