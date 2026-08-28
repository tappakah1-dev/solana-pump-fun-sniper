# Allow-Exect

A Pump.fun execution desk. It does **not** scan the launchpad. It only acts
when a token is created by a **trusted DEV wallet** you add in the UI.

This is not a high-win-rate bot. Most allow-listed launches die. The book
works only if losers are cut with a bounded loss, a winner peels **20% at
+110%** from *your fill* and trails the rest of initials until fade / **−12%**
giveback / **3×** cap, the stub is not flattened by normal early volatility,
and a sell agent then decides how much remaining to clip, when to flatten a
20–50k death, and when to leave a moonbag so **one runner in 10–15 rugs pays
the book**.

Not financial advice. You can lose the entire ticket. You will, often.

## What it does

- Watches live Pump.fun creates
- Buys a **fixed** buy size (`ticket_sol` → `buy_exact_sol_in`) when the
  creator is a trusted DEV, socials exist (presence only), you are not chasing
  skip mcap, and risk limits allow it
- Runs a phase machine: `OPEN_IGNORE` → `SHAKEOUT` → `SEEK_RENT` → `STUB` →
  `MOONBAG`
- At +110% (2.1× fill): **peel 20%**, arm rent (cannot cancel), trail the other
  ~30% of the original bag while tape is ripping, fire on fade / −12% / 3×
- After rent, a **sell agent** classifies tape (RIPPING / HEALTHY / WEAKENING /
  DEAD) and sizes clips, flatten, or moonbag. THINK lines show the decision.
- Sells graduated coins on **PumpSwap**, not as “liquidity gone”
- Logs every decision as a human line and a JSONL record
- Defaults to **dry-run**. A **Paper any coin with socials** switch (on by
  default in dry-run) fills live Pump.fun creates that have socials so you can
  test the exit agent without waiting on a trusted DEV. **Live ignores this**
  and only buys the allow-list.
- Live is gated by Vercel env + `I UNDERSTAND` + operator whitelist

## What it does not do

- LLM entry or hold decisions (no model call on the poll loop)
- Skip because a bundle was detected
- Flatten because the DEV sold in the first **2 minutes** — even ten of those
- Auto-pause a DEV after two rugs (the 5th–7th coin can be the runner)
- Chandelier / trailing stop from the first spike
- Buy when mcap is already extended above `skip_if_mcap_above`
- Scale in / average
- Withdraw to any other address
- Write private keys into logs, UI text, or JSONL
- Scan non-allow-listed creates for buys (logging them as `SKIP` is fine)

## Market microstructure this desk encodes

Do not pretend we buy the create at ~$3k on block 0. That is not our fill.

Typical open on a serious Pump.fun launch:

1. Dev creates and bundles buys on the first block. Mcap jumps to ~$4k–$7k.
2. Dev usually sells in the first seconds, often more than once. In the current
   meta this is expected. **DEV sells in the first 2 minutes are not an exit.**
3. Snipers push mcap to ~$6k–$15k, then sell.
4. Price dumps toward ~$4k–$7k.
5. After that the coin either dies or starts a real trend.

Our intended fill is the **first pause after the bundle impulse**, about
$5k–$6k.

Drawdowns of −35% to −50% from a local high on 1s/30s candles after the open
are normal. Those wicks must not flatten a position that is still above fill /
above the post-open base.

**After 2 minutes**, a DEV sell (token balance dropping vs the T+2m baseline)
**is** an exit.

If mcap is already above ~$12k when we would buy, we are chasing the sniper
candle. Skip.

## Phase machine

### Universe

Trusted DEV wallets in the UI (stored in the browser). Optional `smart.txt` is
an exit *hint* after we are in — never an entry reason.

If creator ∉ allow list → ignore. No meme scoring. The allow-list is the
research.

### Entry (all must pass)

Creator on allow-list · at least one social field present (Twitter/X, Telegram,
or website — presence only) · dev cooldown · open positions < max · daily loss
limit not hit · current mcap ≤ `skip_if_mcap_above` · one ticket only.

