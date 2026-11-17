// Token Radar: the board, a detail view for every protocol, and the already-launched set,
// rendered from window.RADAR (../data.js, written by main.ts from the same model that writes
// board.json). No fetch, no framework, no network: the page is its data plus this file.
//
// Routes live in the hash so a reader can link a view: #/ is the board, #/p/<slug> is one
// protocol's detail, #/f/<category> is the board filtered to a category.

'use strict';

const R = window.RADAR;
const main = document.getElementById('board');

const state = {
  q: '',
  category: '',
  chain: '',
  watchOnly: false,
  sortKey: 'rank',
  sortDir: 1,
};

/** Escape a data string for HTML text and attribute positions. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Whole dollars as $1.24B / $456M / $12.3K / $980. */
function money(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** A signed percentage with one decimal, or an em dash when the snapshot records none. */
function pct(v) {
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const cls = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}

/** An age in days as a compact label: 45d, 13mo, 2.6y. */
function ageLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30.4)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

/** The chains a row names, the first three and a count of the rest. */
function chainLabel(chains) {
  if (!chains || chains.length === 0) return '—';
  const head = chains.slice(0, 3).join(', ');
  return chains.length > 3 ? `${head} +${chains.length - 3}` : head;
}

/** Split one farm step string into its action and its Cost / Time chips. */
function splitStep(step) {
  const costAt = step.indexOf(' Cost: ');
  if (costAt < 0) return { text: step, cost: null, time: null };
  const rest = step.slice(costAt + 7);
  const timeAt = rest.indexOf('. Time: ');
  if (timeAt < 0) return { text: step.slice(0, costAt), cost: rest.replace(/\.$/, ''), time: null };
  return {
    text: step.slice(0, costAt),
    cost: rest.slice(0, timeAt),
    time: rest.slice(timeAt + 8).replace(/\.$/, ''),
  };
}

function masthead(extra) {
  const s = R.stats;
  return `
  <header class="masthead">
    <div class="radar-ring" aria-hidden="true"></div>
    <div>
      <h1>TOKEN <span class="thin">RADAR</span></h1>
      <p>Every protocol that records no token yet, ranked by what its launch would be worth — and what to do about each one before it happens.</p>
    </div>
    <div class="asof">
      <div>snapshot <strong>${esc(R.as_of)}</strong></div>
      <div>model <strong>${esc(R.model_version)}</strong></div>
      <div>${esc(R.source)}</div>
    </div>
  </header>
  <div class="stats">
    <div class="stat"><div class="k">Protocols scanned</div><div class="v">${s.protocols}</div></div>
    <div class="stat"><div class="k">Record no token</div><div class="v">${s.pre_token}</div></div>
    <div class="stat"><div class="k">Ranked on the board</div><div class="v"><em>${s.board_size}</em></div></div>
    <div class="stat"><div class="k">Watchlist covered</div><div class="v">${s.watchlist_size} / ${s.watchlist_size}</div></div>
    <div class="stat"><div class="k">Aggregate implied value</div><div class="v">${money(s.aggregate_implied_usd)}</div></div>
  </div>
  <div class="model-strip">
    <strong>implied value</strong> = TVL <span class="sep">×</span> category peer multiple <span class="sep">×</span> momentum <span class="sep">×</span> maturity <span class="sep">×</span> footprint
    <span class="sep">·</span> peer multiples are the market's own medians, read from this snapshot — the model is stated in full below
  </div>
  ${extra}`;
}

/** The rows the current controls leave standing. */
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  return R.rows.filter((r) => {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.category && (r.category ?? 'Uncategorised') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
    return true;
  });
}

const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  tvl: (a, b) => a.tvl_usd - b.tvl_usd,
  change: (a, b) => (a.change_7d ?? -Infinity) - (b.change_7d ?? -Infinity),
  age: (a, b) => (a.age_days ?? -1) - (b.age_days ?? -1),
  implied: (a, b) => a.implied_value_usd - b.implied_value_usd,
  conviction: (a, b) => a.conviction - b.conviction,
};

function sortRows(rows) {
  const fn = SORTS[state.sortKey] ?? SORTS.rank;
  return [...rows].sort((a, b) => fn(a, b) * state.sortDir);
}

