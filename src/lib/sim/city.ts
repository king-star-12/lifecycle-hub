/**
 * The synthetic network is laid over real Pittsburgh geography: real street
 * names, real neighbourhoods, real PWSA pressure-zone and facility names.
 *
 * That is a deliberate choice, not decoration. The external-context layer
 * searches the live web for "Butler Street Lawrenceville water main" and needs
 * real place names to find real municipal notices, construction permits and
 * news. The pipes, sensors, telemetry and failures are all simulated.
 */

export type NeighborhoodSpec = {
  name: string;
  anchor: { lat: number; lng: number };
  zone: string;
  /** Typical era of installation for this part of the system. */
  era: [number, number];
  /** Grid bearing of the dominant street direction, degrees. */
  bearing: number;
  streets: { name: string; road_class: 'arterial' | 'collector' | 'local' }[];
};

export const CITY = {
  name: 'Pittsburgh, PA',
  utility: 'Three Rivers Water Authority (synthetic operator)',
  center: { lat: 40.4406, lng: -79.9959 },
} as const;

export const PRESSURE_ZONES = [
  { zone_id: 'PZ-HL1', name: 'Highland No. 1', nominal_psi: 72, pump_station: 'Aspinwall Pump Station', reservoir: 'Highland Reservoir No. 1' },
  { zone_id: 'PZ-HL2', name: 'Highland No. 2', nominal_psi: 84, pump_station: 'Bruecken Pump Station', reservoir: 'Highland Reservoir No. 2' },
  { zone_id: 'PZ-HRN', name: 'Herron Hill', nominal_psi: 96, pump_station: 'Herron Hill Pump Station', reservoir: 'Herron Hill Tank' },
  { zone_id: 'PZ-BRS', name: 'Brashear', nominal_psi: 108, pump_station: 'Brashear Pump Station', reservoir: 'Brashear Tank' },
  { zone_id: 'PZ-GAR', name: 'Garfield', nominal_psi: 78, pump_station: 'Garfield Pump Station', reservoir: 'Garfield Tank' },
  { zone_id: 'PZ-MSN', name: 'Mission Street', nominal_psi: 102, pump_station: 'Mission Pump Station', reservoir: 'Mission Tank' },
  { zone_id: 'PZ-LNC', name: 'Lincoln', nominal_psi: 88, pump_station: 'Lincoln Pump Station', reservoir: 'Lincoln Tank' },
] as const;

