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
    const blocksFound = pool.blocks ?? (Array.isArray(pool.solved) ? pool.solved.length : null);
    setStatValue('stat-blocks', blocksFound ?? 0);

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
  document.getElementById('user-payout-finder-usd').textContent = '1 BCH bonus + your share';
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
      payoutGrid.classList.remove('hidden');
      document.getElementById('user-payout-note').classList.remove('hidden');
    } else {
      payoutGrid.classList.add('hidden');
    }

    // Show USD values from cached price when hashrate is zero (loadUserChance won't run or bails early)
    if (!hashrateToHps(rawHashrate) && bchPrice != null) {
      const fmt = bch => '$' + (bch * bchPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (userPayoutFinder != null)
        document.getElementById('user-payout-finder-usd').innerHTML = fmt(userPayoutFinder) + '<br>1 BCH bonus + your share';
      if (userPayoutShare != null)
        document.getElementById('user-payout-share-usd').innerHTML  = fmt(userPayoutShare)  + '<br>your proportional share only';
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

    if (d.price != null) {
      const fmt = bch => '$' + (bch * d.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (userPayoutFinder != null)
        document.getElementById('user-payout-finder-usd').innerHTML = fmt(userPayoutFinder) + '<br>1 BCH bonus + your share';
      if (userPayoutShare != null)
        document.getElementById('user-payout-share-usd').innerHTML  = fmt(userPayoutShare)  + '<br>your proportional share only';
    }
  } catch (e) {
    console.warn('User chance unavailable:', e.message);
  }
}

// ── Blocks ──────────────────────────────────────────────

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
      const hash   = b.hash  ?? b.blockhash ?? '—';
      const height = b.height ?? b.block_height ?? '—';
      const when   = b.createdate ?? b.time ?? b.timestamp;
      const finder = b.username ?? b.worker ?? '';

      const left = document.createElement('div');
      const heightEl = document.createElement('div');
      heightEl.className = 'block-height';
      heightEl.textContent = 'Block #' + height;
      const hashEl = document.createElement('div');
      hashEl.className = 'block-hash';
      hashEl.textContent = hash;
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
      right.className = 'block-meta';
      right.textContent = when ? new Date(when * 1000).toLocaleString() : '';

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    blocksLoaded = true;

  } catch (err) {
    console.warn('Blocks unavailable:', err.message);
    banner.classList.remove('hidden');
  }
}

// ── Best Shares ──────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function maskAddress(addr) {
  const prefix = addr.startsWith('bitcoincash:') ? 'bitcoincash:' : '';
  const clean = addr.replace(/^bitcoincash:/, '');
  if (clean.length <= 10) return addr;
  return prefix + clean.slice(0, 5) + '...' + clean.slice(-5);
}