function th(key, label, cls) {
  const arrow = state.sortKey === key ? ` <span class="arrow">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '';
  return `<th class="${cls ?? ''}" data-sort="${key}" scope="col">${label}${arrow}</th>`;
}

function boardView() {
  const categories = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const rows = sortRows(visibleRows());
  const body = rows
    .map(
      (r) => `
      <tr data-slug="${esc(r.slug)}" class="${r.rank <= 3 ? 'top' : ''}">
        <td class="rank">${r.rank}</td>
        <td><div class="proto-name">${esc(r.name)} ${r.watchlist ? '<span class="tag watch">watchlist</span>' : ''}</div><div class="proto-slug">${esc(r.slug)}</div></td>
        <td><span class="tag">${esc(r.category ?? 'Uncategorised')}</span></td>
        <td class="chains">${esc(chainLabel(r.chains))}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${ageLabel(r.age_days)}</td>
        <td class="num implied">${money(r.implied_value_usd)}</td>
        <td class="signal-cell"><span class="signal-num">${r.conviction}</span><div class="signal-bar"><i style="width:${r.conviction}%"></i></div></td>
      </tr>`,
    )
    .join('');
  const liveBody = R.live
    .map(
      (l) => `
      <tr>
        <td><div class="proto-name">${esc(l.name)}</div><div class="proto-slug">${esc(l.slug)}</div></td>
        <td><span class="tag">${esc(l.category ?? 'Uncategorised')}</span></td>
        <td class="num">${money(l.tvl_usd)}</td>
        <td class="num">${money(l.mcap_usd)}</td>
        <td class="num">${l.mcap_tvl === null ? '—' : `${l.mcap_tvl.toFixed(2)}×`}</td>
        <td class="num">${pct(l.change_7d)}</td>
      </tr>`,
    )
    .join('');
  const catRows = R.categories
    .slice(0, 14)
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${c.multiple.toFixed(3)}×</td></tr>`)
    .join('');

  return masthead(`
  <div class="controls" role="search">
    <input type="search" id="q" placeholder="Search name or slug…" value="${esc(state.q)}" aria-label="Search protocols">
    <select id="cat" aria-label="Filter by category">
      <option value="">All categories</option>
      ${categories.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <select id="chain" aria-label="Filter by chain">
      <option value="">All chains</option>
      ${chains.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <label class="toggle"><input type="checkbox" id="watch" ${state.watchOnly ? 'checked' : ''}> Watchlist only</label>
    <span class="count">${rows.length} of ${R.rows.length} protocols</span>
  </div>
  <table class="board" aria-label="Pre-token protocols ranked by implied value">
    <thead><tr>
      ${th('rank', '#')}${th('name', 'Protocol')}${th('name', 'Category')}${th('name', 'Chains')}
      ${th('tvl', 'TVL', 'num')}${th('change', '7d', 'num')}${th('age', 'Tokenless', 'num')}
      ${th('implied', 'Implied value', 'num')}${th('conviction', 'Signal', 'num')}
    </tr></thead>
    <tbody>${body || '<tr><td colspan="9">No protocol matches those filters.</td></tr>'}</tbody>
  </table>

  <section class="block">
    <h2>ALREADY <span class="thin">LAUNCHED</span></h2>
    <p class="lede">These protocols' tokens already trade, so the radar does not rank them: it reads them. Their market-cap-to-TVL ratios are the peer evidence the board's implied values are priced from — the market's own answer, per category, to what a dollar of TVL is worth as a token.</p>
    <table class="mini" aria-label="Token-bearing protocols at market value">
      <thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">MCap / TVL</th><th class="num">7d</th></tr></thead>
      <tbody>${liveBody}</tbody>
    </table>
  </section>

  <section class="block">
    <h2>HOW THE RADAR <span class="thin">PRICES A LAUNCH</span></h2>
    <p class="lede">No name is special-cased and no figure comes from outside the snapshot. For every category, the model takes the token-bearing protocols in it, reads each one's market cap over TVL, and shrinks the median toward the universe median (${R.stats.global_multiple.toFixed(3)}×) by the peer count — a category priced by two peers is trusted less than one priced by thirty. Every ratio is first winsorized at the universe's 90th percentile, so one token trading at hundreds of times its TVL caps the anchor instead of setting it, and no category multiple stands above 3×.</p>
    <div class="formula"><strong>implied</strong> = TVL × peerMultiple(category) × momentum × maturity × footprint<br>
    momentum = max(0.55, 1 + clamp(7d change, −50…150)% × 0.6) · maturity = 0.75 + 0.45 × min(tokenless days, 1460)/1460 · footprint = 1 + 0.03 × extra chains (max 7)</div>
    <table class="mini" style="margin-top:14px" aria-label="Category peer multiples">
      <thead><tr><th>Category</th><th class="num">Token-bearing peers</th><th class="num">Peer multiple used</th></tr></thead>
      <tbody>${catRows}</tbody>
    </table>
    <p class="note" style="margin-top:14px"><strong>Reading the board.</strong> A row says the protocol <em>records no token</em> in DefiLlama's record as of ${esc(R.as_of)} — never that it has none anywhere. Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked: a wrapped asset is not a launch waiting to happen. The implied value is this radar's own claim about what a launch would be worth if the record stayed as it is; it is not a prediction that a token will be issued, or when. The watchlist is the house's floor — every one of its ${R.stats.watchlist_size} protocols is on the board — and the radar's own work is everything below it.</p>
  </section>
  <footer class="colophon">
    <span>Board, detail and farm plans are generated from the sealed snapshot by the radar's program; nothing on this page is fetched.</span>
    <span class="right">${esc(R.model_version)} · ${esc(R.as_of)}</span>
  </footer>`);
}

