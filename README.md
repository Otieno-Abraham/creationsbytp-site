# Creations by TP

One-page website for **Creations by TP**, custom money, rose, burn, bottle and diaper bouquets by Tanesha Pinkney.

Live at **https://creationsbytp.com**, hosted on GitHub Pages.

## What's where

| Path | What it is |
|---|---|
| `site/` | The website. Everything in here is published. |
| `site/index.html` | The whole page: content, styles and scripts. |
| `site/assets/` | Web-ready photos (WebP), videos (MP4) and logo. |
| `qa/e2e.test.js` | End-to-end tests (layout, clipped text, media, links, tap sizes, accessibility, order form, gallery). |
| `dev-server.js` | Small local server with video range support, for previewing and testing. |
| `.github/workflows/deploy.yml` | On every push to `main`: run the tests, then publish `site/` only if they pass. |

## Common edits

- **Prices:** search `index.html` for `$150`, `$250`, `$275`, `$350` (price cards, order form options and the JSON-LD block near the top).
- **Order emails:** paste the Web3Forms access key into `data-web3forms-key=""` on the `<form id="orderForm">` line. Leave it empty to send orders by text message only.
- **Gallery:** edit the `GALLERY` list in the script at the bottom of `index.html`, and add files to `site/assets/`.

## Preview locally

```bash
node dev-server.js site 8765
```

Then open http://localhost:8765.

## Run the tests

With the local server running:

```bash
cd qa
npm install
node e2e.test.js
```

The same tests run on GitHub before every deploy. If any test fails, the live site is not updated.
