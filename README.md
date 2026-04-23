# bch.ee Parasite Pool

A Bitcoin Cash (BCH) mining pool with a 1 BCH block finder bonus, Full Round Payouts, and a ~0.7% effective fee.

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

1. **1 BCH** finder bonus to whoever finds the block (fee-free)
2. **99%** of the remaining reward (Block Reward + Tx Fees - 1 BCH) split proportionally among all miners by shares
3. **1%** pool fee on the remaining reward

All shares since the last block count equally — no luck penalty.

## Fee

The effective fee on the full block reward is approximately **~0.7%** because the 1 BCH finder bonus is paid fee-free. The 1% fee applies only to the remaining distributable reward.

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
