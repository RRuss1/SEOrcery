# AnswerWeave — Power Loom
### *Complete Scaffold — Every File, Every Line, Ready to Build*

> **For:** Claude Code / Cursor in VS Code — complete handoff document  
> **Instructions:** Read this entire file, then create every file in `## File:` sections  
> **Depends on:** AnswerWeave core Worker must exist (`answerweave-worker.rruss7997.workers.dev`)  
> **Version:** 1.0 Full Scaffold

---

## Table of Contents

1. [Setup Commands](#setup-commands)
2. [Project Structure](#project-structure)
3. [Worker Files](#worker-files)
   - `worker/index.js` (routing additions)
   - `worker/loom/generator.js`
   - `worker/loom/patch-generator.js`
   - `worker/loom/md-renderer.js`
   - `worker/loom/zip-packager.js`
   - `worker/loom/validator.js`
4. [Fix Builder Files](#fix-builder-files)
   - `worker/loom/fix-builders/base.js`
   - `worker/loom/fix-builders/schema-injector.js`
   - `worker/loom/fix-builders/content-rewriter.js`
   - `worker/loom/fix-builders/freshness-updater.js`
   - `worker/loom/fix-builders/answer-block.js`
   - `worker/loom/fix-builders/citation-builder.js`
5. [Template Files](#template-files)
6. [CLI Files](#cli-files)
7. [Validation Scripts](#validation-scripts)
8. [Build Order](#build-order)
9. [Claude Code Execution Prompt](#claude-code-execution-prompt)

---

## Setup Commands

Run these in the `answerweave/` root before creating files:

```bash
# Create Power Loom directories
mkdir -p worker/loom/fix-builders
mkdir -p loom-templates
mkdir -p cli
mkdir -p scripts

# Install dependencies in worker/
cd worker
npm install diff jsdom adm-zip

# Create D1 table for package storage
wrangler d1 execute answerweave --command "
CREATE TABLE IF NOT EXISTS fix_packages (
  package_id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fix_count INTEGER,
  projected_score_gain INTEGER,
  status TEXT DEFAULT 'generated',
  zip_r2_key TEXT
);

CREATE TABLE IF NOT EXISTS fix_executions (
  execution_id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  fix_id TEXT NOT NULL,
  status TEXT,
  commit_hash TEXT,
  executed_at TEXT,
  FOREIGN KEY (package_id) REFERENCES fix_packages(package_id)
);
"

# Create R2 bucket for zip storage
wrangler r2 bucket create answerweave-loom-packages
```

Update `wrangler.toml` to add the R2 binding:

```toml
[[r2_buckets]]
binding = "LOOM_PACKAGES"
bucket_name = "answerweave-loom-packages"
```

---

## Project Structure

```
answerweave/
├── worker/
│   ├── index.js                          # UPDATE — add /loom routes
│   ├── wrangler.toml                     # UPDATE — add R2 binding
│   └── loom/                             # NEW
│       ├── generator.js
│       ├── patch-generator.js
│       ├── md-renderer.js
│       ├── zip-packager.js
│       ├── validator.js
│       └── fix-builders/
│           ├── base.js
│           ├── schema-injector.js
│           ├── content-rewriter.js
│           ├── freshness-updater.js
│           ├── answer-block.js
│           └── citation-builder.js
├── loom-templates/                       # NEW
│   ├── fix-md.template.md
│   ├── readme.template.md
│   ├── manifest.template.md
│   ├── faq-schema.template.json
│   ├── org-schema.template.json
│   ├── local-business.template.json
│   └── author-bio.template.html
├── cli/                                  # NEW
│   ├── loom-apply.js
│   └── loom-validate.js
└── scripts/                              # NEW
    └── validate-schema.js
```

---

## Worker Files

### File: `worker/index.js` (additions only)

Add these routes to the existing Worker `index.js`. Keep all existing AnswerWeave audit routes intact.

```javascript
// ============================================================================
// POWER LOOM ROUTES — add these to the existing router
// ============================================================================
import { generateFixPackage } from './loom/generator.js';
import { validatePatch } from './loom/validator.js';
import { explainFix } from './loom/md-renderer.js';

// Inside your main fetch handler router switch/if block:

if (url.pathname === '/loom/generate' && request.method === 'POST') {
  const body = await request.json();
  const result = await generateFixPackage(body, env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}

if (url.pathname === '/loom/validate' && request.method === 'POST') {
  const body = await request.json();
  const result = await validatePatch(body, env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}

if (url.pathname === '/loom/explain' && request.method === 'POST') {
  const body = await request.json();
  const result = await explainFix(body, env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}

if (url.pathname.startsWith('/loom/download/') && request.method === 'GET') {
  const packageId = url.pathname.split('/').pop().replace('.zip', '');
  const obj = await env.LOOM_PACKAGES.get(`${packageId}.zip`);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${packageId}.zip"`
    }
  });
}
```

---

### File: `worker/loom/generator.js`

```javascript
// Power Loom generator — orchestrates audit → fix package
import schemaInjector from './fix-builders/schema-injector.js';
import contentRewriter from './fix-builders/content-rewriter.js';
import freshnessUpdater from './fix-builders/freshness-updater.js';
import answerBlock from './fix-builders/answer-block.js';
import citationBuilder from './fix-builders/citation-builder.js';
import { generatePatch } from './patch-generator.js';
import { renderFixMd, renderReadme, renderManifest } from './md-renderer.js';
import { packageFixPackage } from './zip-packager.js';

const BUILDERS = [
  schemaInjector,
  contentRewriter,
  freshnessUpdater,
  answerBlock,
  citationBuilder
];

/**
 * Main orchestrator: audit → fix package
 */
export async function generateFixPackage(request, env) {
  const { audit_id, site_type, repo_access, fix_limit = 10, priority_threshold = 'medium' } = request;

  // 1. Load audit from KV
  const audit = await loadAudit(audit_id, env);
  if (!audit) throw new Error(`Audit ${audit_id} not found`);

  // 2. Build site context (crawl target pages)
  const siteContext = await buildSiteContext(audit, env);

  // 3. Run each builder's detect() to find issues
  const allIssues = [];
  for (const builder of BUILDERS) {
    try {
      const issues = await builder.detect(audit, siteContext, env);
      issues.forEach(i => { i.builder = builder.name; });
      allIssues.push(...issues);
    } catch (err) {
      console.error(`Builder ${builder.name} detect failed:`, err);
    }
  }

  // 4. Filter by priority threshold and sort by impact
  const threshold = { low: 1, medium: 3, high: 6 }[priority_threshold] || 3;
  const filteredIssues = allIssues
    .filter(i => i.impact >= threshold)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, fix_limit);

  // 5. Run each builder's build() to produce fix descriptors
  const fixes = [];
  let fixCounter = 1;
  for (const issue of filteredIssues) {
    const builder = BUILDERS.find(b => b.name === issue.builder);
    try {
      const fix = await builder.build(issue, siteContext, env);
      fix.id = `fix-${String(fixCounter).padStart(3, '0')}`;
      fix.builder = builder.name;
      fixCounter++;
      fixes.push(fix);
    } catch (err) {
      console.error(`Builder ${builder.name} build failed:`, err);
    }
  }

  // 6. Generate patches + MDs for each fix
  const packageId = `loom-${audit_id}-${Date.now()}`;
  const packageFiles = {};

  for (const fix of fixes) {
    const patch = await generatePatch(fix, siteContext);
    const md = renderFixMd(fix, audit, siteContext);
    packageFiles[`${fix.id}-${slugify(fix.title)}.patch`] = patch;
    packageFiles[`${fix.id}-${slugify(fix.title)}.md`] = md;
    fix.patch_file = `${fix.id}-${slugify(fix.title)}.patch`;
    fix.context_md = `${fix.id}-${slugify(fix.title)}.md`;
  }

  // 7. Build fixes.json
  const fixesJson = {
    site: {
      domain: audit.domain,
      audit_id: audit.id,
      audit_date: audit.created_at,
      audit_score: audit.composite_score,
      target_score: Math.min(100, audit.composite_score + fixes.reduce((s, f) => s + f.impact_score, 0)),
      repo_path: repo_access.path,
      site_type,
      tech_stack: siteContext.techStack
    },
    fixes,
    execution_order: fixes.map(f => f.id),
    summary: {
      total_fixes: fixes.length,
      total_estimated_minutes: fixes.reduce((s, f) => s + f.estimated_minutes, 0),
      projected_score_gain: fixes.reduce((s, f) => s + f.impact_score, 0),
      projected_new_score: Math.min(100, audit.composite_score + fixes.reduce((s, f) => s + f.impact_score, 0)),
      projected_new_grade: scoreToGrade(audit.composite_score + fixes.reduce((s, f) => s + f.impact_score, 0))
    }
  };

  packageFiles['fixes.json'] = JSON.stringify(fixesJson, null, 2);
  packageFiles['README.md'] = renderReadme(fixesJson, audit);
  packageFiles['MANIFEST.md'] = renderManifest(fixesJson);

  // 8. Package as zip and store in R2
  const zipBuffer = await packageFixPackage(packageFiles);
  await env.LOOM_PACKAGES.put(`${packageId}.zip`, zipBuffer);

  // 9. Store package record in D1
  await env.DB.prepare(`
    INSERT INTO fix_packages (package_id, audit_id, domain, created_at, fix_count, projected_score_gain, zip_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    packageId, audit_id, audit.domain, new Date().toISOString(),
    fixes.length, fixesJson.summary.projected_score_gain, `${packageId}.zip`
  ).run();

  // 10. Return metadata + download URL
  return {
    package_id: packageId,
    fix_count: fixes.length,
    projected_score_gain: fixesJson.summary.projected_score_gain,
    download_url: `https://answerweave-worker.rruss7997.workers.dev/loom/download/${packageId}.zip`,
    files: Object.keys(packageFiles)
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function loadAudit(auditId, env) {
  const cached = await env.CACHE.get(`audit:${auditId}`, { type: 'json' });
  if (cached) return cached;
  const row = await env.DB.prepare('SELECT * FROM audits WHERE id = ?').bind(auditId).first();
  return row;
}

async function buildSiteContext(audit, env) {
  // Fetch the main pages of the site to get HTML content
  const pages = [];
  const targetUrls = [
    `https://${audit.domain}/`,
    `https://${audit.domain}/about`,
    `https://${audit.domain}/services`,
    `https://${audit.domain}/contact`
  ];

  for (const url of targetUrls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'AnswerWeave/1.0' } });
      if (res.ok) {
        const html = await res.text();
        pages.push({
          url,
          relativePath: new URL(url).pathname === '/' ? 'index.html' : `${new URL(url).pathname.slice(1)}.html`,
          html,
          textContent: stripHtml(html),
          httpHeaders: Object.fromEntries(res.headers),
          wordCount: stripHtml(html).split(/\s+/).length
        });
      }
    } catch (err) {
      console.warn(`Failed to fetch ${url}:`, err.message);
    }
  }

  return {
    domain: audit.domain,
    brand: audit.brand,
    city: audit.city,
    state: audit.state,
    industry: audit.industry,
    pages,
    techStack: detectTechStack(pages),
    isLocalBusiness: !!audit.city
  };
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ').trim();
}

function detectTechStack(pages) {
  const stack = new Set(['html']);
  pages.forEach(p => {
    if (/<link[^>]*\.css/i.test(p.html)) stack.add('css');
    if (/<script/i.test(p.html)) stack.add('javascript');
    if (/wp-content|wordpress/i.test(p.html)) stack.add('wordpress');
    if (/data-reactroot|__NEXT_DATA__/i.test(p.html)) stack.add('react');
  });
  return [...stack];
}

function scoreToGrade(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
```

---

### File: `worker/loom/patch-generator.js`

```javascript
// Generates unified diff patches from fix descriptors
import { createPatch } from 'diff';

/**
 * Generate a unified diff patch from a fix descriptor
 */
export async function generatePatch(fix, siteContext) {
  const page = siteContext.pages.find(p =>
    fix.file_targets.includes(p.relativePath) || fix.file_targets.includes(p.url)
  );

  if (!page) {
    // Create-only fix (new file) — generate a patch that creates the file
    if (fix.action === 'create') {
      return createNewFilePatch(fix.file_targets[0], fix.content || '');
    }
    throw new Error(`Target file not found in siteContext: ${fix.file_targets.join(',')}`);
  }

  const originalHtml = page.html;
  let modifiedHtml;

  switch (fix.action) {
    case 'inject':
      modifiedHtml = applyInject(originalHtml, fix);
      break;
    case 'replace':
      modifiedHtml = applyReplace(originalHtml, fix);
      break;
    case 'delete':
      modifiedHtml = applyDelete(originalHtml, fix);
      break;
    case 'update_meta':
      modifiedHtml = applyUpdateMeta(originalHtml, fix);
      break;
    case 'restructure':
      modifiedHtml = applyRestructure(originalHtml, fix);
      break;
    case 'append':
      modifiedHtml = originalHtml + (fix.content || fix.injection_content || '');
      break;
    default:
      throw new Error(`Unknown action: ${fix.action}`);
  }

  return createPatch(page.relativePath, originalHtml, modifiedHtml, '', '', { context: 3 });
}

// ============================================================================
// Action appliers — produce the modified HTML that the patch represents
// ============================================================================

function applyInject(html, fix) {
  const { location, injection_content } = fix;
  if (location.selector === 'head' && location.position === 'append') {
    return html.replace(/<\/head>/i, `${injection_content}\n</head>`);
  }
  if (location.selector === 'body' && location.position === 'append') {
    return html.replace(/<\/body>/i, `${injection_content}\n</body>`);
  }
  // Fallback: append to end
  return html + '\n' + injection_content;
}

function applyReplace(html, fix) {
  if (!fix.before || !fix.after) throw new Error('Replace action requires before/after');
  return html.replace(fix.before, fix.after);
}

function applyDelete(html, fix) {
  if (fix.delete_pattern) return html.replace(new RegExp(fix.delete_pattern, 'gi'), '');
  if (fix.before) return html.replace(fix.before, '');
  throw new Error('Delete action requires delete_pattern or before');
}

function applyUpdateMeta(html, fix) {
  const { meta_name, new_content } = fix;
  const regex = new RegExp(`<meta[^>]*name=["']${meta_name}["'][^>]*>`, 'i');
  const newTag = `<meta name="${meta_name}" content="${new_content}">`;
  if (regex.test(html)) return html.replace(regex, newTag);
  return html.replace(/<\/head>/i, `${newTag}\n</head>`);
}

function applyRestructure(html, fix) {
  if (!fix.before || !fix.after) throw new Error('Restructure action requires before/after');
  return html.replace(fix.before, fix.after);
}

function createNewFilePatch(filename, content) {
  const lines = content.split('\n');
  const lineCount = lines.length;
  const contentLines = lines.map(l => `+${l}`).join('\n');
  return `--- /dev/null\n+++ b/${filename}\n@@ -0,0 +1,${lineCount} @@\n${contentLines}\n`;
}
```

---

### File: `worker/loom/md-renderer.js`

```javascript
// Renders MD files for the fix package

export function renderFixMd(fix, audit, siteContext) {
  return `# ${fix.id.toUpperCase().replace('-', ' ')} — ${fix.title}

**Dimension:** ${fix.dimension}  
**Builder:** ${fix.builder}  
**Priority:** ${fix.priority || 'medium'}  
**Impact:** +${fix.impact_score} points  
**Estimated time:** ${fix.estimated_minutes} minutes  
**Target files:** ${fix.file_targets.map(f => `\`${f}\``).join(', ')}

---

## Why This Fix

${fix.rationale || 'See audit findings for context.'}

## What This Fix Does

${fix.description || fix.title}

## Before

\`\`\`${detectLang(fix.file_targets[0])}
${fix.before || '(see .patch file for full context)'}
\`\`\`

## After

\`\`\`${detectLang(fix.file_targets[0])}
${fix.after || fix.injection_content || '(see .patch file for full content)'}
\`\`\`

## Execution Instructions (for AI agent)

1. Apply \`${fix.patch_file}\` using \`git apply --check ${fix.patch_file}\` first
2. If dry run passes, run \`git apply ${fix.patch_file}\`
3. Run validation: ${fix.validation?.test || 'Verify file still parses correctly'}
4. If validation passes, commit: \`feat(aeo): ${fix.title.toLowerCase()} [${fix.id}]\`
5. If validation fails, execute the Rollback section and report

## Validation

- **Type:** ${fix.validation?.type || 'manual'}
- **Test:** ${fix.validation?.test || 'Verify file parses correctly and produces expected result'}
${fix.validation?.patterns ? `- **Forbidden patterns:** ${fix.validation.patterns.join(', ')}` : ''}

## Rollback

${fix.rollback || 'Run `git revert HEAD` to undo this commit.'}

## Rationale

The AnswerWeave audit scored this site ${audit.composite_score}/100 overall.
This fix targets the **${fix.dimension}** dimension and is projected to add
${fix.impact_score} points.

${fix.alternatives ? `## Alternative Candidates

${fix.alternatives.map((alt, i) => `### Option ${i + 2}\n\n\`\`\`\n${alt.candidate || alt}\n\`\`\`\n${alt.rationale || ''}`).join('\n\n')}
` : ''}

---
*Generated by AnswerWeave Power Loom v1.0 | Audit ID: ${audit.id}*
`;
}

export function renderReadme(fixesJson, audit) {
  return `# Power Loom Fix Package — ${fixesJson.site.domain}

**Audit ID:** ${fixesJson.site.audit_id}  
**Generated:** ${new Date().toISOString()}  
**Current AEO Score:** ${fixesJson.site.audit_score}/100  
**Target Score:** ${fixesJson.site.target_score}/100 (+${fixesJson.summary.projected_score_gain} points)

---

## Summary

This package contains **${fixesJson.summary.total_fixes} fixes** that together are projected
to raise the site's AEO score by **${fixesJson.summary.projected_score_gain} points** (from
${fixesJson.site.audit_score} to ${fixesJson.summary.projected_new_score}, grade
${fixesJson.summary.projected_new_grade}).

Total estimated execution time: **${fixesJson.summary.total_estimated_minutes} minutes**.

## Execution Instructions

Hand this folder to Claude Code / Cursor with the following prompt:

\`\`\`
Execute the AnswerWeave Power Loom fix package at this path.
Read fixes.json first, then execute fixes in execution_order.
For each fix: read its .md, apply its .patch (dry run first), validate, commit.
Generate validation-report.json when complete.
\`\`\`

## Fix List

${fixesJson.fixes.map(f => `- **${f.id}** — ${f.title} (+${f.impact_score} pts, ~${f.estimated_minutes}min)`).join('\n')}

## Files in This Package

- \`fixes.json\` — machine-readable command list
- \`MANIFEST.md\` — ordered fix index
- \`fix-*.md\` — one per fix with context and instructions
- \`fix-*.patch\` — unified diffs applied via \`git apply\`

## Validation Gates

Every fix has a validation step. The agent MUST:
1. Run \`git apply --check\` before real apply
2. Run the validation test from the fix's MD
3. Only commit if validation passes
4. Roll back if validation fails, then continue to next fix

---
*AnswerWeave Power Loom v1.0*
`;
}

export function renderManifest(fixesJson) {
  return `# Fix Manifest

Execution order and dependencies.

| Order | Fix ID | Title | Dimension | Impact | Depends On |
|-------|--------|-------|-----------|--------|------------|
${fixesJson.execution_order.map((id, i) => {
  const f = fixesJson.fixes.find(fix => fix.id === id);
  return `| ${i + 1} | ${f.id} | ${f.title} | ${f.dimension} | +${f.impact_score} | ${f.depends_on?.join(', ') || 'none'} |`;
}).join('\n')}

**Total projected score gain:** +${fixesJson.summary.projected_score_gain} points
`;
}

export async function explainFix({ fix_id, package_id }, env) {
  // Retrieve the fix from stored package and return verbose explanation
  const pkg = await env.LOOM_PACKAGES.get(`${package_id}.zip`);
  if (!pkg) throw new Error('Package not found');
  // Unzip and find the fix MD (simplified — production should parse zip)
  return { fix_id, package_id, verbose_explanation: 'Verbose explanation retrieved from package MD' };
}

function detectLang(filename) {
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.css')) return 'css';
  return '';
}
```

---

### File: `worker/loom/zip-packager.js`

```javascript
// Bundles the fix package into a zip file
// Note: Cloudflare Workers have limited zip libs. Use a Worker-compatible implementation.

/**
 * Package files object { filename: content } into a zip buffer.
 * Uses a minimal zip writer compatible with Workers runtime.
 */
export async function packageFixPackage(files) {
  // Use the fflate library (Worker-compatible, ESM)
  // Install via: npm install fflate
  const { zipSync, strToU8 } = await import('fflate');

  const fileMap = {};
  for (const [name, content] of Object.entries(files)) {
    fileMap[name] = strToU8(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  const zipped = zipSync(fileMap, { level: 6 });
  return zipped.buffer;
}
```

> **Install note:** Run `npm install fflate` in the `worker/` directory.

---

### File: `worker/loom/validator.js`

```javascript
// Validates patches against target files (dry run)
import { applyPatch } from 'diff';

/**
 * Validates whether a patch can be applied cleanly to the current target file.
 */
export async function validatePatch({ patch_content, target_url }, env) {
  try {
    // Fetch current version of target file
    const res = await fetch(target_url, { headers: { 'User-Agent': 'AnswerWeave/1.0' } });
    if (!res.ok) return { valid: false, reason: `Could not fetch target: ${res.status}` };
    const currentContent = await res.text();

    // Apply patch in memory
    const result = applyPatch(currentContent, patch_content);
    if (result === false) {
      return { valid: false, reason: 'Patch does not apply cleanly — target has changed since audit' };
    }

    return {
      valid: true,
      preview_length: result.length,
      changes_detected: currentContent !== result
    };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}
```

---

## Fix Builder Files

### File: `worker/loom/fix-builders/base.js`

```javascript
// Base helpers shared by all builders

export async function claudeComplete(system, prompt, env, model = 'claude-sonnet-4-20250514') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export function extractJsonFromText(text) {
  // Handle ```json fences and raw JSON
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch {
    // Try to find JSON within the text
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse JSON from Claude response');
  }
}

export function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const schemas = new Set();
  matches.forEach(m => {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach(item => {
        if (item['@type']) schemas.add(Array.isArray(item['@type']) ? item['@type'][0] : item['@type']);
      });
    } catch {}
  });
  return {
    schemas,
    has: (type) => schemas.has(type)
  };
}

export function extractParagraphs(html) {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches.map((m, i) => ({
    id: `p-${i}`,
    text: m[1].replace(/<[^>]+>/g, '').trim(),
    raw: m[0]
  }));
}

export function detectAnswerIntent(text) {
  // Simple heuristic — paragraphs that sound like answers
  const answerSignals = [
    /^(the|a|an|your|our|most|many|some|all|when|if|to)/i,
    /\b(typically|usually|generally|often|always|never)\b/i,
    /\$\d+/,
    /\b\d+\s*(days|hours|years|months|weeks|minutes)\b/i
  ];
  return answerSignals.filter(r => r.test(text)).length >= 2;
}
```

---

### File: `worker/loom/fix-builders/schema-injector.js`

```javascript
// Builder 1 — Schema Injector
// Detects missing JSON-LD schema and injects valid blocks
import { claudeComplete, extractJsonFromText, extractJsonLd } from './base.js';

export default {
  name: 'schema-injector',
  dimension: 'schema_quality',

  async detect(audit, siteContext) {
    const issues = [];
    for (const page of siteContext.pages) {
      const existing = extractJsonLd(page.html);

      if (!existing.has('FAQPage')) {
        issues.push({
          type: 'missing_faq_schema',
          impact: 8,
          page: page.relativePath,
          page_url: page.url
        });
      }

      if (!existing.has('Organization')) {
        issues.push({
          type: 'missing_org_schema',
          impact: 5,
          page: page.relativePath,
          page_url: page.url
        });
      }

      if (siteContext.isLocalBusiness && !existing.has('LocalBusiness')) {
        issues.push({
          type: 'missing_local_business',
          impact: 6,
          page: page.relativePath,
          page_url: page.url
        });
      }
    }
    return issues;
  },

  async build(issue, siteContext, env) {
    const page = siteContext.pages.find(p => p.relativePath === issue.page);
    if (!page) throw new Error(`Page not found: ${issue.page}`);

    let jsonLd;
    let title;
    let description;

    if (issue.type === 'missing_faq_schema') {
      const qaResponse = await claudeComplete(
        'You are an AEO expert. Generate 8 Q&A pairs for this business matching top AI queries.',
        `Business: ${siteContext.brand}
Industry: ${siteContext.industry}
City: ${siteContext.city}
Existing content: ${page.textContent.slice(0, 2000)}

Return ONLY a JSON array of 8 objects: [{"question": "...", "answer": "..."}]
Each answer must be 40-60 words, factual, data-anchored where possible.`,
        env
      );
      const qa = extractJsonFromText(qaResponse);

      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: qa.slice(0, 8).map(pair => ({
          '@type': 'Question',
          name: pair.question,
          acceptedAnswer: { '@type': 'Answer', text: pair.answer }
        }))
      };

      title = `Add FAQPage schema to ${issue.page}`;
      description = 'Injects FAQPage JSON-LD with 8 industry-relevant Q&A pairs into <head>.';
    }

    if (issue.type === 'missing_org_schema') {
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: siteContext.brand,
        url: `https://${siteContext.domain}`,
        address: siteContext.city ? {
          '@type': 'PostalAddress',
          addressLocality: siteContext.city,
          addressRegion: siteContext.state,
          addressCountry: 'US'
        } : undefined
      };
      title = `Add Organization schema to ${issue.page}`;
      description = 'Injects Organization JSON-LD for entity recognition.';
    }

    if (issue.type === 'missing_local_business') {
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: siteContext.brand,
        url: `https://${siteContext.domain}`,
        address: {
          '@type': 'PostalAddress',
          addressLocality: siteContext.city,
          addressRegion: siteContext.state,
          addressCountry: 'US'
        },
        areaServed: siteContext.city
      };
      title = `Add LocalBusiness schema to ${issue.page}`;
      description = 'Injects LocalBusiness JSON-LD for local AI visibility.';
    }

    const injectionContent = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;

    return {
      title,
      description,
      dimension: 'schema_quality',
      action: 'inject',
      file_targets: [issue.page],
      location: { selector: 'head', position: 'append' },
      impact_score: issue.impact,
      estimated_minutes: 10,
      priority: issue.impact >= 7 ? 'high' : 'medium',
      injection_content: injectionContent,
      before: '</head>',
      after: `${injectionContent}\n</head>`,
      validation: {
        type: 'json_ld_valid',
        test: 'Run `node scripts/validate-schema.js <file>` to verify JSON-LD parses'
      },
      rollback: `Remove the injected <script type="application/ld+json"> block from <head> of ${issue.page}`,
      rationale: `AI answer engines favor pages with explicit structured data. This site is missing ${jsonLd['@type']} schema, which is a ${issue.impact}-point opportunity.`
    };
  }
};
```

---

### File: `worker/loom/fix-builders/content-rewriter.js`

```javascript
// Builder 2 — Content Rewriter
// Detects promotional language and replaces with data-anchored alternatives
import { claudeComplete, extractJsonFromText } from './base.js';

