# 🔮 SEOrcery — Launch Guide
### From zero to live in VS Code, GitHub Pages, and Cloudflare Workers

---

## What You're Building

```
Browser (Widget UI)
      ↓  fetch()
Cloudflare Worker  ←— your API key lives here, safe
      ↓
  ├── Google Places API      → GBP score + reviews + rating
  ├── PageSpeed Insights API → real mobile speed score (FREE, no key)
  └── Website keyword scan   → fetches their URL, checks local keywords
      ↓
Widget renders real scores
```

**Hosting:** GitHub Pages (free) for the frontend  
**Proxy:** Cloudflare Workers (free tier — 100k requests/day)  
**APIs used:** Google Places API (free key) + PageSpeed Insights (no key needed)

---

## Prerequisites — Install These First

### 1. VS Code
Download from: https://code.visualstudio.com  
Install these extensions (Ctrl+Shift+X → search each):
- **Live Server** (by Ritwick Dey) — preview your widget locally
- **Prettier** (by Prettier) — auto-formats your code
- **GitLens** (by GitKraken) — makes Git visual

### 2. Node.js (v18 or higher)
Download from: https://nodejs.org (choose LTS)  
Verify install — open VS Code terminal (Ctrl+`) and type:
```bash
node --version
# Should print v18.x.x or higher
```

### 3. Git
Download from: https://git-scm.com  
Verify:
```bash
git --version
# Should print git version 2.x.x
```

### 4. Wrangler (Cloudflare CLI)
```bash
npm install -g wrangler
wrangler --version
# Should print wrangler x.x.x
```

---

## Step 1 — Set Up Your GitHub Repo

### 1a. Create the repo on GitHub
1. Go to https://github.com and sign in (create account if needed)
2. Click **New repository** (green button)
3. Name it exactly: `seorcery`
4. Set to **Public**
5. Check **Add a README file**
6. Click **Create repository**

### 1b. Clone it to your machine in VS Code
Open VS Code, then open the terminal (Ctrl+`):

```bash
cd "C:\Users\goret\OneDrive\Desktop\SEOrcery"
git clone https://github.com/YOUR_GITHUB_USERNAME/seorcery.git
cd seorcery
```

> Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

You should now have: `C:\Users\goret\OneDrive\Desktop\SEOrcery\seorcery\`

### 1c. Open the project in VS Code
```bash
code .
```
VS Code will open with your project folder on the left.

---

## Step 2 — Get Your Google Places API Key

This is the only key you need. Takes 5 minutes.

1. Go to https://console.cloud.google.com
2. Click **Select a project** → **New Project**
3. Name it `SEOrcery` → click **Create**
4. In the left menu: **APIs & Services** → **Library**
5. Search for **Places API** → click it → click **Enable**
6. Go back to Library, search **PageSpeed Insights API** → Enable it too
7. In the left menu: **APIs & Services** → **Credentials**
8. Click **+ Create Credentials** → **API Key**
9. Copy the key — it looks like: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXX`
10. Click **Edit API key** → under **API restrictions** → select **Restrict key**
11. Choose **Places API** and **PageSpeed Insights API** → Save

> ⚠️ Never paste this key into your HTML file. It goes in the Worker only (Step 4).

---

## Step 3 — Build the Project File Structure

In your VS Code terminal, inside the `seorcery` folder:

```bash
mkdir worker
touch index.html
touch worker/index.js
touch worker/wrangler.toml
touch README.md
```

Your folder should now look like:
```
seorcery/
├── index.html
├── README.md
└── worker/
    ├── index.js
    └── wrangler.toml
```

---

## Step 4 — Create the Cloudflare Worker

### 4a. Paste this into `worker/wrangler.toml`

```toml
name = "seorcery-proxy"
main = "index.js"
compatibility_date = "2024-01-01"

[vars]
GOOGLE_API_KEY = "PASTE_YOUR_KEY_HERE"
```

> Replace `PASTE_YOUR_KEY_HERE` with your actual Google API key from Step 2.

### 4b. Paste this into `worker/index.js`

