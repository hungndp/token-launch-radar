'use strict';
/*
 * Token Launch Radar — dashboard (radar-5).
 *
 * One static page, no network: window.RADAR (data.js, written by main.ts) is the whole dataset.
 * The board ranks every pre-token protocol in the sealed snapshot — all 342, the watchlist
 * included and the products of already-traded tokens included, those priced with a published
 * product discount stated on their rows — each with the fitted model's value, the range 200
 * bootstrap refits put around it, three comparable lenses with the traded protocols behind
 * them named, a 0-100 confidence, and a farm plan netted to a verdict. Around the board: the
 * full launched set (every token-bearing protocol, not a sample), the products view (every
 * discounted row with its class, its curve value and its reason), and the method page, which
 * publishes the leave-one-out contest that chose the pricing model. Hash routes: #/ the
 * board, #/live the launched set, #/products the discounted rows, #/method the method,
 * #/p/<slug> one protocol.
 */
const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const app = document.getElementById('app');

const fmt = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x === null || x === undefined ? '—' : x.toFixed(2) + '×');
const signedPct = (x) => (x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
const ageText = (d) => (d === null || d === undefined ? 'unrecorded' : d >= 730 ? (d / 365).toFixed(1) + ' yr' : d >= 60 ? Math.round(d / 30.4) + ' mo' : d + ' d');
const chainList = (cs) => (cs.length === 0 ? '—' : cs.length <= 2 ? cs.join(', ') : cs.slice(0, 2).join(', ') + ' +' + (cs.length - 2));
const evText = { deep: 'deep', fair: 'fair', thin: 'thin', universe: 'universe' };
const flagText = {
  'traded-parent-product': 'a product of a token that already trades — ranked with the product discount',
  'no-category-peers': 'no traded peer in its category — priced on the universe',
  'thin-evidence': 'one or two traded peers in its category',
  'lenses-disagree': 'its three comparable lenses disagree by 1.5× or more',
  'tvl-falling-fast': 'TVL down 15% or more in 7 days',
  'one-hot-week': 'one hot week is carrying the momentum adjustment',
  'age-unrecorded': 'no listing date on record — maturity read as one year',
  young: 'under six months on record',
  'single-chain': 'deployed on a single chain',
};
const verdictChip = (v) => `<span class="vd vd-${v}">${v}</span>`;

const state = { q: '', cat: 'all', verdict: 'all', watch: false, sort: 'rank', liveQ: '' };

function header(active) {
  const s = R.stats;
  const v = R.validation;
  return `<header class="top">
    <div class="brand"><span class="dot"></span><div>
      <h1>Token Launch Radar</h1>
      <p class="sub">Pre-token protocols priced by a model the snapshot itself chose — every protocol in the snapshot accounted for.</p>
    </div></div>
    <div class="stamp">Snapshot ${esc(R.as_of)} · ${esc(R.source)} · model ${esc(R.model_version)} · fitted winner: ${esc(v.winner_name)}</div>
    <div class="kpis">
      <div class="kpi"><b>${s.protocols}</b><span>protocols scanned</span></div>
      <div class="kpi"><b>${s.board_size}</b><span>ranked pre-token</span></div>
      <div class="kpi"><b>${s.live_size}</b><span>already launched</span></div>
      <div class="kpi"><b>${s.products_size}</b><span>ranked with a product discount</span></div>
      <div class="kpi"><b>${s.peers_priced}</b><span>traded peers fitted</span></div>
      <div class="kpi"><b>${fmt(s.aggregate_implied_usd)}</b><span>aggregate implied value</span></div>
      <div class="kpi"><b>${s.avg_distinct_peers}</b><span>avg peers behind a row</span></div>
      <div class="kpi"><b>${s.farm_verdicts.farm} / ${s.farm_verdicts.thin} / ${s.farm_verdicts.skip}</b><span>farm / thin / skip</span></div>
    </div>
    <nav class="tabs">
      <a href="#/" class="${active === 'board' ? 'on' : ''}">Board</a>
      <a href="#/live" class="${active === 'live' ? 'on' : ''}">Launched (${s.live_size})</a>
      <a href="#/products" class="${active === 'products' ? 'on' : ''}">Products (${s.products_size})</a>
      <a href="#/method" class="${active === 'method' ? 'on' : ''}">Method &amp; validation</a>
    </nav>
  </header>`;
}

const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
  confidence: (a, b) => b.confidence - a.confidence || a.rank - b.rank,
  signal: (a, b) => b.conviction - a.conviction || a.rank - b.rank,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
};

