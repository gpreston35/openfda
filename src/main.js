import './styles.css';

const API_ROOT = 'https://api.fda.gov';
const DEFAULT_LIMIT = 8;
const GRAPH_LIMIT = 25;
const CACHE_TTL_MS = 5 * 60 * 1000;
const GRAPH_LABELS = ['Class I', 'Class II', 'Class III', 'Other / not reported'];

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
  route: 'dashboard',
  activeCategory: 'drugs',
  query: '',
  cards: {},
  graph: {},
  graphFocus: { category: 'drugs', classification: 'all' },
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
    const value = key.split('.').reduce((acc, part) => acc?.[part], record);
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

function normalizeClassification(value = '') {
  const text = String(value).trim().toLowerCase();
  if (text.includes('class i') && !text.includes('class ii')) return 'Class I';
  if (text.includes('class ii') && !text.includes('class iii')) return 'Class II';
  if (text.includes('class iii')) return 'Class III';
  return 'Other / not reported';
}

function normalizeRecord(record, categoryKey) {
  const category = categories[categoryKey];
  return {
    category: category.label,
    categoryKey,
    source: category.source,
    title: firstPresent(record, ['product_description', 'product_type', 'openfda.brand_name'], 'Unnamed product or report'),
    summary: firstPresent(record, ['reason_for_recall', 'event_summary', 'description'], 'No summary supplied in this record.'),
    classification: firstPresent(record, ['classification', 'seriousness'], 'Classification not reported'),
    normalizedClassification: normalizeClassification(record.classification || record.seriousness || ''),
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
  if (response.status === 429) throw new Error('openFDA rate limit reached. Please wait a minute and try again.');
  if (response.status === 404) return { results: [] };
  if (!response.ok) throw new Error(`openFDA returned HTTP ${response.status}.`);
  const data = await response.json();
  sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data }));
  return data;
}

function getRoute() {
  if (location.hash === '#/enforcement-data') return 'enforcement';
  if (location.hash === '#/about') return 'about';
  return 'dashboard';
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

    <main class="app-layout">
      <aside class="side-nav" aria-label="Feature navigation">
        <p class="eyebrow">Modules</p>
        <a data-route-link="dashboard" href="#/dashboard">Dashboard</a>
        <a data-route-link="enforcement" href="#/enforcement-data">Enforcement Data graph</a>
        <a data-route-link="about" href="#/about">About</a>
      </aside>

      <div class="content-flow">
        <section class="page" data-page="dashboard" aria-labelledby="dashboard-title">
          <div class="section-heading">
            <p class="eyebrow">Dashboard</p>
            <h2 id="dashboard-title">Recent enforcement snapshots</h2>
            <p>General openFDA enforcement dashboard. Feature-specific modules live in the left navigation.</p>
          </div>
          <div class="category-grid" id="category-grid"></div>

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
        </section>

        <section class="page" data-page="enforcement" aria-labelledby="enforcement-data-title">
          <div class="section-heading">
            <p class="eyebrow">Feature module</p>
            <h2 id="enforcement-data-title">Enforcement Data graph</h2>
            <p>Interactive graph of recent public enforcement records across drugs, devices, and foods. Select a row or classification segment to inspect the underlying records.</p>
          </div>
          <div class="enforcement-graph" id="enforcement-graph" aria-label="Interactive enforcement records graph by classification and category"></div>
          <div class="graph-detail" id="graph-detail" aria-live="polite"></div>
        </section>

        <section class="page about" data-page="about" aria-labelledby="about-title">
          <div class="section-heading">
            <p class="eyebrow">About</p>
            <h2 id="about-title">About this dashboard</h2>
            <p>OpenFDA Public Explorer is a frontend-only public dashboard for FDA enforcement data across drugs, devices, and foods.</p>
          </div>
          <div class="about-grid">
            <article>
              <h3>What it does</h3>
              <p>Loads recent public enforcement records directly from openFDA and presents summary cards, search results, and an interactive Enforcement Data graph.</p>
            </article>
            <article>
              <h3>Privacy and access</h3>
              <p>No login, no API key, no backend proxy, no cookies, no tracking, and no user-data collection.</p>
            </article>
            <article>
              <h3>Data source</h3>
              <p>Data comes from public openFDA endpoints and may be incomplete, delayed, duplicated, or missing fields.</p>
              <a href="https://open.fda.gov/" target="_blank" rel="noreferrer">OpenFDA documentation</a>
            </article>
            <article>
              <h3>Build metadata</h3>
              <dl>
                <div><dt>App version</dt><dd>0.1.0</dd></div>
                <div><dt>Route</dt><dd>/openfda/</dd></div>
                <div><dt>Credit</dt><dd>brought to you by Neuromancer</dd></div>
              </dl>
            </article>
            <article>
              <h3>Credits</h3>
              <ul class="credits-list">
                <li><strong>openFDA / FDA</strong><span>Public enforcement data and source documentation.</span></li>
                <li><strong>GitHub</strong><span>Source repository, workflow history, and deployment automation.</span></li>
                <li><strong>Tavily</strong><span>Research/search assistance used during requirements and source discovery.</span></li>
                <li><strong>Vite</strong><span>Frontend build tooling for the public static app.</span></li>
                <li><strong>Neuromancer</strong><span>Implementation, verification, and release coordination.</span></li>
              </ul>
            </article>
          </div>
        </section>

        <section class="disclaimer" aria-labelledby="disclaimer-title">
          <h2 id="disclaimer-title">Public-data disclaimer</h2>
          <p>Data is retrieved from public openFDA/FDA datasets and may be incomplete, delayed, duplicated, or missing fields. This dashboard is informational only and is not medical, legal, or regulatory advice. Always consult FDA source materials and qualified professionals for decisions that matter.</p>
          <a href="https://open.fda.gov/" target="_blank" rel="noreferrer">Visit openFDA source documentation</a>
        </section>
      </div>
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

  window.addEventListener('hashchange', renderRoute);
}

