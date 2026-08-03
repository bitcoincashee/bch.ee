/* ===========================
   BCH Parasite Pool — App
   =========================== */

const API_BASE = 'https://para.bch.ee';
const EXPLORER_BLOCK_URL = 'https://bchexplorer.cash/block';

// ── Disclaimer ───────────────────────────────────────────

const DISCLAIMER_HTML = `
  <span class="disclaimer-icon">⚠️</span>
  <div>
    <strong>Disclaimer</strong>
    <p>Participation in Bitcoin Cash mining, including through bch.ee Parasite Pool, which is still considered in beta testing, involves risks such as market volatility, hardware failure, and changes in network difficulty. bch.ee Parasite Pool is in beta and has not yet found a block; there is no assurance of future block discoveries or payouts. Users should exercise caution and consider their financial situation before engaging in mining activities.</p>
    <p style="margin-top:.75rem">bch.ee Parasite Pool shall not be held responsible for any losses, missed payouts, technical failures, or interruptions of service of any kind.</p>
  </div>
`;

document.querySelectorAll('.disclaimer-placeholder').forEach(el => {
  el.className = 'disclaimer';
  el.innerHTML = DISCLAIMER_HTML;
});

// ── pool.work (payouts/postponed membership for this round) ─

let poolWorkCache   = null;
let poolWorkPromise = null;

function getPoolWork() {
  if (poolWorkCache) return Promise.resolve(poolWorkCache);
  if (!poolWorkPromise) {
    poolWorkPromise = fetch(`${API_BASE}/pool/pool.work`, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(w => { poolWorkCache = w; return w; })
      .catch(() => null);
  }
  return poolWorkPromise;
}

// ── pool/blocks/ (found blocks) ──────────────────────────────
// /pool/blocks/ is an nginx autoindex JSON listing of one file per found
// block, named "<height>.confirmed" or "<height>.unconfirmed". The listing
// itself carries no block data — each file has to be fetched separately for
// its hash/finder/time.

let foundBlocksPromise = null;

function parseBlockEntry(entry) {
  const m = /^(\d+)\.(confirmed|unconfirmed)$/.exec(entry.name ?? '');
  if (!m) return null;
  return { name: entry.name, height: parseInt(m[1], 10), confirmed: m[2] === 'confirmed' };
}

// Not cached beyond de-duping simultaneous callers — loadPoolStats() polls
// this every 30s for the home page's live block count, so a persistent
// cache would freeze that count at whatever it read on the first load.
function getFoundBlocks() {
  if (!foundBlocksPromise) {
    foundBlocksPromise = fetch(`${API_BASE}/pool/blocks/`, { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(entries => (Array.isArray(entries) ? entries : [])
        .filter(e => e.type === 'file')
        .map(parseBlockEntry)
        .filter(Boolean)
        .sort((a, b) => a.height - b.height))
      .finally(() => { foundBlocksPromise = null; });
  }
  return foundBlocksPromise;
}

const blockDetailsCache = new Map();

function getBlockDetails(entry) {
  if (!blockDetailsCache.has(entry.name)) {
    blockDetailsCache.set(entry.name, fetch(`${API_BASE}/pool/blocks/${entry.name}`, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(data => ({ ...entry, ...data }))
      .catch(() => entry));
  }
  return blockDetailsCache.get(entry.name);
}

// ── State ────────────────────────────────────────────────

let poolLns          = null;  // total pool shares (herp) — set when pool stats load
let poolReward       = null;  // actual block reward from API
let userPayoutFinder = null;  // BCH payout if user finds block
let userPayoutShare  = null;  // BCH payout if someone else finds block
let bchPrice         = null;  // BCH price in USD
let blocksLoaded     = false;
let bestSharesLoaded = false;

// ── Navigation ──────────────────────────────────────────

const navBtns = document.querySelectorAll('.nav-btn');
const sections = document.querySelectorAll('.section');

function showSection(id) {
  sections.forEach(s => s.classList.toggle('active', s.id === id));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.section === id));
  if (id === 'blocks') loadBlocks();
  if (id === 'bestshares') loadBestShares();
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// Handle hash-based navigation
function routeFromHash() {
  const hash = location.hash.replace('#', '') || 'home';
  const valid = ['home', 'connect', 'mystats', 'blocks', 'bestshares', 'faq'];
  showSection(valid.includes(hash) ? hash : 'home');
}
window.addEventListener('hashchange', routeFromHash);
routeFromHash();

// ── Config tabs ──────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    const card = btn.closest('.card');
    card.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    card.querySelectorAll('.config-block').forEach(block => {
      block.classList.toggle('active', block.id === `tab-${tab}`);
    });
  });
});

