/**
 * API client.
 *
 * Sessions are httpOnly cookies, so there is no token in localStorage for an
 * XSS to steal — every call just sends credentials. A 401 triggers one silent
 * refresh and a single retry; if that fails the caller sees the 401 and the app
 * redirects to sign-in.
 */
const BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-keyed messages, for rendering errors next to the input. */
  get fieldErrors() {
    const out = {};
    for (const d of this.details || []) out[d.field] = d.message;
    return out;
  }
}

let refreshing = null;

async function refreshSession() {
  // Collapse concurrent refreshes into one request.
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  }).finally(() => {
    refreshing = null;
  });
  const res = await refreshing;
  return res.ok;
}

async function request(path, { method = 'GET', body, formData, retry = true } = {}) {
  const init = { method, credentials: 'include', headers: {} };

  if (formData) {
    init.body = formData; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, init);

  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) {
      return request(path, { method, body, formData, retry: false });
    }
  }

  // 204 and empty bodies are legitimate.
  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(
      res.status,
      e.message || `Request failed (${res.status})`,
      e.code,
      e.details,
    );
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // An HTML error page from a proxy is not JSON — say so plainly rather than
    // throwing a confusing SyntaxError deep in a component.
    return { error: { message: 'The server returned an unexpected response' } };
  }
}

const get = (p) => request(p);
const post = (p, body) => request(p, { method: 'POST', body });
const patch = (p, body) => request(p, { method: 'PATCH', body });
const put = (p, body) => request(p, { method: 'PUT', body });
const upload = (p, formData) => request(p, { method: 'POST', formData });

const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  }
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  health: () => get('/api/health'),

  auth: {
    me: () => get('/api/auth/me'),
    login: (email, password) => post('/api/auth/login', { email, password }),
    register: (payload) => post('/api/auth/register', payload),
    logout: () => post('/api/auth/logout'),
    changePassword: (currentPassword, newPassword) =>
      post('/api/auth/change-password', { currentPassword, newPassword }),
  },

  catalog: {
    services: () => get('/api/catalog/services'),
    service: (slug) => get(`/api/catalog/services/${slug}`),
    coverage: (zip) => get(`/api/catalog/coverage${qs({ zip })}`),
    areas: () => get('/api/catalog/areas'),
    availability: (params) => get(`/api/catalog/availability${qs(params)}`),
    quote: (payload) => post('/api/catalog/quote', payload),
  },

  bookings: {
    list: (scope) => get(`/api/bookings${qs({ scope })}`),
    get: (id) => get(`/api/bookings/${id}`),
    create: (payload) => post('/api/bookings', payload),
    addresses: () => get('/api/bookings/addresses'),
    addAddress: (payload) => post('/api/bookings/addresses', payload),
    paymentIntent: (id) => post(`/api/bookings/${id}/payment-intent`),
    confirmMock: (id, succeed = true) => post(`/api/bookings/${id}/confirm-mock-payment`, { succeed }),
    cancel: (id, reason) => post(`/api/bookings/${id}/cancel`, { reason }),
  },

  provider: {
    me: () => get('/api/provider/me'),
    updateMe: (payload) => patch('/api/provider/me', payload),
    setCoverage: (serviceIds, areaIds) => put('/api/provider/me/coverage', { serviceIds, areaIds }),
    setCredentials: (credentials) => put('/api/provider/me/credentials', { credentials }),
    uploadDoc: (formData) => upload('/api/provider/me/documents', formData),
    submit: () => post('/api/provider/me/submit'),
    available: () => get('/api/provider/jobs/available'),
    mine: (scope) => get(`/api/provider/jobs/mine${qs({ scope })}`),
    job: (id) => get(`/api/provider/jobs/${id}`),
    accept: (id) => post(`/api/provider/jobs/${id}/accept`),
    setStatus: (id, to, note) => post(`/api/provider/jobs/${id}/status`, { to, note }),
    release: (id, reason) => post(`/api/provider/jobs/${id}/release`, { reason }),
    uploadJobDocs: (id, formData) => upload(`/api/provider/jobs/${id}/documents`, formData),
    earnings: () => get('/api/provider/earnings'),
  },

  admin: {
    overview: () => get('/api/admin/overview'),
    providers: (params) => get(`/api/admin/providers${qs(params)}`),
    provider: (id) => get(`/api/admin/providers/${id}`),
    reviewProvider: (id, decision, notes) =>
      post(`/api/admin/providers/${id}/review`, { decision, notes }),
    reviewDocument: (id, decision, notes) =>
      post(`/api/admin/documents/${id}/review`, { decision, notes }),
    customers: (params) => get(`/api/admin/customers${qs(params)}`),
    setUserActive: (id, isActive) => post(`/api/admin/users/${id}/active`, { isActive }),
    jobs: (params) => get(`/api/admin/jobs${qs(params)}`),
    job: (id) => get(`/api/admin/jobs/${id}`),
    candidates: (id) => get(`/api/admin/jobs/${id}/candidates`),
    assign: (id, providerId, note) => post(`/api/admin/jobs/${id}/assign`, { providerId, note }),
    unassign: (id, reason) => post(`/api/admin/jobs/${id}/unassign`, { reason }),
    setJobStatus: (id, to, note) => post(`/api/admin/jobs/${id}/status`, { to, note }),
    payments: (params) => get(`/api/admin/payments${qs(params)}`),
    refund: (id, amountCents, note) => post(`/api/admin/payments/${id}/refund`, { amountCents, note }),
    payouts: (params) => get(`/api/admin/payouts${qs(params)}`),
    sendPayout: (id) => post(`/api/admin/payouts/${id}/send`),
    exceptions: (params) => get(`/api/admin/exceptions${qs(params)}`),
    resolveException: (id, resolution, dismiss = false) =>
      post(`/api/admin/exceptions/${id}/resolve`, { resolution, dismiss }),
    notifications: (params) => get(`/api/admin/notifications${qs(params)}`),
    services: () => get('/api/admin/services'),
    createService: (payload) => post('/api/admin/services', payload),
    updateService: (id, payload) => patch(`/api/admin/services/${id}`, payload),
    areas: () => get('/api/admin/areas'),
    payoutSettings: () => get('/api/admin/settings/payout'),
    setPayoutSettings: (inspectorPercent) => put('/api/admin/settings/payout', { inspectorPercent }),
    addPriceRule: (serviceId, rule) => post(`/api/admin/services/${serviceId}/price-rules`, rule),
    updatePriceRule: (id, rule) => patch(`/api/admin/price-rules/${id}`, rule),
    retirePriceRule: (id) => request(`/api/admin/price-rules/${id}`, { method: 'DELETE' }),
    expiringCredentials: (days) => get(`/api/admin/credentials/expiring${qs({ days })}`),
    reviewCredential: (id, decision, notes) =>
      post(`/api/admin/credentials/${id}/review`, { decision, notes }),
    createArea: (payload) => post('/api/admin/areas', payload),
    updateArea: (id, payload) => patch(`/api/admin/areas/${id}`, payload),
  },

  documentUrl: (id) => `${BASE}/api/documents/${id}`,
};