function boardView() {
  const cats = [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort();
  let list = rows.filter((r) =>
    (state.cat === 'all' || (r.category || 'Uncategorised') === state.cat) &&
    (state.verdict === 'all' || r.farm.verdict === state.verdict) &&
    (!state.watch || r.watchlist) &&
    (state.q === '' || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(state.q)));
  list = [...list].sort(SORTS[state.sort]);
  const body = list.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="num"><b>#${r.rank}</b><span class="rng">ranks ${r.rank_low}–${r.rank_high}</span></td>
    <td><a class="nm" href="#/p/${esc(r.slug)}">${esc(r.name)}</a>${r.watchlist ? ' <span class="wl">watchlist</span>' : ''}${r.product_reason ? ` <span class="prod">product ×${r.model.product_haircut}</span>` : ''}<span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category || '—')}</td>
    <td class="num">${fmt(r.tvl_usd)}</td>
    <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'dn'}">${signedPct(r.change_7d)}</td>
    <td class="num"><b>${fmt(r.implied_value_usd)}</b><span class="rng">${fmt(r.implied_low_usd)} – ${fmt(r.implied_high_usd)}</span></td>
    <td><span class="sig"><i style="width:${r.confidence}%"></i></span><span class="sign">${r.confidence}</span></td>
    <td class="num">${r.conviction}</td>
    <td>${verdictChip(r.farm.verdict)}</td>
    <td><span class="ev ev-${r.evidence}">${evText[r.evidence]}</span></td>
  </tr>`).join('');
  app.innerHTML = header('board') + `<main>
    <div class="tools">
      <input id="q" type="search" placeholder="Search name, slug, category…" value="${esc(state.q)}">
      <select id="cat"><option value="all">All categories</option>${cats.map((c) => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="verdict"><option value="all">All verdicts</option>${['farm', 'thin', 'skip'].map((v) => `<option value="${v}" ${state.verdict === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="sort">${Object.keys(SORTS).map((k) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>Sort: ${k}</option>`).join('')}</select>
      <label class="chk"><input id="watch" type="checkbox" ${state.watch ? 'checked' : ''}> Watchlist only</label>
      <span class="count">${list.length} of ${rows.length} ranked</span>
    </div>
    <div class="twrap"><table>
      <thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Implied value (refit range)</th><th>Confidence</th><th class="num">Signal</th><th>Verdict</th><th>Evidence</th></tr></thead>
      <tbody>${body || '<tr><td colspan="10" class="empty">No ranked protocol matches.</td></tr>'}</tbody>
    </table></div>
    <p class="note">Implied value is the winning model's point estimate; the range under it is the 10th–90th percentile of 200 bootstrap refits of that model, and the rank range is the refits' 5th–95th. Confidence scores how many distinct traded peers stand behind a row's three lenses and how closely the lenses agree. Rows chipped <i>product</i> are products of a token that already trades: the model values their business on the curve, then applies the product discount printed in the chip — their pages show both steps. Open any row for its named comparables, its netted farm plan and what could make its estimate wrong.</p>
  </main>` + footer();
  bindBoard();
}

function liveView() {
  const q = state.liveQ;
  const list = R.live.filter((r) => q === '' || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(q));
  const body = list.map((r) => `<tr>
    <td><span class="nm2">${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category || '—')}</td>
    <td>${esc(chainList(r.chains))}</td>
    <td class="num">${fmt(r.tvl_usd)}</td>
    <td class="num">${fmt(r.mcap_usd)}</td>
    <td class="num">${pct(r.mcap_tvl)}</td>
    <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'dn'}">${signedPct(r.change_7d)}</td>
  </tr>`).join('');
  app.innerHTML = header('live') + `<main>
    <div class="tools"><input id="liveq" type="search" placeholder="Search the launched set…" value="${esc(q)}"><span class="count">${list.length} of ${R.live.length} launched</span></div>
    <p class="note">Every token-bearing protocol in the snapshot — the full comparable universe the model learns from, not a sample. The ${R.stats.peers_priced} of them that carry both a market cap and a TVL are the priced peers the contest and the lenses draw on; the rest are listed at the market's own figures.</p>
    <div class="twrap"><table>
      <thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num">7d</th></tr></thead>
      <tbody>${body || '<tr><td colspan="7" class="empty">No launched protocol matches.</td></tr>'}</tbody>
    </table></div>
  </main>` + footer();
  const input = document.getElementById('liveq');
  input.addEventListener('input', () => { state.liveQ = input.value.toLowerCase(); const pos = input.selectionStart; liveView(); const el = document.getElementById('liveq'); el.focus(); el.setSelectionRange(pos, pos); });
}

function productsView() {
  const list = rows.filter((r) => r.product_reason !== null);
  const body = list.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="num"><b>#${r.rank}</b></td>
    <td><a class="nm" href="#/p/${esc(r.slug)}">${esc(r.name)}</a><span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category || '—')}</td>
    <td class="num">${fmt(r.tvl_usd)}</td>
    <td class="num">${fmt(r.model.gross_value_usd)}</td>
    <td class="num">×${r.model.product_haircut}</td>
    <td class="num"><b>${fmt(r.implied_value_usd)}</b></td>
    <td class="why">${esc(r.product_reason)}</td>
  </tr>`).join('');
  app.innerHTML = header('products') + `<main>
    <p class="note">Every ranked protocol the snapshot's own record marks as a product of a token that already trades — the screen the house's watchlist reads: a product category (liquid staking, restaking, bridge, canonical bridge, CEX), a version marker at the end of the name, a whole word wrapped, staked or staking in the name, or an exchange's name at its start. An earlier version of this radar set these ${list.length} protocols aside; this one ranks them, because the watchlist is a floor, never a ceiling. Each is priced in two printed steps: the fitted model values the business its TVL describes (the curve value), then the product discount cuts that to the share a token issued by the product itself could claim — the assets parked in a wrapper belong to the parent token's holders, not to a new token. The discounts are the model's published constants: ×${R.model.haircut_exchange} for an exchange's entry, ×${R.model.haircut_wrapper} for a wrapper or staking product, ×${R.model.haircut_bridge} for a bridge product, ×${R.model.haircut_version} for a numbered version of a traded protocol. Open any row for the full reasoning.</p>
    <div class="twrap"><table>
      <thead><tr><th>Rank</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Curve value</th><th class="num">Discount</th><th class="num">Implied value</th><th>Why it is discounted</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </main>` + footer();
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    location.hash = '#/p/' + tr.dataset.slug;
  }));
}