// FAQ internal nav buttons
document.querySelectorAll('.faq-link-btn').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// Make Bitaxe / Avalon / NiceHash inputs selectable for easy copy
document.querySelectorAll('.bitaxe-field input, .avalon-field input, .braiins-field input, .nicehash-field input').forEach(input => {
  input.addEventListener('click', () => input.select());
});

// ── Pool Stats ──────────────────────────────────────────

function hashrateToHps(str) {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  const match = String(str).match(/^([\d.]+)\s*([KMGTP]?)$/i);
  if (!match) return 0;
  const units = { '': 1, 'K': 1e3, 'M': 1e6, 'G': 1e9, 'T': 1e12, 'P': 1e15 };
  return parseFloat(match[1]) * (units[match[2].toUpperCase()] ?? 1);
}

function parseHashrateStr(str) {
  if (str == null) return '—';
  const hps = hashrateToHps(str);
  return hps > 0 ? formatHashrate(hps) : '0 H/s';
}

function formatHashrate(hps) {
  if (hps == null || isNaN(hps)) return '—';
  if (hps >= 1e18) return (hps / 1e18).toFixed(2) + ' EH/s';
  if (hps >= 1e15) return (hps / 1e15).toFixed(2) + ' PH/s';
  if (hps >= 1e12) return (hps / 1e12).toFixed(2) + ' TH/s';
  if (hps >= 1e9)  return (hps / 1e9).toFixed(2)  + ' GH/s';
  if (hps >= 1e6)  return (hps / 1e6).toFixed(2)  + ' MH/s';
  if (hps >= 1e3)  return (hps / 1e3).toFixed(2)  + ' KH/s';
  return hps.toFixed(0) + ' H/s';
}

function formatDiffCompact(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'G';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2)  + 'K';
  return n.toFixed(0);
}

