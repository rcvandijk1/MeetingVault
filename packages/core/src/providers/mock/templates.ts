import type { Cabin } from '../../types.js';

/** One flight in a template, described in local wall-clock time. */
export interface TemplateSegment {
  origin: string;
  destination: string;
  /** Local departure time HH:MM. Day offsets are derived from UTC arithmetic, never guessed. */
  depTime: string;
  /** Days after the leg's reference date on which this segment departs. */
  depDayOffset: number;
  durationMinutes: number;
  carrier: string;
  flightNumber: string;
  aircraft: string;
  /** Cabin for a premium (business) request. Economy requests downgrade everything to economy. */
  premiumCabin: Cabin;
  ticketGroup: string;
  seatProduct?: string;
}

export interface RouteTemplate {
  id: string;
  origin: string;
  gateway: string;
  /** Business-class base fare per passenger in EUR. */
  baseFareBusiness: number;
  outbound: TemplateSegment[];
  inbound: TemplateSegment[];
  /** Purpose in the fixture set (documented for tests). */
  note: string;
  currency?: string;
}

const seg = (
  origin: string,
  destination: string,
  depTime: string,
  durationMinutes: number,
  carrier: string,
  flightNumber: string,
  aircraft: string,
  premiumCabin: Cabin,
  ticketGroup = 'T1',
  depDayOffset = 0,
  seatProduct?: string,
): TemplateSegment => ({ origin, destination, depTime, depDayOffset, durationMinutes, carrier, flightNumber, aircraft, premiumCabin, ticketGroup, seatProduct });

// Shared Qatar Airways feeder flights (local Doha times, UTC+3).
const QR980_DOH_KBV = seg('DOH', 'KBV', '02:10', 390, 'QR', 'QR980', 'Boeing 787-8', 'BUSINESS', 'T1', 1, 'full_flat'); // arrives 12:40 KBV
const QR968_DOH_KBV = seg('DOH', 'KBV', '06:50', 390, 'QR', 'QR968', 'Boeing 787-8', 'BUSINESS', 'T1', 1, 'full_flat'); // arrives 17:20 KBV
const QR988_DOH_KBV = seg('DOH', 'KBV', '09:30', 390, 'QR', 'QR988', 'Boeing 787-8', 'BUSINESS', 'T1', 1, 'full_flat'); // arrives 20:00 KBV
const QR840_DOH_HKT = seg('DOH', 'HKT', '01:50', 395, 'QR', 'QR840', 'Boeing 777-300ER', 'BUSINESS', 'T1', 1, 'full_flat'); // arrives 12:25 HKT
const QR969_KBV_DOH = seg('KBV', 'DOH', '20:35', 420, 'QR', 'QR969', 'Boeing 787-8', 'BUSINESS', 'T1', 0, 'full_flat'); // arrives 23:35 DOH
const QR841_HKT_DOH = seg('HKT', 'DOH', '20:05', 425, 'QR', 'QR841', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'full_flat'); // arrives 23:10 DOH

/**
 * Deterministic, realistic fixtures. Each covers a scenario from the
 * specification (§54) plus discovery routes through other Asian hubs.
 * Times are local; UTC is derived from IANA zones at build time.
 */
