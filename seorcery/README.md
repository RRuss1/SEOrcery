# 🔮 SEOrcery

**Free local SEO score checker — real data, zero cost.**

Built as a white-label tool for digital marketing agencies to embed on client websites or use as a lead generation tool.

---

## What It Does

Scores a local business across 5 SEO factors using real data:

| Factor | Data Source | Cost |
|---|---|---|
| Google Business Profile | Google Places API | Free |
| Reviews & reputation | Google Places API | Free |
| Mobile page speed | PageSpeed Insights API | Free (no key) |
| Local keyword alignment | Live website fetch | Free |
| Citation consistency | Smart estimate | Free |

---

## Quick Start

See **SEOrcery_Launch_Guide.md** for the full step-by-step walkthrough.

### TL;DR

1. Get a free Google Places API key at [console.cloud.google.com](https://console.cloud.google.com)
2. Paste your key into `worker/wrangler.toml`
3. Deploy the worker: `cd worker && wrangler deploy`
4. Paste your Worker URL into `index.html` (the `WORKER_URL` variable)
5. Push to GitHub, enable GitHub Pages → live in 60 seconds

---

## File Structure

```
seorcery/
├── index.html          ← Widget UI (goes on GitHub Pages)
├── README.md
└── worker/
    ├── index.js        ← Cloudflare Worker (API proxy + scoring logic)
    └── wrangler.toml   ← Worker config (put your API key here)
```

---

## Two Things to Update Before Launch

**1. In `worker/wrangler.toml`:**
```toml
GOOGLE_API_KEY = "PASTE_YOUR_GOOGLE_API_KEY_HERE"
```

**2. In `index.html`** (two variables near the bottom of the `<script>` block):
```javascript
const WORKER_URL = "https://seorcery-proxy.YOUR_SUBDOMAIN.workers.dev";
const CTA_URL    = "mailto:your@email.com";
```

---

## Embedding on a Client Site

Once deployed, the widget can be embedded on any website with a single iframe:

```html
<iframe
  src="https://YOUR_USERNAME.github.io/seorcery/"
  width="100%"
  height="750"
  frameborder="0"
  style="border-radius:16px;"
></iframe>
```

---

## Cost

| Service | Cost |
|---|---|
| GitHub Pages | Free |
| Cloudflare Workers (100k req/day) | Free |
| Google Places API (~1,000 lookups/day) | Free |
| PageSpeed Insights API | Free (unlimited) |
| **Total** | **$0/month** |

---

## Built By

Rich Russ · SEOrcery · Powered by [Russell SPC](https://russellspc.com)
