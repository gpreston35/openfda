import './styles.css';

const API_ROOT = 'https://api.fda.gov';
const DEFAULT_LIMIT = 8;
const CACHE_TTL_MS = 5 * 60 * 1000;

const categories = {
  drugs: {
    label: 'Drugs',
    accent: '#8b5cf6',
    endpoint: '/drug/enforcement.json',
    description: 'Drug recalls and enforcement reports, including classification, firm, and recall reason.',
    searchFields: ['product_description', 'recalling_firm', 'reason_for_recall'],
    source: 'drug/enforcement',
  },
  devices: {
    label: 'Devices',
    accent: '#06b6d4',
    endpoint: '/device/enforcement.json',
    description: 'Medical device enforcement reports and product correction/removal activity.',
    searchFields: ['product_description', 'recalling_firm', 'reason_for_recall'],
    source: 'device/enforcement',
  },
  foods: {
    label: 'Foods',
    accent: '#22c55e',
    endpoint: '/food/enforcement.json',
    description: 'Food recalls and enforcement reports from public FDA enforcement data.',
    searchFields: ['product_description', 'recalling_firm', 'reason_for_recall'],
    source: 'food/enforcement',
  },
};

const state = {
  activeCategory: 'drugs',
  query: '',
  cards: {},
  search: { status: 'idle', results: [], error: '' },
};

const app = document.querySelector('#app');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function firstPresent(record, keys, fallback = 'Not reported') {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value) && value.length) return value.join(', ');
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function formatDate(value) {
  if (!value || !/^\d{8}$/.test(String(value))) return 'Date not reported';
  const text = String(value);
  const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Date not reported' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function normalizeRecord(record, categoryKey) {
  const category = categories[categoryKey];
  return {
    category: category.label,
    source: category.source,
    title: firstPresent(record, ['product_description', 'product_type', 'openfda.brand_name'], 'Unnamed product or report'),
    summary: firstPresent(record, ['reason_for_recall', 'event_summary', 'description'], 'No summary supplied in this record.'),
    classification: firstPresent(record, ['classification', 'seriousness'], 'Classification not reported'),
    date: formatDate(firstPresent(record, ['report_date', 'recall_initiation_date', 'termination_date'], '')),
    firm: firstPresent(record, ['recalling_firm', 'manufacturer_name', 'firm_name'], 'Firm not reported'),
    status: firstPresent(record, ['status', 'voluntary_mandated'], 'Status not reported'),
  };
}

function buildUrl(categoryKey, { query = '', field = 'product_description', limit = DEFAULT_LIMIT } = {}) {
  const category = categories[categoryKey];
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('sort', 'report_date:desc');

  const cleaned = query.trim();
  if (cleaned) {
    const escaped = cleaned.replaceAll('"', '\\"');
    params.set('search', `${field}:"${escaped}"`);
  }

  return `${API_ROOT}${category.endpoint}?${params.toString()}`;
}

async function fetchJson(url) {
  const cacheKey = `openfda:${url}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.time < CACHE_TTL_MS) return parsed.data;
    } catch (_) {
      sessionStorage.removeItem(cacheKey);
    }
  }

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 429) {
    throw new Error('openFDA rate limit reached. Please wait a minute and try again.');
  }
  if (response.status === 404) {
    return { results: [] };
  }
  if (!response.ok) {
    throw new Error(`openFDA returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data }));
  return data;
}

function shell() {
  app.innerHTML = `
    <header class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Public FDA data • no login • no API key</p>
        <h1>OpenFDA Public Explorer</h1>
        <p class="lede">A lightweight dashboard for recent public FDA enforcement activity across drugs, devices, and foods.</p>
      </div>
      <div class="hero__panel" aria-label="openFDA API constraints">
        <strong>Unauthenticated openFDA limits</strong>
        <span>240 requests/minute/IP</span>
        <span>1,000 requests/day/IP</span>
      </div>
    </header>

    <main>
      <section class="overview" aria-labelledby="overview-title">
        <div class="section-heading">
          <p class="eyebrow">Dashboard</p>
          <h2 id="overview-title">Recent enforcement snapshots</h2>
        </div>
        <div class="category-grid" id="category-grid"></div>
      </section>

      <section class="explorer" aria-labelledby="explorer-title">
        <div class="section-heading">
          <p class="eyebrow">Browse</p>
          <h2 id="explorer-title">Search public records</h2>
          <p>Search product descriptions, recalling firms, and recall reasons for one category at a time.</p>
        </div>
        <form class="searchbar" id="search-form">
          <label>
            <span>Category</span>
            <select id="category-select">
              ${Object.entries(categories).map(([key, category]) => `<option value="${key}">${category.label}</option>`).join('')}
            </select>
          </label>
          <label class="searchbar__query">
            <span>Keyword</span>
            <input id="query-input" type="search" placeholder="insulin, pacemaker, salmonella…" autocomplete="off" />
          </label>
          <button type="submit">Search</button>
        </form>
        <div class="state" id="search-state">Choose a category or enter a keyword to load current public results.</div>
        <div class="results" id="results"></div>
      </section>

      <section class="disclaimer" aria-labelledby="disclaimer-title">
        <h2 id="disclaimer-title">Public-data disclaimer</h2>
        <p>Data is retrieved from public openFDA/FDA datasets and may be incomplete, delayed, duplicated, or missing fields. This dashboard is informational only and is not medical, legal, or regulatory advice. Always consult FDA source materials and qualified professionals for decisions that matter.</p>
        <a href="https://open.fda.gov/" target="_blank" rel="noreferrer">Visit openFDA source documentation</a>
      </section>
    </main>

    <footer>brought to you by Neuromancer</footer>
  `;

  document.querySelector('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.activeCategory = document.querySelector('#category-select').value;
    state.query = document.querySelector('#query-input').value;
    runSearch();
  });

  document.querySelector('#category-select').addEventListener('change', (event) => {
    state.activeCategory = event.target.value;
    runSearch();
  });
}

