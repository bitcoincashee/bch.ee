/* ===========================
   BCH Parasite Pool — App
   =========================== */

const API_BASE = 'https://para.bch.ee';

// ── Disclaimer ───────────────────────────────────────────

const DISCLAIMER_HTML = `
  <span class="disclaimer-icon">⚠️</span>
  <div>
    <strong>Disclaimer</strong>
    <p>Participation in Bitcoin Cash mining, including through bch.ee Parasite Pool, which is still considered in beta testing, involves risks such as market volatility, hardware failure, and changes in network difficulty. bch.ee Parasite Pool is in beta and has not yet found a block; there is no assurance of future block discoveries or payouts. Users should exercise caution and consider their financial situation before engaging in mining activities.</p>
    <p style="margin-top:.75rem">bch.ee Parasite Pool shall not be held responsible for any losses, missed payouts, technical failures, or interruptions of service of any kind. That said, we are committed to acting in good faith — if an error occurs on our end, we will make every reasonable effort to investigate and make it right.</p>
  </div>
`;

document.querySelectorAll('.disclaimer-placeholder').forEach(el => {
  el.className = 'disclaimer';
  el.innerHTML = DISCLAIMER_HTML;
});

// ── Navigation ──────────────────────────────────────────

const navBtns = document.querySelectorAll('.nav-btn');
const sections = document.querySelectorAll('.section');

function showSection(id) {
  sections.forEach(s => s.classList.toggle('active', s.id === id));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.section === id));
  if (id === 'blocks') loadBlocks();
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// Handle hash-based navigation
function routeFromHash() {
  const hash = location.hash.replace('#', '') || 'home';
  const valid = ['home', 'connect', 'mystats', 'blocks', 'faq'];
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
document.querySelectorAll('.bitaxe-field input, .avalon-field input, .nicehash-field input').forEach(input => {
  input.addEventListener('click', () => input.select());
});

let poolLns        = null;  // total pool shares (lns) — set when pool stats load
let poolReward     = null;  // actual block reward from API
let userPayoutFinder = null;  // BCH payout if user finds block
let userPayoutShare  = null;  // BCH payout if someone else finds block

// ── Pool Stats ──────────────────────────────────────────

function formatDiff(d) {
  if (d >= 1e12) return (d / 1e12).toFixed(2) + ' T';
  if (d >= 1e9)  return (d / 1e9).toFixed(2)  + ' G';
  if (d >= 1e6)  return (d / 1e6).toFixed(2)  + ' M';
  if (d >= 1e3)  return (d / 1e3).toFixed(2)  + ' K';
  return d.toFixed(0);
}

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
  return hps > 0 ? formatHashrate(hps) : str;
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
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
    setStatValue('stat-users',    pool.Users    ?? pool.users    ?? '—');
    setStatValue('stat-uptime',   formatUptime(pool.runtime));
    setStatValue('stat-bestshare', formatDiffCompact(pool.bestshare));
    const blocksFound = pool.blocks ?? (Array.isArray(pool.solved) ? pool.solved.length : null);
    setStatValue('stat-blocks', blocksFound ?? 0);

    const height = pool.height ?? pool.blockheight ?? pool.current_height ?? pool.best_height;
    setStatValue('stat-height', height != null ? height.toLocaleString() : '—');

    const diff = pool.diff ?? pool.difficulty;
    setStatValue('stat-diff', diff != null && diff !== '0.00' ? formatDiff(parseFloat(diff)) : '—');

    poolLns    = pool.lns ?? pool.shares ?? null;
    poolReward = pool.reward ?? null;

    const hashrate = pool.hashrate5m ?? pool.hashrate1m;
    if (hashrate) loadDailyLuck(hashrate);

    document.getElementById('pool-status-banner').classList.add('hidden');

  } catch (err) {
    console.warn('Pool status unavailable:', err.message);
    showPoolWarming();
  }
}

