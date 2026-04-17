# russellSPC — Social Content Engine
## Build Specification v4.0
### "90-Second Daily Machine"

> One click generates copy, image, audio, and a combined MP4 reel,
> then fires posts to all platforms simultaneously.
> Your only job: pick a voice and hit POST ALL.

---

## What Changed from v3

| v3 | v4 |
|----|-----|
| Manual Buffer upload (8 min of you) | Zernio API auto-posts all platforms (~5s) |
| Download MP3 + image separately | ffmpeg.wasm combines them → MP4 reel in browser |
| CapCut step for Reels format | Eliminated — ffmpeg handles it client-side |
| Buffer free tier (no real API) | Zernio free plan with working REST API |
| ~10 min daily | ~90 seconds daily |

---

## Daily Flow — What It Actually Looks Like

```
YOU:    Open app. Pick today's topic + tone. Pick a voice vibe.
        Click ⚡ GENERATE + ATTACK.

APP:    Generates copy (Claude)                     ~5s
        Generates branded image (DALL-E)            ~15s
        Generates voiceover MP3 (ElevenLabs)        ~8s
        Combines image + audio → MP4 reel           ~10s
          (ffmpeg.wasm, runs in your browser, no server)
        Shows you a preview card for each platform

YOU:    30 seconds: glance at LinkedIn post.
        Watch the 45-second reel preview.
        If good → click 🚀 POST ALL

APP:    Fires to LinkedIn + Instagram + Facebook     ~5s
        + Google Business simultaneously
        via Zernio API (one call, all platforms)

YOU:    Done. Close the tab.

TOTAL YOUR TIME: ~90 seconds.
```

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Technology Stack & Costs](#2-technology-stack--costs)
3. [Cloudflare Worker — All 4 Endpoints](#3-cloudflare-worker--all-4-endpoints)
4. [Zernio API — Auto-Posting](#4-zernio-api--auto-posting)
5. [ffmpeg.wasm — In-Browser Reel Assembly](#5-ffmpegwasm--in-browser-reel-assembly)
6. [ElevenLabs Voice Setup](#6-elevenlabs-voice-setup)
7. [Credential Setup](#7-credential-setup)
8. [Frontend App Spec](#8-frontend-app-spec)
9. [File Structure](#9-file-structure)
10. [Build Order](#10-build-order)
11. [Environment Variables](#11-environment-variables)
12. [Content Strategy](#12-content-strategy)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. System Architecture

```
BROWSER (index.html)
  │
  ├─ ffmpeg.wasm (loaded from CDN, cached)
  │    image + MP3 → MP4 reel, 100% client-side
  │
  ├─ Zernio API key (stored in localStorage, not sensitive)
  │    fires POST ALL directly from browser to Zernio
  │
  └─ HTTPS to Cloudflare Worker (all secret API keys live here)
       │
       ├── POST /generate-copy    → Anthropic API
       ├── POST /generate-image   → OpenAI DALL-E 3
       ├── POST /generate-audio   → ElevenLabs API
       └── GET  /brand-assets     → scrape russellSPC.com


POSTING FLOW:
  Browser → Zernio API (your key, not secret) → all platforms
  Zernio handles: LinkedIn, Instagram, Facebook, Google Business
  One API call. One response. All posted.
```

### Why Zernio key lives in browser (not Worker)

Zernio keys are per-account credentials scoped to YOUR profiles only.
Unlike Anthropic/OpenAI keys which could rack up charges if leaked,
a Zernio key can only post to your connected accounts.
Storing it in localStorage is acceptable — same risk level as a
saved password in your browser. Not worth the Worker round-trip.

---

## 2. Technology Stack & Costs

| Layer | Tool | Monthly Cost | Notes |
|-------|------|-------------|-------|
| Credential vault | Cloudflare Worker | **$0** | Free tier |
| Copy generation | Claude Sonnet | **~$0.90** | ~4k tokens/day |
| Image generation | DALL-E 3 | **~$2.40** | 1 image/day |
| Voice generation | ElevenLabs Starter | **$5.00** | 30k chars/mo |
| Video assembly | ffmpeg.wasm | **$0** | Runs in browser |
| Auto-posting | Zernio Free | **$0** | 3 channels free* |
| **TOTAL** | | **~$8.30/mo** | |

*Zernio free plan: 3 social channels, unlimited posts.
For LinkedIn + Instagram + Facebook + Google Business (4 channels),
Zernio's first paid tier is **$15/month** — still cheap.
Full cost with paid Zernio: **~$23.30/month.**

---

## 3. Cloudflare Worker — All 4 Endpoints

### wrangler.toml

```toml
name = "russellspc-social"
main = "src/worker.js"
compatibility_date = "2024-01-01"
```

### src/worker.js

```javascript
// russellSPC Social Worker v4
// Routes: /brand-assets · /generate-copy · /generate-image · /generate-audio

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors('', 200);

    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const isDev = !allowed ||
                  origin.includes('localhost') ||
                  origin.includes('127.0.0.1') ||
                  origin === '';
    if (!isDev && origin !== allowed) {
      return new Response('Forbidden', { status: 403 });
    }

    const path = new URL(request.url).pathname;
    try {
      if (path === '/brand-assets'   && request.method === 'GET')
        return await brandAssets(env);
      if (path === '/generate-copy'  && request.method === 'POST')
        return await generateCopy(request, env);
      if (path === '/generate-image' && request.method === 'POST')
        return await generateImage(request, env);
      if (path === '/generate-audio' && request.method === 'POST')
        return await generateAudio(request, env);
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return cors(JSON.stringify({ error: e.message }), 500);
    }
  }
};

// ── BRAND ASSETS ─────────────────────────────────────────────────────────────
async function brandAssets() {
  try {
    const html = await fetch('https://russellspc.com',
      { headers: { 'User-Agent': 'russellSPC-bot/1.0' } }
    ).then(r => r.text());

    const get = (pattern) => html.match(pattern)?.[1] || null;
    return cors(JSON.stringify({
      logo:        get(/property="og:image"\s+content="([^"]+)"/i),
      color:       get(/name="theme-color"\s+content="([^"]+)"/i) || '#7864ff',
      title:       get(/<title>([^<]+)<\/title>/i)?.trim() || 'russellSPC.com',
      description: get(/property="og:description"\s+content="([^"]+)"/i)
                || get(/name="description"\s+content="([^"]+)"/i)
                || 'White-label dev + AI-assisted builds'
    }), 200);
  } catch {
    return cors(JSON.stringify({
      logo: null, color: '#7864ff',
      title: 'russellSPC.com',
      description: 'White-label dev + AI-assisted builds'
    }), 200);
  }
}

// ── COPY GENERATION ───────────────────────────────────────────────────────────
async function generateCopy(request, env) {
  const { topic, tone, hook } = await request.json();

  const TOPICS = {
    whitelabel:  'White-label dev partnerships — Rich as the invisible technical partner for agencies. The agency delivers. Rich builds it.',
    vibecoding:  'AI-assisted / vibe coding — building production-grade tools fast with AI. Speed and cost advantage for clients.',
    consulting:  'Strategic digital consulting — smart technical decisions without enterprise agency overhead.',
    casestudy:   'Real result story — e.g. built SEO audit tool on Cloudflare in 3 days, now landing deals for an agency.',
    tip:         'Expert tip about AI dev tools, lean stacks, or building smart without bloated teams.',
    cta:         'Low-pressure inquiry post — inviting agency owners or startup founders to start a conversation.',
    credibility: 'Authority building — demonstrating depth across dev, digital marketing, and AI tooling.',
    behind:      'Behind the scenes — what building with AI actually looks like. Humanizes the brand.'
  };

  const prompt = `You write social content for russellSPC.com — Rich Russell, white-label dev + AI builder, Florida.

BRAND VOICE: Sharp, confident, results-focused. Speaks like a builder. Specific over vague. Real over polished.
AUDIENCE: Agency owners needing a trusted silent tech partner. Startup founders needing things built fast.
GOAL: Referral amplification — when someone is referred to Rich, this content confirms he's the real deal.
CTA: russellSPC.com

TOPIC: ${TOPICS[topic] || topic}
TONE: ${tone}
${hook ? `HOOK: "${hook}"` : 'Generate a strong specific non-generic hook.'}

Return ONLY raw JSON (no fences, no preamble):

{
  "linkedin": {
    "copy": "full linkedin post with 3-5 hashtags at end",
    "char_count": 0,
    "posting_note": "brief tip"
  },
  "audiogram": {
    "script": "45-60 sec spoken script, written for the EAR",
    "caption": "instagram/facebook caption + 5-8 hashtags",
    "voice_note": "direction for the voice talent",
    "word_count": 0
  },
  "google": {
    "copy": "google business post 100-150 words",
    "posting_note": "brief tip"
  }
}

LINKEDIN: 150-300 words. Hook → insight/story → low-pressure CTA. Hashtags at end only.
AUDIOGRAM SCRIPT: 100-130 words MAX. Short sentences. Natural rhythm. Opens strong. 
  Ends with spoken CTA ("head to russellSPC dot com").
  NO hashtags in script. Written so it sounds great when heard, not read.
GOOGLE: Service-forward. Local (Florida). URL. Clear CTA. For someone who just found you on Maps.

Return ONLY the raw JSON object.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Anthropic ${res.status}`);
  const raw = data.content.map(b => b.text || '').join('')
    .trim().replace(/^```json|^```|```$/gm, '').trim();
  return cors(raw, 200);
}

// ── IMAGE GENERATION ──────────────────────────────────────────────────────────
async function generateImage(request, env) {
  const { prompt, brandColor } = await request.json();

  const full = `${prompt}
Dark background. Tech-forward minimal aesthetic.
Accent: ${brandColor || '#7864ff'} purple-violet tones.
Abstract/conceptual — no people, no faces, no text.
Social media hero image. 16:9 landscape.
Scroll-stopping composition. Professional quality.`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: full,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      response_format: 'b64_json'   // base64 — avoids CORS on CDN URL
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
  return cors(JSON.stringify({ image: data.data[0].b64_json }), 200);
}

// ── AUDIO GENERATION ──────────────────────────────────────────────────────────
async function generateAudio(request, env) {
  const { script, voiceId } = await request.json();

  // Make URLs sound natural when spoken
  const clean = script
    .replace(/russellSPC\.com/gi, 'russell S P C dot com')
    .replace(/https?:\/\/\S+/g, 'russell S P C dot com')
    .replace(/\n+/g, ' ')
    .trim();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': env.ELEVEN_KEY
    },
    body: JSON.stringify({
      text: clean,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.80,
        style: 0.35,
        use_speaker_boost: true
      }
    })
  });

  if (!res.ok) throw new Error(`ElevenLabs: ${await res.text()}`);
  const buf = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return cors(JSON.stringify({ audio: b64 }), 200);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function cors(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
```

---

## 4. Zernio API — Auto-Posting

### Why Zernio

- Free plan available with working REST API (unlike Buffer which is beta-only)
- One API call posts to multiple platforms simultaneously
- Handles LinkedIn, Instagram, Facebook, Google Business
- Supports video (MP4) posting — critical for the reel
- No platform app review required — Zernio handles OAuth with each platform

### 4.1 Setup

1. Go to [zernio.com](https://zernio.com) → Sign up free
2. Connect your social accounts:
   - LinkedIn (personal profile)
   - Instagram Business
   - Facebook Page
   - Google Business Profile
3. Go to Settings → API → copy your API key
4. Paste key into the app's credential panel (stored in localStorage)

### 4.2 Posting — single API call from browser

```javascript
// Called from browser directly — Zernio key is not a secret
// (scoped to your accounts only, same risk as a saved password)

async function postAll(platforms, content, videoBlob, imageBlob) {
  // Upload video/image to Zernio media endpoint first
  const mediaUrl = await uploadMedia(videoBlob || imageBlob);

  const response = await fetch('https://api.zernio.com/v1/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getZernioKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      platforms,          // ['linkedin', 'instagram', 'facebook', 'google']
      content: {
        linkedin:  content.linkedin,
        instagram: content.audiogram.caption,
        facebook:  content.audiogram.caption,
        google:    content.google
      },
      media: [{
        type: videoBlob ? 'video' : 'image',
        url: mediaUrl
      }],
      schedule: 'now'    // or ISO timestamp for scheduling
    })
  });

  const result = await response.json();
  return result;  // { success: true, posts: { linkedin: id, instagram: id, ... } }
}

async function uploadMedia(blob) {
  const form = new FormData();
  form.append('file', blob, blob.type.includes('video') ? 'reel.mp4' : 'image.jpg');

  const res = await fetch('https://api.zernio.com/v1/media', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getZernioKey()}` },
    body: form
  });
  const data = await res.json();
  return data.url;
}
```

### 4.3 Platform content mapping

| Platform | Content sent | Media |
|----------|-------------|-------|
| LinkedIn | `linkedin.copy` | MP4 reel (optional, text-only also works) |
| Instagram | `audiogram.caption` | MP4 reel (required for Reels) |
| Facebook | `audiogram.caption` | MP4 reel |
| Google Business | `google.copy` | Image (GBP doesn't support video posts) |

This means two media assets:
- **MP4 reel** → LinkedIn + Instagram + Facebook
- **Original image** → Google Business

Both are generated and available in the app before posting.

---

## 5. ffmpeg.wasm — In-Browser Reel Assembly

ffmpeg.wasm runs entirely inside the browser — no server, no upload, no cost.
Your data stays on your device.

This is the piece that eliminates CapCut. The app takes:
- The DALL-E image (base64 → PNG in memory)
- The ElevenLabs audio (base64 → MP3 in memory)
- Combines them into a 1080x1080 (square) or 1920x1080 (landscape) MP4

### 5.1 Load ffmpeg.wasm

```html
<!-- In index.html <head> -->
<script src="https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js"></script>
<script src="https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js"></script>
```

### 5.2 Combine function

```javascript
// Runs after both image and audio are ready
// imageB64: base64 string from DALL-E (now returned as b64_json)
// audioB64: base64 string from ElevenLabs

async function combineIntoReel(imageB64, audioB64) {
  setStatus('assembling reel…');

  const { FFmpeg } = window.FFmpegWASM;
  const { fetchFile, toBlobURL } = window.FFmpegUtil;

  // Load ffmpeg core (cached after first load, ~32MB)
  if (!window._ffmpeg) {
    window._ffmpeg = new FFmpeg();
    await window._ffmpeg.load({
      coreURL: await toBlobURL(
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        'text/javascript'
      ),
      wasmURL: await toBlobURL(
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        'application/wasm'
      )
    });
  }

  const ffmpeg = window._ffmpeg;

  // Decode base64 → Uint8Array → write to ffmpeg virtual filesystem
  const imgBytes = Uint8Array.from(atob(imageB64), c => c.charCodeAt(0));
  const audBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));

  await ffmpeg.writeFile('image.png', imgBytes);
  await ffmpeg.writeFile('audio.mp3', audBytes);

  // Probe audio duration so video length matches exactly
  // FFmpeg command: image (looped) + audio → MP4
  // -loop 1          : loop the still image
  // -i image.png     : input image
  // -i audio.mp3     : input audio
  // -c:v libx264     : H.264 video codec (universal compatibility)
  // -tune stillimage : optimized for still-image video
  // -c:a aac         : AAC audio (required for MP4)
  // -b:a 192k        : audio bitrate
  // -pix_fmt yuv420p : pixel format for broadest compatibility
  // -vf scale=1920:1080 : ensure 1080p output
  // -shortest        : end when audio ends

  await ffmpeg.exec([
    '-loop', '1',
    '-i', 'image.png',
    '-i', 'audio.mp3',
    '-c:v', 'libx264',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
    '-shortest',
    'reel.mp4'
  ]);

  // Read output from virtual filesystem
  const data = await ffmpeg.readFile('reel.mp4');

  // Clean up virtual filesystem
  await ffmpeg.deleteFile('image.png');
  await ffmpeg.deleteFile('audio.mp3');
  await ffmpeg.deleteFile('reel.mp4');

  // Return as Blob
  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);

  // Store for posting and download
  window.REEL_BLOB = blob;
  window.REEL_URL  = url;

  // Show preview
  const video = document.getElementById('reel-preview');
  video.src = url;
  video.style.display = 'block';

  setStatus('reel ready — preview it, then post all');
  return blob;
}
```

### 5.3 Performance notes

- First load: ~30s (downloads 32MB ffmpeg-core.wasm, cached permanently after)
- Subsequent loads: instant (from browser cache)
- Encoding a 60-second reel: ~15-25s (depends on machine)
- Memory: uses ~200-400MB RAM during encoding — fine on any modern laptop
- The only network request the page makes is to load the FFmpeg.wasm binary itself (~30MB, cached after first load).

---

## 6. ElevenLabs Voice Setup

### 6.1 Create account + subscribe

1. [elevenlabs.io](https://elevenlabs.io) → Sign up
2. **Starter plan: $5/month** — 30,000 chars, commercial rights, full voice library
3. Profile → API Keys → copy key
4. `wrangler secret put ELEVEN_KEY`

### 6.2 Build your voice palette (one-time, 20 min)

1. ElevenLabs → Voices → Voice Library
2. Filter: Language = English, Use Case = Social Media or Narration
3. Try these search terms to find good options:
   - "confident narrator" → authority posts
   - "conversational" → tips, behind-the-scenes
   - "professional female" → sharp CTA posts
   - "warm friendly" → approachable content
4. Add 4-6 voices to My Voices
5. Note each Voice ID (in the voice's settings URL)

### 6.3 Voice palette stored in app

```javascript
// In index.html — hardcode your chosen voices here
// Voice IDs from ElevenLabs are not secrets
const VOICE_PALETTE = [
  {
    id: 'YOUR_VOICE_ID_1',
    name: 'Authority',
    gender: 'male',
    description: 'Deep, measured, confident — case studies and credentials',
    emoji: '🎯'
  },
  {
    id: 'YOUR_VOICE_ID_2',
    name: 'Builder',
    gender: 'male',
    description: 'Warm, conversational — tips and behind-the-scenes',
    emoji: '🔨'
  },
  {
    id: 'YOUR_VOICE_ID_3',
    name: 'Sharp',
    gender: 'female',
    description: 'Crisp, professional — CTA and white-label pitch',
    emoji: '⚡'
  },
  {
    id: 'YOUR_VOICE_ID_4',
    name: 'Friendly',
    gender: 'female',
    description: 'Warm, energetic — community and intro content',
    emoji: '✨'
  }
];
```

---

## 7. Credential Setup

### 7.1 Worker secrets (encrypted, never in code)

```bash
wrangler secret put ANTHROPIC_KEY    # sk-ant-...
wrangler secret put OPENAI_KEY       # sk-proj-...
wrangler secret put ELEVEN_KEY       # ElevenLabs API key
wrangler secret put ALLOWED_ORIGIN   # https://YOUR-GITHUB-PAGES-URL.github.io
```

### 7.2 Client-side (localStorage, not secrets)

```javascript
// Zernio key — scoped to your accounts, same risk as saved browser password
localStorage.setItem('russellspc_zernio_key', 'YOUR_ZERNIO_KEY');

// Voice palette — not sensitive at all
localStorage.setItem('russellspc_voices', JSON.stringify(VOICE_PALETTE));

// Worker URL — not sensitive
localStorage.setItem('russellspc_worker_url', 'https://russellspc-social.XXX.workers.dev');
```

### 7.3 What lives where

| Credential | Location | Why |
|-----------|---------|-----|
| ANTHROPIC_KEY | Worker secret | Cost risk if leaked |
| OPENAI_KEY | Worker secret | Cost risk if leaked |
| ELEVEN_KEY | Worker secret | Cost risk if leaked |
| Zernio API key | localStorage | Only posts to your accounts |
| Voice IDs | Hardcoded in app | Not sensitive |
| Worker URL | Hardcoded in app | Not sensitive |

---

## 8. Frontend App Spec

### 8.1 Full pipeline function

```javascript
// THE MAIN FUNCTION — wired to ⚡ GENERATE + ATTACK button

async function generateAndAttack() {
  const btn = document.getElementById('gen-btn');
  btn.disabled = true;

  try {
    // ── STEP 1: Generate copy ─────────────────────────────
    setStatus('writing copy…');
    const copyRes = await workerPost('/generate-copy', {
      topic: getVal('topic'),
      tone:  getActiveTone(),
      hook:  getVal('hook')
    });
    const copy = JSON.parse(await copyRes.text());
    renderCopy(copy);

    // ── STEP 2: Generate image ────────────────────────────
    setStatus('generating image…');
    const imgRes = await workerPost('/generate-image', {
      prompt:     copy.audiogram.script.substring(0, 400),
      brandColor: window.BRAND_COLOR || '#7864ff'
    });
    const { image: imageB64 } = await imgRes.json();
    window.IMAGE_B64 = imageB64;
    renderImage(imageB64);

    // ── STEP 3: Generate audio ────────────────────────────
    setStatus('generating voiceover…');
    const voiceId = getSelectedVoice();
    const audRes = await workerPost('/generate-audio', {
      script: copy.audiogram.script,
      voiceId
    });
    const { audio: audioB64 } = await audRes.json();
    window.AUDIO_B64 = audioB64;

    // ── STEP 4: Combine → MP4 reel ────────────────────────
    setStatus('assembling reel…');
    const reelBlob = await combineIntoReel(imageB64, audioB64);
    window.REEL_BLOB = reelBlob;

    // ── STEP 5: Store image blob for GBP ─────────────────
    const imgBytes = Uint8Array.from(atob(imageB64), c => c.charCodeAt(0));
    window.IMAGE_BLOB = new Blob([imgBytes], { type: 'image/png' });

    // ── DONE ──────────────────────────────────────────────
    setStatus('ready — review and post all');
    document.getElementById('post-all-btn').disabled = false;
    document.getElementById('download-all-btn').disabled = false;

  } catch(e) {
    setStatus(`error: ${e.message}`);
    toast(e.message);
  }

  btn.disabled = false;
}

// ── POST ALL function ─────────────────────────────────────────────
async function postAll() {
  const btn = document.getElementById('post-all-btn');
  btn.disabled = true;
  setStatus('posting to all platforms…');

  const copy = window.CURRENT_COPY;

  try {
    // Upload reel (for LinkedIn, IG, FB)
    setStatus('uploading reel…');
    const reelUrl = await uploadToZernio(window.REEL_BLOB, 'reel.mp4');

    // Upload image (for Google Business — doesn't support video)
    setStatus('uploading image…');
    const imgUrl = await uploadToZernio(window.IMAGE_BLOB, 'image.png');

    // Fire to all platforms in one call
    setStatus('posting…');
    const result = await fetch('https://api.zernio.com/v1/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getZernioKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        posts: [
          {
            platform: 'linkedin',
            content: copy.linkedin.copy,
            media: [{ url: reelUrl, type: 'video' }]
          },
          {
            platform: 'instagram',
            content: copy.audiogram.caption,
            media: [{ url: reelUrl, type: 'video' }]
          },
          {
            platform: 'facebook',
            content: copy.audiogram.caption,
            media: [{ url: reelUrl, type: 'video' }]
          },
          {
            platform: 'google_business',
            content: copy.google.copy,
            media: [{ url: imgUrl, type: 'image' }]
          }
        ]
      })
    }).then(r => r.json());

    // Show results per platform
    renderPostResults(result);
    setStatus('posted ✓');
    toast('all platforms posted!', 'green');

  } catch(e) {
    setStatus(`post error: ${e.message}`);
    toast(e.message);
  }

  btn.disabled = false;
}

async function uploadToZernio(blob, filename) {
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch('https://api.zernio.com/v1/media', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getZernioKey()}` },
    body: form
  });
  const data = await res.json();
  if (!data.url) throw new Error('Media upload failed');
  return data.url;
}
```

### 8.2 UI layout

```
HEADER
  russellSPC // social engine    [status: ready]

SIDEBAR                    MAIN
  ─ Worker URL ─           ─ COPY CARDS ─────────────────────
  [connected ✓]
                           ┌─ LinkedIn ───────────────────────┐
  ─ Content ─              │  [editable post copy]            │
  topic: [select]          │  copy btn                        │
  tone: [pills]            └──────────────────────────────────┘
  hook: [textarea]
                           ┌─ Audiogram ──────────────────────┐
  ─ Voice ─                │  Script: [editable]              │
  [male] [female] [all]    │  Voice note: [italic hint]       │
  [Authority ●]            │  Caption: [editable]             │
  [Builder   ]             └──────────────────────────────────┘
  [Sharp     ]
  [Friendly  ]             ┌─ Reel Preview ───────────────────┐
                           │  [video element]                 │
  ─ Zernio ─               │  1920×1080 MP4                   │
  [key: ••••••••]          │  ↓ download reel                 │
  [connected ✓]            └──────────────────────────────────┘

  ─────────────           ┌─ Image ──────────────────────────┐
                          │  [img preview]                   │
  ⚡ GENERATE + ATTACK    │  ↓ download image                │
                          └──────────────────────────────────┘
  🚀 POST ALL [disabled]
                          ┌─ Google Business ────────────────┐
  ↓ DOWNLOAD ALL          │  [editable post copy]            │
                          │  copy btn                        │
                          └──────────────────────────────────┘

                          ┌─ Post Results ──────────────────┐
                          │  (appears after POST ALL)        │
                          │  LinkedIn  ✓ posted              │
                          │  Instagram ✓ posted              │
                          │  Facebook  ✓ posted              │
                          │  Google    ✓ posted              │
                          └──────────────────────────────────┘
```

### 8.3 Download All

When user clicks ↓ DOWNLOAD ALL:

```javascript
async function downloadAll() {
  // 1. Download the MP4 reel
  if (window.REEL_URL) {
    const a = document.createElement('a');
    a.href = window.REEL_URL;
    a.download = `russellspc-reel-${dateSlug()}.mp4`;
    a.click();
  }

  // 2. Download the image
  if (window.IMAGE_B64) {
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${window.IMAGE_B64}`;
    a.download = `russellspc-image-${dateSlug()}.png`;
    a.click();
  }

  // 3. Download text pack
  const copy = window.CURRENT_COPY;
  const text = [
    `russellSPC.com — Content Pack ${new Date().toLocaleDateString()}`,
    '═'.repeat(50),
    '',
    'LINKEDIN POST',
    '─'.repeat(40),
    copy?.linkedin?.copy || '',
    '',
    'AUDIOGRAM SCRIPT',
    '─'.repeat(40),
    copy?.audiogram?.script || '',
    '',
    'INSTAGRAM / FACEBOOK CAPTION',
    '─'.repeat(40),
    copy?.audiogram?.caption || '',
    '',
    'GOOGLE BUSINESS',
    '─'.repeat(40),
    copy?.google?.copy || '',
  ].join('\n');

  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `russellspc-posts-${dateSlug()}.txt`;
  a.click();

  toast('all files downloaded!', 'green');
}
```

---

## 9. File Structure

```
russellSPC-social-engine/
├── index.html                   ← Complete app — open daily
├── BUILD_SPEC_V4.md             ← This file
│
└── russellspc-worker/           ← Deploy once, runs forever
    ├── wrangler.toml
    └── src/
        └── worker.js
```

---

## 10. Build Order

```
PHASE 1 — Worker (25 min)
  □ npm install -g wrangler && wrangler login
  □ Create project, write worker.js with all 4 routes
  □ wrangler secret put ANTHROPIC_KEY
  □ wrangler secret put OPENAI_KEY
  □ wrangler secret put ELEVEN_KEY
  □ wrangler secret put ALLOWED_ORIGIN
  □ wrangler deploy
  □ Test each endpoint with curl

PHASE 2 — ElevenLabs voices (20 min)
  □ Create Starter account ($5/mo)
  □ Browse library, add 4-6 voices
  □ Note Voice IDs
  □ Update VOICE_PALETTE in index.html

PHASE 3 — Zernio (15 min)
  □ Create Zernio account (free or $15/mo for 4 channels)
  □ Connect LinkedIn + Instagram + Facebook + GBP
  □ Copy API key
  □ Check Zernio docs for exact API endpoint format
    (verify: /v1/posts schema, /v1/media upload format)

PHASE 4 — Frontend (90 min)
  □ Build index.html per Section 8 spec
  □ Add ffmpeg.wasm script tags
  □ Wire generateAndAttack() to ⚡ button
  □ Wire combineIntoReel() after audio generation
  □ Wire postAll() to 🚀 button
  □ Wire downloadAll() to ↓ button
  □ Test full pipeline:
    generate → preview reel → post all → verify in each platform

PHASE 5 — Deploy (10 min)
  □ Push index.html to GitHub
  □ Enable GitHub Pages
  □ Update ALLOWED_ORIGIN Worker secret
  □ Final end-to-end test from live URL
```

---

## 11. Environment Variables

| Key | Where | Secret? |
|-----|-------|---------|
| ANTHROPIC_KEY | Worker secret | ✅ |
| OPENAI_KEY | Worker secret | ✅ |
| ELEVEN_KEY | Worker secret | ✅ |
| ALLOWED_ORIGIN | Worker secret | ❌ |
| Zernio API key | localStorage | ⚠️ low-risk |
| Voice IDs | Hardcoded | ❌ |

---

## 12. Content Strategy

**The one-sentence strategy:**
Every post answers the question a referred prospect asks themselves:
*"Is this person the real deal?"*

**Weekly rotation:**
```
Mon  → Case study / result  (proof)
Tue  → Expert tip           (expertise)
Wed  → Behind the scenes    (humanizes)
Thu  → CTA post             (invitation)
Fri  → Credibility moment   (authority)
```

**What performs for B2B services:**
- Specific always beats vague
- "Built X in Y days" beats "I build things fast"
- The comment section matters more than the post
  → Reply to every comment within an hour
  → That's where referral relationships deepen

---

## 13. Troubleshooting

| Problem | Fix |
|---------|-----|
| ffmpeg slow first load | Normal — 30MB WASM caches after first run |
| Reel encoding slow | Normal — 15-25s, WASM is ~24x slower than native |
| "Out of memory" during encode | Refresh tab, try again — WASM uses ~400MB RAM |
| Zernio API 401 | Check key in localStorage → app credentials panel |
| Zernio Instagram fails | Verify IG account is Business/Creator type |
| Audio sounds flat | Try a different voice ID — quality varies significantly |
| Image not in reel | Verify imageB64 is correct before passing to ffmpeg |
| Worker 403 | Set ALLOWED_ORIGIN secret to match your GitHub Pages URL |

---

*russellSPC.com Social Content Engine v4*
*Stack: Cloudflare Worker · Claude Sonnet · DALL-E 3*
*ElevenLabs Starter · ffmpeg.wasm · Zernio API · GitHub Pages*
*Monthly cost: ~$8.30 (free Zernio) or ~$23.30 (paid Zernio 4 channels)*
*Your daily time: ~90 seconds*
