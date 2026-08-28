# bch.ee Parasite Pool

A Bitcoin Cash (BCH) mining pool with a 1 BCH block finder bonus, Full Round Payouts (PROP), and a 2% pool fee.

Run by the developer of [SoloChance.org](https://solochance.org). Inspired by [parasite.space](https://parasite.space).

## Connect

| Setting  | Value                    |
|----------|--------------------------|
| Stratum  | `para.bch.ee:3333`       |
| Username | `YOUR_BCH_ADDRESS.worker` |
| Password | `x`                      |

For high-diff rentals (e.g. NiceHash), use port `3334`.

No registration required — your BCH address is your identity.

## Payout Structure

1. **2%** pool fee, taken first from the full block reward (Block Reward + Tx Fees)
2. **1 BCH** finder bonus to whoever finds the block, paid directly in the block's coinbase, from what's left after the fee
3. The remaining balance split proportionally (PROP) among all miners by shares, also paid in the coinbase — no minimum, even 1 sat is paid

All shares since the last block count equally — no luck penalty. Every payout is included directly in the coinbase transaction that finds the block, so it's fully trustless with no ongoing bookkeeping.

## Fee

The pool fee is **2%** of the full block reward, taken first — before the 1 BCH finder bonus and miner payouts are calculated.

## Infrastructure

- **Pool software**: [asicseer-pool](https://github.com/cculianu/asicseer-pool) (based on [ckpool](https://bitbucket.org/ckolivas/ckpool/src/master/) by Con Kolivas)
- **Server**: Frankfurt, Germany
- **Website**: Static site hosted on GitHub Pages — no cookies, no tracking, no analytics

## Website

The frontend is a static site with no build step:

- `index.html` — Home, Connect, My Stats, Blocks
- `faq.html` — Frequently Asked Questions
- `terms.html` — Terms of Service
- `privacy.html` — Privacy Policy
- `app.js` — Pool API integration and UI logic
- `style.css` — Styles (dark glassmorphism theme)

### External APIs

| API | Purpose |
|-----|---------|
| `para.bch.ee` | Pool stats, user stats, block data |
| `api.solochance.org` | Block rate estimates, block chance, BCH price, network hashrate |
| Google Fonts | Ubuntu and Ubuntu Mono typefaces |

## Links

- **Website**: [bch.ee](https://bch.ee)
- **Telegram**: [t.me/parabchee](https://t.me/parabchee)
- **FAQ**: [bch.ee/faq.html](https://bch.ee/faq.html)

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you fork, modify, or run this software as a service, you must make your source code available under the same license.