function showPoolWarming() {
  document.getElementById('pool-status-banner').classList.remove('hidden');
  ['stat-hashrate','stat-workers','stat-users','stat-blocks','stat-uptime','stat-bestshare','stat-luck','stat-pool-chance-day','stat-pool-chance-week','stat-pool-chance-month'].forEach(id => {
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

function relativeTime(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
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
  document.getElementById('user-payout-grid').classList.add('hidden');
  document.getElementById('user-chance-grid').classList.add('hidden');
  document.getElementById('user-workers-card').classList.add('hidden');
  userPayoutFinder = null;
  userPayoutShare  = null;
  document.getElementById('user-payout-finder-usd').textContent = 'your share + 1 BCH bonus';
  document.getElementById('user-payout-share-usd').textContent  = 'your proportional share only';
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
    if (rawHashrate != null) {
      chanceGrid.classList.remove('hidden');
      loadUserChance(rawHashrate);
    } else {
      chanceGrid.classList.add('hidden');
    }

    // Expected payout calculation
    const payoutGrid = document.getElementById('user-payout-grid');
    const userLns = data.lns ?? data.shares ?? null;
    if (userLns != null && poolLns != null && poolLns > 0) {
      const BLOCK_REWARD = poolReward ?? 3.125;
      const FINDER_BONUS = 1;
      const POOL_FEE     = 0.99;
      const base = (BLOCK_REWARD - FINDER_BONUS) * POOL_FEE * (userLns / poolLns);
      userPayoutFinder = base + FINDER_BONUS;
      userPayoutShare  = base;
      document.getElementById('user-payout-finder').textContent = userPayoutFinder.toFixed(6) + ' BCH';
      document.getElementById('user-payout-share').textContent  = userPayoutShare.toFixed(6) + ' BCH';
      payoutGrid.classList.remove('hidden');
    } else {
      payoutGrid.classList.add('hidden');
    }

    grid.classList.remove('hidden');

    // Workers table
    const workersCard  = document.getElementById('user-workers-card');
    const workersTable = document.getElementById('user-workers-table');
    const workerList   = Array.isArray(data.worker) ? data.worker : [];
    const activeWorkers = workerList.filter(w => parseFloat(w.hashrate7d) !== 0);
    if (activeWorkers.length > 0) {
      workersTable.innerHTML = `
        <thead><tr>
          <th>Worker</th>
          <th>1m</th><th>5m</th><th>1hr</th><th>1d</th><th>7d</th>
        </tr></thead>
        <tbody>${activeWorkers.map(w => {
          const name = w.workername.includes('.') ? w.workername.split('.').pop() : w.workername;
          return `<tr>
            <td>${name}</td>
            <td>${parseHashrateStr(w.hashrate1m)}</td>
            <td>${parseHashrateStr(w.hashrate5m)}</td>
            <td>${parseHashrateStr(w.hashrate1hr)}</td>
            <td>${parseHashrateStr(w.hashrate1d)}</td>
            <td>${parseHashrateStr(w.hashrate7d)}</td>
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

    if (d.price != null) {
      const fmt = bch => '$' + (bch * d.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (userPayoutFinder != null)
        document.getElementById('user-payout-finder-usd').innerHTML = fmt(userPayoutFinder) + '<br>your share + 1 BCH bonus';
      if (userPayoutShare != null)
        document.getElementById('user-payout-share-usd').innerHTML  = fmt(userPayoutShare)  + '<br>your proportional share only';
    }
  } catch (e) {
    console.warn('User chance unavailable:', e.message);
  }
}

// ── Blocks ──────────────────────────────────────────────

let blocksLoaded = false;

async function loadBlocks() {
  if (blocksLoaded) return;

  const banner = document.getElementById('blocks-status-banner');
  const list   = document.getElementById('blocks-list');
  const empty  = document.getElementById('blocks-empty');

  try {
    const resp = await fetch(`${API_BASE}/pool/pool.status`, { cache: 'no-cache' });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const text = await resp.text();
    const pool = {};
    text.trim().split('\n').forEach(line => {
      try { Object.assign(pool, JSON.parse(line)); } catch {}
    });

    // ckpool exposes solved blocks in the top-level response
    const solved = pool.solved ?? pool.blocks_solved ?? [];

    if (!Array.isArray(solved) || solved.length === 0) {
      empty.classList.remove('hidden');
      blocksLoaded = true;
      return;
    }

    list.innerHTML = '';
    solved.slice().reverse().forEach(b => {
      const row = document.createElement('div');
      row.className = 'block-row';
      const hash  = b.hash  ?? b.blockhash ?? '—';
      const height= b.height ?? b.block_height ?? '—';
      const when  = b.createdate ?? b.time ?? b.timestamp;
      const finder= b.username ?? b.worker ?? '';
      row.innerHTML = `
        <div>
          <div class="block-height">Block #${height}</div>
          <div class="block-hash">${hash}</div>
          ${finder ? `<div class="block-meta" style="margin-top:.3rem">⛏ ${finder}</div>` : ''}
        </div>
        <div class="block-meta">${when ? new Date(when * 1000).toLocaleString() : ''}</div>
      `;
      list.appendChild(row);
    });

    blocksLoaded = true;

  } catch (err) {
    console.warn('Blocks unavailable:', err.message);
    banner.classList.remove('hidden');
  }
}
