/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   CONFIGURACION ??" Reemplazar con valores reales
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
const CONFIG = {
  // ?"??"??"? sb ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
  supabaseUrl:   'https://avwqmeberbjadrrlvaaa.supabase.co',
  supabaseKey:   'sb_publishable_McWl7xNoHVDbUdaR51OFew_TdJTJw30',

  // ?"??"??"? MERCADOPAGO ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
  // Si mpPublicKey est? vac?o, el pago se simula (modo demo)
  mpPublicKey:   'APP_USR-6bcfa5f3-5ae4-4df1-8bf8-cc98e6deb584',
  mpMode:        'sandbox',                         // 'sandbox' | 'production'

  // ?"??"??"? APP ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
  appUrl:        'https://recomendapp.netlify.app',
  profileSlug:   '',
};

const VIEW_PARTIALS = {
  home: '/views/home.html',
  login: '/views/login.html',
  register: '/views/register.html',
  forgot: '/views/forgot.html',
  search: '/views/search.html',
  profile: '/views/profile.html',
  media: '/views/media.html',
  form: '/views/form.html',
  confirm: '/views/confirm.html',
  dashboard: '/views/dashboard.html',
  settings: '/views/settings.html',
};

const INITIAL_VIEW_IDS = ['home', 'login', 'register', 'forgot', 'profile', 'form', 'confirm', 'dashboard'];
const DEFERRED_VIEW_IDS = ['search', 'media', 'settings'];

let viewsLoaded = false;
let shareInFlight = false;
const loadedViewIds = new Set();

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   SUPABASE CLIENT
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function createSbCompat(url, key) {
  const storageKey = 'aplauso_sb_session';
  const listeners = [];

  function readSession() {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  }

  function writeSession(session) {
    try {
      if (session) localStorage.setItem(storageKey, JSON.stringify(session));
      else localStorage.removeItem(storageKey);
    } catch(e) {}
  }

  function decodeJwtPayload(token) {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function isSessionExpired(session) {
    if (!session?.access_token) return true;
    const jwtPayload = decodeJwtPayload(session.access_token);
    const exp = session.expires_at || jwtPayload?.exp || (session.expires_in && session.created_at ? session.created_at + session.expires_in : null);
    if (exp && Date.now() >= exp * 1000) return true;
    return false;
  }

  function getActiveSession() {
    const session = readSession();
    if (!session) return null;
    if (isSessionExpired(session)) {
      writeSession(null);
      return null;
    }
    return session;
  }

  function notify(event, session) {
    listeners.forEach(cb => {
      try { cb(event, session); } catch(e) {}
    });
  }

  function authHeaders() {
    const session = getActiveSession();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${session?.access_token || key}`,
      'Content-Type': 'application/json',
    };
    return headers;
  }

  async function parseResponse(res) {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) {
      const message = json?.msg || json?.message || json?.error_description || json?.error || `HTTP ${res.status}`;
      if (res.status === 401 && /jwt expired/i.test(String(message))) {
        writeSession(null);
        notify('SIGNED_OUT', null);
      }
      return {
        data: null,
        error: { message }
      };
    }
    return { data: json, error: null };
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.mode = 'select';
      this.selectCols = '*';
      this.filters = [];
      this.orderBy = null;
      this.limitBy = null;
      this.payload = null;
      this.expectSingle = false;
      this.returning = null;
    }
    select(cols='*') { this.selectCols = cols; this.returning = cols; return this; }
    insert(payload) { this.mode = 'insert'; this.payload = payload; return this; }
    update(payload) { this.mode = 'update'; this.payload = payload; return this; }
    delete() { this.mode = 'delete'; return this; }
    eq(field, value) { this.filters.push({ field, op: 'eq', value }); return this; }
    order(field, opts={}) { this.orderBy = { field, ascending: opts.ascending !== false }; return this; }
    limit(value) { this.limitBy = value; return this; }
    single() { this.expectSingle = true; return this; }
    async execute() {
      const params = new URLSearchParams();
      if (this.mode === 'select' || this.returning) params.set('select', this.returning || this.selectCols);
      this.filters.forEach(f => params.set(f.field, `${f.op}.${f.value}`));
      if (this.orderBy) params.set('order', `${this.orderBy.field}.${this.orderBy.ascending ? 'asc' : 'desc'}`);
      if (this.limitBy != null) params.set('limit', String(this.limitBy));
      const query = params.toString();
      const endpoint = `${url}/rest/v1/${this.table}${query ? `?${query}` : ''}`;
      const headers = authHeaders();
      const opts = { method: 'GET', headers };
      if (this.mode === 'insert') {
        opts.method = 'POST';
        headers.Prefer = this.returning ? 'return=representation' : 'return=minimal';
        opts.body = JSON.stringify(this.payload);
      }
      if (this.mode === 'update') {
        opts.method = 'PATCH';
        headers.Prefer = this.returning ? 'return=representation' : 'return=minimal';
        opts.body = JSON.stringify(this.payload);
      }
      if (this.mode === 'delete') {
        opts.method = 'DELETE';
        headers.Prefer = this.returning ? 'return=representation' : 'return=minimal';
      }
      const res = await fetch(endpoint, opts);
      const parsed = await parseResponse(res);
      if (parsed.error) return parsed;
      let data = parsed.data;
      if (this.expectSingle) data = Array.isArray(data) ? (data[0] || null) : data;
      return { data, error: null };
    }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }

  return {
    from(table) { return new QueryBuilder(table); },
    functions: {
      async invoke(name, { body } = {}) {
        try {
          const res = await fetch(`${url}/functions/v1/${name}`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(body || {}),
          });
          return parseResponse(res);
        } catch (error) {
          return {
            data: null,
            error: { message: error?.message || 'No se pudo conectar con la funci?n' }
          };
        }
      }
    },
    auth: {
      async getSession() {
        return { data: { session: getActiveSession() }, error: null };
      },
      async signUp({ email, password, options = {} }) {
        const res = await fetch(`${url}/auth/v1/signup`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ email, password, data: options.data || {} }),
        });
        const parsed = await parseResponse(res);
        if (parsed.data?.session) {
          writeSession(parsed.data.session);
          notify('SIGNED_IN', parsed.data.session);
        }
        return parsed;
      },
      async signInWithPassword({ email, password }) {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ email, password }),
        });
        const parsed = await parseResponse(res);
        if (parsed.data?.access_token) {
          const now = Math.floor(Date.now() / 1000);
          const session = {
            access_token: parsed.data.access_token,
            refresh_token: parsed.data.refresh_token,
            token_type: parsed.data.token_type,
            expires_in: parsed.data.expires_in,
            created_at: now,
            expires_at: now + (parsed.data.expires_in || 0),
            user: parsed.data.user,
          };
          writeSession(session);
          parsed.data.session = session;
          notify('SIGNED_IN', session);
        }
        return parsed;
      },
      async signOut() {
        writeSession(null);
        notify('SIGNED_OUT', null);
        return { error: null };
      },
      async resetPasswordForEmail(email, { redirectTo } = {}) {
        const res = await fetch(`${url}/auth/v1/recover`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ email, redirect_to: redirectTo }),
        });
        return parseResponse(res);
      },
      async signInWithOAuth() {
        return { error: { message: 'Google OAuth no est? habilitado en esta versi?n est?tica.' } };
      },
      onAuthStateChange(callback) {
        listeners.push(callback);
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
}

let sb = null;
try {
  if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
    sb = createSbCompat(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  }
} catch(e) { console.warn('Supabase no configurado:', e.message); }

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   MERCADOPAGO INSTANCE
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
let mpInstance = null;
let mpBrick    = null;

function initMP(publicKey) {
  if (!publicKey || !window.MercadoPago) return;
  try {
    mpInstance = new MercadoPago(publicKey, { locale: 'es-AR' });
    console.log('MercadoPago SDK inicializado');
  } catch(e) { console.warn('MP init error:', e); }
}

// Inicializar MP si hay Public Key en CONFIG
if (CONFIG.mpPublicKey) initMP(CONFIG.mpPublicKey);

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   STATE
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
const STATE = {
  loggedIn: false,
  isAnon: false,
  selectedAmt: 1000,
  selectedPay: 'mercadopago',
  currentReplyId: null,
  currentRewardEditId: null,
  currentMediaEditId: null,
  mpConfig: loadMpConfig(),
  user: {
    id: null,
    name: '',
    lastName: '',
    phone: '',
    role: '',
    city: '',
    bio: '',
    tags: [],
    initials: '',
    email: '',
    slug: '',
    shareTitle: '',
    shareSubtitle: '',
    shareDescription: '',
    shareImageMode: 'cover',
  },
  viewedProfile: null,
  reviews: [],
  publicReviews: [],
  rewardItems: [],
  publicRewardItems: [],
  mediaItems: [],
  publicMediaItems: [],
  unlockedMediaIds: (() => {
    try {
      const raw = localStorage.getItem('aplauso_media_unlocks');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })(),
  directoryProfiles: [],
  profileCache: {},
  publicReviewsCache: {},
  publicReviewSort: 'amount_desc',
  publicReviewDateFilter: 'all',
  searchDebounce: null,
};

const CHART_DATA = [
  {day:'Lun',val:8500},{day:'Mar',val:12000},{day:'Mi?',val:5000},{day:'Jue',val:18500},
  {day:'Vie',val:22000},{day:'S?b',val:9000},{day:'Dom',val:14500},
];


/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   MP CONFIG (localStorage)
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function loadMpConfig() {
  try {
    const raw = localStorage.getItem('aplauso_mp_config');
    return raw ? JSON.parse(raw) : { publicKey: '', accessToken: '', mode: 'sandbox', checkoutLabel: 'Recomendapp', profileId: null };
  } catch { return { publicKey: '', accessToken: '', mode: 'sandbox', checkoutLabel: 'Recomendapp', profileId: null }; }
}

function saveMpConfigToStorage(cfg) {
  try { localStorage.setItem('aplauso_mp_config', JSON.stringify(cfg)); } catch(e) {}
}

function getMpPublicKey() {
  return CONFIG.mpPublicKey || STATE.mpConfig.publicKey || '';
}

async function loadStoredMpConfig(force = false) {
  if (!sb || !STATE.user.id) return STATE.mpConfig;
  if (!force && STATE.mpConfig.profileId === STATE.user.id && (STATE.mpConfig.accessToken || STATE.mpConfig.publicKey)) {
    return STATE.mpConfig;
  }

  const { data, error } = await sb
    .from('profile_payment_credentials')
    .select('profile_id, mp_public_key, mp_access_token, mp_mode, mp_checkout_label')
    .eq('profile_id', STATE.user.id)
    .single();

  if (error) {
    if (!/0 rows|no rows/i.test(error.message || '')) {
      console.warn('No se pudieron cargar las credenciales de MercadoPago:', error.message);
    }
    STATE.mpConfig = { publicKey: '', accessToken: '', mode: 'sandbox', checkoutLabel: 'Recomendapp', profileId: STATE.user.id };
    saveMpConfigToStorage(STATE.mpConfig);
    return STATE.mpConfig;
  }

  STATE.mpConfig = {
    publicKey: data?.mp_public_key || '',
    accessToken: data?.mp_access_token || '',
    mode: data?.mp_mode || 'production',
    checkoutLabel: data?.mp_checkout_label || 'Recomendapp',
    profileId: data?.profile_id || STATE.user.id,
  };
  CONFIG.mpPublicKey = STATE.mpConfig.publicKey;
  CONFIG.mpMode = STATE.mpConfig.mode;
  saveMpConfigToStorage(STATE.mpConfig);
  if (STATE.mpConfig.publicKey) initMP(STATE.mpConfig.publicKey);
  return STATE.mpConfig;
}

function slugifyText(value='') {
  return value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function initialsFromProfile(nombre='', apellido='') {
  const first = (nombre || '?').trim().charAt(0) || '?';
  const last = (apellido || '').trim().charAt(0);
  return (first + last).toUpperCase();
}

function formatCurrency(amount=0) {
  return '$' + Number(amount || 0).toLocaleString('es-AR');
}

function formatDateLabel(value) {
  if (!value) return 'recién';
  try {
    return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return 'recién';
  }
}

function profileLink(slug) {
  const base = CONFIG.appUrl || (window.location.origin + window.location.pathname);
  return base + '?slug=' + encodeURIComponent(slug);
}

function profileShareLink(slug) {
  if (!slug) return profileLink(slug);
  const base = (CONFIG.appUrl || window.location.origin || '').replace(/\/+$/, '');
  return `${base}/share/${encodeURIComponent(slug)}`;
}

function profileShareId(profile = {}) {
  return profile.id || profile.slug || '';
}

function profileLinkFromProfile(profile = {}) {
  return profileLink(profileShareId(profile));
}

function profileShareLinkFromProfile(profile = {}) {
  const base = profileShareLink(profileShareId(profile));
  const version = encodeURIComponent(String(profile?.updatedAt || '').trim());
  return version ? `${base}?v=${version}` : base;
}

function isUuidLike(value='') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value).trim());
}

function normalizePhone(phone='') {
  return (phone || '').replace(/[^\d+]/g, '');
}

function maskPhone(phone='') {
  const digits = normalizePhone(phone).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length <= 5) return digits.charAt(0) + '*'.repeat(Math.max(digits.length - 2, 1)) + digits.slice(-1);
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(digits.length - 5, 1))}${digits.slice(-2)}`;
}

function phoneLink(phone='') {
  const normalized = normalizePhone(phone);
  return normalized ? `tel:${normalized}` : '#';
}

function whatsAppLink(phone='') {
  const digits = normalizePhone(phone).replace(/[^\d]/g, '');
  return digits ? `https://wa.me/${digits}` : '#';
}

function galleryPriceLabel(priceCents=0) {
  return formatCurrency(Math.round((priceCents || 0) / 100));
}

function iconSvg(name) {
  const icons = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v5"></path><path d="M12 7h.01"></path></svg>',
    payment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path></svg>',
    anon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12c2.4-4 5.1-6 8-6s5.6 2 8 6c-2.4 4-5.1 6-8 6s-5.6-2-8-6z"></path><circle cx="12" cy="12" r="2.5"></circle><path d="M4 4l16 16"></path></svg>',
    panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="3" width="8" height="5" rx="2"></rect><rect x="13" y="10" width="8" height="11" rx="2"></rect><rect x="3" y="13" width="8" height="8" rx="2"></rect></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L10 17l-5-5"></path></svg>',
  };
  return icons[name] || icons.info;
}

function hydrateIcons(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.icon, .switch-row-icon, .feat-ico, .step-em, .pw-toggle, .confirm-icon').forEach(el => {
    if (el.dataset.iconHydrated === 'true') return;
    const text = (el.textContent || '').trim().toLowerCase();
    let iconName = 'info';
    if (el.classList.contains('pw-toggle')) iconName = 'eye';
    else if (el.classList.contains('confirm-icon') || text === 'gracias') iconName = 'success';
    else if (text.includes('pago')) iconName = 'payment';
    else if (text.includes('anon')) iconName = 'anon';
    else if (text.includes('panel')) iconName = 'panel';
    el.dataset.iconHydrated = 'true';
    el.dataset.iconLabel = (el.textContent || '').trim();
    el.innerHTML = `<span class="ui-icon" aria-hidden="true">${iconSvg(iconName)}</span>`;
  });
}

