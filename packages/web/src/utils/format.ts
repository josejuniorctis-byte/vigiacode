const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Texto relativo curto em português ("agora", "há 2 min", "há 3 h", "há 2 d"). */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '—';

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 30) return 'agora';
  if (seconds < MINUTE) return `há ${seconds} s`;
  if (seconds < HOUR) return `há ${Math.floor(seconds / MINUTE)} min`;
  if (seconds < DAY) return `há ${Math.floor(seconds / HOUR)} h`;
  if (seconds < 7 * DAY) return `há ${Math.floor(seconds / DAY)} d`;

  return formatDate(iso);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const today = new Date();
  const todayKey = toDateKey(today.toISOString());
  if (dateKey === todayKey) return 'Hoje';

  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (dateKey === toDateKey(yesterday.toISOString())) return 'Ontem';

  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
}

export function toDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shortHash(hash: string, length = 7): string {
  return hash.slice(0, length);
}

export function truncate(value: string, maxLength = 160): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