function lensBlock(title, lens, note) {
  const comps = lens.comps.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${fmt(c.mcap_usd)}</td><td class="num">${fmt(c.tvl_usd)}</td><td class="num">${pct(c.ratio)}</td></tr>`).join('');
  return `<div class="lens"><h4>${title}</h4>
    <p class="lensv">${fmt(lens.implied_usd)} <span>at ${pct(lens.multiple)} · ${lens.peers} peers</span></p>
    <p class="lensn">${note}</p>
    ${lens.comps.length ? `<table class="mini"><thead><tr><th>Comparable</th><th class="num">Cap</th><th class="num">TVL</th><th class="num">Cap/TVL</th></tr></thead><tbody>${comps}</tbody></table>` : '<p class="lensn">No traded peer in this set — the lens reads the universe median.</p>'}
  </div>`;
}

function detailView(r) {
  const m = r.model;
  const statRows = [
    ['TVL', fmt(r.tvl_usd)], ['7d change', signedPct(r.change_7d)], ['Category', esc(r.category || '—')],
    ['Chains', esc(chainList(r.chains))], ['Age on record', ageText(r.age_days)], ['Listed', r.listed_at || '—'],
    ['Signal', r.conviction + ' / 100'], ['Confidence', r.confidence + ' / 100'],
    ['Fitted model', esc(R.validation.winner_name)], ['Category multiple', pct(m.peer_multiple) + ` (${m.peer_count} peer${m.peer_count === 1 ? '' : 's'})`],
    ['Momentum ×', m.momentum_multiplier.toFixed(2)], ['Maturity ×', m.maturity_multiplier.toFixed(2)], ['Footprint ×', m.footprint_multiplier.toFixed(2)],
  ];
  if (r.product_reason) {
    statRows.push(['Curve value', fmt(m.gross_value_usd)], ['Product discount', '×' + m.product_haircut]);
  }
  const stats = statRows.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  const wrong = [];
  if (r.product_reason) wrong.push(`This row is a product of a token that already trades — ${r.product_reason}. The fitted model values the business its ${fmt(r.tvl_usd)} of TVL describes at ${fmt(m.gross_value_usd)}; the board then applies the ×${m.product_haircut} product discount, because a token issued here could claim the product's own fees and governance, not the assets parked in it, which belong to the parent token's holders. The discount is a stated constant of the model, printed so it can be argued with: if the parent folded this product into its own token instead, the honest value of a separate launch is nearer zero than the discounted figure; if the product were spun out with its fee stream intact, it could be worth more.`);
  if (r.flags.includes('lenses-disagree')) wrong.push(`Its three lenses disagree by ${m.lens_spread.toFixed(1)}× — the category lens reads ${fmt(m.lens_category_usd)}, the chain lens ${fmt(m.lens_chain_usd)} and the scale lens ${fmt(m.lens_scale_usd)}. The board prints the fitted model's value because leave-one-out says the fitted read is the least wrong of the candidates tested; if the category's small traded names are the truer guide, this row is worth far more than printed, and if the giants' pricing is, far less.`);
  if (r.evidence === 'universe') wrong.push(`No protocol in its category carries both a market cap and a TVL, so the fitted model prices it from the universe's own shape with no category evidence at all. One comparable launch in its category would move this number more than any other single fact.`);
  else if (r.evidence === 'thin') wrong.push(`Only ${m.peer_count} traded peer${m.peer_count === 1 ? '' : 's'} price its category. The shrinkage toward the universe median is doing real work here; a single new listing in the category could move the multiple, and this row with it.`);
  if (r.flags.includes('tvl-falling-fast')) wrong.push(`TVL fell ${signedPct(r.change_7d)} in the snapshot's seven days. The momentum adjustment already discounts the fall; if the outflow is a single whale leaving rather than users drifting away, the discount is too harsh — and if it is the start of a run, not harsh enough.`);
  if (r.flags.includes('one-hot-week')) wrong.push(`The 7-day growth of ${signedPct(r.change_7d)} is doing heavy lifting through the momentum adjustment. One week is a small sample: an incentive campaign ending, or a single large deposit, would unwind much of the premium at the next snapshot.`);
  if (r.flags.includes('age-unrecorded')) wrong.push('The snapshot records no listing date, so maturity is read as one year. A genuinely older protocol is underpriced by that convention; a younger one is flattered by it.');
  wrong.push(`The refit range itself is the honest summary: across 200 bootstrap refits of the winning model this row lands between ${fmt(r.implied_low_usd)} and ${fmt(r.implied_high_usd)} and ranks between #${r.rank_low} and #${r.rank_high}. The point estimate is the middle of that argument, not a promise.`);
  wrong.push('The model prices a launch from TVL, momentum, age and reach. It cannot see a points programme, an investor list, a vesting schedule or whether the team intends to launch at all — any of those can make a real launch price land far from this figure, in either direction.');
  app.innerHTML = header('board') + `<main>
    <p class="back"><a href="#/">← Back to the board</a></p>
    <div class="dhead"><div>
      <h2>#${r.rank} · ${esc(r.name)} ${r.watchlist ? '<span class="wl">watchlist</span>' : ''}</h2>
      <p class="sub2">${esc(r.slug)} · ${esc(r.category || 'Uncategorised')} · pre-token${r.product_reason ? ' · product of a traded token' : ''}</p>
    </div><div class="bigval"><span>Implied value</span><b>${fmt(r.implied_value_usd)}</b><span class="rng2">refits ${fmt(r.implied_low_usd)} – ${fmt(r.implied_high_usd)} · ranks #${r.rank_low}–#${r.rank_high}</span></div></div>
    <div class="vbanner">${verdictChip(r.farm.verdict)}<p><b>Farm verdict: ${r.farm.verdict}.</b> ${esc(r.farm.verdict_reason)}</p></div>
    <div class="grid">${stats}</div>
    ${r.flags.length ? `<div class="flags">${r.flags.map((f) => `<span class="flag">${esc(flagText[f] || f)}</span>`).join('')}</div>` : ''}
    <h3>Comparables — three lenses, named peers</h3>
    <p class="note">The fitted model prints the headline value; these three lenses cross-examine it. Each reads a shrunk median market-cap-to-TVL multiple from its own peer set, applies this protocol's momentum, maturity and footprint adjustments, and names the largest traded protocols behind the number. ${r.model.distinct_peers} distinct traded peers stand behind this row across the three sets.${r.product_reason ? ' The lenses price the underlying business before the product discount; the headline applies the discount to the fitted value, so the lenses can read above it without disagreeing with it.' : ''}</p>
    <div class="lenses">
      ${lensBlock('Category lens', { multiple: m.lens_category_multiple, peers: m.lens_category_peers, implied_usd: m.lens_category_usd, comps: r.comps.category }, 'the radar-3 statistic: its own category’s traded peers')}
      ${lensBlock('Chain lens', { multiple: m.lens_chain_multiple, peers: m.lens_chain_peers, implied_usd: m.lens_chain_usd, comps: r.comps.chain }, 'traded peers deployed on its main chain, whatever their category')}
      ${lensBlock('Scale lens', { multiple: m.lens_scale_multiple, peers: m.lens_scale_peers, implied_usd: m.lens_scale_usd, comps: r.comps.scale }, 'traded peers within 3× of its TVL, whatever their category or chain')}
    </div>
    <h3>Farm plan, netted</h3>
    <div class="econ">
      <div class="stat"><span>Position capital</span><b>${fmt(r.farm.capital_usd)}</b></div>
      <div class="stat"><span>Hold window</span><b>${r.farm.hold_days} days</b></div>
      <div class="stat"><span>All-in plan cost</span><b>${fmt(r.farm.plan_cost_usd)}</b></div>
      <div class="stat"><span>Cost vs implied</span><b>${(r.farm.cost_pct_of_implied * 100).toFixed(3)}%</b></div>
    </div>
    <p class="note">The cost is the plan's gas over its hold window — setup, open, second action, the weekly habit and the unwind — priced at the main chain's mid estimates. Capital is a position that comes back, not a cost, and is stated separately.</p>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <h3>What could make this estimate wrong</h3>
    <ul class="wrong">${wrong.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
  </main>` + footer();
}