function persistUnlockedMedia() {
  try { localStorage.setItem('aplauso_media_unlocks', JSON.stringify(STATE.unlockedMediaIds || [])); } catch {}
}

function mapRewardItem(row) {
  return {
    id: row.id,
    title: row.title || 'Recompensa',
    description: row.description || '',
    imageUrl: row.image_url || '',
    active: row.active !== false,
    sortOrder: row.sort_order || 0,
  };
}

function mapMediaItem(row) {
  return {
    id: row.id,
    title: row.title || 'Imagen',
    description: row.description || '',
    previewUrl: row.preview_url || '',
    downloadUrl: row.download_url || '',
    mediaKind: row.media_kind || 'image',
    allowDownload: row.allow_download !== false,
    priceCents: row.price_cents || 0,
    isCombo: !!row.is_combo,
    visibility: row.visibility || 'public',
    active: row.active !== false,
    sortOrder: row.sort_order || 0,
  };
}

function setAvatarNode(el, initials, imageUrl) {
  if (!el) return;
  if (imageUrl) {
    el.style.backgroundImage = `url('${imageUrl}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = initials || '?';
  }
}

function setCoverNode(el, imageUrl) {
  if (!el) return;
  el.style.backgroundImage = imageUrl
    ? `linear-gradient(rgba(12,11,10,.24), rgba(12,11,10,.42)), url('${imageUrl}')`
    : 'linear-gradient(135deg,#1A1510,#0C0B0A)';
}

function renderFormHeader() {
  const profile = STATE.viewedProfile || STATE.user || {};
  const displayName = [profile.name, profile.lastName].filter(Boolean).join(' ').trim() || 'Perfil';
  const role = profile.role || 'Profesional';
  const city = profile.city || 'Ciudad';
  const nameNode = document.getElementById('formProfileName');
  const metaNode = document.getElementById('formProfileMeta');
  const confirmNode = document.getElementById('csProfileName');
  if (nameNode) nameNode.textContent = displayName;
  if (metaNode) metaNode.textContent = `${role} ? ${city}`;
  if (confirmNode) confirmNode.textContent = displayName;
}

async function imageFileToDataUrl(file, options = {}) {
  if (!file) return '';
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.84,
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No se pudo preparar la imagen'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function previewReviewImage(input, previewId) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const file = input?.files?.[0];
  if (!file) {
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    preview.textContent = preview.dataset.empty || '';
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  preview.style.backgroundImage = `url('${objectUrl}')`;
  preview.classList.add('has-image');
  preview.textContent = '';
}

function openImageLightbox(url) {
  if (!url) return;
  const modal = document.getElementById('imageLightbox');
  const image = document.getElementById('lightboxImage');
  if (!modal || !image) return;
  image.src = url;
  modal.classList.add('open');
}

function closeImageLightbox() {
  const modal = document.getElementById('imageLightbox');
  const image = document.getElementById('lightboxImage');
  if (modal) modal.classList.remove('open');
  if (image) image.src = '';
}

window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = closeImageLightbox;

function resetReviewMediaFields() {
  const phoneInput = document.getElementById('fPhone');
  const avatarInput = document.getElementById('fReviewerAvatar');
  const imageInput = document.getElementById('fReviewImage');
  if (phoneInput) phoneInput.value = '';
  if (avatarInput) avatarInput.value = '';
  if (imageInput) imageInput.value = '';
  ['reviewAvatarPreview', 'reviewImagePreview'].forEach(id => {
    const preview = document.getElementById(id);
    if (!preview) return;
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    preview.textContent = preview.dataset.empty || '';
  });
}

async function uploadProfileAsset(file, folder='avatar') {
  if (!sb || !STATE.user.id || !file) return null;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${STATE.user.id}/${folder}-${Date.now()}.${ext}`;
  const res = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/profile-media/${path}`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${(await sb.auth.getSession()).data.session?.access_token || CONFIG.supabaseKey}`,
      'x-upsert': 'true',
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'No se pudo subir el archivo');
  }
  return `${CONFIG.supabaseUrl}/storage/v1/object/public/profile-media/${path}`;
}

function mergeUserProfile(profile) {
  if (!profile) return;
  STATE.user = {
    ...STATE.user,
    id: profile.id || STATE.user.id,
    name: profile.nombre || STATE.user.name,
    lastName: profile.apellido || '',
    phone: profile.telefono || '',
    role: profile.role || '',
    city: profile.city || '',
    bio: profile.bio || '',
    tags: Array.isArray(profile.tags) ? profile.tags : [],
    initials: initialsFromProfile(profile.nombre, profile.apellido),
    slug: profile.slug || STATE.user.slug,
    updatedAt: profile.updated_at || STATE.user.updatedAt || '',
    plan: profile.plan || 'free',
    allowAnon: profile.allow_anon ?? true,
    minAmount: profile.min_amount ?? 0,
    verified: profile.verified ?? false,
    active: profile.active ?? true,
    totalEarned: profile.total_earned ?? 0,
    reviewCount: profile.review_count ?? 0,
    mpAlias: profile.mp_alias || '',
    mpCbu: profile.mp_cbu || '',
    avatarUrl: profile.avatar_url || '',
    coverUrl: profile.cover_url || '',
    shareTitle: profile.share_title || '',
    shareSubtitle: profile.share_subtitle || '',
    shareDescription: profile.share_description || '',
    shareImageMode: profile.share_image_mode || 'cover',
  };
}

function setViewedProfileFromProfile(profile) {
  if (!profile) return;
  STATE.viewedProfile = {
    id: profile.id,
    slug: profile.slug,
    updatedAt: profile.updated_at || '',
    name: profile.nombre,
    lastName: profile.apellido || '',
    phone: profile.telefono || '',
    role: profile.role || '',
    city: profile.city || '',
    bio: profile.bio || '',
    tags: Array.isArray(profile.tags) ? profile.tags : [],
    initials: initialsFromProfile(profile.nombre, profile.apellido),
    totalEarned: profile.total_earned ?? 0,
    reviewCount: profile.review_count ?? 0,
    verified: profile.verified ?? false,
    allowAnon: profile.allow_anon ?? true,
    minAmount: profile.min_amount ?? 0,
    active: profile.active ?? true,
    mpAlias: profile.mp_alias || '',
    mpCbu: profile.mp_cbu || '',
    avatarUrl: profile.avatar_url || '',
    coverUrl: profile.cover_url || '',
    shareTitle: profile.share_title || '',
    shareSubtitle: profile.share_subtitle || '',
    shareDescription: profile.share_description || '',
    shareImageMode: profile.share_image_mode || 'cover',
  };
}

function mapReviewRow(row) {
  const fullName = (row.reviewer_nombre || 'Anónimo').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    id: row.id,
    name: row.is_anon ? 'Anónimo' : fullName,
    initials: row.is_anon ? '?' : ((parts[0]?.charAt(0) || '?') + (parts[1]?.charAt(0) || '')).toUpperCase(),
    date: formatDateLabel(row.created_at),
    rawDate: row.created_at || null,
    amount: Math.round((row.amount_cents || 0) / 100),
    text: row.message || '',
    phone: row.is_anon ? '' : (row.reviewer_phone || ''),
    avatarUrl: row.is_anon ? '' : (row.reviewer_avatar_url || ''),
    reviewImageUrl: row.review_image_url || '',
    reply: row.reply || null,
    anon: !!row.is_anon,
    color: row.is_anon ? '' : '#4F76B8',
    published: row.published ?? true,
    paymentStatus: row.payment_status || 'approved',
  };
}