function formatUptime(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? 'day' : 'days'}`;
  if (h > 0) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = el.querySelector('.stat-value');
  if (valEl) {
    valEl.textContent = value;
    valEl.classList.remove('skeleton');
  }
}

async function loadPoolStats() {
  try {
    const resp = await fetch(`${API_BASE}/pool/pool.status`, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    // API returns multiple JSON objects separated by newlines — merge them all
    const pool = {};
    text.trim().split('\n').forEach(line => {
      try { Object.assign(pool, JSON.parse(line)); } catch {}
    });

    setStatValue('stat-hashrate', parseHashrateStr(pool.hashrate5m ?? pool.hashrate1m));
    setStatValue('stat-workers',  pool.Workers  ?? pool.workers  ?? '—');
    setStatValue('stat-uptime',   formatUptime(pool.runtime));
    setStatValue('stat-bestshare', formatDiffCompact(pool.bestshare));
    getFoundBlocks()
      .then(blocks => setStatValue('stat-blocks', blocks.length))
      .catch(() => setStatValue('stat-blocks', pool.blocks ?? 0));

    const effort = parseFloat(pool.diff ?? pool.difficulty);
    setStatValue('stat-effort', effort > 0 ? effort + '%' : '< 0.01%');

    poolLns    = pool.herp ?? pool.lns ?? pool.shares ?? null;
    poolReward = pool.reward ?? null;

    const hashrate = pool.hashrate5m ?? pool.hashrate1m;
    if (hashrateToHps(hashrate)) loadDailyLuck(hashrate);

    document.getElementById('pool-status-banner').classList.add('hidden');

  } catch (err) {
    console.warn('Pool status unavailable:', err.message);
    showPoolWarming();
  }
}

function showPoolWarming() {
  document.getElementById('pool-status-banner').classList.remove('hidden');
  ['stat-hashrate','stat-workers','stat-blocks','stat-uptime','stat-bestshare','stat-effort','stat-luck','stat-pool-chance-day','stat-pool-chance-week','stat-pool-chance-month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const v = el.querySelector('.stat-value');
      if (v) { v.textContent = '—'; v.classList.add('skeleton'); }
    }
  });
}

async function loadDailyLuck(poolHps) {
  try {
    const thps = hashrateToHps(poolHps) / 1e12;
    const url  = `https://api.solochance.org/getSoloChanceCalculations?currency=BCH&hashrate=${thps.toFixed(6)}&hashrateUnit=TH`;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return;
    const d = await resp.json();

    // Expected blocks per day = pool share of network * 144 blocks/day
    const blocksPerDay = d.currentHashrate / d.networkHashrate * 144;

    let display;
    if (blocksPerDay >= 10) {
      display = blocksPerDay.toFixed(0) + ' / day';
    } else if (blocksPerDay >= 1) {
      display = blocksPerDay.toFixed(1) + ' / day';
    } else {
      const days = 1 / blocksPerDay;
      if (days < 2)       display = (days * 24).toFixed(1) + ' hr avg';
      else if (days < 60) display = days.toFixed(1) + ' day avg';
      else                display = (days / 30).toFixed(1) + ' mo avg';
    }

    setStatValue('stat-luck', display);
    setStatValue('stat-pool-chance-day',   d.dayChanceText   ?? '—');
    setStatValue('stat-pool-chance-week',  d.weekChanceText  ?? '—');
    setStatValue('stat-pool-chance-month', d.monthChanceText ?? '—');

    if (d.price != null) {
      bchPrice = d.price;
      const priceEl = document.querySelector('#stat-price .stat-value');
      if (priceEl) {
        priceEl.textContent = '$' + d.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        priceEl.classList.remove('skeleton');
      }
    }

    if (d.networkHashrate != null) {
      setStatValue('stat-nethash', formatHashrate(d.networkHashrate));
    }

  } catch (e) {
    console.warn('Daily luck unavailable:', e.message);
  }
}

loadPoolStats();
// Refresh every 30 seconds
setInterval(loadPoolStats, 30_000);

// ── My Stats ──────────────────────────────────────────

const lookupBtn  = document.getElementById('lookup-btn');
const addrInput  = document.getElementById('address-input');

lookupBtn.addEventListener('click', doLookup);
addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });

function goToMyStats(address) {
  addrInput.value = address;
  showSection('mystats');
  doLookup();
}

function relativeTime(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 0) return 'just now';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  if (h > 0) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  if (m > 0) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  return 'Now';
}

const FINDER_CAPTION = '1 BCH bonus + your share';
const SHARE_CAPTION  = 'your proportional share only';

