# Token Launch Radar

A radar for spotting mispriced token launches, built on DefiLlama data.

Most launch dashboards rank by raw TVL or raw hype. This one asks a
different question: *given what similar protocols are worth, what should
this token be worth — and how far is the market from that number?*

## How it works

- Starts from a DefiLlama snapshot of 758 protocols and a 40-token
  watchlist of upcoming / recent launches.
- For each candidate, finds its peer group (same category, similar
  mechanics) and computes peer multiples (market-cap / TVL and related
  ratios).
- Implied value = the candidate's own fundamentals priced at the peer
  group's median multiple. The board ranks all 198 scored candidates by
  the gap between implied and actual pricing.
- Fully deterministic: the same snapshot always produces the same board.

## Run it

```
node main.ts
```

Node 22+, standard library only — no dependencies to install. The run
writes the ranked board and renders the dashboard (see `dashboard/` and
`screenshots/`).

MIT licensed.