```javascript
export default {
  async fetch(request, env) {

    // Allow CORS from your GitHub Pages site
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const apiKey = env.GOOGLE_API_KEY;

    // ── ACTION: score ──────────────────────────────────────────────
    // Params: bizName, city, siteUrl (optional)
    if (action === "score") {
      const bizName = url.searchParams.get("bizName") || "";
      const city    = url.searchParams.get("city") || "";
      const siteUrl = url.searchParams.get("siteUrl") || "";

      const results = {};

      // 1. Google Places — GBP completeness + reviews
      try {
        const query = encodeURIComponent(`${bizName} ${city}`);
        const placesUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=name,rating,user_ratings_total,opening_hours,formatted_address,photos,website&key=${apiKey}`;
        const placesRes = await fetch(placesUrl);
        const placesData = await placesRes.json();
        const place = placesData.candidates?.[0];

        if (place) {
          // GBP score: based on how complete the profile is
          let gbpScore = 40; // base for being found at all
          if (place.rating)              gbpScore += 15;
          if (place.opening_hours)       gbpScore += 15;
          if (place.photos?.length > 0)  gbpScore += 15;
          if (place.website)             gbpScore += 15;
          results.gbp = Math.min(gbpScore, 100);

          // Review score: based on count + rating
          const count  = place.user_ratings_total || 0;
          const rating = place.rating || 0;
          let reviewScore = 0;
          if (count > 0)   reviewScore += 20;
          if (count > 10)  reviewScore += 20;
          if (count > 25)  reviewScore += 20;
          if (count > 50)  reviewScore += 20;
          if (rating >= 4.0) reviewScore += 20;
          results.reviews = Math.min(reviewScore, 100);
          results.placesFound = true;
          results.bizName = place.name;
          results.rating = rating;
          results.reviewCount = count;
        } else {
          results.gbp = 10;
          results.reviews = 10;
          results.placesFound = false;
        }
      } catch (e) {
        results.gbp = 0;
        results.reviews = 0;
        results.placesError = e.message;
      }

      // 2. PageSpeed Insights — mobile speed (no key needed)
      if (siteUrl) {
        try {
          const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(siteUrl)}&strategy=mobile`;
          const psRes = await fetch(psUrl);
          const psData = await psRes.json();
          const score = psData.lighthouseResult?.categories?.performance?.score;
          results.speed = score != null ? Math.round(score * 100) : null;
        } catch (e) {
          results.speed = null;
        }
      } else {
        results.speed = null;
      }

      // 3. Keyword scan — fetch their site and check for local terms
      if (siteUrl) {
        try {
          const siteRes = await fetch(siteUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOrcery/1.0)" }
          });
          const html = await siteRes.text();
          const lower = html.toLowerCase();
          const cityLower = city.toLowerCase();
          const cityWords = cityLower.split(/[\s,]+/).filter(w => w.length > 2);

          let kwScore = 0;
          // Check title tag
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].toLowerCase() : "";
          if (cityWords.some(w => title.includes(w))) kwScore += 30;

          // Check meta description
          const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
          const meta = metaMatch ? metaMatch[1].toLowerCase() : "";
          if (cityWords.some(w => meta.includes(w))) kwScore += 20;

          // Check H1
          const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
          const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").toLowerCase() : "";
          if (cityWords.some(w => h1.includes(w))) kwScore += 25;

          // Check body text frequency
          const bodyText = lower.replace(/<[^>]+>/g, " ");
          const cityOccurrences = cityWords.reduce((acc, w) => {
            const matches = bodyText.match(new RegExp(w, "g"));
            return acc + (matches ? matches.length : 0);
          }, 0);
          if (cityOccurrences > 5)  kwScore += 15;
          if (cityOccurrences > 15) kwScore += 10;

          results.keywords = Math.min(kwScore, 100);
        } catch (e) {
          results.keywords = null;
          results.keywordError = e.message;
        }
      } else {
        results.keywords = null;
      }

      // 4. Citation consistency — smart estimate
      // (real data requires BrightLocal API — this is a logic-based estimate)
      let citationScore = 50; // baseline
      if (results.placesFound) citationScore += 20;
      if (results.gbp > 70)    citationScore += 15;
      if (results.reviews > 50) citationScore += 15;
      results.citations = Math.min(citationScore, 100);
      results.citationsEstimated = true;

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("SEOrcery Worker running ✓", {
      headers: corsHeaders
    });
  }
};
```

---

## Step 5 — Create the Widget (index.html)

Paste this into `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SEOrcery — Local SEO Score</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f4f6f8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { background: #fff; border-radius: 14px; box-shadow: 0 4px 24px rgba(0,0,0,0.10); max-width: 500px; width: 100%; overflow: hidden; }
    .hdr { background: #0D1B2A; padding: 1.5rem; }
    .hdr h1 { color: #fff; font-size: 20px; font-weight: 600; }
    .hdr p { color: #9FE1CB; font-size: 13px; margin-top: 4px; }
    .body { padding: 1.5rem; }
    label { display: block; font-size: 12px; color: #666; margin-bottom: 5px; margin-top: 14px; }
    input { width: 100%; height: 40px; border: 1px solid #ddd; border-radius: 8px; padding: 0 12px; font-size: 14px; }
    input:focus { outline: none; border-color: #00B4A6; }
    .hint { font-size: 11px; color: #999; margin-top: 3px; }
    button.main { width: 100%; height: 44px; background: #0D1B2A; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 1.25rem; letter-spacing: 0.3px; }
    button.main:hover { background: #1a2e45; }
    button.main:disabled { background: #aaa; cursor: default; }
    .results { display: none; padding: 1.5rem; border-top: 1px solid #eee; }
    .overall { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .overall-score { font-size: 42px; font-weight: 700; color: #0D1B2A; }
    .grade { font-size: 13px; font-weight: 600; padding: 5px 14px; border-radius: 20px; }
    .bar-row { margin-bottom: 13px; }
    .bar-meta { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
    .bar-name { color: #555; }
    .bar-val { font-weight: 600; color: #0D1B2A; }
    .bar-track { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.9s cubic-bezier(.4,0,.2,1); width: 0; }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 1rem; }
    .tag { font-size: 11px; padding: 3px 10px; border-radius: 12px; }
    .tag-warn { background: #FFF3CD; color: #856404; }
    .tag-ok   { background: #D1FAE5; color: #065F46; }
    .tag-info { background: #DBEAFE; color: #1E40AF; }
    .cta { background: #f8f9fa; border-radius: 10px; padding: 1rem; margin-top: 1.25rem; }
    .cta p { font-size: 13px; color: #555; line-height: 1.6; margin-bottom: 10px; }
    .cta button { width: 100%; height: 40px; background: #00B4A6; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .note { font-size: 11px; color: #aaa; text-align: center; padding: 0.75rem; }
  </style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <h1>🔮 SEOrcery</h1>
    <p>Free local SEO score — real data, real results</p>
  </div>
  <div class="body">
    <label>Business name *</label>
    <input id="biz" type="text" placeholder="e.g. Sunrise Plumbing" />

    <label>City / market *</label>
    <input id="city" type="text" placeholder="e.g. Fort Lauderdale, FL" />

    <label>Website URL <span style="color:#aaa;">(optional — enables speed + keyword checks)</span></label>
    <input id="siteUrl" type="text" placeholder="https://yourbusiness.com" />
    <p class="hint">Include https://</p>

    <button class="main" id="btn" onclick="runScore()">Analyze My SEO</button>
  </div>

  <div class="results" id="results">
    <div class="overall">
      <div>
        <div style="font-size:12px;color:#888;margin-bottom:4px;">Overall Score</div>
        <div class="overall-score" id="overall">—</div>
      </div>
      <span class="grade" id="grade"></span>
    </div>
    <div id="bars"></div>
    <div class="tag-row" id="tags"></div>
    <div class="cta">
      <p id="cta-text"></p>
      <button onclick="window.location.href='mailto:you@youremail.com?subject=SEO Help Request'">
        Get a free fix plan →
      </button>
    </div>
  </div>
  <div class="note">Powered by SEOrcery &bull; Citation data is estimated</div>
</div>

<script>
  // ⬇️ REPLACE THIS with your deployed Cloudflare Worker URL after Step 6
  const WORKER_URL = "https://seorcery-proxy.YOUR_SUBDOMAIN.workers.dev";

  const FACTORS = [
    { key: "gbp",       label: "Google Business Profile",   color: "#00B4A6" },
    { key: "reviews",   label: "Review score & velocity",   color: "#F5A623" },
    { key: "speed",     label: "Mobile page speed",         color: "#00B4A6" },
    { key: "keywords",  label: "Local keyword alignment",   color: "#F5A623" },
    { key: "citations", label: "Citation consistency *est", color: "#8B5CF6" },
  ];

  async function runScore() {
    const biz     = document.getElementById("biz").value.trim();
    const city    = document.getElementById("city").value.trim();
    const siteUrl = document.getElementById("siteUrl").value.trim();

    if (!biz || !city) { alert("Business name and city are required."); return; }

    const btn = document.getElementById("btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Analyzing...';

    try {
      const params = new URLSearchParams({ action: "score", bizName: biz, city });
      if (siteUrl) params.append("siteUrl", siteUrl);

      const res  = await fetch(`${WORKER_URL}?${params}`);
      const data = await res.json();

      // Calculate scores array
      const scores = FACTORS.map(f => {
        const v = data[f.key];
        return v != null ? v : 50; // fallback if data missing
      });
      const validScores = scores.filter((_, i) => data[FACTORS[i].key] != null);
      const overall = validScores.length > 0
        ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
        : 0;

      // Overall score
      document.getElementById("overall").textContent = overall + "/100";

      // Grade badge
      let grade, gc, gb;
      if (overall >= 75) { grade = "Strong";      gc = "#065F46"; gb = "#D1FAE5"; }
      else if (overall >= 55) { grade = "Fair";   gc = "#856404"; gb = "#FFF3CD"; }
      else { grade = "Needs Work"; gc = "#991B1B"; gb = "#FEE2E2"; }
      const gEl = document.getElementById("grade");
      gEl.textContent = grade;
      gEl.style.background = gb;
      gEl.style.color = gc;

      // Bars
      const barsEl = document.getElementById("bars");
      barsEl.innerHTML = "";
      FACTORS.forEach((f, i) => {
        const val = data[f.key];
        const display = val != null ? val : "—";
        const pct = val != null ? val : 0;
        barsEl.innerHTML += `
          <div class="bar-row">
            <div class="bar-meta">
              <span class="bar-name">${f.label}</span>
              <span class="bar-val">${typeof display === "number" ? display + "%" : display}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" id="bf${i}" style="background:${f.color};"></div>
            </div>
          </div>`;
      });

      requestAnimationFrame(() => {
        FACTORS.forEach((_, i) => {
          const v = data[FACTORS[i].key];
          const el = document.getElementById("bf" + i);
          if (el && v != null) el.style.width = v + "%";
        });
      });

      // Tags
      const tagsEl = document.getElementById("tags");
      tagsEl.innerHTML = "";
      if (!data.placesFound) tagsEl.innerHTML += `<span class="tag tag-warn">⚠ Not found on Google</span>`;
      if (data.gbp < 60)     tagsEl.innerHTML += `<span class="tag tag-warn">Incomplete GBP profile</span>`;
      if (data.reviews < 50) tagsEl.innerHTML += `<span class="tag tag-warn">Low review count</span>`;
      if (data.speed != null && data.speed < 50) tagsEl.innerHTML += `<span class="tag tag-warn">Slow mobile speed</span>`;
      if (data.keywords != null && data.keywords < 50) tagsEl.innerHTML += `<span class="tag tag-warn">Weak local keywords</span>`;
      if (data.gbp >= 80)    tagsEl.innerHTML += `<span class="tag tag-ok">Strong GBP</span>`;
      if (data.reviews >= 70) tagsEl.innerHTML += `<span class="tag tag-ok">Active reviews</span>`;
      if (data.placesFound)  tagsEl.innerHTML += `<span class="tag tag-info">Found: ${data.bizName}</span>`;

      // CTA message
      const ctaMsg = overall >= 75
        ? `${biz} has a strong local SEO foundation in ${city}. A few targeted improvements could push you to #1 in your market.`
        : overall >= 55
        ? `${biz} is visible in ${city} but leaving leads on the table. Most of these gaps are fast fixes.`
        : `${biz} has significant SEO gaps in ${city} — but that's actually good news. Low-hanging fruit = quick wins.`;
      document.getElementById("cta-text").textContent = ctaMsg;

      document.getElementById("results").style.display = "block";
    } catch (err) {
      alert("Something went wrong. Make sure your Worker URL is set correctly.\n\n" + err.message);
    }

    btn.innerHTML = "Re-analyze";
    btn.disabled = false;
  }