### Size

Fixed `ticket_sol`. Same size every trade. Never sized up because “hold-score
is green.”

### Phase 0 — OPEN_IGNORE (0–15s after fill)

Ignore: first DEV sells, bundled first-block wallets, 1-second wicks, %
drawdown from the first local high.

### Phase 1 — SHAKEOUT (after ignore, `shakeout_seconds`)

Do not use a stop measured from the high.

Flatten only if:

- mcap falls under `dead_mcap` and stays there, or
- mcap < `fill_mcap * (1 - hard_death_from_fill_pct)` (default 55% below fill), or
- mcap flatlines in the dead band (`dead_mcap` → `flatline_mcap_max`, default
  3k–4k) for `flatline_seconds` (default 25) without escaping above it —
  `flatline_stuck`, sell 100%. The timer resets on any escape above the band, or
- liquidity/pool is gone **and the coin has not graduated**, or
- DEV sell **after** `dev_sell_ignore_seconds` (default 120)

Graduation (`complete`) is a venue change to PumpSwap. The desk keeps the
position and sells on the new pool.

Otherwise stay. At the end, set `base_low` to a robust low of this window
(not a single 1s tick). That shelf is later stub invalidation.

**Exception — rent tag:** if mcap prints `fill × (1 + rent_profit_pct)` (2.1×)
during shakeout, the desk jumps to SEEK_RENT immediately (`rent_tag_in_shakeout`)
with `base_low` from the samples so far. The open is over and the tag is live —
we do not watch a 2.1×–3.5× print come and go while the shakeout clock runs out.
Next tick the rent agent peels / trails / caps as usual.

### Phase 2 — SEEK_RENT (trailing initials)

Arm rent when `mcap >= fill_mcap * (1 + rent_profit_pct)`. Default
`rent_profit_pct = 1.10` → **+110% from fill = 2.1×**. Rent **cannot be
cancelled** — 50% of the original bag will be sold. Only the print is flexible:

1. **Peel 20%** (`rent_peel_fraction`) at the exact tag. Never sit 100% size
   through a 2.1× dump.
2. **Trail the rest of initials** (~30% of original) while tape is ripping
   (unique buyers still up, buy SOL vs sell SOL, mcap still expanding).
3. **Fire the trail** on the first real fade: sell print, buy-volume pause vs
   the post-tag peak, or **−12% giveback** from the post-tag high
   (`rent_giveback_pct`).
4. **Hard cap at 3×** (`rent_cap_multiple`): take remaining initials even if
   the tape is still ripping, mark the 3× rung so the stub ladder does not
   double-clip.

If 2.1× has not tagged by `no_rent_timeout_seconds` (default 600): sell 100%,
reason `DEAD_NO_RENT`. Before rent arms, the dead-band flatline rule still
applies — stuck in the 3k–4k band for `flatline_seconds` sells 100%
(`flatline_stuck`) instead of waiting for the timeout. Once rent is armed,
the flatline does not fire — the trail or the cap will.

THINK lines show peel / hold trail / giveback / cap.

### Phase 3 — STUB (sell agent)

After initials are back, the remaining bag has to pay for 10–15 rugs **or**
get cut when the coin is dying at 20–50k.

The agent is deterministic (tape in → THINK line + clip/flatten/moonbag). It
does **not** call a language model every poll.

Tape regimes: `RIPPING` · `HEALTHY` · `WEAKENING` · `DEAD`

Mcap zones: early (<$20k) · death ($20–50k) · runner ($50–100k) · moon ($100k+)

Wick rule: if mcap drops ≥ 40% from the recent local high, do **not** sell
immediately. Wait `wick_wait_seconds` (default 75). Then KEEP if reclaimed,
else flatten if still under `base_low`.

Ladder clips of remaining, sized by regime × zone (ripping 100k+ keeps more;
weakening 20–50k is dumped):