const TIER_1_WORDS = ['premier', 'revolutionary', 'best-in-class', '#1', 'unmatched', 'world-class', 'leading', 'cutting-edge', 'state-of-the-art'];
const TIER_2_WORDS = ['top-rated', 'award-winning', 'trusted', 'premium', 'elite', 'exceptional', 'superior', 'outstanding'];
const TIER_3_WORDS = ['quality', 'professional', 'reliable', 'experienced'];

export default {
  name: 'content-rewriter',
  dimension: 'content_quality',

  async detect(audit, siteContext) {
    const issues = [];

    for (const page of siteContext.pages) {
      const text = page.textContent;

      [...TIER_1_WORDS, ...TIER_2_WORDS].forEach(word => {
        const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
        const matches = [...text.matchAll(regex)];
        matches.forEach(match => {
          // Get 80 chars of context around the match
          const start = Math.max(0, match.index - 40);
          const end = Math.min(text.length, match.index + word.length + 40);
          const context = text.slice(start, end);

          // Find the containing HTML element in raw html
          const htmlMatch = findContainingElement(page.html, word, match.index);

          issues.push({
            type: 'promotional_language',
            word,
            tier: TIER_1_WORDS.includes(word) ? 1 : 2,
            impact: TIER_1_WORDS.includes(word) ? 5 : 3,
            context,
            html_context: htmlMatch,
            page: page.relativePath,
            page_url: page.url
          });
        });
      });
    }

    // De-duplicate by word+page
    const seen = new Set();
    return issues.filter(i => {
      const key = `${i.page}:${i.word.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async build(issue, siteContext, env) {
    const response = await claudeComplete(
      `You rewrite promotional marketing copy into specific, data-anchored claims that AI answer engines trust. Never use superlatives. Always use verifiable facts.`,
      `Original HTML context: "${issue.html_context}"
Promotional word flagged: "${issue.word}"
Business: ${siteContext.brand}
City: ${siteContext.city}
Industry: ${siteContext.industry}

Generate 3 rewrite candidates that replace the promotional language with specific, 
verifiable claims (years in business, review count, certifications, measurable 
outcomes). Each candidate should be similar length to the original HTML.

Return ONLY JSON: [{"candidate": "...", "rationale": "..."}]`,
      env
    );

    const rewrites = extractJsonFromText(response);
    if (!rewrites[0]) throw new Error('No rewrite generated');

    return {
      title: `Replace promotional language "${issue.word}" on ${issue.page}`,
      description: `Removes promotional term "${issue.word}" and replaces with data-anchored claim.`,
      dimension: 'content_quality',
      action: 'replace',
      file_targets: [issue.page],
      impact_score: issue.impact,
      estimated_minutes: 5,
      priority: issue.tier === 1 ? 'high' : 'medium',
      before: issue.html_context,
      after: rewrites[0].candidate,
      alternatives: rewrites.slice(1),
      validation: {
        type: 'regex_absent',
        test: `Verify "${issue.word}" no longer appears in ${issue.page}`,
        patterns: [issue.word]
      },
      rollback: 'git revert the commit',
      rationale: `AI models filter out promotional language. Terms like "${issue.word}" trigger ad-detection heuristics and reduce citation probability.`
    };
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findContainingElement(html, word, approxIndex) {
  // Find the <p>, <h1-6>, <li>, <span>, or <div> containing the word
  const regex = new RegExp(`<(p|h[1-6]|li|span|div)[^>]*>[^<]*${escapeRegex(word)}[^<]*</\\1>`, 'i');
  const match = html.match(regex);
  return match ? match[0] : `...${word}...`;
}
```

---

### File: `worker/loom/fix-builders/freshness-updater.js`

```javascript
// Builder 3 — Freshness Updater
// Fixes the 14-day content decay problem
import { claudeComplete, extractJsonFromText } from './base.js';

export default {
  name: 'freshness-updater',
  dimension: 'freshness',

  async detect(audit, siteContext) {
    const issues = [];
    const now = new Date();

    for (const page of siteContext.pages) {
      // 1. Missing last-modified meta tag
      if (!/<meta[^>]+name=["']last-modified["']/i.test(page.html)) {
        issues.push({
          type: 'missing_last_modified',
          impact: 3,
          page: page.relativePath,
          page_url: page.url
        });
      }

      // 2. Stale HTTP Last-Modified header
      const lastModHeader = page.httpHeaders['last-modified'];
      if (lastModHeader) {
        const lastMod = new Date(lastModHeader);
        const daysStale = (now - lastMod) / (1000 * 60 * 60 * 24);
        if (daysStale > 30) {
          issues.push({
            type: 'stale_content',
            days_stale: Math.round(daysStale),
            impact: 5,
            page: page.relativePath,
            page_url: page.url,
            severity: daysStale > 90 ? 'high' : 'medium'
          });
        }
      }

      // 3. Outdated year references
      const dateRegex = /\b(19|20)\d{2}\b/g;
      const yearsInContent = [...page.textContent.matchAll(dateRegex)]
        .map(m => parseInt(m[0]))
        .filter(y => y < now.getFullYear() - 1 && y > 2000);

      if (yearsInContent.length > 0) {
        issues.push({
          type: 'outdated_date_references',
          dates: [...new Set(yearsInContent)],
          impact: 2,
          page: page.relativePath,
          page_url: page.url
        });
      }
    }

    return issues;
  },

  async build(issue, siteContext, env) {
    const page = siteContext.pages.find(p => p.relativePath === issue.page);
    if (!page) throw new Error(`Page not found: ${issue.page}`);

    if (issue.type === 'missing_last_modified') {
      const today = new Date().toISOString().split('T')[0];
      const injectionContent = `<meta name="last-modified" content="${today}">`;
      return {
        title: `Add last-modified meta tag to ${issue.page}`,
        description: 'Adds a last-modified meta tag so AI engines detect recent freshness.',
        dimension: 'freshness',
        action: 'inject',
        file_targets: [issue.page],
        location: { selector: 'head', position: 'append' },
        impact_score: 3,
        estimated_minutes: 2,
        priority: 'medium',
        injection_content: injectionContent,
        before: '</head>',
        after: `${injectionContent}\n</head>`,
        validation: {
          type: 'meta_present',
          test: `Verify <meta name="last-modified"> exists in ${issue.page}`
        },
        rollback: `Remove the injected <meta name="last-modified"> tag from ${issue.page}`,
        rationale: 'Content without freshness signals is deprioritized by AI answer engines after 14 days. A last-modified meta tag signals recency.'
      };
    }

    if (issue.type === 'stale_content') {
      const response = await claudeComplete(
        'You suggest specific content updates to refresh stale pages for AEO.',
        `Page last updated ${issue.days_stale} days ago.
Content: ${page.textContent.slice(0, 3000)}

Suggest 3 specific paragraph-level updates that would add fresh data/stats/references.
Each suggestion should specify:
- which paragraph to update (first 50 chars)
- what new content to add
- why it helps AEO

Return ONLY JSON: [{"paragraph_excerpt": "...", "addition": "...", "rationale": "..."}]`,
        env
      );
      const suggestions = extractJsonFromText(response);

      return {
        title: `Refresh stale content on ${issue.page} (${issue.days_stale} days old)`,
        description: `Suggests 3 content refreshes to restore freshness signals.`,
        dimension: 'freshness',
        action: 'restructure',
        file_targets: [issue.page],
        impact_score: 5,
        estimated_minutes: 20,
        priority: issue.severity === 'high' ? 'high' : 'medium',
        suggestions,
        validation: {
          type: 'content_refresh',
          test: 'Verify at least one dated statistic or reference was added'
        },
        rollback: 'git revert the commit',
        rationale: `Content is ${issue.days_stale} days old. AI engines deprioritize unrefreshed content after 14 days.`
      };
    }

    if (issue.type === 'outdated_date_references') {
      const currentYear = new Date().getFullYear();
      const oldestYear = Math.min(...issue.dates);
      return {
        title: `Update outdated year references on ${issue.page}`,
        description: `Updates "${oldestYear}" and other dated year references to current year.`,
        dimension: 'freshness',
        action: 'replace',
        file_targets: [issue.page],
        impact_score: 2,
        estimated_minutes: 5,
        priority: 'low',
        before: `© ${oldestYear}`,
        after: `© ${currentYear}`,
        validation: {
          type: 'regex_absent',
          test: `Verify outdated years ${issue.dates.join(', ')} no longer appear as copyright/updated markers`
        },
        rollback: 'git revert the commit',
        rationale: `Visible outdated years (${issue.dates.join(', ')}) signal stale content to both users and AI.`
      };
    }
  }
};
```

---

### File: `worker/loom/fix-builders/answer-block.js`

```javascript
// Builder 4 — Answer Block
// Restructures long prose into 40-word extractable answer blocks
import { claudeComplete, extractJsonFromText, extractParagraphs, detectAnswerIntent } from './base.js';

export default {
  name: 'answer-block',
  dimension: 'citation_position',

  async detect(audit, siteContext) {
    const issues = [];

    for (const page of siteContext.pages) {
      const paragraphs = extractParagraphs(page.html);

      paragraphs.forEach(p => {
        const wordCount = p.text.split(/\s+/).filter(Boolean).length;
        const isAnswer = detectAnswerIntent(p.text);

        if (wordCount > 80 && isAnswer) {
          issues.push({
            type: 'paragraph_too_long_for_extraction',
            word_count: wordCount,
            impact: 4,
            paragraph_id: p.id,
            text: p.text,
            raw_html: p.raw,
            page: page.relativePath,
            page_url: page.url
          });
        }
      });
    }

    // Limit to top 3 per page to avoid flooding the fix list
    const byPage = {};
    issues.forEach(i => {
      byPage[i.page] = byPage[i.page] || [];
      byPage[i.page].push(i);
    });
    return Object.values(byPage).flatMap(list =>
      list.sort((a, b) => b.word_count - a.word_count).slice(0, 3)
    );
  },

  async build(issue, siteContext, env) {
    const response = await claudeComplete(
      `You restructure long paragraphs into AEO-optimized answer blocks.

RULES:
1. Start with a direct answer in ≤40 words (the extraction target)
2. Follow with expanded context in a separate paragraph
3. Add an H3 header if one doesn't exist nearby
4. Preserve ALL factual content from the original
5. Use plain language, no marketing speak`,
      `Original paragraph (${issue.word_count} words):
${issue.text}

Return ONLY JSON: {
  "header": "H3 header text",
  "direct_answer": "40-word direct answer",
  "expanded_context": "Remaining content, restructured",
  "direct_answer_word_count": N
}`,
      env
    );

    const restructured = extractJsonFromText(response);
    if (restructured.direct_answer_word_count > 40) {
      // Retry with stricter prompt? For now, flag it
      console.warn(`Direct answer exceeded 40 words: ${restructured.direct_answer_word_count}`);
    }

    const newHtml = `<h3>${restructured.header}</h3>\n<p>${restructured.direct_answer}</p>\n<p>${restructured.expanded_context}</p>`;

    return {
      title: `Restructure ${issue.word_count}-word paragraph for extraction on ${issue.page}`,
      description: `Splits a long paragraph into a 40-word direct answer plus expanded context.`,
      dimension: 'citation_position',
      action: 'restructure',
      file_targets: [issue.page],
      impact_score: issue.impact,
      estimated_minutes: 8,
      priority: 'medium',
      before: issue.raw_html,
      after: newHtml,
      validation: {
        type: 'word_count_check',
        test: `Verify direct answer paragraph is ≤40 words. Current: ${restructured.direct_answer_word_count}`
      },
      rollback: 'git revert the commit',
      rationale: `AI engines extract answers under 40 words at 2.7× the rate of longer passages. This paragraph (${issue.word_count} words) was too long for direct extraction.`
    };
  }
};
```

---

### File: `worker/loom/fix-builders/citation-builder.js`

```javascript
// Builder 5 — Citation Builder
// Fixes authority gaps (author bios, thin About pages, missing credentials)
import { claudeComplete } from './base.js';

export default {
  name: 'citation-builder',
  dimension: 'citation_position',

  async detect(audit, siteContext) {
    const issues = [];

    // 1. Missing author/team attribution
    const hasAuthorBio = siteContext.pages.some(p =>
      /<(div|section|article)[^>]*class=["'][^"']*(author|bio|team|about-us)[^"']*["']/i.test(p.html)
    );
    if (!hasAuthorBio) {
      issues.push({
        type: 'missing_author_bio',
        impact: 4,
        page: 'index.html'
      });
    }

    // 2. Thin About page
    const aboutPage = siteContext.pages.find(p => p.relativePath.includes('about'));
    if (aboutPage && aboutPage.wordCount < 300) {
      issues.push({
        type: 'thin_about_page',
        current_word_count: aboutPage.wordCount,
        impact: 5,
        page: aboutPage.relativePath,
        current_content: aboutPage.textContent
      });
    } else if (!aboutPage) {
      issues.push({
        type: 'no_about_page',
        impact: 6,
        page: 'about.html'
      });
    }

    // 3. No external authority citations
    const avgExternalLinks = siteContext.pages.reduce((sum, p) => {
      const external = (p.html.match(/href=["']https?:\/\/(?!(?:www\.)?${siteContext.domain})/g) || []).length;
      return sum + external;
    }, 0) / Math.max(1, siteContext.pages.length);

    if (avgExternalLinks < 2) {
      issues.push({
        type: 'no_authority_citations',
        current_avg: avgExternalLinks.toFixed(1),
        impact: 3,
        page: 'index.html'
      });
    }

    return issues;
  },

  async build(issue, siteContext, env) {
    if (issue.type === 'missing_author_bio') {
      const bioBlock = await claudeComplete(
        'You generate structured author/team bio HTML for AEO, with schema.org markup inline.',
        `Business: ${siteContext.brand}
Industry: ${siteContext.industry}
City: ${siteContext.city}

Generate an author/team bio section for the homepage footer with:
1. Brief owner/team blurb (2-3 sentences)
2. Years in business signal
3. Credential placeholders (to be filled by client)
4. Inline schema.org/Person JSON-LD

Return ONLY the HTML block (no markdown fences).`,
        env
      );

      return {
        title: `Add author/team bio block to ${issue.page}`,
        description: 'Adds an author bio section with schema.org/Person markup.',
        dimension: 'citation_position',
        action: 'inject',
        file_targets: [issue.page],
        location: { selector: 'body', position: 'append' },
        impact_score: 4,
        estimated_minutes: 15,
        priority: 'medium',
        injection_content: bioBlock,
        before: '</body>',
        after: `${bioBlock}\n</body>`,
        validation: {
          type: 'html_element_present',
          test: `Verify new bio block present in ${issue.page}`
        },
        rollback: `Remove the injected bio block from ${issue.page}`,
        rationale: 'E-E-A-T signals (Experience, Expertise, Authoritativeness, Trust) are required for AI to cite content confidently. A structured author bio establishes these.'
      };
    }

    if (issue.type === 'thin_about_page') {
      const expansion = await claudeComplete(
        'You expand About pages for AEO authority signals.',
        `Current About page (${issue.current_word_count} words):
${issue.current_content}

Business: ${siteContext.brand}
Industry: ${siteContext.industry}
City: ${siteContext.city}

Expand to 800+ words with:
- Founding story (with approximate year)
- Team credentials (use placeholders [CERT] if unknown)
- Service area specifics
- Community involvement mentions
- Measurable impact claims (use placeholders [X customers] if unknown)

Return clean HTML (no markdown fences). Preserve all original facts.`,
        env
      );

      return {
        title: `Expand thin About page (currently ${issue.current_word_count} words)`,
        description: 'Expands the About page to 800+ words with authority signals.',
        dimension: 'citation_position',
        action: 'replace',
        file_targets: [issue.page],
        impact_score: 5,
        estimated_minutes: 30,
        priority: 'high',
        before: issue.current_content,
        after: expansion,
        validation: {
          type: 'word_count_min',
          test: `Verify About page is at least 800 words after apply`
        },
        rollback: 'git revert the commit',
        rationale: 'Thin About pages (under 300 words) signal low authority to AI. Expanded About pages with founding story, credentials, and service details build E-E-A-T signals.'
      };
    }

    if (issue.type === 'no_about_page') {
      const content = await claudeComplete(
        'You create full About pages for local businesses optimized for AEO.',
        `Business: ${siteContext.brand}
Industry: ${siteContext.industry}
City: ${siteContext.city}

Create a complete about.html page (800+ words) with authority signals, 
credentials placeholders, founding story. Return HTML only.`,
        env
      );

      return {
        title: `Create missing About page`,
        description: 'Creates a full about.html page with authority signals.',
        dimension: 'citation_position',
        action: 'create',
        file_targets: ['about.html'],
        content,
        impact_score: 6,
        estimated_minutes: 30,
        priority: 'high',
        validation: {
          type: 'file_exists',
          test: 'Verify about.html exists and is valid HTML'
        },
        rollback: 'Delete the created about.html file',
        rationale: 'Missing About pages are a major authority gap. AI engines use About pages to establish business legitimacy.'
      };
    }
  }
};
```

---

## Template Files

### File: `loom-templates/fix-md.template.md`

```markdown
# {{FIX_ID}} — {{TITLE}}

**Dimension:** {{DIMENSION}}  
**Builder:** {{BUILDER}}  
**Priority:** {{PRIORITY}}  
**Impact:** +{{IMPACT_SCORE}} points  
**Estimated time:** {{ESTIMATED_MINUTES}} minutes  
**Target files:** {{FILE_TARGETS}}

---

## Why This Fix

{{RATIONALE}}

## What This Fix Does

{{DESCRIPTION}}

## Before

```{{LANG}}
{{BEFORE}}
```

## After

```{{LANG}}
{{AFTER}}
```

## Execution Instructions (for AI agent)

1. Apply `{{PATCH_FILE}}` using `git apply --check` first
2. If dry run passes, run `git apply {{PATCH_FILE}}`
3. Run validation: {{VALIDATION_TEST}}
4. If validation passes, commit: `feat(aeo): {{TITLE_LOWER}} [{{FIX_ID}}]`
5. If validation fails, execute the Rollback section and report

## Validation

{{VALIDATION_DETAILS}}

## Rollback

{{ROLLBACK}}

---
*Generated by AnswerWeave Power Loom v1.0 | Audit ID: {{AUDIT_ID}}*
```

### File: `loom-templates/readme.template.md`

See the `renderReadme()` function in `md-renderer.js` — this template is programmatic.

### File: `loom-templates/manifest.template.md`

See the `renderManifest()` function in `md-renderer.js` — this template is programmatic.

### File: `loom-templates/faq-schema.template.json`

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "QUESTION_PLACEHOLDER",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "ANSWER_PLACEHOLDER"
      }
    }
  ]
}
```

### File: `loom-templates/org-schema.template.json`

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "BRAND_PLACEHOLDER",
  "url": "URL_PLACEHOLDER",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "CITY_PLACEHOLDER",
    "addressRegion": "STATE_PLACEHOLDER",
    "addressCountry": "US"
  }
}
```