function methodView() {
  const v = R.validation;
  const win = v.rows.find((x) => x.id === v.winner);
  const vrows = v.rows.map((x) => `<tr class="${x.id === v.winner ? 'win' : ''}"><td><b>${esc(x.name)}</b>${x.id === v.winner ? ' <span class="wl">winner</span>' : ''}<span class="slug">${esc(x.describe)}</span></td><td class="num">${x.median_abs_log_error.toFixed(4)}</td><td class="num">${x.mean_abs_log_error.toFixed(4)}</td><td class="num">${x.within_2x_pct.toFixed(1)}%</td></tr>`).join('');
  const coefs = Object.entries(v.coefficients).map(([k, val]) => `${k} ${val}`).join(' · ');
  const catRows = R.categories.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${pct(c.multiple)}</td><td class="num">${pct(c.multiple_p25)} – ${pct(c.multiple_p75)}</td><td><span class="ev ev-${c.evidence}">${evText[c.evidence]}</span></td></tr>`).join('');
  app.innerHTML = header('method') + `<main class="prose">
    <h2>Method &amp; validation</h2>
    <p>The snapshot (${esc(R.as_of)}, ${esc(R.source)}) records ${R.stats.protocols} protocols. ${R.stats.token_bearing} already carry a token; ${R.stats.pre_token} do not. Of the traded set, ${v.peers_priced} carry both a market cap and a TVL — the priced peers, the only ground truth a pricing model can be tested against. This radar does not ask the reader to trust its model: it fits five candidates to those peers, tests each one out of sample, and prices the board with the winner.</p>
    <h3>The contest: leave-one-out over ${v.peers_priced} priced peers</h3>
    <p>Each candidate is refit ${v.peers_priced} times, each time leaving one priced peer out, and must predict the held-out peer's recorded market cap from its TVL, category, growth, age and chains alone. The error is the absolute log<sub>10</sub> ratio of prediction to actual — 0.30 is a factor of two. The winner is the lowest median error; ties break toward the simpler model.</p>
    <div class="twrap"><table><thead><tr><th>Candidate</th><th class="num">Median |log error|</th><th class="num">Mean |log error|</th><th class="num">Within 2×</th></tr></thead><tbody>${vrows}</tbody></table></div>
    <p><b>${esc(v.winner_name)}</b> prices this board (median error ${win.median_abs_log_error.toFixed(4)}, fitted coefficients: ${esc(coefs)}). Two things are worth noticing. The plain category medians radar-3 shipped finish behind even the flat control once the adjustments are tested honestly — the adjustment stack, applied to raw category medians, was double-counting what size already explains. And no candidate is good in absolute terms: the best of them is still a factor of two off on a typical peer. That is the market being priced, not a defect this page hides — it is why every row carries a range and a confidence score instead of a bare number.</p>
    <h3>Ranges from 200 refits</h3>
    <p>The winner is refit on 200 bootstrap resamples of the peer set (seeded, so the board is byte-for-byte reproducible) and every row is re-priced by each refit. A row's range is its refits' 10th–90th percentile; its rank range is the refits' 5th–95th. A row whose price survives resampling wears a narrow range; a row resting on a handful of peers wears a wide one.</p>
    <h3>The product discount: all ${R.stats.pre_token} pre-token protocols are ranked</h3>
    <p>The house's watchlist is a floor, never a ceiling, so this board ranks every protocol that records no token — including the ${R.stats.products_size} the snapshot's own record marks as products of a token that already trades. The screen is the watchlist's own: a product category (Liquid Staking, Liquid Restaking, Restaked BTC, Bridge, Canonical Bridge, CEX), a version marker at the end of the name, a whole word wrapped, staked or staking in the name, or an exchange's name at its start. A product's TVL is real, but it is the parent asset parked inside a wrapper: a token the product issued could claim the wrapper's own fees and governance, never the parked assets, which belong to the parent token's holders. So a product row is priced in two printed steps — the fitted curve values the business its TVL describes, then a discount cuts that value to the share its own token could claim: ×${R.model.haircut_exchange} for an exchange's entry (tracked reserves are customer assets, not a business seeking a launch), ×${R.model.haircut_wrapper} for a wrapper or staking product, ×${R.model.haircut_bridge} for a bridge product (a fee stream on flow, not the assets in transit), ×${R.model.haircut_version} for a numbered version of a traded protocol (a real business, discounted because a second token would split the parent's claim rather than add to it). The factors are constants of the model, stated here and printed on every such row with its curve value, so a reader who disagrees with a factor can recompute the row in one multiplication. The bootstrap ranges and rank ranges are computed after the discount, so they describe the figure the board actually prints.</p>
    <h3>Confidence and the three lenses</h3>
    <p>Every row is also priced three independent ways — by its category's peers, by its main chain's peers, and by peers within 3× of its TVL — with the largest names behind each lens printed on its page. Confidence (0–100) is half the count of distinct peers behind the three lenses (24 or more saturates) and half their agreement: when the lenses spread by 1.5× or more the row is flagged <i>lenses-disagree</i> and the agreement half scores zero. On the giants the category lens is the outlier — small traded curators price at ratios the fitted curve, reading the whole universe's size shape, will not follow — and the row's page shows all three numbers so the reader can judge the argument rather than the headline.</p>
    <h3>Farm verdicts, netted</h3>
    <p>Each row's farm plan is priced: its gas over its hold window at its main chain's mid estimates (Ethereum $21 a transaction and $25 a week; Solana cents; the large L2s about $0.50 and $2; anything else $1 and $2.50). Verdicts follow stated thresholds — <b>skip</b> when the value rests on the universe median alone, or when a signal under 20 meets one-or-two-peer evidence; <b>farm</b> when the signal is 55 or better and confidence is 45 or better; <b>thin</b> — a small position, sized down — for everything between. Across the board: ${R.stats.farm_verdicts.farm} farm, ${R.stats.farm_verdicts.thin} thin, ${R.stats.farm_verdicts.skip} skip.</p>
    <h3>The adjustments</h3>
    <p>Whichever candidate wins, three adjustments shape its read, each fitted from the snapshot's own figures: momentum (7-day TVL growth from −40% to +60% maps to ×0.55–×1.75), maturity (a listing under 30 days old reads ×0.6, rising linearly to ×1.15 at three years; an unrecorded age reads as one year), and footprint (×0.92 on one chain, ×1.0 at two to four, ×1.08 at five or more). The cat-adj and curve candidates divide each peer's own adjustments out before fitting, so the contest measures the adjustments rather than assuming them.</p>
    <h3>Every category's peer evidence</h3>
    <div class="twrap"><table><thead><tr><th>Category</th><th class="num">Priced peers</th><th class="num">Shrunk median</th><th class="num">Peer p25 – p75</th><th>Evidence</th></tr></thead><tbody>${catRows}</tbody></table></div>
    <h3>Limits, stated</h3>
    <p>The snapshot is one day (${esc(R.as_of)}) and a sealed one: prices and TVL are that day's record, and a board rebuilt on another day's snapshot would rank differently. The floor of ${fmt(R.floor_usd)} is the snapshot's own — this entry reads the snapshot it is given and nothing else. Implied value is a model's statement about what a launch could price at, never a promise that a launch happens. Nothing is set aside: the ${R.stats.products_size} products of traded tokens are ranked with their discount stated, because a radar that hides the largest names in the snapshot leaves the reader to wonder whether it saw them at all.</p>
  </main>` + footer();
}

function footer() {
  return `<footer>Built from the sealed snapshot alone — no live prices, no names hardcoded. Board and launched set together account for all ${R.stats.protocols} protocols: ${R.stats.board_size} ranked + ${R.stats.live_size} launched. Nothing is set aside.</footer>`;
}

function bindBoard() {
  const q = document.getElementById('q');
  q.addEventListener('input', () => { state.q = q.value.toLowerCase(); const pos = q.selectionStart; boardView(); const el = document.getElementById('q'); el.focus(); el.setSelectionRange(pos, pos); });
  document.getElementById('cat').addEventListener('change', (e) => { state.cat = e.target.value; boardView(); });
  document.getElementById('verdict').addEventListener('change', (e) => { state.verdict = e.target.value; boardView(); });
  document.getElementById('sort').addEventListener('change', (e) => { state.sort = e.target.value; boardView(); });
  document.getElementById('watch').addEventListener('change', (e) => { state.watch = e.target.checked; boardView(); });
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    location.hash = '#/p/' + tr.dataset.slug;
  }));
}

function route() {
  const h = location.hash || '#/';
  if (h.startsWith('#/p/')) {
    const r = bySlug.get(decodeURIComponent(h.slice(4)));
    if (r) { detailView(r); window.scrollTo(0, 0); return; }
  }
  if (h === '#/live') { liveView(); return; }
  if (h === '#/products') { productsView(); return; }
  if (h === '#/method') { methodView(); return; }
  boardView();
}
window.addEventListener('hashchange', route);
route();
