/** Presentation helpers. All money arrives as integer cents. */

export const money = (cents, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(cents / 100) ? 0 : 2,
  }).format((cents ?? 0) / 100);

export const moneyExact = (cents, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format((cents ?? 0) / 100);

export const dateLong = (d) =>
  new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(d));

export const dateShort = (d) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(new Date(d));

export const dayName = (d) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'short' }).format(new Date(d));

export const timeOnly = (d) =>
  new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date(d));

export const dateTime = (d) =>
  new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d));

export const dateTimeFull = (d) =>
  new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d));

export const duration = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
};

/** "in 3 days" / "2 hours ago" — for schedules and audit trails. */
export const relative = (d) => {
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });

  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return rtf.format(Math.round(diff / 2_592_000_000), 'month');
};

export const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
};

export const addressLine = (a) =>
  a ? [a.line1, a.line2, a.city, a.region, a.postcode].filter(Boolean).join(', ') : '';

/** Job status → badge class + label. One mapping, used everywhere. */
export const STATUS_TONE = {
  PENDING_PAYMENT: { tone: 'badge-hold', label: 'Awaiting payment' },
  OPEN: { tone: 'badge-hivis', label: 'Finding a provider' },
  ASSIGNED: { tone: 'badge-info', label: 'Provider assigned' },
  EN_ROUTE: { tone: 'badge-info', label: 'On the way' },
  IN_PROGRESS: { tone: 'badge-info', label: 'In progress' },
  AWAITING_REPORT: { tone: 'badge-hold', label: 'Awaiting report' },
  COMPLETED: { tone: 'badge-go', label: 'Completed' },
  CANCELLED: { tone: 'badge-mute', label: 'Cancelled' },
  REFUNDED: { tone: 'badge-mute', label: 'Refunded' },
};

export const statusTone = (s) => STATUS_TONE[s] ?? { tone: 'badge-mute', label: s };

export const PROVIDER_TONE = {
  DRAFT: 'badge-mute',
  PENDING: 'badge-hold',
  APPROVED: 'badge-go',
  REJECTED: 'badge-stop',
  SUSPENDED: 'badge-stop',
};

export const PAYMENT_TONE = {
  REQUIRES_PAYMENT: 'badge-hold',
  PROCESSING: 'badge-info',
  SUCCEEDED: 'badge-go',
  FAILED: 'badge-stop',
  REFUNDED: 'badge-mute',
};

export const PAYOUT_TONE = {
  PENDING: 'badge-hold',
  PROCESSING: 'badge-info',
  PAID: 'badge-go',
  FAILED: 'badge-stop',
};

export const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