export const NEIGHBORHOODS: NeighborhoodSpec[] = [
  {
    name: 'Downtown', anchor: { lat: 40.4406, lng: -79.9959 }, zone: 'PZ-HL1', era: [1898, 1948], bearing: 58,
    streets: [
      { name: 'Liberty Avenue', road_class: 'arterial' },
      { name: 'Grant Street', road_class: 'arterial' },
      { name: 'Smithfield Street', road_class: 'collector' },
      { name: 'Fifth Avenue', road_class: 'arterial' },
      { name: 'Forbes Avenue', road_class: 'arterial' },
      { name: 'Wood Street', road_class: 'collector' },
      { name: 'Stanwix Street', road_class: 'collector' },
    ],
  },
  {
    name: 'Strip District', anchor: { lat: 40.4501, lng: -79.9782 }, zone: 'PZ-HL1', era: [1901, 1955],
    bearing: 58,
    streets: [
      { name: 'Smallman Street', road_class: 'collector' },
      { name: 'Penn Avenue', road_class: 'arterial' },
      { name: 'Liberty Avenue', road_class: 'arterial' },
      { name: '21st Street', road_class: 'local' },
      { name: '31st Street', road_class: 'local' },
    ],
  },
  {
    name: 'Lawrenceville', anchor: { lat: 40.4682, lng: -79.9601 }, zone: 'PZ-HL1', era: [1895, 1952],
    bearing: 52,
    streets: [
      { name: 'Butler Street', road_class: 'arterial' },
      { name: 'Penn Avenue', road_class: 'arterial' },
      { name: '34th Street', road_class: 'local' },
      { name: '40th Street', road_class: 'collector' },
      { name: 'Fisk Street', road_class: 'local' },
    ],
  },
  {
    name: 'Oakland', anchor: { lat: 40.4416, lng: -79.9553 }, zone: 'PZ-HRN', era: [1908, 1962], bearing: 82,
    streets: [
      { name: 'Forbes Avenue', road_class: 'arterial' },
      { name: 'Fifth Avenue', road_class: 'arterial' },
      { name: 'Craig Street', road_class: 'collector' },
      { name: 'Bigelow Boulevard', road_class: 'arterial' },
      { name: 'Atwood Street', road_class: 'local' },
      { name: 'Bouquet Street', road_class: 'local' },
    ],
  },
  {
    name: 'Shadyside', anchor: { lat: 40.4520, lng: -79.9345 }, zone: 'PZ-HL2', era: [1912, 1968], bearing: 78,
    streets: [
      { name: 'Walnut Street', road_class: 'collector' },
      { name: 'Ellsworth Avenue', road_class: 'collector' },
      { name: 'Aiken Avenue', road_class: 'local' },
      { name: 'Negley Avenue', road_class: 'arterial' },
      { name: 'Fifth Avenue', road_class: 'arterial' },
    ],
  },
  {
    name: 'Squirrel Hill', anchor: { lat: 40.4380, lng: -79.9220 }, zone: 'PZ-HL2', era: [1920, 1974], bearing: 30,
    streets: [
      { name: 'Murray Avenue', road_class: 'arterial' },
      { name: 'Forbes Avenue', road_class: 'arterial' },
      { name: 'Beacon Street', road_class: 'collector' },
      { name: 'Shady Avenue', road_class: 'collector' },
      { name: 'Wightman Street', road_class: 'local' },
    ],
  },
  {
    name: 'Bloomfield', anchor: { lat: 40.4620, lng: -79.9490 }, zone: 'PZ-GAR', era: [1900, 1958], bearing: 66,
    streets: [
      { name: 'Liberty Avenue', road_class: 'arterial' },
      { name: 'Friendship Avenue', road_class: 'collector' },
      { name: 'Cedarville Street', road_class: 'local' },
      { name: 'Pearl Street', road_class: 'local' },
    ],
  },
  {
    name: 'East Liberty', anchor: { lat: 40.4612, lng: -79.9251 }, zone: 'PZ-GAR', era: [1905, 1966], bearing: 70,
    streets: [
      { name: 'Penn Avenue', road_class: 'arterial' },
      { name: 'Highland Avenue', road_class: 'arterial' },
      { name: 'Baum Boulevard', road_class: 'arterial' },
      { name: 'Centre Avenue', road_class: 'collector' },
    ],
  },
  {
    name: 'Highland Park', anchor: { lat: 40.4782, lng: -79.9203 }, zone: 'PZ-HL2', era: [1915, 1970], bearing: 20,
    streets: [
      { name: 'Highland Avenue', road_class: 'arterial' },
      { name: 'Bryant Street', road_class: 'collector' },
      { name: 'Stanton Avenue', road_class: 'collector' },
    ],
  },
  {
    name: 'Hill District', anchor: { lat: 40.4452, lng: -79.9762 }, zone: 'PZ-HRN', era: [1896, 1954], bearing: 74,
    streets: [
      { name: 'Centre Avenue', road_class: 'arterial' },
      { name: 'Wylie Avenue', road_class: 'collector' },
      { name: 'Bedford Avenue', road_class: 'collector' },
      { name: 'Herron Avenue', road_class: 'arterial' },
    ],
  },
  {
    name: 'North Side', anchor: { lat: 40.4533, lng: -80.0081 }, zone: 'PZ-LNC', era: [1893, 1950], bearing: 12,
    streets: [
      { name: 'Western Avenue', road_class: 'arterial' },
      { name: 'North Avenue', road_class: 'arterial' },
      { name: 'Brighton Road', road_class: 'arterial' },
      { name: 'East Ohio Street', road_class: 'collector' },
      { name: 'Federal Street', road_class: 'collector' },
    ],
  },
  {
    name: 'South Side', anchor: { lat: 40.4283, lng: -79.9751 }, zone: 'PZ-MSN', era: [1897, 1956], bearing: 62,
    streets: [
      { name: 'East Carson Street', road_class: 'arterial' },
      { name: 'Sarah Street', road_class: 'local' },
      { name: 'Josephine Street', road_class: 'local' },
      { name: '18th Street', road_class: 'collector' },
    ],
  },
  {
    name: 'Mount Washington', anchor: { lat: 40.4312, lng: -80.0083 }, zone: 'PZ-BRS', era: [1902, 1964], bearing: 40,
    streets: [
      { name: 'Grandview Avenue', road_class: 'collector' },
      { name: 'Shiloh Street', road_class: 'local' },
      { name: 'Virginia Avenue', road_class: 'collector' },
      { name: 'Warrington Avenue', road_class: 'arterial' },
    ],
  },
  {
    name: 'Point Breeze', anchor: { lat: 40.4451, lng: -79.9062 }, zone: 'PZ-HL2', era: [1922, 1978], bearing: 84,
    streets: [
      { name: 'Reynolds Street', road_class: 'collector' },
      { name: 'Penn Avenue', road_class: 'arterial' },
      { name: 'Fifth Avenue', road_class: 'arterial' },
      { name: 'Braddock Avenue', road_class: 'arterial' },
    ],
  },
  {
    name: 'Brookline', anchor: { lat: 40.3952, lng: -80.0212 }, zone: 'PZ-BRS', era: [1928, 1986], bearing: 46,
    streets: [
      { name: 'Brookline Boulevard', road_class: 'arterial' },
      { name: 'Pioneer Avenue', road_class: 'collector' },
      { name: 'Whited Street', road_class: 'local' },
    ],
  },
];

/** Critical facilities that raise an asset's consequence-of-failure score. */
export const CRITICAL_FACILITIES: Record<string, string[]> = {
  Oakland: ['UPMC Presbyterian', 'Magee-Womens Hospital', 'Central Fire Station 14', 'Schenley High School'],
  Downtown: ['Allegheny County Courthouse', 'Fire Station 1', 'Point Park University'],
  Shadyside: ['UPMC Shadyside', 'Liberty Elementary School'],
  'North Side': ['Allegheny General Hospital', 'Fire Station 3', 'Manchester Academic School'],
  'Hill District': ['Hill District Health Center', 'Milliones Middle School'],
  'East Liberty': ['East Liberty Fire Station', 'Dilworth Elementary School'],
  'South Side': ['South Side Hospital Annex', 'Phillips Elementary School'],
  'Squirrel Hill': ['Colfax Elementary School', 'Fire Station 18'],
  Lawrenceville: ['Children’s Hospital of Pittsburgh', 'Arsenal Middle School'],
  Brookline: ['Brookline Elementary School'],
  'Mount Washington': ['Fire Station 24'],
  'Highland Park': ['Fulton Elementary School'],
  Bloomfield: ['West Penn Hospital'],
  'Point Breeze': ['Linden Elementary School'],
  'Strip District': ['Fire Station 7'],
};