function updatePayoutUsd(price) {
  if (price == null) return;
  const fmt = bch => '$' + (bch * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (userPayoutFinder != null)
    document.getElementById('user-payout-finder-usd').innerHTML = fmt(userPayoutFinder) + '<br>' + FINDER_CAPTION;
  if (userPayoutShare != null)
    document.getElementById('user-payout-share-usd').innerHTML = fmt(userPayoutShare) + '<br>' + SHARE_CAPTION;
}

async function doLookup() {
  const addr = addrInput.value.trim();
  if (!addr) { addrInput.focus(); return; }

  const banner  = document.getElementById('user-status-banner');
  const grid    = document.getElementById('user-stats-grid');
  const details = document.getElementById('user-details-card');

  // Reset
  banner.classList.add('hidden');
  grid.classList.add('hidden');
  details.classList.add('hidden');
  document.getElementById('user-payout-note').classList.add('hidden');
  document.getElementById('user-payout-grid').classList.add('hidden');
  document.getElementById('user-chance-grid').classList.add('hidden');
  document.getElementById('user-workers-card').classList.add('hidden');
  userPayoutFinder = null;
  userPayoutShare  = null;
  document.getElementById('user-payout-finder-usd').textContent = FINDER_CAPTION;
  document.getElementById('user-payout-share-usd').textContent  = SHARE_CAPTION;
  ['user-chance-day','user-chance-week','user-chance-month'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = '—';
    el.classList.add('skeleton');
  });
  lookupBtn.disabled = true;
  lookupBtn.textContent = 'Loading…';

  try {
    const resp = await fetch(`${API_BASE}/users/${encodeURIComponent(addr)}`, { cache: 'no-cache' });

    lookupBtn.disabled = false;
    lookupBtn.textContent = 'Look Up';

    if (resp.status === 404) {
      document.getElementById('user-status-msg').textContent =
        "This address hasn't been seen by the pool yet, or the node is still warming up.";
      banner.classList.remove('hidden');
      return;
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    // Populate stats — field names vary by pool software; try multiple keys
    document.getElementById('user-hashrate').textContent =
      parseHashrateStr(data.hashrate5m ?? data.hashrate1m ?? data.hashrate ?? data.workerHashrate);

    document.getElementById('user-workers').textContent =
      data.workers ?? data.worker_count ?? 1;

    document.getElementById('user-lastseen').textContent =
      relativeTime(data.lastshare ?? data.last_share ?? data.lastShareTime);

    // Block chance calculation
    const rawHashrate = data.hashrate5m ?? data.hashrate1m ?? data.hashrate ?? data.workerHashrate;
    const chanceGrid = document.getElementById('user-chance-grid');
    if (hashrateToHps(rawHashrate)) {
      chanceGrid.classList.remove('hidden');
      loadUserChance(rawHashrate);
    } else {
      chanceGrid.classList.add('hidden');
    }

    // Expected payout calculation
    const payoutGrid = document.getElementById('user-payout-grid');
    const userLns = data.herp ?? data.lns ?? data.shares ?? null;
    if (userLns != null && poolLns != null && poolLns > 0) {
      const BLOCK_REWARD = poolReward ?? 3.125;
      const FINDER_BONUS = 1;
      const POOL_FEE     = 0.99;
      const base = (BLOCK_REWARD - FINDER_BONUS) * POOL_FEE * (userLns / poolLns);
      userPayoutFinder = base + FINDER_BONUS;
      userPayoutShare  = base;

      document.getElementById('user-payout-finder').textContent = userPayoutFinder.toFixed(6) + ' BCH';
      document.getElementById('user-payout-share').textContent  = userPayoutShare.toFixed(6) + ' BCH';
      document.getElementById('user-payout-finder-usd').textContent = FINDER_CAPTION;
      document.getElementById('user-payout-share-usd').textContent  = SHARE_CAPTION;
      payoutGrid.classList.remove('hidden');
      document.getElementById('user-payout-note').classList.remove('hidden');
    } else {
      payoutGrid.classList.add('hidden');
    }

    // Show USD values from cached price when hashrate is zero (loadUserChance won't run or bails early)
    if (!hashrateToHps(rawHashrate) && bchPrice != null) {
      updatePayoutUsd(bchPrice);
    }

    grid.classList.remove('hidden');

    // Workers table
    const workersCard  = document.getElementById('user-workers-card');
    const workersTable = document.getElementById('user-workers-table');
    const workerList   = Array.isArray(data.worker) ? data.worker : [];
    const activeWorkers = workerList.filter(w => parseFloat(w.hashrate1hr || 0) !== 0 || (w.bestshare_alltime ?? w.bestshare ?? 0) > 0);
    if (activeWorkers.length > 0) {
      workersTable.innerHTML = `
        <thead><tr>
          <th>Worker</th>
          <th>1m</th><th>5m</th><th>1hr</th><th>Current Best</th><th>Best Ever</th>
        </tr></thead>
        <tbody>${activeWorkers.map(w => {
          const wn = w.workername ?? '';
          const name = wn.includes('.') ? wn.split('.').pop() : wn;
          return `<tr>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(parseHashrateStr(w.hashrate1m))}</td>
            <td>${escapeHtml(parseHashrateStr(w.hashrate5m))}</td>
            <td>${escapeHtml(parseHashrateStr(w.hashrate1hr))}</td>
            <td>${formatDiffCompact(w.bestshare ?? 0)}</td>
            <td>${formatDiffCompact(w.bestshare_alltime ?? w.bestshare ?? 0)}</td>
          </tr>`;
        }).join('')}</tbody>`;
      workersCard.classList.remove('hidden');
    } else {
      workersCard.classList.add('hidden');
    }

    // Show curl command and raw JSON for transparency
    document.getElementById('user-curl').textContent =
      `curl "${API_BASE}/users/${encodeURIComponent(addr)}"`;
    document.getElementById('user-raw').textContent = JSON.stringify(data, null, 2);
    details.classList.remove('hidden');

  } catch (err) {
    console.warn('User lookup failed:', err.message);
    lookupBtn.disabled = false;
    lookupBtn.textContent = 'Look Up';
    document.getElementById('user-status-msg').textContent =
      'Could not reach the pool API. It may still be warming up.';
    banner.classList.remove('hidden');
  }
}