function detailView(row) {
  const m = row.model;
  const steps = row.farm_steps
    .map((s) => {
      const parts = splitStep(s);
      return `<li><div>${esc(parts.text)}</div><div class="chips">
        ${parts.cost ? `<span class="chip"><b>Cost</b> ${esc(parts.cost)}</span>` : ''}
        ${parts.time ? `<span class="chip"><b>Time</b> ${esc(parts.time)}</span>` : ''}
      </div></li>`;
    })
    .join('');
  return `
  <a class="back" href="#/">← back to the board</a>
  <div class="detail-head">
    <span class="rank-badge">#${row.rank}</span>
    <h1>${esc(row.name)}</h1>
    <div class="tags">
      <span class="tag">${esc(row.category ?? 'Uncategorised')}</span>
      ${row.watchlist ? '<span class="tag watch">on the house watchlist</span>' : '<span class="tag">early — below the watchlist floor</span>'}
      <span class="tag">records no token</span>
    </div>
  </div>
  <div class="detail-grid">
    <div class="stat"><div class="k">Implied launch value</div><div class="v"><em>${money(row.implied_value_usd)}</em></div></div>
    <div class="stat"><div class="k">TVL</div><div class="v">${money(row.tvl_usd)}</div></div>
    <div class="stat"><div class="k">TVL change, 7d</div><div class="v">${row.change_7d === null ? '—' : `${row.change_7d > 0 ? '+' : ''}${row.change_7d.toFixed(1)}%`}</div></div>
    <div class="stat"><div class="k">Signal</div><div class="v">${row.conviction} / 100</div></div>
    <div class="stat"><div class="k">Tokenless for</div><div class="v">${row.age_days === null ? 'unknown' : `${row.age_days} days`}</div></div>
    <div class="stat"><div class="k">Tracked since</div><div class="v">${esc(row.listed_at ?? '—')}</div></div>
    <div class="stat"><div class="k">Chains</div><div class="v" style="font-size:14px;font-family:var(--sans)">${esc(row.chains.join(', ') || '—')}</div></div>
    <div class="stat"><div class="k">DefiLlama slug</div><div class="v" style="font-size:14px">${esc(row.slug)}</div></div>
  </div>
  <div class="why">
    <h3>WHY THIS VALUE</h3>
    <table>
      <tr><td>TVL in the snapshot</td><td class="num">${money(row.tvl_usd)}</td><td class="what">the protocol's own figure, ${esc(R.as_of)}</td></tr>
      <tr><td>× peer multiple, ${esc(row.category ?? 'Uncategorised')}</td><td class="num">${m.peer_multiple.toFixed(3)}×</td><td class="what">median market cap / TVL of ${m.peer_count} token-bearing peer${m.peer_count === 1 ? '' : 's'}, shrunk toward the universe median ${m.global_multiple.toFixed(3)}×</td></tr>
      <tr><td>× momentum</td><td class="num">${m.momentum_multiplier.toFixed(3)}×</td><td class="what">from its seven-day TVL change of ${row.change_7d === null ? 'an unreported figure, read as flat' : `${row.change_7d.toFixed(1)}%`}</td></tr>
      <tr><td>× maturity</td><td class="num">${m.maturity_multiplier.toFixed(3)}×</td><td class="what">the survival premium for ${row.age_days === null ? 'an unrecorded age, read as 300 days' : `${row.age_days} days`} at scale with no token recorded</td></tr>
      <tr><td>× footprint</td><td class="num">${m.footprint_multiplier.toFixed(3)}×</td><td class="what">live on ${row.chains.length} chain${row.chains.length === 1 ? '' : 's'} at snapshot time: day-one distribution</td></tr>
      <tr class="total"><td>= implied launch value</td><td class="num">${money(row.implied_value_usd)}</td><td class="what">the radar's claim, if the record stayed as it is</td></tr>
    </table>
  </div>
  <div class="plan">
    <h3>HOW TO FARM IT</h3>
    <ol>${steps}</ol>
    <p class="note">Farming is positioning, not a promise: ${esc(row.name)} records no token and may never issue one. The plan keeps the cost of finding out small, dated and logged, so the same wallet can be reused or unwound cleanly.</p>
  </div>
  <footer class="colophon">
    <span><a class="back" href="#/">← back to the board</a></span>
    <span class="right">${esc(R.model_version)} · ${esc(R.as_of)}</span>
  </footer>`;
}