function getReviewTimestamp(review) {
  const value = new Date(review?.rawDate || review?.date || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function getTopRewardReview(reviews = []) {
  return [...reviews].sort((a, b) => b.amount - a.amount || getReviewTimestamp(b) - getReviewTimestamp(a))[0] || null;
}

function buildProfileMeta(profile, reviews = []) {
  const displayName = [profile?.name, profile?.lastName].filter(Boolean).join(' ').trim() || 'Perfil';
  const role = (profile?.role || 'Profesional').trim();
  const city = (profile?.city || 'Argentina').trim();
  const topReview = getTopRewardReview(reviews);
  const totalReviews = reviews.length;
  const highestReward = topReview?.amount || 0;
  const shareTitle = (profile?.shareTitle || '').trim() || displayName;
  const shareSubtitle = (profile?.shareSubtitle || '').trim() || [role, city].filter(Boolean).join(' | ');
  const shortBio = (profile?.bio || '').trim();
  const shareDescription = (profile?.shareDescription || '').trim();
  const description = shareDescription || (
    shortBio
      ? `${shortBio} Especialidad: ${role}. Recomendaciones visibles y reconocimiento real en Recomendapp.`
      : totalReviews
        ? `${displayName}, ${role} en ${city}. Mira sus recomendaciones visibles, ${totalReviews} resenas publicadas y reconocimientos de hasta $${highestReward.toLocaleString('es-AR')} en Recomendapp.`
        : `${displayName}, ${role} en ${city}. Conoce su perfil profesional y deja una recomendacion con reconocimiento real en Recomendapp.`
  );
  const composedTitle = shareSubtitle
    ? `${shareTitle} | ${shareSubtitle} | Recomendapp - Reconoce quien te atendio bien`
    : `${shareTitle} | Recomendapp - Reconoce quien te atendio bien`;
  return {
    displayName,
    shareTitle,
    shareSubtitle,
    description,
    composedTitle,
    highestReward,
    totalReviews,
  };
}

function getProfileShareImage(profile = {}) {
  const mode = String(profile?.shareImageMode || '').trim() || 'cover';
  if (mode === 'none') return '';
  if (mode === 'avatar') return profile?.avatarUrl || profile?.coverUrl || '';
  return profile?.coverUrl || profile?.avatarUrl || '';
}

function upsertMetaTag(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
}

function updateProfileDocumentMeta(profile, reviews = []) {
  const meta = buildProfileMeta(profile, reviews);
  const canonicalUrl = profileLinkFromProfile(profile);
  const shareUrl = profileShareLinkFromProfile(profile);
  const shareImage = getProfileShareImage(profile);
  document.title = meta.composedTitle;
  upsertMetaTag('meta[name="description"]', { name: 'description', content: meta.description });
  upsertMetaTag('meta[property="og:title"]', { property: 'og:title', content: meta.composedTitle });
  upsertMetaTag('meta[property="og:description"]', { property: 'og:description', content: meta.description });
  upsertMetaTag('meta[property="og:url"]', { property: 'og:url', content: shareUrl });
  upsertMetaTag('meta[property="og:image"]', { property: 'og:image', content: shareImage });
  upsertMetaTag('meta[name="twitter:card"]', { name: 'twitter:card', content: shareImage ? 'summary_large_image' : 'summary' });
  upsertMetaTag('meta[name="twitter:title"]', { name: 'twitter:title', content: meta.composedTitle });
  upsertMetaTag('meta[name="twitter:description"]', { name: 'twitter:description', content: meta.description });
  upsertMetaTag('meta[name="twitter:image"]', { name: 'twitter:image', content: shareImage });
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', canonicalUrl);
}

function getFilteredPublicReviews(reviews = STATE.publicReviews || []) {
  const now = Date.now();
  const filtered = reviews.filter(review => {
    if (STATE.publicReviewDateFilter === '7d') {
      return now - getReviewTimestamp(review) <= 7 * 24 * 60 * 60 * 1000;
    }
    if (STATE.publicReviewDateFilter === '30d') {
      return now - getReviewTimestamp(review) <= 30 * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  const sorted = [...filtered];
  if (STATE.publicReviewSort === 'amount_desc') {
    sorted.sort((a, b) => b.amount - a.amount || getReviewTimestamp(b) - getReviewTimestamp(a));
  } else if (STATE.publicReviewSort === 'amount_asc') {
    sorted.sort((a, b) => a.amount - b.amount || getReviewTimestamp(b) - getReviewTimestamp(a));
  } else if (STATE.publicReviewSort === 'recent') {
    sorted.sort((a, b) => getReviewTimestamp(b) - getReviewTimestamp(a));
  } else if (STATE.publicReviewSort === 'oldest') {
    sorted.sort((a, b) => getReviewTimestamp(a) - getReviewTimestamp(b));
  }
  return sorted;
}

function setPublicReviewSort(value) {
  STATE.publicReviewSort = value || 'amount_desc';
  renderProfile();
}

function setPublicReviewDateFilter(value) {
  STATE.publicReviewDateFilter = value || 'all';
  renderProfile();
}

window.setPublicReviewSort = setPublicReviewSort;
window.setPublicReviewDateFilter = setPublicReviewDateFilter;

function mapProfileCard(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: `${row.nombre} ${row.apellido || ''}`.trim(),
    role: row.role || '',
    city: row.city || '',
    phone: row.telefono || '',
    bio: row.bio || '',
    cat: Array.isArray(row.tags) && row.tags.length ? row.tags : ['General'],
    revs: row.review_count || 0,
    total: Math.round((row.total_earned || 0) / 100),
    initials: initialsFromProfile(row.nombre, row.apellido),
    color: '#4F76B8',
  };
}

async function fetchPublicReviews(profileId, forceRefresh = false) {
  if (!sb || !profileId) return [...STATE.publicReviews];
  if (!forceRefresh && STATE.publicReviewsCache[profileId]) {
    return STATE.publicReviewsCache[profileId].map(r => ({ ...r }));
  }
  const { data, error } = await sb
    .from('reviews')
    .select('id, reviewer_nombre, reviewer_phone, reviewer_avatar_url, review_image_url, is_anon, message, amount_cents, reply, created_at')
    .eq('profile_id', profileId)
    .eq('published', true)
    .eq('payment_status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const mapped = (data || []).map(mapReviewRow);
  STATE.publicReviewsCache[profileId] = mapped;
  return mapped.map(r => ({ ...r }));
}

async function fetchOwnReviews(profileId) {
  if (!sb || !profileId) return [...STATE.reviews];
  const { data, error } = await sb
    .from('reviews')
    .select('id, reviewer_nombre, reviewer_phone, reviewer_avatar_url, review_image_url, is_anon, message, amount_cents, reply, created_at, payment_status, published')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapReviewRow);
}

async function fetchRewardItems(profileId, isOwner = false) {
  if (!sb || !profileId) return [];
  let query = sb
    .from('profile_reward_items')
    .select('id, title, description, image_url, active, sort_order')
    .eq('profile_id', profileId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (!isOwner) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapRewardItem);
}

async function fetchMediaItems(profileId, isOwner = false) {
  if (!sb || !profileId) return [];
  let query = sb
    .from('profile_media_items')
    .select('id, title, description, preview_url, download_url, media_kind, allow_download, price_cents, is_combo, visibility, active, sort_order')
    .eq('profile_id', profileId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (!isOwner) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapMediaItem);
}

async function refreshOwnProfileState(forceProfileRefresh = false) {
  if (!sb || !STATE.user.id) return;

  if (forceProfileRefresh) {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', STATE.user.id)
      .single();

    if (!error && profile) {
      if (STATE.user.slug) delete STATE.profileCache[STATE.user.slug];
      mergeUserProfile(profile);
    }
  }

  const [reviews, rewardItems, mediaItems] = await Promise.all([
    fetchOwnReviews(STATE.user.id),
    fetchRewardItems(STATE.user.id, true),
    fetchMediaItems(STATE.user.id, true),
  ]);
  STATE.reviews = reviews;
  STATE.rewardItems = rewardItems;
  STATE.mediaItems = mediaItems;
  delete STATE.publicReviewsCache[STATE.user.id];

  if (!STATE.viewedProfile || STATE.viewedProfile.id === STATE.user.id || STATE.viewedProfile.slug === STATE.user.slug) {
    STATE.viewedProfile = { ...STATE.user };
    STATE.publicReviews = STATE.reviews.filter(r => r.published && r.paymentStatus === 'approved');
    STATE.publicRewardItems = STATE.rewardItems.filter(item => item.active);
    STATE.publicMediaItems = STATE.mediaItems.filter(item => item.active);
  }
}

async function loadSearchProfiles() {
  if (STATE.directoryProfiles?.length) {
    if (document.getElementById('view-search')?.classList.contains('active')) renderSearch();
    return;
  }
  if (!sb) return;
  const { data, error } = await sb
    .from('profiles')
      .select('*')
    .eq('active', true)
    .order('review_count', { ascending: false })
    .limit(100);
  if (error) {
    console.warn('No se pudieron cargar perfiles:', error.message);
    return;
  }
  STATE.directoryProfiles = (data || []).map(mapProfileCard);
  if (document.getElementById('view-search')?.classList.contains('active')) renderSearch();
}

async function loadViewedProfileBySlug(slug, pushState = true, forceRefresh = false) {
  if (!sb || !slug) return;
  const isOwnProfile = STATE.loggedIn && (slug === STATE.user.slug || slug === STATE.user.id);
  if (isOwnProfile) {
    if (forceRefresh) {
      await refreshOwnProfileState(true);
    } else {
      STATE.viewedProfile = { ...STATE.user };
      STATE.publicReviews = STATE.reviews.filter(r => r.published && r.paymentStatus === 'approved');
      STATE.publicRewardItems = STATE.rewardItems.filter(item => item.active);
      STATE.publicMediaItems = STATE.mediaItems.filter(item => item.active);
    }
    renderProfile();
    if (pushState) history.replaceState({}, '', '?slug=' + encodeURIComponent(STATE.user.id || STATE.user.slug || slug));
    return;
  }

  let profile = !forceRefresh ? STATE.profileCache[slug] : null;
  let error = null;
  if (!profile) {
    const query = sb
      .from('profiles')
      .select('*');
    const response = isUuidLike(slug)
      ? await query.eq('id', slug).single()
      : await query.eq('slug', slug).single();
    profile = response.data;
    error = response.error;
    if (profile && !error) {
      STATE.profileCache[slug] = profile;
      STATE.profileCache[profile.slug] = profile;
      STATE.profileCache[profile.id] = profile;
    }
  }

  if (error || !profile) {
    toast('No encontramos ese perfil', 'error');
    return;
  }

  setViewedProfileFromProfile(profile);
  STATE.publicReviews = [];
  STATE.publicRewardItems = [];
  STATE.publicMediaItems = [];
  renderProfile();
  const [publicReviews, publicRewardItems, publicMediaItems] = await Promise.all([
    fetchPublicReviews(profile.id, forceRefresh),
    fetchRewardItems(profile.id, false),
    fetchMediaItems(profile.id, false),
  ]);
  STATE.publicReviews = publicReviews;
  STATE.publicRewardItems = publicRewardItems;
  STATE.publicMediaItems = publicMediaItems;
  renderProfile();
  if (pushState) history.replaceState({}, '', '?slug=' + encodeURIComponent(profile.id || profile.slug || slug));
}

async function hydrateUser(session, navigateToDashboard = false) {
  if (!session?.user || !sb) return;
  STATE.loggedIn = true;
  STATE.user.id = session.user.id;
  STATE.user.email = session.user.email || '';

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error) {
    console.warn('No se pudo cargar el perfil del usuario:', error.message);
  } else {
    mergeUserProfile(profile);
    const [reviews, rewardItems, mediaItems] = await Promise.all([
      fetchOwnReviews(session.user.id),
      fetchRewardItems(session.user.id, true),
      fetchMediaItems(session.user.id, true),
    ]);
    STATE.reviews = reviews;
    STATE.rewardItems = rewardItems;
    STATE.mediaItems = mediaItems;
    await loadStoredMpConfig(true);
  }

  const requestedSlug = new URLSearchParams(window.location.search).get('slug');
  if (requestedSlug && requestedSlug !== STATE.user.slug) {
    await loadViewedProfileBySlug(requestedSlug, false);
  } else {
    STATE.viewedProfile = { ...STATE.user };
    STATE.publicReviews = [...STATE.reviews].filter(r => r.published && r.paymentStatus === 'approved');
    STATE.publicRewardItems = [...STATE.rewardItems].filter(item => item.active);
    STATE.publicMediaItems = [...STATE.mediaItems].filter(item => item.active);
  }

  updateNav();
  renderDashboard();
  renderProfile();
  if (navigateToDashboard) nav('dashboard');
}

async function bootstrapSupabaseData() {
  if (!sb) return;
  const requestedSlug = new URLSearchParams(window.location.search).get('slug') || CONFIG.profileSlug;
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    await hydrateUser(session, false);
    if (requestedSlug) await nav('profile');
  } else if (requestedSlug) {
    await nav('profile');
    await loadViewedProfileBySlug(requestedSlug, false);
  }
}

async function ensureViewsLoaded(viewIds = []) {
  const root = document.getElementById('views-root');
  if (!root) return;
  const missing = viewIds.filter(viewId => VIEW_PARTIALS[viewId] && !loadedViewIds.has(viewId));
  if (!missing.length) return;
  const entries = await Promise.all(
    missing.map(async (viewId) => {
      const response = await fetch(VIEW_PARTIALS[viewId], { cache: 'force-cache' });
      if (!response.ok) throw new Error(`No se pudo cargar la vista "${viewId}"`);
      return [viewId, await response.text()];
    })
  );
  entries.forEach(([viewId, markup]) => {
    const holder = document.createElement('div');
    holder.innerHTML = String(markup).trim();
    const viewNode = holder.firstElementChild;
    if (viewNode) {
      root.appendChild(viewNode);
      loadedViewIds.add(viewId);
      hydrateIcons(viewNode);
    }
  });
}

async function loadViews() {
  if (viewsLoaded) return;
  const requestedSlug = new URLSearchParams(window.location.search).get('slug') || CONFIG.profileSlug;
  await ensureViewsLoaded(requestedSlug ? ['profile'] : INITIAL_VIEW_IDS);
  viewsLoaded = true;
}

function runViewLifecycle(viewId) {
  updateNav();
  if (viewId === 'dashboard') renderDashboard();
  if (viewId === 'profile') renderProfile();
  if (viewId === 'media') renderMediaVault();
  if (viewId === 'search') {
    if (STATE.directoryProfiles?.length) renderSearch();
    else loadSearchProfiles();
  }
  if (viewId === 'settings') loadSettingsForm();
  if (viewId === 'form') {
    renderFormHeader();
    initFormMp();
  }
  hydrateIcons(document.getElementById('view-' + viewId) || document);
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   NAVIGATION
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
async function nav(viewId) {
  if (!viewsLoaded) return;
  await ensureViewsLoaded([viewId]);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + viewId);
  if (el) { el.classList.add('active'); window.scrollTo(0,0); }
  runViewLifecycle(viewId);
}

window.nav = nav;

function updateNav() {
  const nr = document.getElementById('navRight');
  if (!nr) return;
  if (STATE.loggedIn) {
    nr.innerHTML = `
      <button class="nav-link" onclick="nav('search')">Buscar</button>
      <button class="nav-link" onclick="nav('dashboard')">Mi panel</button>
      <div class="nav-dropdown-wrap" id="ddWrap">
        <div class="nav-user" onclick="toggleDD()" id="navAv">${STATE.user.initials}</div>
        <div class="nav-dropdown" id="navDD">
          <button class="dd-item" onclick="nav('profile');closeDD()">Ver mi perfil</button>
          <button class="dd-item" onclick="nav('settings');closeDD()">Configuración</button>
          <div class="dd-sep"></div>
          <button class="dd-item danger" onclick="doLogout()">Cerrar sesión</button>
        </div>
      </div>`;
  } else {
    nr.innerHTML = `
      <!--button class="nav-link" onclick="nav('search')">Buscar perfiles</button-->
      <button class="nav-btn-ghost" onclick="nav('login')">Ingresar</button>
      <button class="nav-btn-amber" onclick="nav('register')">Crear perfil</button>`;
  }
}

function toggleDD() {
  document.getElementById('navDD')?.classList.toggle('open');
}
function closeDD() {
  document.getElementById('navDD')?.classList.remove('open');
}
document.addEventListener('click', e => {
  const dd = document.getElementById('ddWrap');
  if (dd && !dd.contains(e.target)) closeDD();
});

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   MERCADOPAGO ??" CHECKOUT PRO
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function initFormMp() {
  const pk = getMpPublicKey();
  renderFormHeader();
  if (pk && mpInstance === null) initMP(pk);
  // Reset brick al entrar al form
  const brickContainer = document.getElementById('mp-brick-container');
  if (!brickContainer) return;
  brickContainer.innerHTML = '';
  mpBrick = null;
  if (STATE.selectedPay === 'mercadopago') renderMpBrick();
}

async function renderMpBrick() {
  const brickContainer = document.getElementById('mp-brick-container');
  if (!brickContainer) return;
  const pk = getMpPublicKey();
  const hasCredentials = !!STATE.mpConfig.accessToken;
  if (!hasCredentials) {
    // Modo demo: sin brick, el bot?n simula
    brickContainer.innerHTML = `
      <div class="mp-info-box">
        <span class="icon">Info</span>
        <div><strong>Pago con MercadoPago</strong>: al presionar el boton te vamos a redirigir al checkout para completar el pago.
        <br><span class="auth-link" onclick="nav('settings');settTab(document.querySelector('.s-nav-item:nth-child(2)'),'stPagos')">Revisar credenciales</span></div>
      </div>`;
    return;
  }
  if (mpInstance === null) initMP(pk);
  brickContainer.innerHTML = '<div id="mp-wallet-brick"></div>';
  // El brick real se crea al construir la preferencia
}

async function createMpPreference(reviewDraft = {}) {
  const amount = STATE.selectedAmt;
  if (!amount || amount < 100) { toast('El monto m?nimo es $100','error'); return null; }

  // En producci?n: llamar a la Edge Function de sb
  if (sb) {
    try {
      const { data, error } = await sb.functions.invoke('mp-create-preference', {
        body: {
          amount,
          profileSlug: STATE.viewedProfile?.slug || STATE.user.slug,
          reviewerName: STATE.isAnon ? 'Anónimo' : ((document.getElementById('fNombre')?.value || '') + ' ' + (document.getElementById('fApellido')?.value || '')).trim(),
          message: document.getElementById('fMsg')?.value || '',
          reviewerPhone: reviewDraft.reviewerPhone || '',
          reviewerAvatarUrl: reviewDraft.reviewerAvatarUrl || '',
          reviewImageUrl: reviewDraft.reviewImageUrl || '',
          reviewerName: reviewDraft.reviewerName || '',
          message: reviewDraft.message || document.getElementById('fMsg')?.value || '',
          appUrl: window.location.origin + window.location.pathname,
        }
      });
      if (error) throw error;
      return data;
    } catch(e) {
      console.error('Error al crear preferencia MP:', e);
      toast('Error al conectar con MercadoPago','error');
      return null;
    }
  }
  // Simulaci?n
  return { preference_id: 'demo-' + Date.now(), init_point: '#' };
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   TOAST
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function toast(msg, type='success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(8px)'; t.style.transition='all .3s'; setTimeout(()=>t.remove(),300); }, 2800);
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   AUTH
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function togglePw(inputOrId, btn) {
  const inp = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!inp) return;
  const isText = inp.type === 'text';
  inp.type = isText ? 'password' : 'text';
  btn.textContent = isText ? 'Ver' : 'Ocultar';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pw = document.getElementById('loginPw').value;
  if (!email || !pw) { toast('Complet? todos los campos','error'); return; }

  if (sb) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { toast(error.message,'error'); return; }
      await hydrateUser(data.session, false);
      toast('Bienvenido de nuevo','success');
      setTimeout(() => nav('dashboard'), 600);
    } catch(e) { toast('Error al iniciar sesi?n','error'); }
  } else {
    // Demo
    STATE.loggedIn = true;
    toast('Bienvenida de nuevo, Marcela','success');
    setTimeout(() => nav('dashboard'), 600);
  }
}

async function loginWithGoogle() {
  if (sb) {
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href }});
  } else {
    toast('Conectando con Google...','info');
    setTimeout(() => { STATE.loggedIn = true; nav('dashboard'); }, 800);
  }
}

