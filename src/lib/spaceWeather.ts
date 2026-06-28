export type SpaceMetric = {
  label: string;
  value: string;
  unit?: string;
  status: 'nominal' | 'elevated' | 'critical';
  level: number;
};

export type SignalFeedItem = {
  id: string;
  title: string;
  detail: string;
  issuedAt: string;
  severity: 'nominal' | 'elevated' | 'critical';
};

export type SpaceWeatherSnapshot = {
  source: string;
  updatedAt: string;
  statusLabel: string;
  statusSeverity: 'nominal' | 'elevated' | 'critical';
  metrics: {
    particleFlux: SpaceMetric;
    corridorDensity: SpaceMetric;
    magneticStability: SpaceMetric;
    orbitalRisk: SpaceMetric;
  };
  feed: SignalFeedItem[];
};

type PlasmaRow = [string, string, string, string];
type MagRow = [string, string, string, string, string, string, string];
type KpEntry = {
  time_tag: string;
  Kp: number;
  a_running: number;
  station_count: number;
};
type AlertEntry = {
  product_id: string;
  issue_datetime: string;
  message: string;
};

const NOAA_BASE = 'https://services.swpc.noaa.gov/products';

function toIsoTime(value: string): string {
  return value.includes('T') ? value : value.replace(' ', 'T').replace('.000', '');
}

function clampLevel(value: number): number {
  return Math.max(8, Math.min(100, Math.round(value)));
}

function formatUtc(isoLike: string): string {
  const date = new Date(toIsoTime(isoLike));
  if (Number.isNaN(date.getTime())) return isoLike;
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date) + ' UTC';
}

function parseAlert(entry: AlertEntry): SignalFeedItem {
  const message = entry.message.replace(/\r/g, '');
  const titleLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('WATCH:') || line.startsWith('WARNING:') || line.startsWith('ALERT:') || line.startsWith('SUMMARY:') || line.startsWith('CONTINUED ALERT:'))
    ?? 'Sinal operacional recebido';

  const severity: SignalFeedItem['severity'] =
    /K-index of 5|G1|WARNING:|X-Ray Flux exceeded M5/i.test(message) ? 'critical'
    : /WATCH:|ALERT:/i.test(message) ? 'elevated'
    : 'nominal';

  const detailLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Threshold Reached:') || line.startsWith('Valid From:') || line.startsWith('Begin Time:') || line.startsWith('Highest Storm Level'))
    ?? 'Telemetria oficial interceptada pela malha sentinel.';

  return {
    id: `${entry.product_id}-${entry.issue_datetime}`,
    title: titleLine
      .replace('CONTINUED ALERT:', 'ALERTA CONTINUADO:')
      .replace('ALERT:', 'ALERTA:')
      .replace('WATCH:', 'VIGILANCIA:')
      .replace('WARNING:', 'AVISO:')
      .replace('SUMMARY:', 'RESUMO:'),
    detail: detailLine,
    issuedAt: formatUtc(entry.issue_datetime),
    severity,
  };
}

export async function fetchSpaceWeatherSnapshot(fetchImpl: typeof fetch = fetch): Promise<SpaceWeatherSnapshot> {
  const [plasmaRows, magRows, kpRows, alerts] = await Promise.all([
    fetchImpl(`${NOAA_BASE}/solar-wind/plasma-2-hour.json`).then((response) => response.json() as Promise<PlasmaRow[]>),
    fetchImpl(`${NOAA_BASE}/solar-wind/mag-2-hour.json`).then((response) => response.json() as Promise<MagRow[]>),
    fetchImpl(`${NOAA_BASE}/noaa-planetary-k-index.json`).then((response) => response.json() as Promise<KpEntry[]>),
    fetchImpl(`${NOAA_BASE}/alerts.json`).then((response) => response.json() as Promise<AlertEntry[]>),
  ]);

  const latestPlasma = plasmaRows.at(-1);
  const latestMag = magRows.at(-1);
  const latestKp = kpRows.at(-1);

  if (!latestPlasma || !latestMag || !latestKp) {
    throw new Error('NOAA feed incompleto');
  }

  const density = Number.parseFloat(latestPlasma[1]);
  const speed = Number.parseFloat(latestPlasma[2]);
  const bz = Number.parseFloat(latestMag[3]);
  const bt = Number.parseFloat(latestMag[6]);
  const kp = latestKp.Kp;

  const orbitalSeverity: SpaceMetric['status'] =
    kp >= 5 ? 'critical'
    : kp >= 4 ? 'elevated'
    : 'nominal';
  const particleSeverity: SpaceMetric['status'] =
    speed >= 600 ? 'critical'
    : speed >= 500 ? 'elevated'
    : 'nominal';
  const densitySeverity: SpaceMetric['status'] =
    density >= 8 ? 'critical'
    : density >= 5 ? 'elevated'
    : 'nominal';
  const magneticSeverity: SpaceMetric['status'] =
    bz <= -5 ? 'critical'
    : bz <= -2 ? 'elevated'
    : 'nominal';

  const feed = alerts.slice(0, 4).map(parseAlert);

  const statusSeverity =
    feed.some((item) => item.severity === 'critical') || orbitalSeverity === 'critical' || particleSeverity === 'critical' ? 'critical'
    : feed.some((item) => item.severity === 'elevated') || orbitalSeverity === 'elevated' || magneticSeverity === 'elevated' ? 'elevated'
    : 'nominal';

  const statusLabel =
    statusSeverity === 'critical' ? 'critical'
    : statusSeverity === 'elevated' ? 'elevated'
    : 'nominal';

  return {
    source: 'NOAA / SWPC Deep Space Telemetry',
    updatedAt: formatUtc(latestPlasma[0]),
    statusLabel,
    statusSeverity,
    metrics: {
      particleFlux: {
        label: 'Fluxo de particulas',
        value: speed.toFixed(1),
        unit: 'km/s',
        status: particleSeverity,
        level: clampLevel((speed / 700) * 100),
      },
      corridorDensity: {
        label: 'Densidade do corredor',
        value: density.toFixed(2),
        unit: 'p/cc',
        status: densitySeverity,
        level: clampLevel((density / 10) * 100),
      },
      magneticStability: {
        label: 'Estabilidade magnetica',
        value: `${bz.toFixed(2)} / ${bt.toFixed(2)}`,
        unit: 'Bz/Bt',
        status: magneticSeverity,
        level: clampLevel((Math.min(Math.abs(bz), 8) / 8) * 100),
      },
      orbitalRisk: {
        label: 'Indice de risco orbital',
        value: kp.toFixed(2),
        unit: 'Kp',
        status: orbitalSeverity,
        level: clampLevel((kp / 9) * 100),
      },
    },
    feed,
  };
}
