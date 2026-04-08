// ============================================================
//  SEOrcery — Cloudflare Worker
//  Handles all API calls so your Google key stays secret.
//  Deploy: wrangler deploy  (from the /worker folder)
// ============================================================

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

      // ── 1. Google Places API (New) ─────────────────────────
      // Uses the Places API (New) Text Search endpoint
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
          // GBP completeness: max 100
          let gbp = 30; // base — found on Google at all
          if (place.rating)                       gbp += 15; // has ratings
          if (place.regularOpeningHours)          gbp += 20; // hours set
          if (place.photos?.length >= 3)          gbp += 20; // has photos
          if (place.websiteUri)                   gbp += 15; // website linked
          results.gbp = Math.min(gbp, 100);

          // Review health: count + rating
          const count  = place.userRatingCount || 0;
          const rating = place.rating || 0;
          let reviews  = 0;
          if (count >= 1)  reviews += 15;
          if (count >= 10) reviews += 20;
          if (count >= 25) reviews += 20;
          if (count >= 50) reviews += 20;
          if (rating >= 4.0) reviews += 15;
          if (rating >= 4.5) reviews += 10;
          results.reviews     = Math.min(reviews, 100);
          results.placesFound = true;
          results.bizName     = place.displayName?.text || bizName;
          results.rating      = rating;
          results.reviewCount = count;
          results.hasWebsite  = !!place.websiteUri;
          results.hasHours    = !!place.regularOpeningHours;

        } else {
          // Business not found on Google — that itself is a big SEO issue
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
      // No API key required — completely free
      if (siteUrl) {
        try {
          const psUrl =
            `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
            `?url=${encodeURIComponent(siteUrl)}&strategy=mobile`;
          const psRes  = await fetch(psUrl);
          const psData = await psRes.json();
          const score  = psData.lighthouseResult?.categories?.performance?.score;
          results.speed       = score != null ? Math.round(score * 100) : null;
          results.speedTested = true;

          // Pull a few extra metrics if available
          const audits = psData.lighthouseResult?.audits;
          if (audits) {
            const fcp = audits["first-contentful-paint"]?.displayValue;
            const lcp = audits["largest-contentful-paint"]?.displayValue;
            if (fcp) results.fcp = fcp;
            if (lcp) results.lcp = lcp;
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

      // ── 3. Keyword alignment ─────────────────────────────
      // Fetches their real website and checks for local SEO signals
      if (siteUrl) {
        try {
          const siteRes = await fetch(siteUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; SEOrceryBot/1.0; +https://seorcery.dev)"
            },
            // Don't follow infinite redirects
            redirect: "follow",
          });

          const html       = await siteRes.text();
          const lower      = html.toLowerCase();
          const cityLower  = city.toLowerCase();
          const cityTokens = cityLower
            .split(/[\s,]+/)
            .filter(w => w.length > 2 && !["the","and","for","fl","ca","tx","ny"].includes(w));

          let kw = 0;

          // Title tag — highest signal
          const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title  = titleM ? titleM[1].toLowerCase() : "";
          if (cityTokens.some(w => title.includes(w))) kw += 30;

          // Meta description
          const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
          const meta  = metaM ? metaM[1].toLowerCase() : "";
          if (cityTokens.some(w => meta.includes(w))) kw += 20;

          // H1 tag
          const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const h1  = h1M ? h1M[1].replace(/<[^>]+>/g, "").toLowerCase() : "";
          if (cityTokens.some(w => h1.includes(w))) kw += 25;

          // Body text frequency
          const body = lower.replace(/<style[\s\S]*?<\/style>/gi, "")
                            .replace(/<script[\s\S]*?<\/script>/gi, "")
                            .replace(/<[^>]+>/g, " ");
          const occurrences = cityTokens.reduce((acc, w) => {
            const m = body.match(new RegExp(`\\b${w}\\b`, "g"));
            return acc + (m ? m.length : 0);
          }, 0);
          if (occurrences > 3)  kw += 10;
          if (occurrences > 10) kw += 10;
          if (occurrences > 20) kw += 5;

          results.keywords      = Math.min(kw, 100);
          results.keywordTested = true;
          results.cityOccurrences = occurrences;

        } catch (e) {
          results.keywords      = null;
          results.keywordTested = false;
          results.keywordError  = e.message;
        }
      } else {
        results.keywords      = null;
        results.keywordTested = false;
      }

      // ── 4. Citation consistency (smart estimate) ─────────
      // Real citation data requires BrightLocal API ($).
      // This is a logic-based estimate using what we already know.
      {
        let cit = 40; // baseline
        if (results.placesFound)          cit += 20; // exists on Google
        if (results.gbp > 70)             cit += 15; // profile is complete
        if (results.reviews > 50)         cit += 15; // active business signals
        if (results.hasWebsite)           cit += 10; // website matches listing
        results.citations          = Math.min(cit, 100);
        results.citationsEstimated = true;
      }

      // ── Overall score ─────────────────────────────────────
      const scoreKeys  = ["gbp","reviews","speed","keywords","citations"];
      const available  = scoreKeys.filter(k => results[k] != null);
      results.overall  = available.length > 0
        ? Math.round(available.reduce((a, k) => a + results[k], 0) / available.length)
        : 0;
      results.factorCount = available.length;

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Unknown action ───────────────────────────────────────
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};
