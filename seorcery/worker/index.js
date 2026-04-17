// ============================================================
//  SEOrcery — Cloudflare Worker
//  Handles all API calls so your Google key stays secret.
//  Deploy: wrangler deploy  (from the /worker folder)
//  Secrets: GOOGLE_API_KEY, TURNSTILE_SECRET
// ============================================================

// ── Cloudflare Turnstile verification ──
async function verifyTurnstile(token, secret, ip) {
  if (!token) return { success: false, error: "No Turnstile token" };
  if (!secret) return { success: false, error: "Turnstile not configured" };
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  return res.json();
}

// ── In-memory IP rate limiter: 5 requests per IP per hour ──
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ipHits = new Map();
function checkRateLimit(ip) {
  if (!ip) return { allowed: true };
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    return { allowed: false, resetMs: RATE_LIMIT_WINDOW_MS - (now - hits[0]) };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 10000) {
    for (const [k, v] of ipHits) {
      if (v.filter(t => now - t < RATE_LIMIT_WINDOW_MS).length === 0) ipHits.delete(k);
    }
  }
  return { allowed: true };
}

export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get("action");
    const apiKey = env.GOOGLE_API_KEY;

    // ── Health check ────────────────────────────────────────
    if (!action) {
      return new Response(
        JSON.stringify({ status: "SEOrcery Worker running ✓" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Rate limit + Turnstile gate for all actions ──
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      const mins = Math.ceil(rate.resetMs / 60000);
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.` }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const turnstileToken = url.searchParams.get("turnstileToken");
    const tsResult = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
    if (!tsResult.success) {
      return new Response(
        JSON.stringify({ error: "Verification failed. Please refresh and try again." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Main scoring action ──────────────────────────────────
    if (action === "score") {
      const bizName = (url.searchParams.get("bizName") || "").trim();
      const city    = (url.searchParams.get("city")    || "").trim();
      const siteUrl = (url.searchParams.get("siteUrl") || "").trim();

      if (!bizName || !city) {
        return new Response(
          JSON.stringify({ error: "bizName and city are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results = {};

      // ── Fetch site HTML once (reused for keywords + tech SEO) ──
      let siteHtml = null;
      let siteFetchOk = false;
      if (siteUrl) {
        try {
          const siteRes = await fetch(siteUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; SEOrceryBot/1.0; +https://seorcery.dev)"
            },
            redirect: "follow",
          });
          siteHtml = await siteRes.text();
          siteFetchOk = true;
        } catch (e) {
          results.siteFetchError = e.message;
        }
      }

      // ── 1. Google Places API (New) ─────────────────────────
      try {
        const fieldMask = [
          "places.displayName",
          "places.rating",
          "places.userRatingCount",
          "places.regularOpeningHours",
          "places.formattedAddress",
          "places.photos",
          "places.websiteUri",
          "places.businessStatus",
        ].join(",");

        const placesRes = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": fieldMask,
            },
            body: JSON.stringify({ textQuery: `${bizName} ${city}` }),
          }
        );
        const placesData = await placesRes.json();
        const place      = placesData.places?.[0];

        if (place && place.businessStatus !== "CLOSED_PERMANENTLY") {
          // GBP completeness — tighter scoring, harder to max
          const photoCount = place.photos?.length || 0;
          let gbp = 10; // base: found on Google
          if (place.rating)                       gbp += 8;  // has any rating
          if (place.regularOpeningHours)          gbp += 12; // hours listed
          if (photoCount >= 1)                    gbp += 5;  // has any photos
          if (photoCount >= 3)                    gbp += 10; // decent photo set
          if (photoCount >= 6)                    gbp += 8;  // rich media
          if (place.websiteUri)                   gbp += 10; // website linked
          if (place.rating >= 4.0)                gbp += 10; // good rating
          if (place.rating >= 4.5)                gbp += 7;  // great rating
          if ((place.userRatingCount || 0) >= 50) gbp += 10; // active profile
          if ((place.userRatingCount || 0) >= 100) gbp += 10; // well-maintained
          results.gbp = Math.min(gbp, 100);

          // Review health — granular tiers, hard to max without volume + quality
          const count  = place.userRatingCount || 0;
          const rating = place.rating || 0;
          let reviews  = 0;
          if (count >= 1)    reviews += 5;   // has any
          if (count >= 5)    reviews += 8;   // getting started
          if (count >= 15)   reviews += 8;   // building momentum
          if (count >= 30)   reviews += 10;  // solid base
          if (count >= 50)   reviews += 10;  // strong
          if (count >= 100)  reviews += 10;  // very strong
          if (count >= 200)  reviews += 7;   // dominant
          if (rating >= 3.5) reviews += 8;   // decent rating
          if (rating >= 4.0) reviews += 10;  // good rating
          if (rating >= 4.5) reviews += 12;  // excellent rating
          // Recency penalty: low count + high rating = probably not sustained
          if (count < 10 && rating >= 4.5) reviews -= 5;
          results.reviews     = Math.max(0, Math.min(reviews, 100));
          results.placesFound = true;
          results.bizName     = place.displayName?.text || bizName;
          results.rating      = rating;
          results.reviewCount = count;
          results.photoCount  = photoCount;
          results.hasWebsite  = !!place.websiteUri;
          results.hasHours    = !!place.regularOpeningHours;

        } else {
          results.gbp         = 5;
          results.reviews     = 5;
          results.placesFound = false;
          results.bizName     = bizName;
        }

      } catch (e) {
        results.gbp         = null;
        results.reviews     = null;
        results.placesFound = false;
        results.placesError = e.message;
      }

      // ── 2. PageSpeed Insights ────────────────────────────
      if (siteUrl) {
        try {
          const psUrl =
            `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
            `?url=${encodeURIComponent(siteUrl)}&strategy=mobile&key=${apiKey}`;
          const psRes  = await fetch(psUrl);
          const psData = await psRes.json();

          if (psData.error) {
            // PageSpeed couldn't reach the site — that's still useful data
            const msg = psData.error.message || "";
            if (msg.includes("FAILED_DOCUMENT_REQUEST") || msg.includes("ERR_CONNECTION")) {
              results.speed       = 5;
              results.speedTested = true;
              results.speedNote   = "Site unreachable by Google";
            } else if (msg.includes("DNS_FAILURE")) {
              results.speed       = 5;
              results.speedTested = true;
              results.speedNote   = "DNS failure — site may be down";
            } else {
              results.speed       = 10;
              results.speedTested = true;
              results.speedNote   = "Could not analyze site";
            }
          } else {
            const score = psData.lighthouseResult?.categories?.performance?.score;
            results.speed       = score != null ? Math.round(score * 100) : null;
            results.speedTested = true;

            // Pull extra metrics + store Lighthouse vitals for CrUX fallback
            const audits = psData.lighthouseResult?.audits;
            if (audits) {
              const fcp = audits["first-contentful-paint"]?.displayValue;
              const lcp = audits["largest-contentful-paint"]?.displayValue;
              if (fcp) results.fcp = fcp;
              if (lcp) results.lcp = lcp;

              // Store raw Lighthouse vitals for CrUX fallback
              results._lhLcp = audits["largest-contentful-paint"]?.numericValue;
              results._lhCls = audits["cumulative-layout-shift"]?.numericValue;
              results._lhInp = audits["interaction-to-next-paint"]?.numericValue
                            || audits["total-blocking-time"]?.numericValue; // TBT as INP proxy
            }
          }
        } catch (e) {
          results.speed       = null;
          results.speedTested = false;
          results.speedError  = e.message;
        }
      } else {
        results.speed       = null;
        results.speedTested = false;
      }

      // ── 3. Chrome UX Report (Core Web Vitals) ────────────
      // Try exact URL first, then fall back to origin-level data
      if (siteUrl) {
        try {
          const cruxEndpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`;
          const cruxHeaders  = { "Content-Type": "application/json" };

          let cruxRes = await fetch(cruxEndpoint, {
            method: "POST", headers: cruxHeaders,
            body: JSON.stringify({ url: siteUrl }),
          });
          let cruxData = await cruxRes.json();

          // Fall back to origin if URL-level has no data
          if (!cruxData.record?.metrics) {
            const origin = new URL(siteUrl).origin;
            cruxRes  = await fetch(cruxEndpoint, {
              method: "POST", headers: cruxHeaders,
              body: JSON.stringify({ origin }),
            });
            cruxData = await cruxRes.json();
          }

          const metrics = cruxData.record?.metrics;

          if (metrics) {
            let vitals = 0;
            const vitalsDetails = [];

            // LCP — Largest Contentful Paint (good < 2500ms)
            const lcpMs = metrics.largest_contentful_paint?.percentiles?.p75;
            if (lcpMs != null) {
              if (lcpMs <= 2500)      { vitals += 35; vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s ✓`); }
              else if (lcpMs <= 4000) { vitals += 20; vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s`); }
              else                    { vitals += 5;  vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s ✗`); }
            }

            // INP — Interaction to Next Paint (good < 200ms)
            const inpMs = metrics.interaction_to_next_paint?.percentiles?.p75;
            if (inpMs != null) {
              if (inpMs <= 200)      { vitals += 35; vitalsDetails.push(`INP ${inpMs}ms ✓`); }
              else if (inpMs <= 500) { vitals += 20; vitalsDetails.push(`INP ${inpMs}ms`); }
              else                   { vitals += 5;  vitalsDetails.push(`INP ${inpMs}ms ✗`); }
            }

            // CLS — Cumulative Layout Shift (good < 0.1)
            const cls = metrics.cumulative_layout_shift?.percentiles?.p75;
            if (cls != null) {
              const clsVal = cls / 100; // CrUX returns CLS * 100
              if (clsVal <= 0.1)      { vitals += 30; vitalsDetails.push(`CLS ${clsVal.toFixed(2)} ✓`); }
              else if (clsVal <= 0.25) { vitals += 15; vitalsDetails.push(`CLS ${clsVal.toFixed(2)}`); }
              else                     { vitals += 5;  vitalsDetails.push(`CLS ${clsVal.toFixed(2)} ✗`); }
            }

            results.vitals        = Math.min(vitals, 100);
            results.vitalsTested  = true;
            results.vitalsDetails = vitalsDetails;
          } else {
            // No CrUX data — fall back to Lighthouse metrics
            if (results._lhLcp != null) {
              let vitals = 0;
              const vitalsDetails = [];

              const lcpMs = results._lhLcp;
              if (lcpMs <= 2500)      { vitals += 35; vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s ✓`); }
              else if (lcpMs <= 4000) { vitals += 20; vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s`); }
              else                    { vitals += 5;  vitalsDetails.push(`LCP ${(lcpMs/1000).toFixed(1)}s ✗`); }

              const clsVal = results._lhCls;
              if (clsVal != null) {
                if (clsVal <= 0.1)      { vitals += 30; vitalsDetails.push(`CLS ${clsVal.toFixed(2)} ✓`); }
                else if (clsVal <= 0.25) { vitals += 15; vitalsDetails.push(`CLS ${clsVal.toFixed(2)}`); }
                else                     { vitals += 5;  vitalsDetails.push(`CLS ${clsVal.toFixed(2)} ✗`); }
              }

              // Use TBT as INP proxy (good < 200ms)
              const tbt = results._lhInp;
              if (tbt != null) {
                if (tbt <= 200)      { vitals += 35; vitalsDetails.push(`TBT ${Math.round(tbt)}ms ✓`); }
                else if (tbt <= 600) { vitals += 20; vitalsDetails.push(`TBT ${Math.round(tbt)}ms`); }
                else                 { vitals += 5;  vitalsDetails.push(`TBT ${Math.round(tbt)}ms ✗`); }
              }

              vitalsDetails.push("(from Lighthouse)");
              results.vitals        = Math.min(vitals, 100);
              results.vitalsTested  = true;
              results.vitalsDetails = vitalsDetails;
            } else {
              results.vitals       = null;
              results.vitalsTested = true;
              results.vitalsNote   = "Site unreachable for analysis";
            }
          }
        } catch (e) {
          results.vitals       = null;
          results.vitalsTested = false;
          results.vitalsError  = e.message;
        }
      } else {
        results.vitals       = null;
        results.vitalsTested = false;
      }

      // Clean up internal Lighthouse fields
      delete results._lhLcp;
      delete results._lhCls;
      delete results._lhInp;

      // ── 4. Keyword alignment ─────────────────────────────
      if (siteUrl && siteFetchOk && siteHtml) {
        try {
          const html  = siteHtml;
          const lower = html.toLowerCase();
          const cityLower = city.toLowerCase();

          const stopWords = new Set(["the","and","for","of","in","a","an","to","is","at","on","or"]);
          const cityTokens = cityLower
            .split(/[\s,]+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
          const fullCity = cityTokens.join(" ");

          const body = lower
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ");

          const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title  = titleM ? titleM[1].toLowerCase() : "";

          const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
          const meta  = metaM ? metaM[1].toLowerCase() : "";

          const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const h1  = h1M ? h1M[1].replace(/<[^>]+>/g, "").toLowerCase() : "";

          const hTags = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
            .map(m => m[1].replace(/<[^>]+>/g, "").toLowerCase())
            .join(" ");

          const hasLocalSchema = lower.includes("localbusiness") || lower.includes("local_business");
          const hasPhone   = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(body);
          const hasAddress = /\d+\s+[\w\s]+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court)\b/i.test(body);
          const hasGeoMeta = lower.includes('name="geo') || lower.includes("maps.google") || lower.includes("google.com/maps");

          let kw = 0;
          const details = [];

          if (fullCity && title.includes(fullCity)) {
            kw += 20; details.push("City in title");
          } else if (cityTokens.some(w => title.includes(w))) {
            kw += 12; details.push("Partial city in title");
          }

          if (cityTokens.some(w => meta.includes(w))) {
            kw += 12; details.push("City in meta description");
          }

          if (cityTokens.some(w => h1.includes(w))) {
            kw += 15; details.push("City in H1");
          }

          if (cityTokens.some(w => hTags.includes(w))) {
            kw += 8; details.push("City in subheadings");
          }

          const occurrences = cityTokens.reduce((acc, w) => {
            const m = body.match(new RegExp(`\\b${w}\\b`, "g"));
            return acc + (m ? m.length : 0);
          }, 0);
          if (occurrences > 2)  kw += 5;
          if (occurrences > 8)  kw += 5;
          if (occurrences > 15) kw += 5;

          if (hasPhone)       { kw += 3;  details.push("Phone number found"); }
          if (hasAddress)     { kw += 3;  details.push("Street address found"); }
          if (hasLocalSchema) { kw += 12; details.push("LocalBusiness schema"); }
          if (hasGeoMeta)     { kw += 5;  details.push("Map/geo signals"); }

          results.keywords        = Math.min(kw, 100);
          results.keywordTested   = true;
          results.cityOccurrences = occurrences;
          results.keywordDetails  = details;

        } catch (e) {
          results.keywords      = null;
          results.keywordTested = false;
          results.keywordError  = e.message;
        }
      } else {
        results.keywords      = siteUrl ? null : null;
        results.keywordTested = !!siteUrl;
      }

      // ── 5. Technical SEO — tighter scoring with more checks ──
      if (siteUrl) {
        try {
          let tech = 0;
          const techDetails = [];

          // HTTPS (10 pts)
          if (siteUrl.startsWith("https://")) {
            tech += 10; techDetails.push("HTTPS ✓");
          } else {
            techDetails.push("No HTTPS ✗");
          }

          // Sitemap.xml (10 pts)
          try {
            const origin = new URL(siteUrl).origin;
            const smRes  = await fetch(`${origin}/sitemap.xml`, {
              method: "HEAD",
              headers: { "User-Agent": "SEOrceryBot/1.0" },
              redirect: "follow",
            });
            if (smRes.ok) {
              tech += 10; techDetails.push("Sitemap found");
            } else {
              techDetails.push("No sitemap");
            }
          } catch {
            techDetails.push("No sitemap");
          }

          // robots.txt (8 pts)
          try {
            const origin  = new URL(siteUrl).origin;
            const robRes  = await fetch(`${origin}/robots.txt`, {
              headers: { "User-Agent": "SEOrceryBot/1.0" },
              redirect: "follow",
            });
            const robText = await robRes.text();
            if (robRes.ok && robText.toLowerCase().includes("user-agent")) {
              tech += 8; techDetails.push("robots.txt found");
            } else {
              techDetails.push("No robots.txt");
            }
          } catch {
            techDetails.push("No robots.txt");
          }

          if (siteFetchOk && siteHtml) {
            const lower = siteHtml.toLowerCase();

            // Image alt tags (12 pts)
            const imgTags   = siteHtml.match(/<img\b[^>]*>/gi) || [];
            const totalImgs = imgTags.length;
            const withAlt   = imgTags.filter(t => /\balt\s*=\s*["'][^"']+/i.test(t)).length;
            if (totalImgs === 0) {
              tech += 6;
            } else {
              const altPct = withAlt / totalImgs;
              if (altPct >= 0.9)      tech += 12;
              else if (altPct >= 0.5) tech += 6;
              else                    tech += 2;
              techDetails.push(`${withAlt}/${totalImgs} images have alt text`);
            }

            // Meta viewport (8 pts)
            if (lower.includes('name="viewport"')) {
              tech += 8; techDetails.push("Mobile viewport ✓");
            } else {
              techDetails.push("No viewport tag");
            }

            // Meta description present (8 pts)
            const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+/i.test(siteHtml)
                             || /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(siteHtml);
            if (hasMetaDesc) {
              tech += 8; techDetails.push("Meta description ✓");
            } else {
              techDetails.push("No meta description");
            }

            // Canonical tag (8 pts)
            if (lower.includes('rel="canonical"') || lower.includes("rel='canonical'")) {
              tech += 8; techDetails.push("Canonical tag ✓");
            } else {
              techDetails.push("No canonical tag");
            }

            // Lang attribute (5 pts)
            if (/<html[^>]+lang=/i.test(siteHtml)) {
              tech += 5; techDetails.push("Lang attribute ✓");
            } else {
              techDetails.push("No lang attribute");
            }

            // Open Graph tags (8 pts)
            const hasOG = lower.includes('property="og:') || lower.includes("property='og:");
            if (hasOG) {
              tech += 8; techDetails.push("Open Graph tags ✓");
            } else {
              techDetails.push("No Open Graph tags");
            }

            // Heading structure — has H1 (5 pts)
            if (/<h1[\s>]/i.test(siteHtml)) {
              tech += 5; techDetails.push("Has H1 tag");
            } else {
              techDetails.push("Missing H1 tag");
            }

            // Social media links (up to 8 pts — 3pts each, max 8)
            const socials = [
              { name: "Facebook",  pattern: "facebook.com/" },
              { name: "Instagram", pattern: "instagram.com/" },
              { name: "LinkedIn",  pattern: "linkedin.com/" },
              { name: "Yelp",      pattern: "yelp.com/" },
              { name: "X/Twitter", pattern: "twitter.com/" },
              { name: "X",         pattern: "x.com/" },
              { name: "YouTube",   pattern: "youtube.com/" },
            ];
            const found = [];
            for (const s of socials) {
              if (lower.includes(s.pattern) && !found.includes(s.name)) {
                found.push(s.name);
              }
            }
            const socialPts = Math.min(found.length * 3, 8);
            tech += socialPts;
            if (found.length > 0) {
              techDetails.push(`Social: ${found.slice(0, 3).join(", ")}`);
            } else {
              techDetails.push("No social links");
            }
          }

          results.techSeo        = Math.min(tech, 100);
          results.techSeoTested  = true;
          results.techSeoDetails = techDetails;

        } catch (e) {
          results.techSeo       = null;
          results.techSeoTested = false;
          results.techSeoError  = e.message;
        }
      } else {
        results.techSeo       = null;
        results.techSeoTested = false;
      }

      // ── 6. Citation consistency (smart estimate) ─────────
      // Much tighter — most businesses should land 30-55
      {
        let cit = 15; // baseline (was 40 — way too generous)
        if (results.placesFound)           cit += 12; // exists on Google
        if (results.hasWebsite)            cit += 10; // website matches listing
        if (results.hasHours)              cit += 8;  // hours = consistent data
        if (results.gbp > 50)              cit += 8;  // decent profile
        if (results.gbp > 75)              cit += 10; // strong profile
        if (results.reviews > 30)          cit += 8;  // some review activity
        if (results.reviews > 60)          cit += 10; // strong review signals
        if (results.reviewCount >= 50)     cit += 8;  // volume = visibility
        if ((results.photoCount || 0) >= 3) cit += 6; // photos = active listing
        if (results.rating >= 4.0)         cit += 5;  // quality signal
        results.citations          = Math.min(cit, 100);
        results.citationsEstimated = true;
      }

      // ── Overall score ─────────────────────────────────────
      const scoreKeys = ["gbp","reviews","speed","vitals","keywords","techSeo","citations"];
      const available = scoreKeys.filter(k => results[k] != null);
      results.overall     = available.length > 0
        ? Math.round(available.reduce((a, k) => a + results[k], 0) / available.length)
        : 0;
      results.factorCount = available.length;

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Radar action — bulk lead finder ────────────────────────
    if (action === "radar") {
      const industry = (url.searchParams.get("industry") || "").trim();
      const city     = (url.searchParams.get("city")     || "").trim();
      const limit    = Math.min(parseInt(url.searchParams.get("limit") || "20"), 60);

      if (!industry || !city) {
        return new Response(
          JSON.stringify({ error: "industry and city are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const fieldMask = [
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.rating",
          "places.userRatingCount",
          "places.regularOpeningHours",
          "places.photos",
          "places.websiteUri",
          "places.businessStatus",
          "places.id",
        ].join(",");

        const allRaw   = [];
        let pageToken  = null;
        const perPage  = Math.min(limit, 20); // API max per request is 20
        const maxPages = Math.ceil(limit / 20);
        let pages      = 0;

        do {
          const reqBody = { textQuery: `${industry} in ${city}`, maxResultCount: perPage };
          if (pageToken) reqBody.pageToken = pageToken;

          const placesRes = await fetch(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": fieldMask + ",nextPageToken",
              },
              body: JSON.stringify(reqBody),
            }
          );
          const placesData = await placesRes.json();
          const batch = (placesData.places || []).filter(
            p => p.businessStatus !== "CLOSED_PERMANENTLY"
          );
          allRaw.push(...batch);
          pageToken = placesData.nextPageToken || null;
          pages++;
        } while (pageToken && allRaw.length < limit && pages < maxPages);

        const rawPlaces = allRaw.slice(0, limit);

        // Map to a simplified format the frontend expects
        const places = rawPlaces.map(p => ({
          name:               p.displayName?.text || "",
          formatted_address:  p.formattedAddress || "",
          lat:                p.location?.latitude,
          lng:                p.location?.longitude,
          rating:             p.rating || 0,
          user_ratings_total: p.userRatingCount || 0,
          opening_hours:      !!p.regularOpeningHours,
          photos:             p.photos || [],
          website:            p.websiteUri || null,
          place_id:           p.id || null,
        }));

        // Compute center from average of all place coordinates
        const withCoords = places.filter(p => p.lat && p.lng);
        const center = withCoords.length > 0
          ? {
              lat: withCoords.reduce((a, p) => a + p.lat, 0) / withCoords.length,
              lng: withCoords.reduce((a, p) => a + p.lng, 0) / withCoords.length,
            }
          : { lat: 0, lng: 0 };

        return new Response(
          JSON.stringify({ places, center, total: places.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } catch (e) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Unknown action ───────────────────────────────────────
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