function renderRoute() {
  state.route = getRoute();
  document.querySelectorAll('[data-page]').forEach((page) => {
    page.hidden = page.dataset.page !== state.route;
  });
  document.querySelectorAll('[data-route-link]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.routeLink === state.route);
  });
  renderEnforcementGraph();
  renderGraphDetail();
}

function renderEnforcementGraph() {
  const graph = document.querySelector('#enforcement-graph');
  if (!graph) return;
  const maxCount = Math.max(1, ...Object.values(state.graph).map((row) => row.total || 0));

  graph.innerHTML = `
    <div class="enforcement-graph__header">
      <div>
        <span>Interactive classification graph</span>
        <strong>Recent enforcement sample</strong>
      </div>
      <p>Click a category row or colored classification segment to update the record detail panel.</p>
    </div>
    <div class="enforcement-graph__legend">
      ${GRAPH_LABELS.map((label) => `<button type="button" data-graph-category="${state.graphFocus.category}" data-graph-classification="${escapeHtml(label)}" data-classification="${escapeHtml(label)}"><i></i>${escapeHtml(label)}</button>`).join('')}
    </div>
    <div class="enforcement-graph__rows">
      ${Object.entries(categories).map(([key, category]) => {
        const row = state.graph[key] || { status: 'loading', total: 0, counts: {}, records: [] };
        const total = row.total || 0;
        const width = row.status === 'loading' ? 18 : Math.max(8, Math.round((total / maxCount) * 100));
        const status = row.status === 'error' ? 'Unable to load' : row.status === 'loading' ? 'Loading…' : `${total} records`;
        const selectedRow = state.graphFocus.category === key;
        return `
          <article class="enforcement-graph__row ${selectedRow ? 'is-selected' : ''}" style="--accent:${category.accent}; --bar-width:${width}%">
            <button class="enforcement-graph__label" data-graph-category="${key}" data-graph-classification="all" type="button">
              <strong>${category.label}</strong>
              <span>${escapeHtml(status)}</span>
            </button>
            <div class="enforcement-graph__track" role="group" aria-label="${escapeHtml(category.label)} classification segments">
              <div class="enforcement-graph__bar">
                ${GRAPH_LABELS.map((label) => {
                  const value = row.counts?.[label] || 0;
                  const percent = total ? Math.round((value / total) * 100) : 0;
                  const selected = selectedRow && state.graphFocus.classification === label;
                  return `<button type="button" class="enforcement-graph__segment ${selected ? 'is-selected' : ''}" data-graph-category="${key}" data-graph-classification="${escapeHtml(label)}" data-classification="${escapeHtml(label)}" style="--segment:${percent}%" title="${escapeHtml(`${category.label} ${label}: ${value}`)}"><span>${value}</span></button>`;
                }).join('')}
              </div>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;

  graph.querySelectorAll('[data-graph-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.graphFocus = {
        category: button.dataset.graphCategory,
        classification: button.dataset.graphClassification || 'all',
      };
      renderEnforcementGraph();
      renderGraphDetail();
    });
  });
}