</script>
</body>
</html>
```

> **One thing to update:** Find `mailto:you@youremail.com` in the CTA button and replace with your real email or VLS's contact page URL.

---

## Step 6 — Deploy the Cloudflare Worker

### 6a. Log in to Cloudflare
In the VS Code terminal, navigate to the worker folder:
```bash
cd worker
wrangler login
```
This opens a browser window — log in or create a free Cloudflare account.

### 6b. Deploy
```bash
wrangler deploy
```
On success, it prints your Worker URL:
```
Published seorcery-proxy (x.xx sec)
  https://seorcery-proxy.YOUR_SUBDOMAIN.workers.dev
```

Copy that full URL.

### 6c. Paste the Worker URL into index.html
Back in `index.html`, find this line near the bottom:
```javascript
const WORKER_URL = "https://seorcery-proxy.YOUR_SUBDOMAIN.workers.dev";
```
Replace the placeholder with your actual URL.

---

## Step 7 — Deploy the Widget to GitHub Pages

In the VS Code terminal, go back to the root folder:
```bash
cd ..
git add .
git commit -m "Initial SEOrcery launch"
git push origin main
```

Then on GitHub:
1. Go to your repo: `https://github.com/YOUR_USERNAME/seorcery`
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **Deploy from a branch**
4. Branch: `main`, folder: `/ (root)`
5. Click **Save**