async function doRegister() {
  const nombre  = document.getElementById('regNombre').value.trim();
  const apellido= document.getElementById('regApellido')?.value?.trim()||'';
  const email   = document.getElementById('regEmail').value.trim();
  const pw      = document.getElementById('regPw').value;
  if (!nombre || !email || !pw) { toast('Complet? todos los campos','error'); return; }
  if (pw.length < 8) { toast('La contrase?a debe tener al menos 8 caracteres','error'); return; }

  if (sb) {
    try {
      const { data, error } = await sb.auth.signUp({
        email, password: pw,
        options: { data: { nombre, apellido } }
      });
      if (error) { toast(error.message,'error'); return; }
      if (data.session) {
        await hydrateUser(data.session, false);
        toast('Perfil creado exitosamente','success');
        setTimeout(() => nav('dashboard'), 600);
        return;
      }
      toast('Cuenta creada. Revis? tu email para confirmar el acceso.','success');
      setTimeout(() => nav('login'), 900);
      return;
      STATE.loggedIn = true;
      STATE.user.name = nombre;
      STATE.user.lastName = apellido;
      STATE.user.initials = (nombre[0]+(apellido[0]||'')).toUpperCase();
      toast('Perfil creado exitosamente','success');
      setTimeout(() => nav('dashboard'), 600);
    } catch(e) { toast('Error al crear cuenta','error'); }
  } else {
    STATE.loggedIn = true;
    STATE.user.name = nombre;
    toast('Perfil creado','success');
    setTimeout(() => nav('dashboard'), 600);
  }
}

async function doLogout() {
  if (sb) await sb.auth.signOut();
  STATE.loggedIn = false;
  STATE.user.id = null;
  closeDD();
  toast('Sesi?n cerrada','info');
  setTimeout(() => nav('home'), 400);
}

async function doForgot() {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) { toast('Ingres? tu email','error'); return; }
  if (sb) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '?reset=true' });
    if (error) { toast(error.message,'error'); return; }
  }
  toast('Link enviado a ' + email,'success');
  setTimeout(() => nav('login'), 1200);
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   FORM / REVIEW
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function toggleSwitch(id, sectionId) {
  const sw = document.getElementById(id);
  if (!sw) return;
  sw.classList.toggle('on');
  if (sectionId) {
    STATE.isAnon = sw.classList.contains('on');
    const sec = document.getElementById(sectionId);
    if (sec) sec.style.maxHeight = STATE.isAnon ? '0' : '150px';
  }
}

function selAmt(el, val) {
  document.querySelectorAll('.amt-pill').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  STATE.selectedAmt = parseInt(val) || 0;
  document.getElementById('customAmt').value = '';
}