function renderGraphDetail() {
  const detail = document.querySelector('#graph-detail');
  if (!detail) return;
  const categoryKey = state.graphFocus.category;
  const category = categories[categoryKey];
  const graphRow = state.graph[categoryKey] || { status: 'loading', records: [] };
  const records = graphRow.records || [];
  const filtered = state.graphFocus.classification === 'all'
    ? records
    : records.filter((item) => item.normalizedClassification === state.graphFocus.classification);
  const label = state.graphFocus.classification === 'all' ? 'all classifications' : state.graphFocus.classification;

  if (graphRow.status === 'loading') {
    detail.innerHTML = '<div class="state state--loading">Loading graph records…</div>';
    return;
  }

  if (graphRow.status === 'error') {
    detail.innerHTML = `<div class="state state--error">Could not load ${escapeHtml(category.label)} graph records.</div>`;
    return;
  }

  detail.innerHTML = `
    <div class="graph-detail__header">
      <div>
        <p class="eyebrow">Selected graph data</p>
        <h3>${escapeHtml(category.label)} — ${escapeHtml(label)}</h3>
        <p>${filtered.length} matching records from the latest ${records.length} ${escapeHtml(category.source)} results.</p>
      </div>
      <a href="#/dashboard" data-search-category="${categoryKey}">Search ${escapeHtml(category.label)}</a>
    </div>
    <div class="results results--compact">
      ${(filtered.length ? filtered : records.slice(0, 3)).slice(0, 6).map(renderResultCard).join('') || '<div class="state">No records returned for this graph selection.</div>'}
    </div>
  `;

  detail.querySelector('[data-search-category]')?.addEventListener('click', () => {
    state.activeCategory = categoryKey;
    setTimeout(() => {
      const select = document.querySelector('#category-select');
      if (select) select.value = categoryKey;
      runSearch();
    }, 0);
  });
}

function renderCategoryGrid() {
  const grid = document.querySelector('#category-grid');
  if (!grid) return;
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
  if (!stateBox || !results) return;

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
  renderEnforcementGraph();
  renderGraphDetail();
  renderCategoryGrid();
  await Promise.all(Object.keys(categories).map(async (key) => {
    try {
      const data = await fetchJson(buildUrl(key, { limit: GRAPH_LIMIT }));
      const records = (data.results || []).map((record) => normalizeRecord(record, key));
      const counts = records.reduce((acc, record) => {
        acc[record.normalizedClassification] = (acc[record.normalizedClassification] || 0) + 1;
        return acc;
      }, {});
      state.graph[key] = { status: 'ready', total: records.length, counts, records };
      state.cards[key] = {
        status: 'ready',
        count: String(records.length),
        latest: records[0] ? `Latest report: ${records[0].date}` : 'No recent records returned.',
      };
    } catch (error) {
      state.graph[key] = { status: 'error', total: 0, counts: {}, records: [] };
      state.cards[key] = { status: 'error', error: error.message || 'Could not load this category.' };
    }
    renderEnforcementGraph();
    renderGraphDetail();
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

if (!location.hash) location.hash = '#/dashboard';
shell();
renderRoute();
renderCategoryGrid();
renderEnforcementGraph();
renderGraphDetail();
loadOverview();
runSearch();