After ~60 seconds your widget is live at:
```
https://YOUR_USERNAME.github.io/seorcery/
```

---

## Step 8 — Test It End to End

1. Open `https://YOUR_USERNAME.github.io/seorcery/`
2. Enter a real local business name + city
3. Optionally enter their website URL
4. Click **Analyze My SEO**
5. You should see real scores in 3–5 seconds

**If it hangs or errors:**
- Open browser DevTools (F12) → Console tab — look for red errors
- Check that your Worker URL in `index.html` is correct
- Go to https://dash.cloudflare.com → Workers → your worker → **Logs** to see what's happening

---

## Step 9 — Update the CTA Button

Right now the CTA says "Get a free fix plan" and links to an email. You have options:

**Option A — Email lead capture (easiest)**
```html
<button onclick="window.location.href='mailto:yourname@email.com?subject=SEO Fix Plan for ' + document.getElementById('biz').value">
  Get a free fix plan →
</button>
```

**Option B — Link to VLS contact page**
```html
<button onclick="window.open('https://vlsmarketing.net/contact', '_blank')">
  Get a free fix plan →
</button>
```

**Option C — Embed a form (most leads)**  
Replace the button with a small email input + submit that posts to a free service like Formspree (https://formspree.io).

---

## Ongoing Workflow in VS Code

Every time you make changes:
```bash
# 1. Edit files in VS Code
# 2. Preview locally with Live Server (right-click index.html → Open with Live Server)
# 3. When happy, push to GitHub:
git add .
git commit -m "describe your change"
git push origin main
# 4. If worker.js changed, redeploy:
cd worker
wrangler deploy
cd ..
```

---

## Cost Summary

| Service | Cost |
|---|---|
| GitHub Pages | Free |
| Cloudflare Workers (up to 100k req/day) | Free |
| Google Places API (up to ~1,000 lookups/day) | Free |
| PageSpeed Insights API | Free (unlimited) |
| **Total** | **$0/month** |

When VLS starts embedding this on client sites and volume grows, the Google Places API free tier may need upgrading (~$17 per 1,000 extra lookups). Still very cheap.

---

## What to Show VLS

Once it's live, your pitch is:

> "Here's a real SEO audit tool running on your client's business name right now — live data from Google, real page speed scores, keyword analysis of their actual website. I built this in a weekend. Imagine what we can build for your clients together."

That's the close. 🔮

---

*Built with Google Places API, PageSpeed Insights API, and Cloudflare Workers.*  
*SEOrcery — by Rich Russ*