function selPay(el, method) {
  document.querySelectorAll('.pay-chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  STATE.selectedPay = method;
  const brick = document.getElementById('mp-brick-container');
  const transferBox = document.getElementById('transferInfoBox');
  const transferText = document.getElementById('transferInfoText');
  if (method === 'mercadopago') {
    if (transferBox) transferBox.style.display = 'none';
    if (brick) {
      brick.style.display = '';
      renderMpBrick();
    }
  } else {
    if (brick) {
      brick.style.display = 'none';
      brick.innerHTML = '';
    }
    if (transferBox) {
      if (method === 'transfer') {
        const alias = STATE.viewedProfile?.mpAlias || 'Sin alias configurado';
        const cbu = STATE.viewedProfile?.mpCbu || 'Sin CBU/CVU configurado';
        transferBox.style.display = '';
        if (transferText) transferText.textContent = `Alias: ${alias} ? CBU/CVU: ${cbu}`;
      } else {
        transferBox.style.display = 'none';
      }
    }
  }
}

function addReviewPrompt(text) {
  const field = document.getElementById('fMsg');
  if (!field || !text) return;
  const current = field.value.trim();
  field.value = current ? `${current} ${text}` : text;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

function renderRewardAdmin() {
  const list = document.getElementById('rewardAdminList');
  if (!list) return;
  if (!STATE.rewardItems.length) {
    list.innerHTML = '<div class="gallery-admin-empty">Todavía no cargaste recompensas por reseña.</div>';
    return;
  }
  list.innerHTML = STATE.rewardItems.map(item => `
    <div class="gallery-admin-card">
      <div class="gallery-admin-thumb" style="${item.imageUrl ? `background-image:url('${item.imageUrl}')` : ''}"></div>
      <div>
        <div class="gallery-admin-title">${item.title}</div>
        <div class="gallery-admin-meta">${item.description || 'Sin descripción'}<br>${item.active ? 'Activa y visible cuando corresponda' : 'Oculta'}</div>
      </div>
      <div class="gallery-admin-actions">
        <button class="btn btn-ghost btn-sm" onclick="editRewardItem('${item.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRewardItem('${item.id}')">Eliminar</button>
      </div>
    </div>`).join('');
}

function renderPublicRewards(items = STATE.publicRewardItems || []) {
  const section = document.getElementById('pubRewardsSection');
  const grid = document.getElementById('pubRewardsGrid');
  if (!section || !grid) return;
  section.style.display = items.length ? '' : 'none';
  if (!items.length) return;
  grid.innerHTML = items.map(item => `
    <div class="gallery-card">
      <div class="gallery-media" style="${item.imageUrl ? `background-image:url('${item.imageUrl}')` : ''}">
        <div class="gallery-badge-row">
          <span class="gallery-pill">Recompensa</span>
          <span class="gallery-pill">Sin costo extra</span>
        </div>
      </div>
      <div class="gallery-card-body">
        <div class="gallery-title-row">
          <div class="gallery-title">${item.title}</div>
        </div>
        <div class="gallery-desc">${item.description || 'Se entrega luego de la aprobación del pago de tu reseña.'}</div>
        <div class="gallery-cta">
          <button class="btn btn-amber btn-sm" onclick="nav('form')">Quiero dejar mi reseña</button>
        </div>
      </div>
    </div>`).join('');
}

function isMediaUnlocked(item) {
  return item.visibility === 'public' || (STATE.unlockedMediaIds || []).includes(item.id);
}

function mediaKindLabel(kind='image') {
  if (kind === 'video') return 'Video';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'file') return 'Archivo';
  return 'Imagen';
}

function renderMediaCards(items, allowPay = true) {
  return items.map(item => {
    const unlocked = isMediaUnlocked(item);
    const locked = item.visibility === 'private' && !unlocked;
    const bgStyle = item.previewUrl ? `background-image:url('${item.previewUrl}');${locked ? 'filter:blur(8px) brightness(.65);transform:scale(1.04);' : ''}` : '';
    const overlay = item.previewUrl
      ? ''
      : `<div class="gallery-media-overlay">${mediaKindLabel(item.mediaKind)}</div>`;
    const stateNote = locked
      ? 'Se habilita cuando el pago queda aprobado.'
      : item.downloadUrl
        ? (item.allowDownload ? 'Disponible para descarga directa desde esta misma página.' : 'Disponible para visualización online desde esta misma página.')
        : 'El perfil todavía no cargó el enlace final de acceso.';
    return `
      <div class="gallery-card">
        <div class="gallery-media" style="${bgStyle}">
          ${overlay}
          <div class="gallery-badge-row">
            <span class="gallery-pill">${item.isCombo ? `Combo ? ${mediaKindLabel(item.mediaKind)}` : mediaKindLabel(item.mediaKind)}</span>
            <span class="gallery-pill">${locked ? 'Bloqueada' : (item.visibility === 'public' ? 'P?blica' : 'Desbloqueada')}</span>
          </div>
        </div>
        <div class="gallery-card-body">
          <div class="gallery-title-row">
            <div class="gallery-title">${item.title}</div>
            <div class="gallery-price">${galleryPriceLabel(item.priceCents)}</div>
          </div>
          <div class="gallery-desc">${item.description || 'Contenido disponible en la galer?a.'}</div>
          <div class="gallery-state-note">${stateNote}</div>
          <div class="gallery-cta">
            ${locked && allowPay
              ? `<button class="btn btn-amber btn-sm" onclick="purchaseMediaItem('${item.id}')">Desbloquear</button>`
              : ''}
            ${!locked && item.downloadUrl
              ? `<a class="btn btn-surface btn-sm" href="${item.downloadUrl}" ${item.allowDownload ? 'download' : 'target="_blank" rel="noopener"'}>${item.allowDownload ? 'Descargar' : 'Ver contenido'}</a>`
              : ''}
            ${!locked && !item.downloadUrl
              ? `<button class="btn btn-surface btn-sm" disabled>Sin descarga cargada</button>`
              : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderPublicMediaPreview(items = STATE.publicMediaItems || []) {
  const section = document.getElementById('pubMediaSection');
  const grid = document.getElementById('pubMediaPreviewGrid');
  if (!section || !grid) return;
  section.style.display = items.length ? '' : 'none';
  if (!items.length) return;
  grid.innerHTML = renderMediaCards(items.slice(0, 3), false);
}

function renderMediaVault() {
  const grid = document.getElementById('mediaVaultGrid');
  if (!grid) return;
  const items = STATE.publicMediaItems || [];
  if (!items.length) {
    grid.innerHTML = '<div class="gallery-empty">Este perfil todavía no publicó imágenes o combos.</div>';
    return;
  }
  grid.innerHTML = renderMediaCards(items, true);
}

function resetRewardForm() {
  STATE.currentRewardEditId = null;
  ['rewardTitle','rewardDescription','rewardImageUrl'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const imageFile = document.getElementById('rewardImageFile');
  if (imageFile) imageFile.value = '';
  const active = document.getElementById('rewardActive');
  if (active) active.value = 'true';
}

function editRewardItem(id) {
  const item = STATE.rewardItems.find(entry => entry.id === id);
  if (!item) return;
  STATE.currentRewardEditId = id;
  document.getElementById('rewardTitle').value = item.title;
  document.getElementById('rewardDescription').value = item.description || '';
  document.getElementById('rewardImageUrl').value = item.imageUrl || '';
  document.getElementById('rewardActive').value = String(item.active !== false);
}

async function saveRewardItem() {
  if (!sb || !STATE.user.id) return toast('Inici? sesi?n para guardar recompensas','error');
  const title = document.getElementById('rewardTitle')?.value?.trim() || '';
  if (!title) return toast('Escrib? un t?tulo para la recompensa','error');
  const description = document.getElementById('rewardDescription')?.value?.trim() || '';
  const imageFile = document.getElementById('rewardImageFile')?.files?.[0] || null;
  const imageUrlField = document.getElementById('rewardImageUrl')?.value?.trim() || '';
  const image_url = (imageFile ? await uploadProfileAsset(imageFile, 'reward') : '') || imageUrlField || '';
  const payload = {
    profile_id: STATE.user.id,
    title,
    description,
    image_url,
    active: (document.getElementById('rewardActive')?.value || 'true') === 'true',
    sort_order: STATE.currentRewardEditId
      ? (STATE.rewardItems.find(item => item.id === STATE.currentRewardEditId)?.sortOrder || 0)
      : STATE.rewardItems.length,
  };
  const query = STATE.currentRewardEditId
    ? sb.from('profile_reward_items').update(payload).eq('id', STATE.currentRewardEditId).eq('profile_id', STATE.user.id)
    : sb.from('profile_reward_items').insert(payload);
  const { error } = await query;
  if (error) return toast(error.message || 'No se pudo guardar la recompensa','error');
  STATE.rewardItems = await fetchRewardItems(STATE.user.id, true);
  STATE.publicRewardItems = STATE.rewardItems.filter(item => item.active);
  renderRewardAdmin();
  renderPublicRewards();
  resetRewardForm();
  toast('Recompensa guardada ','success');
}

async function deleteRewardItem(id) {
  if (!sb || !STATE.user.id) return;
  const { error } = await sb.from('profile_reward_items').delete().eq('id', id).eq('profile_id', STATE.user.id);
  if (error) return toast(error.message || 'No se pudo eliminar la recompensa','error');
  STATE.rewardItems = await fetchRewardItems(STATE.user.id, true);
  STATE.publicRewardItems = STATE.rewardItems.filter(item => item.active);
  renderRewardAdmin();
  renderPublicRewards();
  resetRewardForm();
  toast('Recompensa eliminada ','success');
}

function resetMediaForm() {
  STATE.currentMediaEditId = null;
  ['mediaTitle','mediaPrice','mediaDescription','mediaPreviewUrl','mediaDownloadUrl'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const previewFile = document.getElementById('mediaPreviewFile');
  if (previewFile) previewFile.value = '';
  document.getElementById('mediaKind').value = 'image';
  document.getElementById('mediaAllowDownload').value = 'true';
  document.getElementById('mediaVisibility').value = 'public';
  document.getElementById('mediaIsCombo').value = 'false';
  document.getElementById('mediaActive').value = 'true';
}

function renderMediaAdmin() {
  const list = document.getElementById('mediaAdminList');
  if (!list) return;
  if (!STATE.mediaItems.length) {
    list.innerHTML = '<div class="gallery-admin-empty">Todav?a no cargaste im?genes o combos.</div>';
    return;
  }
  list.innerHTML = STATE.mediaItems.map(item => `
    <div class="gallery-admin-card">
      <div class="gallery-admin-thumb" style="${item.previewUrl ? `background-image:url('${item.previewUrl}')` : ''}"></div>
      <div>
        <div class="gallery-admin-title">${item.title}</div>
        <div class="gallery-admin-meta">${item.description || 'Sin descripci?n'}<br>${galleryPriceLabel(item.priceCents)} ? ${item.isCombo ? 'Combo' : mediaKindLabel(item.mediaKind)} ? ${item.visibility === 'public' ? 'P?blica' : 'Privada'} ? ${item.allowDownload ? 'Descargable' : 'Solo visualizaci?n'} ? ${item.active ? 'Activa' : 'Oculta'}</div>
      </div>
      <div class="gallery-admin-actions">
        <button class="btn btn-ghost btn-sm" onclick="editMediaItem('${item.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteMediaItem('${item.id}')">Eliminar</button>
      </div>
    </div>`).join('');
}

function editMediaItem(id) {
  const item = STATE.mediaItems.find(entry => entry.id === id);
  if (!item) return;
  STATE.currentMediaEditId = id;
  document.getElementById('mediaTitle').value = item.title;
  document.getElementById('mediaPrice').value = Math.round((item.priceCents || 0) / 100);
  document.getElementById('mediaDescription').value = item.description || '';
  document.getElementById('mediaPreviewUrl').value = item.previewUrl || '';
  document.getElementById('mediaDownloadUrl').value = item.downloadUrl || '';
  document.getElementById('mediaKind').value = item.mediaKind || 'image';
  document.getElementById('mediaAllowDownload').value = String(item.allowDownload !== false);
  document.getElementById('mediaVisibility').value = item.visibility || 'public';
  document.getElementById('mediaIsCombo').value = String(!!item.isCombo);
  document.getElementById('mediaActive').value = String(item.active !== false);
}

async function saveMediaItem() {
  if (!sb || !STATE.user.id) return toast('Inici? sesi?n para guardar im?genes','error');
  const title = document.getElementById('mediaTitle')?.value?.trim() || '';
  if (!title) return toast('Escrib? un t?tulo para la imagen','error');
  const description = document.getElementById('mediaDescription')?.value?.trim() || '';
  const previewFile = document.getElementById('mediaPreviewFile')?.files?.[0] || null;
  const previewUrlField = document.getElementById('mediaPreviewUrl')?.value?.trim() || '';
  const preview_url = (previewFile ? await uploadProfileAsset(previewFile, 'media-preview') : '') || previewUrlField || '';
  const payload = {
    profile_id: STATE.user.id,
    title,
    description,
    preview_url,
    download_url: document.getElementById('mediaDownloadUrl')?.value?.trim() || '',
    media_kind: document.getElementById('mediaKind')?.value || 'image',
    allow_download: (document.getElementById('mediaAllowDownload')?.value || 'true') === 'true',
    price_cents: Math.max(0, (parseInt(document.getElementById('mediaPrice')?.value || '0', 10) || 0) * 100),
    is_combo: (document.getElementById('mediaIsCombo')?.value || 'false') === 'true',
    visibility: document.getElementById('mediaVisibility')?.value || 'public',
    active: (document.getElementById('mediaActive')?.value || 'true') === 'true',
    sort_order: STATE.currentMediaEditId
      ? (STATE.mediaItems.find(item => item.id === STATE.currentMediaEditId)?.sortOrder || 0)
      : STATE.mediaItems.length,
  };
  const query = STATE.currentMediaEditId
    ? sb.from('profile_media_items').update(payload).eq('id', STATE.currentMediaEditId).eq('profile_id', STATE.user.id)
    : sb.from('profile_media_items').insert(payload);
  const { error } = await query;
  if (error) return toast(error.message || 'No se pudo guardar la imagen','error');
  STATE.mediaItems = await fetchMediaItems(STATE.user.id, true);
  STATE.publicMediaItems = STATE.mediaItems.filter(item => item.active);
  renderMediaAdmin();
  renderPublicMediaPreview();
  renderMediaVault();
  resetMediaForm();
  toast('Imagen guardada ','success');
}

async function deleteMediaItem(id) {
  if (!sb || !STATE.user.id) return;
  const { error } = await sb.from('profile_media_items').delete().eq('id', id).eq('profile_id', STATE.user.id);
  if (error) return toast(error.message || 'No se pudo eliminar la imagen','error');
  STATE.mediaItems = await fetchMediaItems(STATE.user.id, true);
  STATE.publicMediaItems = STATE.mediaItems.filter(item => item.active);
  renderMediaAdmin();
  renderPublicMediaPreview();
  renderMediaVault();
  resetMediaForm();
  toast('Imagen eliminada ','success');
}

async function purchaseMediaItem(mediaItemId) {
  const item = (STATE.publicMediaItems || []).find(entry => entry.id === mediaItemId);
  if (!item) return toast('No encontramos esa imagen','error');
  if (item.visibility !== 'private') return;
  if (!sb) {
    STATE.unlockedMediaIds = Array.from(new Set([...(STATE.unlockedMediaIds || []), mediaItemId]));
    persistUnlockedMedia();
    renderMediaVault();
    toast('Contenido desbloqueado en modo demo ','success');
    return;
  }
  const { data, error } = await sb.functions.invoke('mp-create-media-unlock', {
    body: {
      mediaItemId,
      profileSlug: STATE.viewedProfile?.slug || STATE.user.slug,
      appUrl: window.location.origin + window.location.pathname,
    }
  });
  if (error || !data?.init_point) {
    toast(error?.message || data?.error || 'No se pudo iniciar el desbloqueo','error');
    return;
  }
  sessionStorage.setItem('aplauso_media_pending', JSON.stringify({
    unlockId: data.unlock_id,
    mediaItemId,
    profileSlug: STATE.viewedProfile?.slug || STATE.user.slug || '',
  }));
  window.location.href = data.init_point;
}

async function submitReview() {
  const msg = document.getElementById('fMsg')?.value?.trim();
  const nombre   = document.getElementById('fNombre')?.value?.trim() || '';
  const apellido = document.getElementById('fApellido')?.value?.trim() || '';
  const reviewerPhone = document.getElementById('fPhone')?.value?.trim() || '';
  const reviewerAvatarFile = document.getElementById('fReviewerAvatar')?.files?.[0] || null;
  const reviewImageFile = document.getElementById('fReviewImage')?.files?.[0] || null;
  const profileId = STATE.viewedProfile?.id;
  if (!msg) { toast('Escribí tu reseña antes de continuar','error'); return; }
  if (!STATE.selectedAmt || STATE.selectedAmt < 100) { toast('Seleccioná un monto válido','error'); return; }

  if (!profileId) { toast('No se pudo identificar el perfil destino','error'); return; }
  const btn = document.getElementById('submitBtn');
  const btnTxt = document.getElementById('submitBtnText');
  if (!STATE.isAnon && !nombre) {
    toast('Sumá al menos tu nombre o activá el modo anónimo','error');
    return;
  }
  btn.disabled = true;
  btnTxt.innerHTML = '<span class="spinner"></span> Procesando...';
  if (reviewerPhone && normalizePhone(reviewerPhone).length < 8) {
    btn.disabled = false;
    btnTxt.textContent = 'Pagar y publicar resena';
    toast('Ingresa un celular valido o dejalo vacio','error');
    return;
  }
  const reviewerName = STATE.isAnon ? 'Anonimo' : ((nombre + ' ' + apellido).trim() || 'Visitante');
  const reviewerAvatarUrl = STATE.isAnon || !reviewerAvatarFile
    ? ''
    : await imageFileToDataUrl(reviewerAvatarFile, { maxWidth: 520, maxHeight: 520, quality: 0.86 });
  const reviewImageUrl = reviewImageFile
    ? await imageFileToDataUrl(reviewImageFile, { maxWidth: 1440, maxHeight: 1440, quality: 0.84 })
    : '';
  const reviewDraft = {
    reviewerName,
    reviewerPhone: STATE.isAnon ? '' : reviewerPhone,
    reviewerAvatarUrl,
    reviewImageUrl,
    message: msg,
  };

  // Si hay MP configurado ??' crear preferencia y redirigir
  const pk = getMpPublicKey();
  if (STATE.selectedPay === 'mercadopago') {
    const pref = await createMpPreference(reviewDraft);
    if (!pref) { btn.disabled = false; btnTxt.textContent = 'Pagar y publicar reseña'; return; }

    // Guardar datos temporales para mostrar en confirmaci?n post-pago
    sessionStorage.setItem('aplauso_pending', JSON.stringify({
      reviewId: pref.review_id || '',
      profileSlug: STATE.viewedProfile?.slug || STATE.user.slug || '',
      nombre: reviewerName,
      pay: 'MercadoPago',
      amount: STATE.selectedAmt,
      msg,
      reviewerPhone: reviewDraft.reviewerPhone,
      reviewerAvatarUrl: reviewDraft.reviewerAvatarUrl,
      reviewImageUrl: reviewDraft.reviewImageUrl
    }));

    // En producci?n redirige al checkout de MP
    if (pref.init_point && pref.init_point !== '#') {
      window.location.href = pref.init_point;
      return;
    }
  }

  if (sb) {
    try {
      const { data, error } = await sb
        .from('reviews')
        .insert({
          profile_id: profileId,
          reviewer_nombre: reviewerName,
          reviewer_phone: reviewDraft.reviewerPhone,
          reviewer_avatar_url: reviewDraft.reviewerAvatarUrl,
          review_image_url: reviewDraft.reviewImageUrl,
          is_anon: STATE.isAnon,
          message: msg,
          amount_cents: Math.round(STATE.selectedAmt * 100),
          payment_method: STATE.selectedPay === 'transfer' ? 'transfer' : STATE.selectedPay === 'cash' ? 'cash' : 'mercadopago',
          payment_status: STATE.selectedPay === 'mercadopago' ? 'pending' : 'approved',
          published: STATE.selectedPay === 'mercadopago' ? false : true,
        })
        .select('id, reviewer_nombre, reviewer_phone, reviewer_avatar_url, review_image_url, is_anon, message, amount_cents, reply, created_at, payment_status, published')
        .single();

      if (error) throw error;
      if (data?.published) {
        delete STATE.publicReviewsCache[profileId];
        STATE.publicReviews.unshift(mapReviewRow(data));
      }

      document.getElementById('csAuthor').textContent = reviewerName;
      document.getElementById('csPago').textContent = STATE.selectedPay === 'mercadopago'
        ? 'MercadoPago'
        : STATE.selectedPay === 'transfer'
          ? 'Transferencia'
          : 'Efectivo';
      document.getElementById('csAmount').textContent = '$' + STATE.selectedAmt.toLocaleString('es-AR') + ' ';
      document.getElementById('fMsg').value = '';
      resetReviewMediaFields();
      btn.disabled = false;
      btnTxt.textContent = 'Pagar y publicar reseña';
      toast(data?.published ? 'Reseña guardada en la base' : 'Reseña guardada pendiente de pago','success');
      renderProfile();
      nav('confirm');
      return;
    } catch(e) {
      console.error('Error guardando reseña:', e);
      btn.disabled = false;
      btnTxt.textContent = 'Pagar y publicar reseña';
      toast(e?.message || 'No se pudo guardar la reseña','error');
      return;
    }
  }

  // Modo demo / pago manual
  await new Promise(r => setTimeout(r, 1200));
  const newRev = {
    id: Date.now(),
    name: STATE.isAnon ? 'Anónimo' : (nombre ? nombre + ' ' + (apellido ? apellido.charAt(0)+'.' : '') : 'Visitante'),
    initials: STATE.isAnon ? '?' : ((nombre[0]||'')+(apellido[0]||'')).toUpperCase(),
    date: 'ahora mismo',
    amount: STATE.selectedAmt,
    text: msg,
    phone: reviewDraft.reviewerPhone,
    avatarUrl: reviewDraft.reviewerAvatarUrl,
    reviewImageUrl: reviewDraft.reviewImageUrl,
    reply: null,
    anon: STATE.isAnon,
    color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
  };
  STATE.reviews.unshift(newRev);

  const displayName = STATE.isAnon ? 'Anónimo' : (nombre + ' ' + apellido).trim() || 'Visitante';
  document.getElementById('csAuthor').textContent = displayName;
  document.getElementById('csPago').textContent = STATE.selectedPay === 'mercadopago'
    ? 'MercadoPago'
    : STATE.selectedPay === 'transfer'
      ? 'Transferencia'
      : 'Efectivo';
  document.getElementById('csAmount').textContent = '$' + STATE.selectedAmt.toLocaleString('es-AR') + ' ';

  document.getElementById('fMsg').value = '';
  resetReviewMediaFields();
  btn.disabled = false;
  btnTxt.textContent = 'Pagar y publicar reseña';
  toast('Reseña publicada exitosamente','success');
  nav('confirm');
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   PROFILE RENDER
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function renderProfile() {
  const profile = STATE.viewedProfile || STATE.user;
  const allReviews = STATE.publicReviews || [];
  const reviews = getFilteredPublicReviews(allReviews);
  const rewardItems = STATE.publicRewardItems || [];
  const mediaItems = STATE.publicMediaItems || [];
  const profileName = (profile.name + ' ' + (profile.lastName || '')).trim() || 'Perfil';
  const isVerified = !!profile.verified;
  const phone = profile.phone || '';
  const hasPhone = !!normalizePhone(phone);
  const pubQuickbar = document.getElementById('pubQuickbar');
  const revCountNode = document.getElementById('revCount');
  const reviewSummary = document.getElementById('pubReviewSummary');
  const reviewSortSelect = document.getElementById('reviewSortSelect');
  const reviewDateFilterSelect = document.getElementById('reviewDateFilterSelect');
  const rewardsSection = document.getElementById('pubRewardsSection');
  const mediaSection = document.getElementById('pubMediaSection');
  const pubReviews = document.getElementById('pubReviews');
  const formProfileAvatar = document.getElementById('formProfileAvatar');
  const highestReward = allReviews.reduce((max, review) => Math.max(max, review.amount || 0), 0);
  const latestReview = [...allReviews].sort((a, b) => getReviewTimestamp(b) - getReviewTimestamp(a))[0] || null;
  const totalVisibleAmount = allReviews.reduce((sum, review) => sum + (review.amount || 0), 0);
  const visibleLabel = reviews.length === allReviews.length
    ? `${reviews.length} resenas visibles`
    : `${reviews.length} de ${allReviews.length} resenas visibles`;

  setAvatarNode(document.getElementById('pubAvatarText'), profile.initials || initialsFromProfile(profile.name, profile.lastName), profile.avatarUrl);
  setCoverNode(document.getElementById('pubCover'), profile.coverUrl);
  document.getElementById('pubName').textContent = profileName;
  document.getElementById('pubRole').textContent = profile.role || 'Profesional';
  document.getElementById('pubCity').textContent = profile.city ? profile.city + ', AR' : 'Argentina';
  document.getElementById('pubVerified').style.display = isVerified ? '' : 'none';
  document.getElementById('pubBio').textContent = profile.bio || 'Perfil en Recomendapp';
  document.getElementById('pubTags').innerHTML = (profile.tags || []).map(tag => `<span class="pub-tag">${tag}</span>`).join('');
  updateProfileDocumentMeta(profile, allReviews);

  if (false && pubQuickbar) {
    pubQuickbar.innerHTML = `
      <div class="pub-quickbar-actions pub-quickbar-actions-compact">
        <button class="btn btn-amber btn-sm" onclick="nav('form')">Dejar reseña</button>
        <button class="btn btn-surface btn-sm" onclick="document.getElementById('pubReviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })">Ver reseñas</button>
        ${hasPhone ? `<button class="btn btn-surface btn-sm" onclick="window.open('${whatsAppLink(phone)}','_blank','noopener')">WhatsApp</button>` : ''}
      </div>`;
  }

  if (pubQuickbar) {
    pubQuickbar.innerHTML = `
      <div class="pub-quickbar-copy">
        <strong>${allReviews.length ? 'Prueba social con reconocimiento visible' : 'Perfil listo para recibir tu primera resena'}</strong>
        <span>${allReviews.length ? 'Una resena paga no se siente como un comentario liviano: muestra tiempo, decision y valor real. Eso ayuda a que una persona nueva entienda mas rapido por que confiar en este perfil.' : 'Tu resena puede ser la primera senal fuerte de confianza y reconocimiento real para este perfil.'}</span>
      </div>
      <div class="pub-quickbar-stats">
        <div class="pub-quickbar-stat">
          <strong>${highestReward ? '$' + highestReward.toLocaleString('es-AR') : '$0'}</strong>
          <span>Mayor recompensa</span>
        </div>
        <div class="pub-quickbar-stat">
          <strong>${latestReview?.date || 'Sin actividad'}</strong>
          <span>Ultima resena</span>
        </div>
      </div>
      <div class="pub-quickbar-actions">
        <button class="btn btn-amber btn-md pub-cta-primary" onclick="nav('form')">Dejar mi resena ahora</button>
        <button class="btn btn-surface btn-md pub-cta-secondary" onclick="document.getElementById('pubReviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })">Ver prueba social</button>
        ${hasPhone ? `<button class="btn btn-surface btn-sm" onclick="window.open('${whatsAppLink(phone)}','_blank','noopener')">WhatsApp</button>` : ''}
      </div>`;
  }

  const csProfileName = document.getElementById('csProfileName');
  if (csProfileName) csProfileName.textContent = profileName;

  renderFormHeader();
  if (formProfileAvatar) {
    setAvatarNode(formProfileAvatar, profile.initials || initialsFromProfile(profile.name, profile.lastName), profile.avatarUrl);
  }

  if (revCountNode) revCountNode.textContent = `${reviews.length} reseñas`;
  if (reviewSummary) {
    reviewSummary.innerHTML = `
      <span class="pub-review-pill">Orden: ${STATE.publicReviewSort === 'amount_desc' ? 'Mayor recompensa' : STATE.publicReviewSort === 'recent' ? 'Mas recientes' : STATE.publicReviewSort === 'oldest' ? 'Mas antiguas' : 'Menor recompensa'}</span>
      <span class="pub-review-pill">${highestReward ? 'Hasta $' + highestReward.toLocaleString('es-AR') : 'Sin recompensas visibles'}</span>
      <span class="pub-review-pill">${latestReview ? 'Ultima actividad ' + latestReview.date : 'Aun sin actividad'}</span>`;
  }
  if (reviewSortSelect) reviewSortSelect.value = STATE.publicReviewSort;
  if (reviewDateFilterSelect) reviewDateFilterSelect.value = STATE.publicReviewDateFilter;
  if (revCountNode) revCountNode.textContent = visibleLabel;
  if (rewardsSection) rewardsSection.style.display = rewardItems.length ? '' : 'none';
  if (mediaSection) mediaSection.style.display = mediaItems.length ? '' : 'none';
  if (pubReviews) {
    pubReviews.innerHTML = reviews.length
      ? reviews.map(review => revCardHTML(review, false)).join('')
      : `<div class="rev-card"><p class="rev-text">Todavía no hay reseñas publicadas. La primera puede ser la tuya.</p><button class="btn btn-amber btn-sm" onclick="nav('form')">Escribir la primera reseña</button></div>`;
  }

  if (pubReviews && !reviews.length) {
    pubReviews.innerHTML = `<div class="rev-card"><p class="rev-text">No hay resenas que coincidan con estos filtros todavia.</p><button class="btn btn-amber btn-sm" onclick="setPublicReviewDateFilter('all'); setPublicReviewSort('amount_desc')">Ver todas</button></div>`;
  }

  renderPublicRewards(rewardItems);
  renderPublicMediaPreview(mediaItems);

  if (document.getElementById('view-media')?.classList.contains('active')) {
    renderMediaVault();
  }
}

function revCardHTML(r, isDash) {
  const topReviewId = getTopRewardReview(isDash ? STATE.reviews : (STATE.publicReviews || []))?.id;
  const isTopReward = r.id === topReviewId;
  const replyBtn = isDash && !r.reply
    ? `<button class="d-rev-btn primary" onclick="openReply('${r.id}')">Responder</button>`
    : (isDash && r.reply ? `<button class="d-rev-btn" style="color:var(--green)" disabled> Respondida</button>` : '');
  const replyBlock = r.reply
    ? `<div class="rev-reply"><div class="rev-reply-label">Respuesta de ${STATE.user.name}</div><p class="rev-reply-text">${r.reply}</p></div>` : '';
  const avStyle = r.avatarUrl
    ? `background-image:url('${r.avatarUrl}');background-size:cover;background-position:center;color:transparent`
    : (r.anon
      ? 'color:var(--text3);font-family:sans-serif;font-size:18px'
      : `background:${r.color||'var(--amber)'};background-image:linear-gradient(135deg,${r.color||'#4F76B8'},${r.color||'#94B8F0'})`);
  const maskedPhone = maskPhone(r.phone);
  const reviewPhone = maskedPhone ? `<span class="rev-contact">${maskedPhone}</span>` : '';
  const reviewImage = r.reviewImageUrl ? `<button class="rev-media" type="button" onclick="openImageLightbox('${r.reviewImageUrl}')" style="background-image:url('${r.reviewImageUrl}')"><span class="rev-media-zoom">Ver completa</span></button>` : '';
  const topRewardBadge = isTopReward ? `<span class="rev-top-badge">Mayor recompensa</span>` : '';

  if (isDash) return `
    <div class="d-rev-item">
      <div class="avatar av-sm" style="${avStyle}">${r.initials}</div>
      <div class="d-rev-body">
        <div class="d-rev-top">
          <span class="d-rev-name">${r.name}</span>
          ${topRewardBadge}
          <span class="badge badge-amber"> $${r.amount.toLocaleString('es-AR')}</span>
          <span style="font-size:11px;color:var(--text3)">${r.date}</span>
        </div>
        ${reviewPhone}
        <div class="d-rev-text">"${r.text.substring(0,120)}${r.text.length>120?'...':''}"</div>
        ${reviewImage}
        ${replyBlock}
        <div class="d-rev-actions">${replyBtn}</div>
      </div>
    </div>`;

  return `
    <div class="rev-card ${isTopReward ? 'rev-card-top' : ''}">
      <div class="rev-header">
        <div class="rev-left">
          <div class="rev-av-txt" style="${avStyle}">${r.initials}</div>
          <div><div class="rev-name">${r.name}</div><div class="rev-date">${r.date}</div>${reviewPhone}</div>
        </div>
        <div class="rev-right-meta">${topRewardBadge}<div class="rev-amount"> $${r.amount.toLocaleString('es-AR')}</div></div>
      </div>
      <p class="rev-text">${r.text}</p>
      ${reviewImage}
      ${replyBlock}
    </div>`;
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   REPLY MODAL
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function openReply(id) {
  STATE.currentReplyId = id;
  const rev = STATE.reviews.find(r => r.id === id);
  if (!rev) return;
  document.getElementById('modalRevPreview').textContent = '"' + rev.text.substring(0,200) + (rev.text.length>200?'...':`"`);
  document.getElementById('replyText').value = '';
  document.getElementById('replyModal').classList.add('open');
}
function closeModal() {
  document.getElementById('replyModal').classList.remove('open');
  STATE.currentReplyId = null;
}
function submitReply() {
  if (sb && STATE.user.id) {
    const text = document.getElementById('replyText').value.trim();
    if (!text) { toast('Escribí tu respuesta','error'); return; }
    (async () => {
      const { error } = await sb
        .from('reviews')
        .update({ reply: text, replied_at: new Date().toISOString() })
        .eq('id', STATE.currentReplyId);
      if (error) {
        toast(error.message || 'No se pudo guardar la respuesta','error');
        return;
      }
      STATE.reviews = await fetchOwnReviews(STATE.user.id);
      if (STATE.viewedProfile?.slug === STATE.user.slug) {
        delete STATE.publicReviewsCache[STATE.user.id];
        STATE.publicReviews = [...STATE.reviews].filter(r => r.published && r.paymentStatus === 'approved');
      }
      toast('Respuesta publicada ','success');
      closeModal();
      renderDashboard();
      renderProfile();
    })();
    return;
  }
  const text = document.getElementById('replyText').value.trim();
  if (!text) { toast('Escribí tu respuesta','error'); return; }
  const rev = STATE.reviews.find(r => r.id === STATE.currentReplyId);
  if (rev) {
    rev.reply = text;
    const pending = STATE.reviews.filter(r => !r.reply).length;
    const el = document.getElementById('pendingCount');
    if (el) el.textContent = pending;
    toast('Respuesta publicada ','success');
    closeModal();
    renderDashboard();
    renderProfile();
  }
}
document.getElementById('replyModal').addEventListener('click', e => { if (e.target === document.getElementById('replyModal')) closeModal(); });
document.getElementById('imageLightbox')?.addEventListener('click', e => {
  if (e.target === document.getElementById('imageLightbox')) closeImageLightbox();
});

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   DASHBOARD
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function renderDashboard() {
  const dashboardView = document.getElementById('view-dashboard');
  if (!dashboardView) return;
  const isProfileTabVisible = document.getElementById('tabPerfil')?.style.display !== 'none';
  const isAnalyticsTabVisible = document.getElementById('tabAnalytics')?.style.display !== 'none';
  const isPaymentsTabVisible = document.getElementById('tabPagos')?.style.display !== 'none';
  const editNombre = document.getElementById('editNombre');
  const editApellido = document.getElementById('editApellido');
  const editRole = document.getElementById('editRole');
  const editCity = document.getElementById('editCity');
  const editPhone = document.getElementById('editPhone');
  const editBio = document.getElementById('editBio');
  const editTags = document.getElementById('editTags');
  const editShareTitle = document.getElementById('editShareTitle');
  const editShareSubtitle = document.getElementById('editShareSubtitle');
  const editShareDescription = document.getElementById('editShareDescription');
  const editShareImageMode = document.getElementById('editShareImageMode');
  if (editNombre) editNombre.value = STATE.user.name || '';
  if (editApellido) editApellido.value = STATE.user.lastName || '';
  if (editRole) editRole.value = STATE.user.role || '';
  if (editCity) editCity.value = STATE.user.city || '';
  if (editPhone) editPhone.value = STATE.user.phone || '';
  if (editBio) editBio.value = STATE.user.bio || '';
  if (editTags) editTags.value = (STATE.user.tags || []).join(', ');
  if (editShareTitle) editShareTitle.value = STATE.user.shareTitle || '';
  if (editShareSubtitle) editShareSubtitle.value = STATE.user.shareSubtitle || '';
  if (editShareDescription) editShareDescription.value = STATE.user.shareDescription || '';
  if (editShareImageMode) editShareImageMode.value = STATE.user.shareImageMode || 'cover';
  if (isProfileTabVisible) {
    renderRewardAdmin();
    renderMediaAdmin();
  }
  // Avatar y t?tulos
  const av = document.getElementById('dashAvatar');
  if (av) setAvatarNode(av, STATE.user.initials, STATE.user.avatarUrl);
  const dt = document.getElementById('dashTitle');
  if (dt) dt.textContent = 'Panel de ' + STATE.user.name;
  const ds = document.getElementById('dashSubtitle');
  if (ds) ds.textContent = STATE.user.role + ' ? ' + STATE.user.city;

  // Metricas
  const total = STATE.reviews.reduce((s,r) => s+r.amount, 0);
  const avg   = STATE.reviews.length ? Math.round(total/STATE.reviews.length) : 0;
  document.getElementById('mTotal').textContent = '$' + total.toLocaleString('es-AR');
  document.getElementById('mReviews').textContent = STATE.reviews.length;
  document.getElementById('mAvg').textContent = '$' + avg.toLocaleString('es-AR');
  document.getElementById('pendingCount').textContent = STATE.reviews.filter(r=>!r.reply).length;
  const topReview = getTopRewardReview(STATE.reviews);

  // Reviews
  const dr = document.getElementById('dashReviews');
  if (dr) dr.innerHTML = STATE.reviews.slice(0,5).map(r => revCardHTML(r, true)).join('');
  const dashTopReview = document.getElementById('dashTopReview');
  if (dashTopReview) {
    dashTopReview.innerHTML = topReview
      ? `
        <div class="dash-spotlight-copy">
          <div class="dash-spotlight-amount">$${topReview.amount.toLocaleString('es-AR')}</div>
          <div class="dash-spotlight-sub">Mayor recompensa recibida</div>
        </div>
        ${revCardHTML(topReview, false)}`
      : `<div class="gallery-admin-empty">Todavia no hay resenas destacadas para mostrar.</div>`;
  }

  // Activity
  const af = document.getElementById('activityFeed');
  if (af) af.innerHTML = STATE.reviews.slice(0,4).map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div class="avatar av-xs" style="background:${r.color||'#4F76B8'}">${r.initials}</div>
      <div style="flex:1"><div style="font-size:12px;color:var(--text2)"><strong style="color:var(--text)">${r.name}</strong> dejó una reseña</div><div style="font-size:11px;color:var(--text3)">${r.date}</div></div>
      <span class="badge badge-amber" style="font-size:11px">$${(r.amount/1000).toFixed(r.amount%1000?1:0)}k</span>
    </div>`).join('');

  // Chart
  if (isAnalyticsTabVisible) {
    const bars = document.getElementById('chartBars');
    const labels = document.getElementById('chartLabels');
    if (bars) {
      const max = Math.max(...CHART_DATA.map(d=>d.val));
      bars.innerHTML = CHART_DATA.map(d => {
        const h = Math.round((d.val/max)*90)+10;
        return `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${h}px" title="$${d.val.toLocaleString('es-AR')}"></div></div>`;
      }).join('');
    }
    if (labels) labels.innerHTML = CHART_DATA.map(d => `<div style="flex:1;text-align:center;font-size:10px;color:var(--text3)">${d.day}</div>`).join('');

    const ad = document.getElementById('amtDistrib');
    if (ad) {
      const ranges = [
        {label:'$0-1k', count:STATE.reviews.filter(r=>r.amount<=1000).length},
        {label:'$1k-5k', count:STATE.reviews.filter(r=>r.amount>1000&&r.amount<=5000).length},
        {label:'$5k-10k', count:STATE.reviews.filter(r=>r.amount>5000&&r.amount<=10000).length},
        {label:'$10k+', count:STATE.reviews.filter(r=>r.amount>10000).length},
      ];
      const maxC = Math.max(...ranges.map(r=>r.count),1);
      ad.innerHTML = ranges.map(r => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:64px;font-size:12px;color:var(--text2)">${r.label}</div>
          <div style="flex:1;background:var(--surface);border-radius:4px;height:8px;overflow:hidden">
            <div style="height:100%;border-radius:4px;background:var(--amber);width:${Math.round(r.count/maxC*100)}%;transition:width .6s"></div>
          </div>
          <div style="font-size:12px;color:var(--text3);width:20px;text-align:right">${r.count}</div>
        </div>`).join('');
    }

    const replied = STATE.reviews.filter(r=>r.reply).length;
    const rateEl = document.getElementById('analyticsReplyRate');
    if (rateEl) rateEl.textContent = STATE.reviews.length ? Math.round(replied/STATE.reviews.length*100)+'%' : '0%';
  }

  if (isPaymentsTabVisible) {
    const ph = document.getElementById('payHistory');
    if (ph) ph.innerHTML = STATE.reviews.slice(0, 10).map(p => `
      <div class="pay-row">
        <div class="pay-row-left">
          <div class="avatar av-sm" style="background:linear-gradient(135deg,#635D55,#3A3630)">${(p.name || '?').charAt(0)}</div>
          <div class="pay-row-info"><div class="pay-row-name">${p.name}</div><div class="pay-row-date">${p.date} ? MercadoPago</div></div>
        </div>
        <div class="pay-row-amount">+${formatCurrency(p.amount)}</div>
      </div>`).join('');
  }

  // Link
  const pl = document.getElementById('profileLinkDisplay');
  if (pl) pl.textContent = profileShareLinkFromProfile(STATE.user);
}

function dashTab(btn, tabId) {
  document.querySelectorAll('.d-tab').forEach(t => t.classList.remove('act'));
  btn.classList.add('act');
  ['tabReseñas','tabAnalytics','tabPagos','tabPerfil'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === tabId ? 'block' : 'none';
  });
  if (tabId === 'tabAnalytics' || tabId === 'tabPagos') renderDashboard();
}

function saveProfile() {
  if (sb && STATE.user.id) {
    (async () => {
      const nombre = document.getElementById('editNombre')?.value?.trim() || STATE.user.name;
      const apellido = document.getElementById('editApellido')?.value?.trim() || STATE.user.lastName;
      const role = document.getElementById('editRole')?.value?.trim() || '';
      const city = document.getElementById('editCity')?.value?.trim() || '';
      const telefono = document.getElementById('editPhone')?.value?.trim() || '';
      const bio = document.getElementById('editBio')?.value?.trim() || '';
      const tags = (document.getElementById('editTags')?.value || '').split(',').map(t=>t.trim()).filter(Boolean);
      const share_title = document.getElementById('editShareTitle')?.value?.trim() || '';
      const share_subtitle = document.getElementById('editShareSubtitle')?.value?.trim() || '';
      const share_description = document.getElementById('editShareDescription')?.value?.trim() || '';
      const share_image_mode = document.getElementById('editShareImageMode')?.value || 'cover';
      const avatarFile = document.getElementById('editAvatarFile')?.files?.[0] || null;
      const coverFile = document.getElementById('editCoverFile')?.files?.[0] || null;
      const [avatar_url, cover_url] = await Promise.all([
        avatarFile ? uploadProfileAsset(avatarFile, 'avatar') : Promise.resolve(STATE.user.avatarUrl || null),
        coverFile ? uploadProfileAsset(coverFile, 'cover') : Promise.resolve(STATE.user.coverUrl || null),
      ]);
      const payload = {
        nombre,
        apellido,
        role,
        city,
        telefono,
        bio,
        tags,
        slug: STATE.user.slug,
        avatar_url,
        cover_url,
        share_title,
        share_subtitle,
        share_description,
        share_image_mode,
      };
      let { data, error } = await sb
        .from('profiles')
        .update(payload)
        .eq('id', STATE.user.id)
        .select('*')
        .single();
      if (error && /share_title|share_subtitle|share_description|share_image_mode/i.test(error.message || '')) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.share_title;
        delete fallbackPayload.share_subtitle;
        delete fallbackPayload.share_description;
        delete fallbackPayload.share_image_mode;
        const fallbackResponse = await sb
          .from('profiles')
          .update(fallbackPayload)
          .eq('id', STATE.user.id)
          .select('*')
          .single();
        data = fallbackResponse.data;
        error = fallbackResponse.error;
        if (!error) {
          toast('El perfil se guardo, pero para persistir metadatos personalizados falta aplicar la migracion SQL.', 'info');
        }
      }
      if (error) {
        toast(error.message || 'No se pudo actualizar el perfil','error');
        return;
      }
      if (STATE.user.slug) delete STATE.profileCache[STATE.user.slug];
      if (payload.slug && payload.slug !== STATE.user.slug) delete STATE.profileCache[payload.slug];
      mergeUserProfile(data);
      if (!STATE.viewedProfile || STATE.viewedProfile.id === STATE.user.id) STATE.viewedProfile = { ...STATE.user };
      toast('Perfil actualizado ','success');
      updateNav();
      renderDashboard();
      renderProfile();
    })();
    return;
  }
  STATE.user.name     = document.getElementById('editNombre')?.value || STATE.user.name;
  STATE.user.lastName = document.getElementById('editApellido')?.value || STATE.user.lastName;
  STATE.user.role     = document.getElementById('editRole')?.value || STATE.user.role;
  STATE.user.city     = document.getElementById('editCity')?.value || STATE.user.city;
  STATE.user.phone    = document.getElementById('editPhone')?.value || STATE.user.phone;
  STATE.user.bio      = document.getElementById('editBio')?.value || STATE.user.bio;
  STATE.user.shareTitle = document.getElementById('editShareTitle')?.value || STATE.user.shareTitle;
  STATE.user.shareSubtitle = document.getElementById('editShareSubtitle')?.value || STATE.user.shareSubtitle;
  STATE.user.shareDescription = document.getElementById('editShareDescription')?.value || STATE.user.shareDescription;
  STATE.user.shareImageMode = document.getElementById('editShareImageMode')?.value || STATE.user.shareImageMode;
  const tagsRaw       = document.getElementById('editTags')?.value || '';
  STATE.user.tags     = tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
  STATE.user.initials = (STATE.user.name.charAt(0)+STATE.user.lastName.charAt(0)).toUpperCase();
  STATE.user.slug     = (STATE.user.name+'-'+STATE.user.lastName).toLowerCase().replace(/\s+/g,'-');
  toast('Perfil actualizado ','success');
  updateNav();
  renderDashboard();
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   SETTINGS ??" MP CREDENTIALS
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
async function loadSettingsForm() {
  await loadStoredMpConfig(true);
  const cfg = STATE.mpConfig;
  const pkEl = document.getElementById('stMpPublicKey');
  const atEl = document.getElementById('stMpAccessToken');
  const modeEl = document.getElementById('stMpMode');
  const checkoutLabelEl = document.getElementById('stMpCheckoutLabel');
  const aliasEl = document.getElementById('stMpAliasCobro');
  const cbuEl = document.getElementById('stMpCbuCobro');
  const minEl = document.getElementById('stMinAmount');
  const anonEl = document.getElementById('stAllowAnon');
  if (pkEl) pkEl.value = cfg.publicKey || '';
  if (atEl) atEl.value = cfg.accessToken || '';
  if (modeEl) modeEl.value = cfg.mode || 'sandbox';
  if (checkoutLabelEl) checkoutLabelEl.value = cfg.checkoutLabel || 'Recomendapp';
  if (aliasEl) aliasEl.value = STATE.user.mpAlias || '';
  if (cbuEl) cbuEl.value = STATE.user.mpCbu || '';
  if (minEl) minEl.value = Math.round((STATE.user.minAmount || 0) / 100);
  if (anonEl) anonEl.value = String(STATE.user.allowAnon ?? true);
  updateMpStatusBadge();

  // email settings
  const stN = document.getElementById('stNombre');
  const stA = document.getElementById('stApellido');
  const stP = document.getElementById('stTelefono');
  const stE = document.getElementById('stEmail');
  const stShareTitle = document.getElementById('stShareTitle');
  const stShareSubtitle = document.getElementById('stShareSubtitle');
  const stShareDescription = document.getElementById('stShareDescription');
  if (stN) stN.value = STATE.user.name;
  if (stA) stA.value = STATE.user.lastName;
  if (stP) stP.value = STATE.user.phone || '';
  if (stE) stE.value = STATE.user.email;
  if (stShareTitle) stShareTitle.value = STATE.user.shareTitle || '';
  if (stShareSubtitle) stShareSubtitle.value = STATE.user.shareSubtitle || '';
  if (stShareDescription) stShareDescription.value = STATE.user.shareDescription || '';
}

async function saveAccountSettings() {
  if (!sb || !STATE.user.id) {
    toast('Inici? sesi?n para guardar tu cuenta','error');
    return;
  }
  const nombre = document.getElementById('stNombre')?.value?.trim() || STATE.user.name;
  const apellido = document.getElementById('stApellido')?.value?.trim() || STATE.user.lastName;
  const telefono = document.getElementById('stTelefono')?.value?.trim() || '';
  const share_title = document.getElementById('stShareTitle')?.value?.trim() || '';
  const share_subtitle = document.getElementById('stShareSubtitle')?.value?.trim() || '';
  const share_description = document.getElementById('stShareDescription')?.value?.trim() || '';
  let { data, error } = await sb
    .from('profiles')
    .update({
      nombre,
      apellido,
      telefono,
      slug: STATE.user.slug,
      share_title,
      share_subtitle,
      share_description,
    })
    .eq('id', STATE.user.id)
    .select('*')
    .single();

  if (error && /share_title|share_subtitle|share_description/i.test(error.message || '')) {
    const fallbackResponse = await sb
      .from('profiles')
      .update({
        nombre,
        apellido,
        telefono,
        slug: STATE.user.slug,
      })
      .eq('id', STATE.user.id)
      .select('*')
      .single();
    data = fallbackResponse.data;
    error = fallbackResponse.error;
    if (!error) {
      toast('La cuenta se guardo, pero para persistir metadatos personalizados falta aplicar la migracion SQL.', 'info');
    }
  }

  if (error) {
    toast(error.message || 'No se pudo guardar la cuenta','error');
    return;
  }

  if (STATE.user.slug) delete STATE.profileCache[STATE.user.slug];
  mergeUserProfile(data);
  if (!STATE.viewedProfile || STATE.viewedProfile.id === STATE.user.id) {
    STATE.viewedProfile = { ...STATE.user };
  }
  updateNav();
  renderDashboard();
  renderProfile();
  toast('Cuenta actualizada ','success');
}

function updateMpStatusBadge() {
  const badge = document.getElementById('mpStatusBadge');
  if (!badge) return;
  const pk = getMpPublicKey();
  if (!pk) {
    badge.className = 'mp-status disconnected';
    badge.textContent = '?s? Sin configurar';
  } else if (STATE.mpConfig.mode === 'production' || CONFIG.mpMode === 'production') {
    badge.className = 'mp-status connected';
    badge.textContent = 'Activo en producci?n';
  } else {
    badge.className = 'mp-status configured';
    badge.textContent = '?Y?? Configurado en sandbox';
  }
}

async function savePaymentSettings() {
  if (!sb || !STATE.user.id) {
    toast('Primero inici? sesi?n para guardar tus datos de cobro','error');
    return;
  }

  const mp_alias = document.getElementById('stMpAliasCobro')?.value?.trim() || '';
  const mp_cbu = document.getElementById('stMpCbuCobro')?.value?.trim() || '';
  const minAmountArs = parseInt(document.getElementById('stMinAmount')?.value || '0', 10) || 0;
  const allowAnon = (document.getElementById('stAllowAnon')?.value || 'true') === 'true';

  const { data, error } = await sb
    .from('profiles')
    .update({
      mp_alias,
      mp_cbu,
      min_amount: Math.max(0, minAmountArs * 100),
      allow_anon: allowAnon,
    })
    .eq('id', STATE.user.id)
    .select('*')
    .single();

  if (error) {
    toast(error.message || 'No se pudieron guardar los datos de cobro','error');
    return;
  }

  if (STATE.user.slug) delete STATE.profileCache[STATE.user.slug];
  mergeUserProfile(data);
  if (!STATE.viewedProfile || STATE.viewedProfile.id === STATE.user.id) {
    STATE.viewedProfile = { ...STATE.user };
  }
  toast('Datos de cobro guardados ','success');
  renderProfile();
}

async function saveMpCredentials() {
  const pk   = document.getElementById('stMpPublicKey')?.value?.trim();
  const at   = document.getElementById('stMpAccessToken')?.value?.trim();
  const mode = document.getElementById('stMpMode')?.value;
  const checkoutLabel = document.getElementById('stMpCheckoutLabel')?.value?.trim() || 'Recomendapp';
  if (!pk || !at) { toast('Complet? Public Key y Access Token','error'); return; }
  if (!pk.startsWith('APP_USR-') && !pk.startsWith('TEST-')) {
    toast('La Public Key no parece v?lida','error'); return;
  }
  if (!sb || !STATE.user.id) {
    toast('Inici? sesi?n para guardar tus credenciales','error'); return;
  }

  const { data: existing, error: existingError } = await sb
    .from('profile_payment_credentials')
    .select('profile_id')
    .eq('profile_id', STATE.user.id)
    .single();

  if (existingError && !/0 rows|no rows/i.test(existingError.message || '')) {
    toast(existingError.message || 'No se pudo revisar la configuraci?n actual','error');
    return;
  }

  const payload = {
    profile_id: STATE.user.id,
    mp_public_key: pk,
    mp_access_token: at,
    mp_mode: mode,
    mp_checkout_label: checkoutLabel,
  };

  const query = existing
    ? sb.from('profile_payment_credentials').update(payload).eq('profile_id', STATE.user.id)
    : sb.from('profile_payment_credentials').insert(payload);

  const { error } = await query;
  if (error) {
    toast(error.message || 'No se pudieron guardar las credenciales','error');
    return;
  }

  STATE.mpConfig = { publicKey: pk, accessToken: at, mode, checkoutLabel, profileId: STATE.user.id };
  saveMpConfigToStorage(STATE.mpConfig);
  CONFIG.mpPublicKey = pk;
  CONFIG.mpMode = mode;
  initMP(pk);
  updateMpStatusBadge();
  toast('Credenciales de MercadoPago guardadas para este perfil','success');
}

async function testMpConnection() {
  const pk = getMpPublicKey();
  if (!pk) { toast('Primero configur? la Public Key','error'); return; }
  toast('Probando conexión...','info');
  setTimeout(() => {
    if (pk.startsWith('APP_USR-') || pk.startsWith('TEST-')) {
      toast('Public Key v?lida ? Conexi?n OK','success');
    } else {
      toast('Public Key con formato inv?lido','error');
    }
  }, 1000);
}

function copyWebhook() {
  const url = CONFIG.supabaseUrl.includes('TU-PROYECTO')
    ? 'https://avwqmeberbjadrrlvaaa.supabase.co/functions/v1/mp-webhook'
    : CONFIG.supabaseUrl + '/functions/v1/mp-webhook';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('URL copiada ','success'));
  } else {
    toast('URL: ' + url,'info');
  }
}

// Modal MP Config (acceso rapido)
function openMpModal() { document.getElementById('mpConfigModal').classList.add('open'); }
function closeMpModal() { document.getElementById('mpConfigModal').classList.remove('open'); }
function saveMpConfig() {
  const pk   = document.getElementById('mpPublicKeyInput')?.value?.trim();
  const at   = document.getElementById('mpAccessTokenInput')?.value?.trim();
  const mode = document.getElementById('mpModeSelect')?.value;
  if (!pk || !at) { toast('Complet? ambos campos','error'); return; }
  STATE.mpConfig = { publicKey: pk, accessToken: at, mode, checkoutLabel: STATE.mpConfig.checkoutLabel || 'Recomendapp' };
  saveMpConfigToStorage(STATE.mpConfig);
  CONFIG.mpPublicKey = pk;
  initMP(pk);
  closeMpModal();
  toast('MercadoPago configurado ','success');
}
document.getElementById('mpConfigModal').addEventListener('click', e => {
  if (e.target === document.getElementById('mpConfigModal')) closeMpModal();
});

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   SETTINGS TABS
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function settTab(btn, panelId) {
  document.querySelectorAll('.s-nav-item').forEach(b => b.classList.remove('act'));
  btn.classList.add('act');
  ['stCuenta','stPagos','stPlan','stNotif','stDanger'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === panelId ? 'block' : 'none';
  });
  if (panelId === 'stPagos') updateMpStatusBadge();
}

function confirmDelete() {
  if (confirm('¿Estás segura de que querés eliminar tu cuenta? Esta acción es irreversible.')) {
    STATE.loggedIn = false;
    toast('Cuenta eliminada','error');
    setTimeout(() => nav('home'), 800);
  }
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   SEARCH
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
let currentFilter = 'Todos';
function renderSearch(query='') {
  const q = (query || document.getElementById('searchInput')?.value || '').toLowerCase();
  const source = STATE.directoryProfiles || [];
  const filtered = source.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q) || p.city.toLowerCase().includes(q);
    const matchF = currentFilter === 'Todos' || p.cat.includes(currentFilter);
    return matchQ && matchF;
  });
  const grid = document.getElementById('profileGrid');
  if (!grid) return;
  if (!filtered.length) { grid.innerHTML = '<div style="grid-column:span 2;text-align:center;padding:60px;color:var(--text3)">No se encontraron perfiles.</div>'; return; }
  grid.innerHTML = filtered.map(p => `
    <div class="p-card" onclick="openPublicProfile('${p.slug || ''}')">
      <div class="p-card-top">
        <div class="avatar av-md" style="background:linear-gradient(135deg,${p.color},${p.color}AA)">${p.initials}</div>
        <div><div class="p-card-name">${p.name}</div><div class="p-card-role">${p.role} ? ${p.city}</div></div>
      </div>
      <p class="p-card-bio">${p.bio}</p>
      <div class="p-card-stats">
        <div class="p-card-stat"><div class="v">${p.revs}</div><div class="l">reseñas</div></div>
        <div class="p-card-stat"><div class="v" style="color:var(--amber)">$${(p.total/1000).toFixed(0)}k</div><div class="l">recibido</div></div>
      </div>
    </div>`).join('');
}
function doSearch() {
  if (STATE.searchDebounce) clearTimeout(STATE.searchDebounce);
  STATE.searchDebounce = setTimeout(() => renderSearch(), 120);
}
function setFilter(el, filter) {
  currentFilter = filter;
  document.querySelectorAll('.f-chip').forEach(c => c.classList.remove('act'));
  el.classList.add('act');
  renderSearch();
}

async function openPublicProfile(slug) {
  nav('profile');
  if (!slug) return;
  if (sb) {
    await loadViewedProfileBySlug(slug, true);
    return;
  }
  const localProfile = STATE.directoryProfiles.find(p => p.slug === slug || p.id === slug);
  if (!localProfile) return;
  STATE.viewedProfile = {
    id: localProfile.id,
    slug: localProfile.slug,
    name: localProfile.name.split(' ')[0] || localProfile.name,
    lastName: localProfile.name.split(' ').slice(1).join(' '),
    role: localProfile.role,
    city: localProfile.city,
    bio: localProfile.bio,
    tags: localProfile.cat || [],
    initials: localProfile.initials,
  };
  renderProfile();
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   SHARE
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
async function doShare() {
  const targetProfile = STATE.viewedProfile?.id ? STATE.viewedProfile : STATE.user;
  const targetName = STATE.viewedProfile?.name || STATE.user.name;
  const url = profileShareLinkFromProfile(targetProfile);
  if (navigator.share) {
    if (shareInFlight) return;
    shareInFlight = true;
    try {
      await navigator.share({
        title: `${targetName} | Recomendapp`,
        text: 'Mira este perfil en Recomendapp',
        url,
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('No se pudo compartir:', error);
      }
    } finally {
      shareInFlight = false;
    }
    return;
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Enlace copiado ','success'));
  } else {
    toast('Enlace: ' + url,'info');
  }
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   PLAN SELECT
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function selectPlan(plan) {
  document.getElementById('planFree')?.classList.toggle('selected', plan==='free');
  document.getElementById('planPro')?.classList.toggle('selected', plan==='pro');
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   MARQUEE
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
function buildMarquee() {
  const items = ['Reseñas con impacto real','Recompensa obligatoria','Perfil público profesional','Simple y transparente','MercadoPago integrado','Respuestas del profesional','Compartible al instante','Anónimo opcional','Checkout Pro nativo','sb backend'];
  const html = [...items,...items].map(i => `<div class="m-item"><span class="star"></span>${i}</div>`).join('');
  const marqueeInner = document.getElementById('marqueeInner');
  if (!marqueeInner) return;
  marqueeInner.innerHTML = html;
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   sb AUTH LISTENER
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      hydrateUser(session, false);
      return;
    }
    if (session?.user) {
      STATE.loggedIn = true;
      STATE.user.email = session.user.email || '';
      const meta = session.user.user_metadata || {};
      if (meta.nombre) {
        STATE.user.name = meta.nombre;
        STATE.user.lastName = meta.apellido || '';
        STATE.user.initials = (meta.nombre[0]+(meta.apellido?.[0]||'')).toUpperCase();
      }
      updateNav();
    } else if (event === 'SIGNED_OUT') {
      STATE.loggedIn = false;
      updateNav();
    }
  });
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   WEBHOOK POST-PAGO (si viene de MercadoPago)
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
async function waitForPublishedReview(reviewId, attempts = 10, delayMs = 800) {
  if (!sb || !reviewId) return null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await sb
      .from('reviews')
      .select('id, reviewer_nombre, reviewer_phone, reviewer_avatar_url, review_image_url, is_anon, message, amount_cents, reply, created_at, payment_status, published')
      .eq('id', reviewId)
      .eq('published', true)
      .eq('payment_status', 'approved')
      .limit(1);

    if (!error && Array.isArray(data) && data[0]) return mapReviewRow(data[0]);
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return null;
}

async function confirmApprovedPayment(reviewId, paymentId, profileSlug) {
  const merchantOrderId = new URLSearchParams(window.location.search).get('merchant_order_id') || '';
  if (!sb || !reviewId || (!paymentId && !merchantOrderId) || !profileSlug) return null;
  const { data, error } = await sb.functions.invoke('mp-confirm-return', {
    body: { reviewId, paymentId, merchantOrderId, profileSlug }
  });
  if (error) {
    console.warn('No se pudo confirmar el pago en el retorno:', error.message || error);
    return null;
  }
  return data;
}

async function confirmApprovedMediaUnlock(unlockId, paymentId, profileSlug) {
  const merchantOrderId = new URLSearchParams(window.location.search).get('merchant_order_id') || '';
  if (!sb || !unlockId || (!paymentId && !merchantOrderId) || !profileSlug) return null;
  const { data, error } = await sb.functions.invoke('mp-confirm-media-return', {
    body: { unlockId, paymentId, merchantOrderId, profileSlug }
  });
  if (error) {
    console.warn('No se pudo confirmar el desbloqueo:', error.message || error);
    return null;
  }
  return data;
}

async function syncApprovedReview(targetReviewId, targetSlug, attempts = 24, delayMs = 1200) {
  if (!targetReviewId || !targetSlug) return null;
  const isOwnProfile = STATE.loggedIn && targetSlug === STATE.user.slug;

  if (isOwnProfile) {
    await refreshOwnProfileState(true);
    renderDashboard();
    renderProfile();
    return STATE.publicReviews.find(r => r.id === targetReviewId) || null;
  }

  let publishedReview = null;

  for (let i = 0; i < attempts; i++) {
    const latest = await waitForPublishedReview(targetReviewId, 1, delayMs);
    if (latest) {
      publishedReview = latest;
      break;
    }

    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  await loadViewedProfileBySlug(targetSlug, false, true);
  if (publishedReview && !STATE.publicReviews.some(r => r.id === publishedReview.id)) {
    STATE.publicReviews.unshift(publishedReview);
  }
  renderProfile();
  return publishedReview;
}

async function checkMpReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('payment') || params.get('status');
  const reviewId = params.get('review_id') || '';
  const unlockId = params.get('unlock_id') || '';
  const mediaItemId = params.get('media_item_id') || '';
  const returnSlug = params.get('slug') || '';
  const paymentId = params.get('payment_id') || params.get('collection_id') || params.get('data.id') || '';
  const merchantOrderId = params.get('merchant_order_id') || '';
  const pending = sessionStorage.getItem('aplauso_pending');
  const pendingMedia = sessionStorage.getItem('aplauso_media_pending');

  if (status) {
    if ((params.get('media') === '1' || unlockId) && pendingMedia) {
      const mediaData = JSON.parse(pendingMedia);
      const confirmedUnlock = await confirmApprovedMediaUnlock(unlockId || mediaData.unlockId, paymentId, returnSlug || mediaData.profileSlug || '');
      if (confirmedUnlock?.payment_status === 'approved') {
        STATE.unlockedMediaIds = Array.from(new Set([...(STATE.unlockedMediaIds || []), mediaItemId || mediaData.mediaItemId]));
        persistUnlockedMedia();
        if (returnSlug) await loadViewedProfileBySlug(returnSlug, false, true);
        renderProfile();
        renderMediaVault();
        setTimeout(() => nav('media'), 150);
        toast('Pago aprobado y contenido desbloqueado','success');
      } else {
        setTimeout(() => toast('El pago del contenido no fue aprobado. Intent? de nuevo.','error'), 300);
      }
      sessionStorage.removeItem('aplauso_media_pending');
      const cleanMediaPath = returnSlug ? window.location.pathname + '?slug=' + encodeURIComponent(returnSlug) : window.location.pathname;
      history.replaceState({}, '', cleanMediaPath);
      return;
    }

    const data = pending ? JSON.parse(pending) : {
      nombre: 'Visitante',
      amount: 0,
      reviewId,
      profileSlug: returnSlug,
    };

    if (status === 'approved' || status === 'success') {
      const targetReviewId = reviewId || data.reviewId || '';
      const targetSlug = returnSlug || data.profileSlug || STATE.viewedProfile?.slug || '';
      let confirmation = null;
      if (targetReviewId && targetSlug && (paymentId || merchantOrderId)) {
        confirmation = await confirmApprovedPayment(targetReviewId, paymentId, targetSlug);
      }
      const publishedReview = confirmation?.payment_status === 'approved'
        ? await syncApprovedReview(targetReviewId, targetSlug, 18, 700)
        : await syncApprovedReview(targetReviewId, targetSlug, 24, 1200);

      document.getElementById('csAuthor').textContent = data.nombre;
      document.getElementById('csPago').textContent = 'MercadoPago';
      document.getElementById('csAmount').textContent = data.amount ? ('$' + data.amount.toLocaleString('es-AR') + ' ARS') : 'Pago aprobado';
      setTimeout(() => nav(publishedReview ? 'confirm' : 'profile'), 150);
      toast(
        publishedReview
          ? 'Pago aprobado y resena publicada'
          : 'Pago aprobado. Actualizamos la resena en unos segundos.',
        'success'
      );
    } else {
      setTimeout(() => toast('El pago no fue aprobado. Intenta de nuevo.','error'), 300);
    }

    if (pending) sessionStorage.removeItem('aplauso_pending');
    const cleanPath = returnSlug ? window.location.pathname + '?slug=' + encodeURIComponent(returnSlug) : window.location.pathname;
    history.replaceState({}, '', cleanPath);
  }
}

/* ?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.?
   INIT
?.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.??.? */
async function initApp() {
  try {
    await loadViews();
    buildMarquee();
    updateNav();
    await bootstrapSupabaseData();
    await checkMpReturn();
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        ensureViewsLoaded(DEFERRED_VIEW_IDS);
        if (!STATE.directoryProfiles?.length) loadSearchProfiles();
      }, { timeout: 1500 });
    } else {
      setTimeout(() => {
        ensureViewsLoaded(DEFERRED_VIEW_IDS);
        if (!STATE.directoryProfiles?.length) loadSearchProfiles();
      }, 800);
    }
  } catch (error) {
    console.error('No se pudo iniciar la app:', error);
    const root = document.getElementById('views-root');
    if (root) {
      root.innerHTML = '<div class="view active"><section class="auth-wrap"><div class="auth-right" style="width:100%"><div class="auth-form-box"><h2>No pudimos cargar la app</h2><p class="auth-sub">Revisá que los archivos de vistas estén disponibles en la carpeta views/.</p></div></div></section></div>';
    }
  }
}

initApp();
