import type { Station } from './fuelfinder.client.js';

/**
 * Bundled sample fuel + EV stations around central London, used when
 * FUEL_FINDER_MOCK=true. Prices are illustrative pence-per-litre
 * (pence-per-kWh for ELECTRIC).
 */
export const SAMPLE_STATIONS: Station[] = [
  {
    siteId: 'FF-0001',
    brand: 'Shell',
    address: 'Holborn, London',
    postcode: 'WC1V 6NX',
    latitude: 51.5174,
    longitude: -0.1187,
    isEvCharger: false,
    prices: [
      { kind: 'E10', pricePence: 144.9 },
      { kind: 'E5', pricePence: 155.9 },
      { kind: 'B7', pricePence: 151.9 },
    ],
  },
  {
    siteId: 'FF-0002',
    brand: 'BP',
    address: 'Old Street, London',
    postcode: 'EC1V 9NR',
    latitude: 51.5256,
    longitude: -0.0876,
    isEvCharger: false,
    prices: [
      { kind: 'E10', pricePence: 142.7 },
      { kind: 'B7', pricePence: 149.7 },
    ],
  },
  {
    siteId: 'FF-0003',
    brand: 'Esso',
    address: 'Vauxhall, London',
    postcode: 'SW8 2LG',
    latitude: 51.4861,
    longitude: -0.1253,
    isEvCharger: false,
    prices: [
      { kind: 'E10', pricePence: 141.9 },
      { kind: 'E5', pricePence: 153.9 },
      { kind: 'B7', pricePence: 148.9 },
    ],
  },
  {
    siteId: 'FF-0004',
    brand: 'Tesco',
    address: 'Kensington, London',
    postcode: 'W8 5SF',
    latitude: 51.4991,
    longitude: -0.1938,
    isEvCharger: false,
    prices: [
      { kind: 'E10', pricePence: 139.9 },
      { kind: 'B7', pricePence: 146.9 },
    ],
  },
  {
    siteId: 'FF-0005',
    brand: 'Asda',
    address: 'Clapham, London',
    postcode: 'SW11 5TN',
    latitude: 51.4649,
    longitude: -0.1705,
    isEvCharger: false,
    prices: [
      { kind: 'E10', pricePence: 138.7 },
      { kind: 'B7', pricePence: 145.7 },
    ],
  },
  {
    siteId: 'FF-EV-0001',
    brand: 'InstaVolt',
    address: 'Southbank, London',
    postcode: 'SE1 9PX',
    latitude: 51.5045,
    longitude: -0.1146,
    isEvCharger: true,
    prices: [{ kind: 'ELECTRIC', pricePence: 79.0 }],
  },
  {
    siteId: 'FF-EV-0002',
    brand: 'Pod Point',
    address: 'Camden, London',
    postcode: 'NW1 8QP',
    latitude: 51.5416,
    longitude: -0.1435,
    isEvCharger: true,
    prices: [{ kind: 'ELECTRIC', pricePence: 69.0 }],
  },
  {
    siteId: 'FF-EV-0003',
    brand: 'Gridserve',
    address: 'Stratford, London',
    postcode: 'E20 1EJ',
    latitude: 51.5434,
    longitude: -0.0116,
    isEvCharger: true,
    prices: [{ kind: 'ELECTRIC', pricePence: 66.0 }],
  },
];