| Multiple vs fill | Agent |
| --- | --- |
| 3× / 5× / 6.5× / 8× / 10× / 16× / 30× | Clip a slice of **remaining**, smaller on RIPPING moon tape |
| Death-zone fade / stall | Sell remaining — this is not a runner |
| Leftover ≤ moonbag SOL after a real runner | Moonbag |

A 14-minute 70% dump with sell volume **kills a fat stub**. A **paid moonbag**
rides the same dump. Do not dump a ripping 100k+ because it printed a rung. Do
not moonbag a coin that died at 30k.

### Phase 4 — MOONBAG

Once leftover is dust and the tape already paid (10× trim, 16×/30×, $100k+, or
realized ≥ 10× ticket): no more ladder, no trailing stop. Left on for ATH.
Auto-exit only if the DEV sells after the 2-minute window, liquidity is
actually gone (unfinished curve with empty reserves), or you press Sell.

A DEV is **never** auto-paused after rugs. The 5th–7th coin can be the runner.

## Dry-run vs live

| | Dry-run (default) | Live |
| --- | --- | --- |
| Logic | Full | Full |
| Market | Live Pump.fun mcap / trades | Same |
| Transactions | None (paper fills) | Real `buy_exact_sol_in` / sell, signed on the server |
| Curve vs PumpSwap | Venue tracked | Curve native ix, graduated sells via PumpSwap (`pump-amm`) |
| Wallet | Simulated SOL | `BOT_PRIVATE_KEY` in Vercel env |
| Enable | Dry run on | Env key + `BOT_LIVE_ENABLED=true` + type `I UNDERSTAND` + whitelist if set |

Press **Start** after adding trusted DEV wallets. Creates from other wallets are logged `SKIP`. Allow-listed creates wait for a snapshot (the fill pause), then buy if mcap is not a chase.

The private key is **never** pasted in the UI. It lives in Vercel project environment variables. The repo you push to GitHub must not contain secrets.

## Deploy — GitHub then Vercel

**Rule: code on GitHub, secrets only on Vercel.** Never put `BOT_PRIVATE_KEY` or
Helius in the repo. `.gitignore` already blocks `.env`.

Use a **dedicated trading wallet**, not the Phantom you click Connect with.
Connect-wallet is only the operator gate. The bot signs with `BOT_PRIVATE_KEY`.

### A. Put the code on GitHub (private repo)