function renderCategoryGrid() {
  const grid = document.querySelector('#category-grid');
  grid.innerHTML = Object.entries(categories).map(([key, category]) => {
    const card = state.cards[key] || { status: 'loading', count: '…', latest: 'Loading recent reports…', error: '' };
    const body = card.status === 'error'
      ? `<p class="muted">${escapeHtml(card.error)}</p>`
      : `<p>${escapeHtml(category.description)}</p><strong>${escapeHtml(card.count)} recent records loaded</strong><span>${escapeHtml(card.latest)}</span>`;
    return `
      <article class="category-card" style="--accent:${category.accent}">
        <div class="category-card__top">
          <h3>${category.label}</h3>
          <span>${escapeHtml(category.source)}</span>
        </div>
        ${body}
        <button data-category="${key}" type="button">Browse ${category.label}</button>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('button[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeCategory = button.dataset.category;
      document.querySelector('#category-select').value = state.activeCategory;
      document.querySelector('#query-input').focus();
      runSearch();
    });
  });
}

function renderResults() {
  const stateBox = document.querySelector('#search-state');
  const results = document.querySelector('#results');

  if (state.search.status === 'loading') {
    stateBox.className = 'state state--loading';
    stateBox.textContent = 'Loading public openFDA records…';
    results.innerHTML = skeletonCards();
    return;
  }

  if (state.search.status === 'error') {
    stateBox.className = 'state state--error';
    stateBox.textContent = state.search.error;
    results.innerHTML = '';
    return;
  }

  if (!state.search.results.length) {
    stateBox.className = 'state';
    stateBox.textContent = 'No matching records were returned. Try a broader keyword or another category.';
    results.innerHTML = '';
    return;
  }

  stateBox.className = 'state state--success';
  stateBox.textContent = `${state.search.results.length} public ${categories[state.activeCategory].label.toLowerCase()} records loaded from openFDA.`;
  results.innerHTML = state.search.results.map(renderResultCard).join('');
}

function renderResultCard(item) {
  return `
    <article class="result-card">
      <div class="result-card__meta">
        <span>${escapeHtml(item.category)}</span>
        <span>${escapeHtml(item.source)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <dl>
        <div><dt>Classification</dt><dd>${escapeHtml(item.classification)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(item.date)}</dd></div>
        <div><dt>Firm</dt><dd>${escapeHtml(item.firm)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(item.status)}</dd></div>
      </dl>
    </article>
  `;
}

function skeletonCards() {
  return Array.from({ length: 3 }, () => '<article class="result-card skeleton"><span></span><h3></h3><p></p><p></p></article>').join('');
}

async function loadOverview() {
  renderCategoryGrid();
  await Promise.all(Object.keys(categories).map(async (key) => {
    try {
      const data = await fetchJson(buildUrl(key, { limit: 5 }));
      const results = data.results || [];
      state.cards[key] = {
        status: 'ready',
        count: String(results.length),
        latest: results[0] ? `Latest report: ${formatDate(results[0].report_date)}` : 'No recent records returned.',
      };
    } catch (error) {
      state.cards[key] = { status: 'error', error: error.message || 'Could not load this category.' };
    }
    renderCategoryGrid();
  }));
}

let searchRun = 0;
async function runSearch() {
  const runId = ++searchRun;
  state.search = { status: 'loading', results: [], error: '' };
  renderResults();
  try {
    const fields = state.query.trim() ? categories[state.activeCategory].searchFields : ['product_description'];
    let data = { results: [] };
    for (const field of fields) {
      data = await fetchJson(buildUrl(state.activeCategory, { query: state.query, field, limit: DEFAULT_LIMIT }));
      if ((data.results || []).length) break;
    }
    if (runId !== searchRun) return;
    state.search = {
      status: 'ready',
      results: (data.results || []).map((record) => normalizeRecord(record, state.activeCategory)),
      error: '',
    };
  } catch (error) {
    if (runId !== searchRun) return;
    state.search = {
      status: 'error',
      results: [],
      error: error.message || 'Could not load openFDA records right now.',
    };
  }
  renderResults();
}

shell();
renderCategoryGrid();
loadOverview();
runSearch();