export const ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    id: 'AMS-DOH-KBV-QR',
    origin: 'AMS',
    gateway: 'KBV',
    baseFareBusiness: 1690,
    note: 'Great AMS result: evening departure, one protected 2h05 connection, Qsuite.',
    outbound: [seg('AMS', 'DOH', '20:30', 375, 'QR', 'QR274', 'Boeing 787-9', 'BUSINESS', 'T1', 0, 'full_flat'), QR968_DOH_KBV],
    inbound: [QR969_KBV_DOH, seg('DOH', 'AMS', '01:40', 405, 'QR', 'QR273', 'Airbus A350-900', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'DUS-DOH-HKT-QR',
    origin: 'DUS',
    gateway: 'HKT',
    baseFareBusiness: 1420,
    note: 'Cheap HKT result: afternoon departure from Düsseldorf, 2h00 in Doha, private driver to Krabi.',
    outbound: [seg('DUS', 'DOH', '15:40', 370, 'QR', 'QR082', 'Boeing 787-9', 'BUSINESS', 'T1', 0, 'full_flat'), QR840_DOH_HKT],
    inbound: [QR841_HKT_DOH, seg('DOH', 'DUS', '01:20', 395, 'QR', 'QR081', 'Boeing 787-9', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'FRA-BKK-KBV-TG',
    origin: 'FRA',
    gateway: 'KBV',
    baseFareBusiness: 1390,
    note: 'Cheap but bad FRA result: 09:30 departure needs an airport hotel, 4h30 connection in Bangkok.',
    outbound: [seg('FRA', 'BKK', '09:30', 650, 'TG', 'TG923', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'angle_flat'), seg('BKK', 'KBV', '06:50', 80, 'TG', 'TG241', 'Airbus A320', 'BUSINESS', 'T1', 1)],
    inbound: [seg('KBV', 'BKK', '18:35', 80, 'TG', 'TG246', 'Airbus A320', 'BUSINESS'), seg('BKK', 'FRA', '23:45', 740, 'TG', 'TG920', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'angle_flat')],
  },
  {
    id: 'CPH-BKK-KBV-TG',
    origin: 'CPH',
    gateway: 'KBV',
    baseFareBusiness: 1190,
    note: 'Very cheap CPH result: positioning flight from AMS plus an airport hotel before the 12:45 departure.',
    outbound: [seg('CPH', 'BKK', '12:45', 665, 'TG', 'TG951', 'Boeing 787-9', 'BUSINESS', 'T1', 0, 'full_flat'), seg('BKK', 'KBV', '09:20', 80, 'TG', 'TG243', 'Airbus A320', 'BUSINESS', 'T1', 1)],
    inbound: [seg('KBV', 'BKK', '21:00', 80, 'TG', 'TG248', 'Airbus A320', 'BUSINESS'), seg('BKK', 'CPH', '01:20', 720, 'TG', 'TG950', 'Boeing 787-9', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'AMS-BKK+BKK-KBV-SELF',
    origin: 'AMS',
    gateway: 'KBV',
    baseFareBusiness: 1250,
    note: 'Self-transfer: KLM business to Bangkok, separate Bangkok Airways economy ticket to Krabi.',
    outbound: [seg('AMS', 'BKK', '17:30', 665, 'KL', 'KL875', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'full_flat'), seg('BKK', 'KBV', '14:30', 80, 'PG', 'PG261', 'Airbus A319', 'ECONOMY', 'T2', 1)],
    inbound: [seg('KBV', 'BKK', '10:05', 80, 'PG', 'PG262', 'Airbus A319', 'ECONOMY', 'T2'), seg('BKK', 'AMS', '16:00', 770, 'KL', 'KL876', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'full_flat')],
  },
  {
    id: 'AMS-IST-KBV-TK-BAD',
    origin: 'AMS',
    gateway: 'KBV',
    baseFareBusiness: 1310,
    note: 'Bad transfer: 7h05 layover in Istanbul, exceeds the default hard maximum of 5h.',
    outbound: [seg('AMS', 'IST', '11:10', 215, 'TK', 'TK1952', 'Airbus A321neo', 'BUSINESS'), seg('IST', 'KBV', '23:50', 590, 'TK', 'TK172', 'Airbus A330-300', 'BUSINESS', 'T1', 0, 'angle_flat')],
    inbound: [seg('KBV', 'IST', '13:20', 660, 'TK', 'TK173', 'Airbus A330-300', 'BUSINESS', 'T1', 0, 'angle_flat'), seg('IST', 'AMS', '22:30', 225, 'TK', 'TK1955', 'Airbus A321neo', 'BUSINESS')],
  },
  {
    id: 'AMS-DXB-KBV-EK-DOMINATED',
    origin: 'AMS',
    gateway: 'KBV',
    baseFareBusiness: 1950,
    note: 'Dominated result: more expensive, slower and less convenient than AMS-DOH-KBV.',
    outbound: [seg('AMS', 'DXB', '21:05', 400, 'EK', 'EK150', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'angle_flat'), seg('DXB', 'KBV', '10:35', 385, 'EK', 'EK362', 'Boeing 777-300ER', 'BUSINESS', 'T1', 1, 'angle_flat')],
    inbound: [seg('KBV', 'DXB', '20:00', 440, 'EK', 'EK363', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'angle_flat'), seg('DXB', 'AMS', '03:45', 445, 'EK', 'EK147', 'Airbus A380-800', 'BUSINESS', 'T1', 1, 'angle_flat')],
  },
  // --- Discovery routes -----------------------------------------------------
  {
    id: 'AMS-DOH-HKT-QR',
    origin: 'AMS',
    gateway: 'HKT',
    baseFareBusiness: 1580,
    note: 'AMS via Doha to Phuket.',
    outbound: [seg('AMS', 'DOH', '15:55', 375, 'QR', 'QR276', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat'), QR840_DOH_HKT],
    inbound: [QR841_HKT_DOH, seg('DOH', 'AMS', '01:40', 405, 'QR', 'QR273', 'Airbus A350-900', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'AMS-SIN-KBV-SQ',
    origin: 'AMS',
    gateway: 'KBV',
    baseFareBusiness: 1780,
    note: 'Discovery: Singapore hub.',
    outbound: [seg('AMS', 'SIN', '21:20', 760, 'SQ', 'SQ323', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat'), seg('SIN', 'KBV', '18:50', 105, 'SQ', 'SQ5231', 'Boeing 737-8', 'BUSINESS', 'T1', 1)],
    inbound: [seg('KBV', 'SIN', '20:40', 100, 'SQ', 'SQ5232', 'Boeing 737-8', 'BUSINESS'), seg('SIN', 'AMS', '01:15', 795, 'SQ', 'SQ324', 'Airbus A350-900', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'LHR-KUL-KBV-MH',
    origin: 'LHR',
    gateway: 'KBV',
    baseFareBusiness: 1310,
    note: 'Discovery: Kuala Lumpur hub from London.',
    outbound: [seg('LHR', 'KUL', '22:00', 780, 'MH', 'MH003', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat'), seg('KUL', 'KBV', '20:10', 90, 'MH', 'MH780', 'Boeing 737-800', 'BUSINESS', 'T1', 1)],
    inbound: [seg('KBV', 'KUL', '18:50', 85, 'MH', 'MH781', 'Boeing 737-800', 'BUSINESS'), seg('KUL', 'LHR', '23:45', 840, 'MH', 'MH004', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat')],
  },
  {
    id: 'BRU-BKK-HKT-TG',
    origin: 'BRU',
    gateway: 'HKT',
    baseFareBusiness: 1495,
    note: 'Discovery: Brussels via Bangkok to Phuket.',
    outbound: [seg('BRU', 'BKK', '13:30', 655, 'TG', 'TG935', 'Boeing 787-9', 'BUSINESS', 'T1', 0, 'full_flat'), seg('BKK', 'HKT', '09:00', 85, 'TG', 'TG203', 'Airbus A320', 'BUSINESS', 'T1', 1)],
    inbound: [seg('HKT', 'BKK', '21:00', 85, 'TG', 'TG222', 'Airbus A320', 'BUSINESS'), seg('BKK', 'BRU', '00:30', 740, 'TG', 'TG934', 'Boeing 787-9', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'MUC-DOH-KBV-QR',
    origin: 'MUC',
    gateway: 'KBV',
    baseFareBusiness: 1460,
    note: 'Discovery: Munich via Doha.',
    outbound: [seg('MUC', 'DOH', '16:20', 345, 'QR', 'QR058', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat'), QR980_DOH_KBV],
    inbound: [QR969_KBV_DOH, seg('DOH', 'MUC', '02:00', 365, 'QR', 'QR057', 'Airbus A350-900', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'ZRH-BKK-KBV-TG',
    origin: 'ZRH',
    gateway: 'KBV',
    baseFareBusiness: 1520,
    note: 'Discovery: Zürich via Bangkok.',
    outbound: [seg('ZRH', 'BKK', '13:05', 645, 'TG', 'TG971', 'Boeing 777-300ER', 'BUSINESS', 'T1', 0, 'angle_flat'), seg('BKK', 'KBV', '09:20', 80, 'TG', 'TG243', 'Airbus A320', 'BUSINESS', 'T1', 1)],
    inbound: [seg('KBV', 'BKK', '21:00', 80, 'TG', 'TG248', 'Airbus A320', 'BUSINESS'), seg('BKK', 'ZRH', '00:35', 745, 'TG', 'TG970', 'Boeing 777-300ER', 'BUSINESS', 'T1', 1, 'angle_flat')],
  },
  {
    id: 'CDG-DOH-HKT-QR',
    origin: 'CDG',
    gateway: 'HKT',
    baseFareBusiness: 1440,
    note: 'Discovery: Paris via Doha to Phuket.',
    outbound: [seg('CDG', 'DOH', '16:00', 385, 'QR', 'QR040', 'Airbus A350-1000', 'BUSINESS', 'T1', 0, 'full_flat'), QR840_DOH_HKT],
    inbound: [QR841_HKT_DOH, seg('DOH', 'CDG', '01:35', 410, 'QR', 'QR039', 'Airbus A350-1000', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'DUS-DOH-KBV-QR',
    origin: 'DUS',
    gateway: 'KBV',
    baseFareBusiness: 1490,
    note: 'Düsseldorf via Doha to Krabi.',
    outbound: [seg('DUS', 'DOH', '15:40', 370, 'QR', 'QR082', 'Boeing 787-9', 'BUSINESS', 'T1', 0, 'full_flat'), QR980_DOH_KBV],
    inbound: [QR969_KBV_DOH, seg('DOH', 'DUS', '01:20', 395, 'QR', 'QR081', 'Boeing 787-9', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'FRA-DOH-HKT-QR',
    origin: 'FRA',
    gateway: 'HKT',
    baseFareBusiness: 1440,
    note: 'Frankfurt via Doha to Phuket, afternoon departure (no hotel).',
    outbound: [seg('FRA', 'DOH', '15:05', 355, 'QR', 'QR068', 'Airbus A350-900', 'BUSINESS', 'T1', 0, 'full_flat'), QR840_DOH_HKT],
    inbound: [QR841_HKT_DOH, seg('DOH', 'FRA', '01:50', 380, 'QR', 'QR067', 'Airbus A350-900', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'CPH-DOH-HKT-QR',
    origin: 'CPH',
    gateway: 'HKT',
    baseFareBusiness: 1250,
    note: 'Copenhagen via Doha to Phuket (afternoon departure, no hotel, positioning flight only).',
    outbound: [seg('CPH', 'DOH', '15:30', 365, 'QR', 'QR164', 'Boeing 787-8', 'BUSINESS', 'T1', 0, 'full_flat'), QR840_DOH_HKT],
    inbound: [QR841_HKT_DOH, seg('DOH', 'CPH', '01:30', 380, 'QR', 'QR163', 'Boeing 787-8', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
  {
    id: 'LHR-DOH-KBV-QR',
    origin: 'LHR',
    gateway: 'KBV',
    baseFareBusiness: 1720,
    note: 'London via Doha to Krabi.',
    outbound: [seg('LHR', 'DOH', '21:25', 395, 'QR', 'QR016', 'Airbus A380-800', 'BUSINESS', 'T1', 0, 'full_flat'), QR988_DOH_KBV],
    inbound: [QR969_KBV_DOH, seg('DOH', 'LHR', '01:15', 430, 'QR', 'QR015', 'Airbus A380-800', 'BUSINESS', 'T1', 1, 'full_flat')],
  },
];

/** Generic hubs used to synthesise routes for origins that have no explicit template. */
export const GENERIC_HUBS: Array<{ hub: string; carrier: string; longHaulAircraft: string; feederAircraft: string; hubToKbv: string; hubToHkt: string; seat: string }> = [
  { hub: 'DOH', carrier: 'QR', longHaulAircraft: 'Boeing 787-9', feederAircraft: 'Boeing 787-8', hubToKbv: 'QR980', hubToHkt: 'QR840', seat: 'full_flat' },
  { hub: 'DXB', carrier: 'EK', longHaulAircraft: 'Boeing 777-300ER', feederAircraft: 'Boeing 777-300ER', hubToKbv: 'EK362', hubToHkt: 'EK378', seat: 'angle_flat' },
  { hub: 'IST', carrier: 'TK', longHaulAircraft: 'Airbus A330-300', feederAircraft: 'Airbus A330-300', hubToKbv: 'TK172', hubToHkt: 'TK172', seat: 'angle_flat' },
  { hub: 'AUH', carrier: 'EY', longHaulAircraft: 'Boeing 787-9', feederAircraft: 'Boeing 787-9', hubToKbv: 'EY432', hubToHkt: 'EY430', seat: 'full_flat' },
];