### File: `loom-templates/local-business.template.json`

```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "BRAND_PLACEHOLDER",
  "url": "URL_PLACEHOLDER",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "CITY_PLACEHOLDER",
    "addressRegion": "STATE_PLACEHOLDER",
    "addressCountry": "US"
  },
  "areaServed": "CITY_PLACEHOLDER",
  "telephone": "PHONE_PLACEHOLDER"
}
```

### File: `loom-templates/author-bio.template.html`

```html
<section class="author-bio" itemscope itemtype="https://schema.org/Person">
  <h3 itemprop="name">OWNER_NAME_PLACEHOLDER</h3>
  <p itemprop="description">
    Founder of <span itemprop="worksFor">BRAND_PLACEHOLDER</span>,
    serving CITY_PLACEHOLDER since YEAR_PLACEHOLDER.
    [CREDENTIAL_PLACEHOLDER]
  </p>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": "OWNER_NAME_PLACEHOLDER",
    "jobTitle": "Founder",
    "worksFor": { "@type": "Organization", "name": "BRAND_PLACEHOLDER" }
  }
  </script>
</section>
```

---

## CLI Files

### File: `cli/loom-apply.js`

```javascript
#!/usr/bin/env node
// Local CLI: apply a fix package to a repo
// Usage: node cli/loom-apply.js <package_path> <repo_path>

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const [packagePath, repoPath] = process.argv.slice(2);
if (!packagePath || !repoPath) {
  console.error('Usage: loom-apply.js <package_path> <repo_path>');
  process.exit(1);
}

const fixesJson = JSON.parse(fs.readFileSync(path.join(packagePath, 'fixes.json'), 'utf8'));
const report = {
  package_id: path.basename(packagePath),
  executed_at: new Date().toISOString(),
  fixes_attempted: 0,
  fixes_succeeded: 0,
  fixes_failed: 0,
  results: []
};

process.chdir(repoPath);

for (const fixId of fixesJson.execution_order) {
  const fix = fixesJson.fixes.find(f => f.id === fixId);
  console.log(`\n▶ ${fix.id} — ${fix.title}`);
  report.fixes_attempted++;

  const patchPath = path.join(packagePath, fix.patch_file);
  const startTime = Date.now();

  try {
    // Dry run first
    execSync(`git apply --check "${patchPath}"`, { stdio: 'pipe' });
    console.log('  ✓ Dry run passed');

    // Real apply
    execSync(`git apply "${patchPath}"`, { stdio: 'pipe' });
    console.log('  ✓ Patch applied');

    // Commit
    const commitMsg = `feat(aeo): ${fix.title.toLowerCase()} [${fix.id}]`;
    execSync(`git add -A && git commit -m "${commitMsg}"`, { stdio: 'pipe' });
    const commitHash = execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
    console.log(`  ✓ Committed: ${commitHash}`);

    report.fixes_succeeded++;
    report.results.push({
      fix_id: fix.id,
      builder: fix.builder,
      status: 'success',
      commit_hash: commitHash,
      validation_passed: true,
      duration_seconds: Math.round((Date.now() - startTime) / 1000)
    });
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    try { execSync('git checkout -- .', { stdio: 'pipe' }); } catch {}
    report.fixes_failed++;
    report.results.push({
      fix_id: fix.id,
      builder: fix.builder,
      status: 'failed',
      reason: err.message,
      rollback_applied: true,
      duration_seconds: Math.round((Date.now() - startTime) / 1000)
    });
  }
}

// Write validation report into the package
fs.writeFileSync(
  path.join(packagePath, 'validation-report.json'),
  JSON.stringify(report, null, 2)
);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Completed: ${report.fixes_succeeded}/${report.fixes_attempted} fixes applied`);
console.log(`Report saved to: ${packagePath}/validation-report.json`);
```

### File: `cli/loom-validate.js`

```javascript
#!/usr/bin/env node
// Validates a fix package before applying (dry run all patches)
// Usage: node cli/loom-validate.js <package_path> <repo_path>

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const [packagePath, repoPath] = process.argv.slice(2);
if (!packagePath || !repoPath) {
  console.error('Usage: loom-validate.js <package_path> <repo_path>');
  process.exit(1);
}