1. Unzip the project. Do **not** add a `.env` file with real values.
2. On [GitHub](https://github.com/new): New repository → **Private** → name it
   (e.g. `allow-exec`). Do **not** tick “Add a README / gitignore / license”.
3. Push the unzipped folder. Easiest: [GitHub Desktop](https://desktop.github.com)
   → Add existing repository → that folder → Publish repository → **Keep this
   code private**.

Or from a terminal in the unzipped folder:

```bash
git init
git add .
git commit -m "Allow-Exec desk"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Confirm the repo has **no** `.env` with secrets. `.env.example` (names only) is fine.

### B. Import on Vercel

1. [vercel.com](https://vercel.com) → Add New → Project → import that GitHub repo.
2. Framework: Vite (or Other). Build command stays `npm run build`. Output is
   the Nitro Vercel preset already in `vite.config.ts`. **Do not deploy yet** —
   add env vars first.

### C. Environment variables (before first production deploy)

Vercel → Project → Settings → Environment Variables. Apply to **Production**.
Add Preview only if you will open preview URLs.

| Name | Set on first deploy? | Value |
| --- | --- | --- |
| `HELIUS_API_KEY` | **yes** | Helius key. Wins over any RPC URL in the UI |
| `OPERATOR_WHITELIST` | **yes** | Your Phantom/Solflare **public** address(es), comma-separated |
| `BOT_PRIVATE_KEY` | yes if you will go live later | Trading wallet secret (base58 or JSON byte array). **Not** the Connect wallet |
| `BOT_LIVE_ENABLED` | **no — leave unset** | `true` only when you are ready to send real txs |
| `BOT_OPERATOR_SECRET` | optional | Long random string |

Then **Deploy**. Treat the Vercel URL as a private desk. Anyone who can open it
with an empty whitelist and type `I UNDERSTAND` can fire live trades once
`BOT_LIVE_ENABLED=true`.

Jito tip is **not** an env var — it is the `Jito tip (SOL)` field on the desk.
Live txs with a tip > 0 go to Jito’s block engine first, then fall back to RPC.

See `.env.example` for the same names with comments. Names only — no values.

## How to test (paper, then live)

Trusted DEVs, ticket size, slippage, and Jito tip live in **your browser** on
that Vercel URL. They are not in GitHub.

1. Open the Vercel URL. **Connect Wallet** — must be a key in `OPERATOR_WHITELIST`.
2. Paste trusted DEV wallets (full addresses). Set **Buy exact SOL in**,
   slippage, Jito tip, skip-mcap. Leave **Dry run ON**.
3. **Lab** (right side) — run these before any live ticket:

| Preset | What you should see |
| --- | --- |
| `Runner_Biz_like` | Peel 20% at 2.1×, trail, wick KEEP, clips, moonbag |
| `Fake_rip_2.1x` | Peel, then sell-print banks the rest of initials (no 3× hold) |
| `Rip_hold_to_3x` | Peel 20%, hold trail 2.4× → 2.7×, bank rest at 3× cap |
| `Cheshire_70_dump` | Paid moonbag rides a 70% dump |
| `Death_zone_fade` | Unpaid stub dies in the 20–50k band |
| `NonRunner_no_rent` | Never 2.1× → flatten at timeout |

4. **Start** (still dry-run). Watch live Pump creates. Non-allow-listed =
   `SKIP`. An allow-listed create should `BUY` only if mcap is not a chase.
   THINK lines: peel → trail hold or fade/cap → stub agent.
5. Live, only after paper looks right:
   - Vercel → set `BOT_LIVE_ENABLED=true` → Redeploy
   - Desk: type **I UNDERSTAND**
   - One ticket, one DEV you actually trust
   - Confirm the first fill, the 20% peel, and the trail/fade on the log

Buy size in the UI is the `buy_exact_sol_in` spendable SOL (`ticket_sol`). Same size every trade.

Market data death (repeated Pump.fun API failures) blocks new buys; exits still attempt if a price is available. Buy retry: at most once per mint.

### Live fill failures

A failed live fill logs one ERROR line with the full chain, e.g.
`native:sim_failed … | portal:418 …`. Reading it:

- `native:… | portal:418 …` — the native curve tx failed to build (usually a
  transient RPC/simulation flake; one retry is attempted) and PumpPortal's
  `trade-local` rate-limited the Vercel server IP (418 = rate limit / temporary
  ban). No tx was sent. A Helius key makes the native path (account fetch +
  simulation) far more reliable and keeps you off the portal entirely.
- `tx_landed_error` — the tx landed but the program errored; no fill.
- A Jito accept is no longer logged as a fill: the desk confirms the tx
  signature on-chain for ~12s and falls back to a direct RPC send if the bundle
  did not land, so a `BUY` line always means the tx is on-chain.

## Configuration

Buy metrics sit on the main screen (ticket SOL, skip mcap, max open, daily loss,
slippage, **Jito tip**, **DEV-sell ignore seconds**, **rent peel / giveback / cap**, plus phase rules). They
persist in the browser.

## Logs

Every strategy decision prints one human line and one JSONL object. `THINK`
lines are the sell agent talking. Download from the log panel. Never keys,
seeds, Helius API keys, or raw signed transactions.

## Risk warning

Most launches die. This desk can lose the full ticket on every trade. Daily
loss limit and max open positions are brakes, not guarantees. This is not
financial advice. If you enable live, you typed `I UNDERSTAND` because you
do.
