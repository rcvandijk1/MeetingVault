import type { Airport } from '../types.js';

/**
 * Reference airport data. This is seed data — the database copy is the
 * source of truth at runtime and can be extended from the UI/API.
 */
export const AIRPORTS: Airport[] = [
  // Europe — candidate departure airports
  { code: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL', timezone: 'Europe/Amsterdam', region: 'EUROPE' },
  { code: 'RTM', name: 'Rotterdam The Hague', city: 'Rotterdam', country: 'NL', timezone: 'Europe/Amsterdam', region: 'EUROPE' },
  { code: 'EIN', name: 'Eindhoven', city: 'Eindhoven', country: 'NL', timezone: 'Europe/Amsterdam', region: 'EUROPE' },
  { code: 'BRU', name: 'Brussels', city: 'Brussels', country: 'BE', timezone: 'Europe/Brussels', region: 'EUROPE' },
  { code: 'DUS', name: 'Düsseldorf', city: 'Düsseldorf', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'CGN', name: 'Cologne Bonn', city: 'Cologne', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'FRA', name: 'Frankfurt', city: 'Frankfurt', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'LUX', name: 'Luxembourg', city: 'Luxembourg', country: 'LU', timezone: 'Europe/Luxembourg', region: 'EUROPE' },
  { code: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR', timezone: 'Europe/Paris', region: 'EUROPE' },
  { code: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB', timezone: 'Europe/London', region: 'EUROPE' },
  { code: 'DUB', name: 'Dublin', city: 'Dublin', country: 'IE', timezone: 'Europe/Dublin', region: 'EUROPE' },
  { code: 'CPH', name: 'Copenhagen Kastrup', city: 'Copenhagen', country: 'DK', timezone: 'Europe/Copenhagen', region: 'EUROPE' },
  { code: 'OSL', name: 'Oslo Gardermoen', city: 'Oslo', country: 'NO', timezone: 'Europe/Oslo', region: 'EUROPE' },
  { code: 'ARN', name: 'Stockholm Arlanda', city: 'Stockholm', country: 'SE', timezone: 'Europe/Stockholm', region: 'EUROPE' },
  { code: 'HEL', name: 'Helsinki Vantaa', city: 'Helsinki', country: 'FI', timezone: 'Europe/Helsinki', region: 'EUROPE' },
  { code: 'BER', name: 'Berlin Brandenburg', city: 'Berlin', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'HAM', name: 'Hamburg', city: 'Hamburg', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'MUC', name: 'Munich', city: 'Munich', country: 'DE', timezone: 'Europe/Berlin', region: 'EUROPE' },
  { code: 'ZRH', name: 'Zürich', city: 'Zürich', country: 'CH', timezone: 'Europe/Zurich', region: 'EUROPE' },
  { code: 'VIE', name: 'Vienna', city: 'Vienna', country: 'AT', timezone: 'Europe/Vienna', region: 'EUROPE' },
  { code: 'PRG', name: 'Prague', city: 'Prague', country: 'CZ', timezone: 'Europe/Prague', region: 'EUROPE' },
  { code: 'WAW', name: 'Warsaw Chopin', city: 'Warsaw', country: 'PL', timezone: 'Europe/Warsaw', region: 'EUROPE' },
  { code: 'BUD', name: 'Budapest', city: 'Budapest', country: 'HU', timezone: 'Europe/Budapest', region: 'EUROPE' },
  { code: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'IT', timezone: 'Europe/Rome', region: 'EUROPE' },
  { code: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'IT', timezone: 'Europe/Rome', region: 'EUROPE' },
  { code: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'ES', timezone: 'Europe/Madrid', region: 'EUROPE' },
  { code: 'BCN', name: 'Barcelona El Prat', city: 'Barcelona', country: 'ES', timezone: 'Europe/Madrid', region: 'EUROPE' },
  { code: 'LIS', name: 'Lisbon', city: 'Lisbon', country: 'PT', timezone: 'Europe/Lisbon', region: 'EUROPE' },
  // Hubs
  { code: 'DOH', name: 'Doha Hamad', city: 'Doha', country: 'QA', timezone: 'Asia/Qatar', region: 'MIDDLE_EAST' },
  { code: 'DXB', name: 'Dubai', city: 'Dubai', country: 'AE', timezone: 'Asia/Dubai', region: 'MIDDLE_EAST' },
  { code: 'AUH', name: 'Abu Dhabi Zayed', city: 'Abu Dhabi', country: 'AE', timezone: 'Asia/Dubai', region: 'MIDDLE_EAST' },
  { code: 'IST', name: 'Istanbul', city: 'Istanbul', country: 'TR', timezone: 'Europe/Istanbul', region: 'MIDDLE_EAST' },
  { code: 'BKK', name: 'Bangkok Suvarnabhumi', city: 'Bangkok', country: 'TH', timezone: 'Asia/Bangkok', region: 'ASIA' },
  { code: 'DMK', name: 'Bangkok Don Mueang', city: 'Bangkok', country: 'TH', timezone: 'Asia/Bangkok', region: 'ASIA' },
  { code: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'SG', timezone: 'Asia/Singapore', region: 'ASIA' },
  { code: 'KUL', name: 'Kuala Lumpur', city: 'Kuala Lumpur', country: 'MY', timezone: 'Asia/Kuala_Lumpur', region: 'ASIA' },
  { code: 'HKG', name: 'Hong Kong', city: 'Hong Kong', country: 'HK', timezone: 'Asia/Hong_Kong', region: 'ASIA' },
  { code: 'DEL', name: 'Delhi Indira Gandhi', city: 'Delhi', country: 'IN', timezone: 'Asia/Kolkata', region: 'ASIA' },
  { code: 'BOM', name: 'Mumbai', city: 'Mumbai', country: 'IN', timezone: 'Asia/Kolkata', region: 'ASIA' },
  { code: 'CMB', name: 'Colombo Bandaranaike', city: 'Colombo', country: 'LK', timezone: 'Asia/Colombo', region: 'ASIA' },
  // Gateways
  { code: 'KBV', name: 'Krabi International', city: 'Krabi', country: 'TH', timezone: 'Asia/Bangkok', region: 'ASIA' },
  { code: 'HKT', name: 'Phuket International', city: 'Phuket', country: 'TH', timezone: 'Asia/Bangkok', region: 'ASIA' },
];

export const AIRPORT_INDEX: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

export const AIRLINE_NAMES: Record<string, string> = {
  QR: 'Qatar Airways',
  EK: 'Emirates',
  EY: 'Etihad Airways',
  TK: 'Turkish Airlines',
  TG: 'Thai Airways',
  KL: 'KLM',
  LH: 'Lufthansa',
  SQ: 'Singapore Airlines',
  MH: 'Malaysia Airlines',
  CX: 'Cathay Pacific',
  BA: 'British Airways',
  AF: 'Air France',
  EW: 'Eurowings',
  SK: 'SAS',
  AY: 'Finnair',
  LX: 'SWISS',
  OS: 'Austrian',
  PG: 'Bangkok Airways',
  FD: 'Thai AirAsia',
  VZ: 'Thai Vietjet',
  AI: 'Air India',
  UL: 'SriLankan Airlines',
  WY: 'Oman Air',
  GF: 'Gulf Air',
};

export function airlineName(code: string): string {
  return AIRLINE_NAMES[code] ?? code;
}