async function loadBestShares() {
  if (bestSharesLoaded) return;

  const loading = document.getElementById('bestshares-loading');
  const tableCard = document.getElementById('bestshares-table-card');
  const table = document.getElementById('bestshares-table');

  try {
    // Step 1: Get all addresses from pool.work
    const workResp = await fetch(`${API_BASE}/pool/pool.work`, { cache: 'no-cache' });
    if (!workResp.ok) throw new Error('Failed to fetch pool.work');
    const work = await workResp.json();

    const addresses = [...new Set([
      ...Object.keys(work.payouts ?? {}),
      ...Object.keys(work.postponed ?? {})
    ])];

    // Step 2: Fetch each user's data
    const results = await Promise.all(addresses.map(async (addr) => {
      try {
        const resp = await fetch(`${API_BASE}/users/${encodeURIComponent(addr)}`, { cache: 'no-cache' });
        if (!resp.ok) return null;
        const data = await resp.json();
        return {
          address:    addr,
          bestshare:  data.bestshare ?? 0,
          hashrate1m: data.hashrate1m ?? null,
          userLns:    data.herp ?? data.lns ?? data.shares ?? null
        };
      } catch { return null; }
    }));

    // Step 3: Get network difficulty
    const statusResp = await fetch(`${API_BASE}/pool/pool.status`, { cache: 'no-cache' });
    const statusText = await statusResp.text();
    const pool = {};
    statusText.trim().split('\n').forEach(line => {
      try { Object.assign(pool, JSON.parse(line)); } catch {}
    });

    const diffPercent = parseFloat(pool.diff);
    const accepted = pool.accepted;
    const networkDiff = (diffPercent > 0 && accepted > 0) ? accepted / (diffPercent / 100) : 874000000000;

    const rows = results.filter(r => r && r.bestshare > 0);
    const BLOCK_REWARD = poolReward ?? 3.125;
    const bsMedals = ['🏆', '🥈', '🥉'];
    const top3Addresses = [...rows]
      .sort((a, b) => b.bestshare - a.bestshare)
      .slice(0, 3)
      .map(r => r.address);

    let sortCol = 'bestshare';
    let sortDir = -1; // -1 = descending, 1 = ascending

    function renderBestSharesBody() {
      const sorted = [...rows].sort((a, b) => {
        let av, bv;
        if (sortCol === 'hashrate') {
          av = hashrateToHps(a.hashrate1m);
          bv = hashrateToHps(b.hashrate1m);
        } else if (sortCol === 'bestshare') {
          av = a.bestshare;
          bv = b.bestshare;
        } else { // payout
          av = (a.userLns != null && poolLns > 0) ? a.userLns / poolLns : 0;
          bv = (b.userLns != null && poolLns > 0) ? b.userLns / poolLns : 0;
        }
        return (av - bv) * sortDir;
      });

      table.querySelectorAll('th[data-sort]').forEach(th => {
        const active = th.dataset.sort === sortCol;
        th.classList.toggle('sort-active', active);
        th.textContent = th.dataset.label + (active ? (sortDir === -1 ? ' ▼' : ' ▲') : '');
      });

      table.querySelector('tbody').innerHTML = sorted.map((r, i) => {
        const pct = (r.bestshare / networkDiff * 100);
        const pctStr = pct >= 0.001 ? pct.toFixed(3) + '%' : '&lt; 0.001%';
        const hps = hashrateToHps(r.hashrate1m);
        const icon = hps > 0 ? '<span class="miner-active-icon">⛏️</span>' : '<span class="miner-idle-icon">💤</span>';
        const hrStr = escapeHtml(parseHashrateStr(r.hashrate1m));
        const medal = bsMedals[top3Addresses.indexOf(r.address)];
        const bsCell = medal ? medal + ' ' + formatDiffCompact(r.bestshare) : formatDiffCompact(r.bestshare);
        let payoutStr = '—';
        if (r.userLns != null && poolLns != null && poolLns > 0) {
          const base = (BLOCK_REWARD - 1) * 0.99 * (r.userLns / poolLns);
          payoutStr = base.toFixed(8) + ' BCH';
        }
        const sharesStr = r.userLns != null ? formatDiffCompact(r.userLns) : '—';
        return `<tr>
          <td>${i + 1}</td>
          <td><code>${escapeHtml(maskAddress(r.address))}</code></td>
          <td>${icon} ${hrStr}</td>
          <td class="col-bs">${bsCell}</td>
          <td class="col-bs">${pctStr}</td>
          <td class="col-payout">${payoutStr}</td>
          <td class="col-payout">${sharesStr}</td>
        </tr>`;
      }).join('');
    }

    // Build thead with sortable headers
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
        if (sortCol === th.dataset.sort) {
          sortDir *= -1;
        } else {
          sortCol = th.dataset.sort;
          sortDir = -1;
        }
        renderBestSharesBody();
      });
    });

    renderBestSharesBody();
    loading.classList.add('hidden');
    tableCard.classList.remove('hidden');
    bestSharesLoaded = true;

  } catch (err) {
    console.warn('Best shares unavailable:', err.message);
    loading.textContent = 'Could not load best shares.';
  }
}