async function loadUserChance(hashrateStr) {
  const thps = hashrateToHps(hashrateStr) / 1e12;
  if (!thps) return;
  try {
    const url  = `https://api.solochance.org/getSoloChanceCalculations?currency=BCH&hashrate=${thps.toFixed(6)}&hashrateUnit=TH`;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return;
    const d = await resp.json();

    document.getElementById('user-chance-day').textContent   = d.dayChanceText   ?? '—';
    document.getElementById('user-chance-week').textContent  = d.weekChanceText  ?? '—';
    document.getElementById('user-chance-month').textContent = d.monthChanceText ?? '—';

    ['user-chance-day','user-chance-week','user-chance-month'].forEach(id => {
      document.getElementById(id).classList.remove('skeleton');
    });

    updatePayoutUsd(d.price);
  } catch (e) {
    console.warn('User chance unavailable:', e.message);
  }
}

// ── Blocks ──────────────────────────────────────────────

async function loadBlocks() {
  if (blocksLoaded) return;

  const banner  = document.getElementById('blocks-status-banner');
  const loading = document.getElementById('blocks-loading');
  const list    = document.getElementById('blocks-list');
  const empty   = document.getElementById('blocks-empty');

  // Reset UI in case this is a retry after a previous failed attempt
  // (blocksLoaded stays false on error, so the Blocks tab can re-trigger this)
  banner.classList.add('hidden');
  empty.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const entries = await getFoundBlocks();

    const countEl = document.getElementById('blocks-total-count');
    if (countEl) countEl.textContent = entries.length;

    if (!Array.isArray(entries) || entries.length === 0) {
      loading.classList.add('hidden');
      empty.classList.remove('hidden');
      blocksLoaded = true;
      return;
    }

    const details = await Promise.all(entries.map(getBlockDetails));

    loading.classList.add('hidden');
    list.innerHTML = '';
    details.slice().reverse().forEach(b => {
      const hash      = b.hash   ?? null;
      const height    = b.height ?? null;
      const when      = b.time ?? b.createdate ?? b.timestamp;
      const finder    = b.finder_address ?? b.solvedby ?? '';
      const confirmed = b.confirmed;

      // Link the row to its BCH Explorer page when we have an id to point at
      const explorerId = height ?? hash;
      const row = document.createElement(explorerId ? 'a' : 'div');
      row.className = 'block-row';
      if (explorerId) {
        row.href = `${EXPLORER_BLOCK_URL}/${explorerId}`;
        row.target = '_blank';
        row.rel = 'noopener';
      }

      const left = document.createElement('div');
      const heightEl = document.createElement('div');
      heightEl.className = 'block-height';
      heightEl.textContent = 'Block #' + (height ?? '—');
      const hashEl = document.createElement('div');
      hashEl.className = 'block-hash';
      hashEl.textContent = hash ?? '—';
      left.appendChild(heightEl);
      left.appendChild(hashEl);
      if (finder) {
        const finderEl = document.createElement('div');
        finderEl.className = 'block-meta';
        finderEl.style.marginTop = '.3rem';
        finderEl.textContent = '⛏ ' + finder;
        left.appendChild(finderEl);
      }

      const right = document.createElement('div');
      right.style.textAlign = 'right';
      const statusEl = document.createElement('div');
      statusEl.className = 'block-status' + (confirmed ? ' confirmed' : '');
      statusEl.textContent = confirmed ? 'Confirmed' : 'Unconfirmed';
      const whenEl = document.createElement('div');
      whenEl.className = 'block-meta';
      whenEl.style.marginTop = '.3rem';
      whenEl.textContent = when ? new Date(when * 1000).toLocaleString() : '';
      right.appendChild(statusEl);
      right.appendChild(whenEl);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    blocksLoaded = true;

  } catch (err) {
    console.warn('Blocks unavailable:', err.message);
    loading.classList.add('hidden');
    banner.classList.remove('hidden');
  }
}

// ── Best Shares ──────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadBestShares() {
  if (bestSharesLoaded) return;
  bestSharesLoaded = true;

  const loading = document.getElementById('bestshares-loading');
  const tableCard = document.getElementById('bestshares-table-card');
  const table = document.getElementById('bestshares-table');

  try {
    // Fetch pool.work and pool.status in parallel
    const [work, statusResp] = await Promise.all([
      getPoolWork(),
      fetch(`${API_BASE}/pool/pool.status`, { cache: 'no-cache' }),
    ]);

    if (!work) throw new Error('Failed to fetch pool.work');

    const statusText = await statusResp.text();

    const addresses = Object.keys(work.payouts ?? {});

    const pool = {};
    statusText.trim().split('\n').forEach(line => {
      try { Object.assign(pool, JSON.parse(line)); } catch {}
    });

    const diffPercent = parseFloat(pool.diff);
    const accepted = pool.accepted;
    const networkDiff = (diffPercent > 0 && accepted > 0) ? accepted / (diffPercent / 100) : 874000000000;

    const BLOCK_REWARD = poolReward ?? 3.125;
    const bsMedals = ['🏆', '🥈', '🥉'];

    // addr → row object once loaded, null if fetch returned no useful data, absent if pending
    const userData = new Map();

    let sortCol = 'bestshare';
    let sortDir = -1;

    function sortRows(rows) {
      return [...rows].sort((a, b) => {
        let av, bv;
        if (sortCol === 'hashrate') {
          av = hashrateToHps(a.hashrate1m);
          bv = hashrateToHps(b.hashrate1m);
        } else if (sortCol === 'bestshare') {
          av = a.bestshare;
          bv = b.bestshare;
        } else {
          av = (a.userLns != null && poolLns > 0) ? a.userLns / poolLns : 0;
          bv = (b.userLns != null && poolLns > 0) ? b.userLns / poolLns : 0;
        }
        return (av - bv) * sortDir;
      });
    }

    function renderRow(r, rank, top3) {
      const pct = (r.bestshare / networkDiff * 100);
      const pctRaw = pct >= 0.001 ? pct.toFixed(3) + '%' : '&lt; 0.001%';
      const pctTip = pct > 100
        ? ` <span class="info-tip" data-tip="This share was sent before the last target was lowered">i</span>`
        : '';
      const hps = hashrateToHps(r.hashrate1m);
      const icon = hps > 0 ? '<span class="miner-active-icon">⛏️</span>' : '<span class="miner-idle-icon">💤</span>';
      const medal = bsMedals[top3.indexOf(r.address)];
      const bsCell = medal ? medal + ' ' + formatDiffCompact(r.bestshare) : formatDiffCompact(r.bestshare);
      let payoutStr = '—';
      if (r.userLns != null && poolLns != null && poolLns > 0) {
        const base = (BLOCK_REWARD - 1) * 0.99 * (r.userLns / poolLns);
        payoutStr = base.toFixed(8) + ' BCH';
      }
      return `<tr>
        <td>${rank}</td>
        <td><code class="bs-address" data-address="${escapeHtml(r.address)}">${escapeHtml(r.address)}</code></td>
        <td>${icon} ${escapeHtml(parseHashrateStr(r.hashrate1m))}</td>
        <td class="col-bs">${bsCell}</td>
        <td class="col-bs">${pctRaw}${pctTip}</td>
        <td class="col-payout">${payoutStr}</td>
        <td class="col-payout">${r.userLns != null ? formatDiffCompact(r.userLns) : '—'}</td>
      </tr>`;
    }

    function renderPendingRow(addr, rank) {
      return `<tr>
        <td>${rank}</td>
        <td><code class="bs-address" data-address="${escapeHtml(addr)}">${escapeHtml(addr)}</code></td>
        <td class="bs-pending">—</td>
        <td class="col-bs bs-pending">—</td>
        <td class="col-bs bs-pending">—</td>
        <td class="col-payout bs-pending">—</td>
        <td class="col-payout bs-pending">—</td>
      </tr>`;
    }

    function renderBestSharesBody() {
      const loaded = [];
      const pending = [];
      for (const addr of addresses) {
        if (!userData.has(addr)) pending.push(addr);
        else if (userData.get(addr) !== null) loaded.push(userData.get(addr));
      }

      const top3 = [...loaded]
        .sort((a, b) => b.bestshare - a.bestshare)
        .slice(0, 3)
        .map(r => r.address);

      const sortedLoaded = sortRows(loaded);

      table.querySelectorAll('th[data-sort]').forEach(th => {
        const active = th.dataset.sort === sortCol;
        th.classList.toggle('sort-active', active);
        th.textContent = th.dataset.label + (active ? (sortDir === -1 ? ' ▼' : ' ▲') : '');
      });

      let rank = 1;
      let html = '';
      html += sortedLoaded.map(r => renderRow(r, rank++, top3)).join('');
      html += pending.map(a => renderPendingRow(a, rank++)).join('');

      table.querySelector('tbody').innerHTML = html;
    }

    table.innerHTML = `
      <thead><tr>
        <th>#</th>
        <th>Address</th>
        <th data-sort="hashrate" data-label="Hashrate" class="sort-th">Hashrate</th>
        <th data-sort="bestshare" data-label="Best Share" class="sort-th col-bs">Best Share</th>
        <th class="col-bs">% of Net Diff</th>
        <th data-sort="payout" data-label="Est. Payout" class="sort-th col-payout">Est. Payout</th>
        <th class="col-payout">Work Done</th>
      </tr></thead>
      <tbody></tbody>`;

    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (sortCol === th.dataset.sort) sortDir *= -1;
        else { sortCol = th.dataset.sort; sortDir = -1; }
        renderBestSharesBody();
      });
    });

    // tbody is re-rendered on sort, so delegate from the table itself
    table.addEventListener('click', e => {
      const addrEl = e.target.closest('.bs-address');
      if (addrEl) goToMyStats(addrEl.dataset.address);
    });

    loading.classList.add('hidden');
    tableCard.classList.remove('hidden');
    renderBestSharesBody();

    // Fetch each user individually; update their row as data arrives
    addresses.forEach(addr => {
      fetch(`${API_BASE}/users/${encodeURIComponent(addr)}`, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          userData.set(addr, (data && data.bestshare > 0) ? {
            address:    addr,
            bestshare:  data.bestshare,
            hashrate1m: data.hashrate1m ?? null,
            userLns:    data.herp ?? data.lns ?? data.shares ?? null
          } : null);
          renderBestSharesBody();
        })
        .catch(() => { userData.set(addr, null); renderBestSharesBody(); });
    });

  } catch (err) {
    bestSharesLoaded = false;
    console.warn('Best shares unavailable:', err.message);
    loading.textContent = 'Could not load best shares.';
  }
}