/** Render the current route into <main> and wire the board's controls when it shows. */
function render() {
  const hash = location.hash || '#/';
  const detail = hash.match(/^#\/p\/(.+)$/);
  const filtered = hash.match(/^#\/f\/(.+)$/);
  if (detail) {
    const row = R.rows.find((r) => r.slug === decodeURIComponent(detail[1]));
    main.innerHTML = row ? detailView(row) : boardView();
  } else {
    if (filtered) state.category = decodeURIComponent(filtered[1]);
    main.innerHTML = boardView();
    wireBoard();
  }
  main.setAttribute('aria-busy', 'false');
  window.scrollTo(0, 0);
}

/** Attach the board's controls: search, filters, sort headers and row navigation. */
function wireBoard() {
  const q = document.getElementById('q');
  const cat = document.getElementById('cat');
  const chain = document.getElementById('chain');
  const watch = document.getElementById('watch');
  if (q) q.addEventListener('input', () => { state.q = q.value; refreshTable(); });
  if (cat) cat.addEventListener('change', () => { state.category = cat.value; refreshTable(); });
  if (chain) chain.addEventListener('change', () => { state.chain = chain.value; refreshTable(); });
  if (watch) watch.addEventListener('change', () => { state.watchOnly = watch.checked; refreshTable(); });
  wireTable();
}

/** Re-render only the board table and the count, keeping the controls as they stand. */
function refreshTable() {
  const fresh = document.createElement('div');
  fresh.innerHTML = boardView();
  const oldTable = main.querySelector('table.board');
  const newTable = fresh.querySelector('table.board');
  const oldCount = main.querySelector('.count');
  const newCount = fresh.querySelector('.count');
  if (oldTable && newTable) oldTable.replaceWith(newTable);
  if (oldCount && newCount) oldCount.textContent = newCount.textContent;
  wireTable();
}

/** Sort headers and row clicks for whichever board table is on the page. */
function wireTable() {
  main.querySelectorAll('th[data-sort]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'rank' || key === 'name' ? 1 : -1; }
      refreshTable();
    });
  });
  main.querySelectorAll('tr[data-slug]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = `#/p/${encodeURIComponent(el.getAttribute('data-slug'))}`; });
  });
}

window.addEventListener('hashchange', render);
render();