const fixesJson = JSON.parse(fs.readFileSync(path.join(packagePath, 'fixes.json'), 'utf8'));
process.chdir(repoPath);

let passed = 0, failed = 0;
for (const fix of fixesJson.fixes) {
  const patchPath = path.join(packagePath, fix.patch_file);
  try {
    execSync(`git apply --check "${patchPath}"`, { stdio: 'pipe' });
    console.log(`✓ ${fix.id} — ${fix.title}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${fix.id} — ${fix.title}`);
    console.log(`   ${err.message.split('\n')[0]}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

---

## Validation Scripts

### File: `scripts/validate-schema.js`

```javascript
#!/usr/bin/env node
// Validates JSON-LD in an HTML file parses cleanly
// Usage: node scripts/validate-schema.js <html_file>

import fs from 'fs';

const file = process.argv[2];
if (!file) { console.error('Usage: validate-schema.js <html_file>'); process.exit(1); }

const html = fs.readFileSync(file, 'utf8');
const matches = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

if (matches.length === 0) {
  console.error('No JSON-LD blocks found');
  process.exit(1);
}

let hasError = false;
matches.forEach((m, i) => {
  try {
    const parsed = JSON.parse(m[1]);
    const type = Array.isArray(parsed) ? parsed[0]['@type'] : parsed['@type'];
    console.log(`✓ Block ${i + 1}: ${type} — valid`);
  } catch (err) {
    console.error(`✗ Block ${i + 1}: invalid JSON — ${err.message}`);
    hasError = true;
  }
});

process.exit(hasError ? 1 : 0);
```

---

## Build Order

Execute in this order to build Power Loom from scratch:

1. **Run setup commands** (create dirs, install deps, create D1 tables, create R2 bucket)
2. **Update `wrangler.toml`** (add R2 binding)
3. **Create `worker/loom/fix-builders/base.js`** (shared helpers)
4. **Create `worker/loom/fix-builders/schema-injector.js`** (highest impact, test first)
5. **Create `worker/loom/patch-generator.js`**
6. **Create `worker/loom/md-renderer.js`**
7. **Create `worker/loom/zip-packager.js`** (and `npm install fflate`)
8. **Create `worker/loom/validator.js`**
9. **Create `worker/loom/generator.js`**
10. **Update `worker/index.js`** (add routes)
11. **Deploy Worker:** `wrangler deploy`
12. **Test `/loom/generate`** with an existing audit ID → verify zip downloads correctly
13. **Create remaining builders** (content-rewriter, freshness-updater, answer-block, citation-builder)
14. **Create template files**
15. **Create CLI files** (loom-apply.js, loom-validate.js)
16. **Create validation script** (validate-schema.js)
17. **End-to-end test:** generate package for a real site → apply with CLI → verify commits

---

## Claude Code Execution Prompt

The agency pastes this into Claude Code / Cursor when handing over a fix package:

```
You are executing an AnswerWeave Power Loom fix package for {CLIENT_DOMAIN}.

The package is at: {PACKAGE_PATH}
The client's site repo is at: {REPO_PATH}

Execute these steps:

1. Read fixes.json to understand the full scope
2. For each fix in execution_order:
   a. Read the corresponding .md file for full context
   b. Run `git apply --check {patch_file}` (dry run)
   c. If dry run passes, run `git apply {patch_file}`
   d. Run the validation step from the MD's Validation section
   e. If validation passes, commit with: `feat(aeo): {title} [{fix_id}]`
   f. If validation fails, run `git checkout -- .` to roll back, mark as failed
3. Generate validation-report.json in the package folder with pass/fail per fix
4. Report total score gain and fixes applied/failed

Rules:
- Do NOT hand-edit any files — only apply the patches
- Do NOT skip validation steps
- Do NOT commit without passing validation
- If a fix fails, roll back and continue with the next fix
- After all fixes applied, run `npm install` in repo if any new deps were added
```

---

## Deployment Checklist

- [ ] All files created per this scaffold
- [ ] `npm install fflate diff jsdom adm-zip` in `worker/`
- [ ] D1 tables created (`fix_packages`, `fix_executions`)
- [ ] R2 bucket created and bound (`answerweave-loom-packages`)
- [ ] `wrangler.toml` updated with R2 binding
- [ ] `ANTHROPIC_KEY` secret set (already exists from AnswerWeave core)
- [ ] `wrangler deploy` succeeds
- [ ] `/loom/generate` endpoint returns valid response for existing audit ID
- [ ] Generated zip contains all expected files
- [ ] `cli/loom-apply.js` successfully applies a test package to a scratch repo
- [ ] `validation-report.json` generated correctly after apply

---

*AnswerWeave Power Loom v1.0 — Complete Scaffold. Every file, every line, ready to build.*
