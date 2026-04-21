// Auto-fix engine — the Slop Hog's jaws
// Two modes:
//   1. Local rules-based replacements (no API cost)
//   2. Claude-powered rewrites (optional, for nuanced cases)

const { scanText } = require('./scanner');

// ── Pattern -> human replacement map ──────────────────────────────
// Each entry: [regex, replacement fn or string]
const REPLACEMENTS = [
  // AI Preambles — delete entirely
  [/\b(sure|absolutely|of course|certainly|great question)[!,.]?\s*(here['’]?s|let me|I['’]?d be happy|I['’]?ll)\b[^.!?]*[.!?]\s*/gi, ''],
  [/\bhere['’]?s\s+(a|an|the|your)\s+(revised|updated|rewritten|draft|suggested)[^.!?]*[.!?]\s*/gi, ''],
  [/\bI['’]?ve\s+(drafted|written|created|prepared|put together|revised|updated)[^.!?]*[.!?]\s*/gi, ''],

  // AI Closings — delete
  [/\b(feel free to|don['’]?t hesitate to)\s+(let me know|reach out|ask|modify|adjust|edit|change)[^.!?]*[.!?]\s*/gi, ''],
  [/\blet me know if you['’]?d?\s+(like|want|need)[^.!?]*[.!?]\s*/gi, ''],
  [/\bI\s+(hope|trust)\s+this\s+(helps|works|meets|is)[^.!?]*[.!?]\s*/gi, ''],
  [/\bwould you like me to\s+\w+[^.!?]*[.!?]?\s*/gi, ''],
  [/\bI\s+can\s+(adjust|modify|revise|tweak|change)[^.!?]*[.!?]\s*/gi, ''],

  // AI Self-Reference — delete
  [/\bas\s+an?\s+(AI|artificial intelligence|language model|large language model|LLM|assistant|chatbot),?\s*/gi, ''],
  [/\bI['’]?m\s+an?\s+(AI|artificial intelligence|language model|assistant),?\s*/gi, ''],

  // AI Slop phrases — direct swap
  [/\bdelves?\s+into\b/gi, 'covers'],
  [/\bdelved\s+into\b/gi, 'covered'],
  [/\b(deep|deeper)\s+dive\b/gi, 'look'],
  [/\blet['’]?s\s+(explore|dive|unpack|break down|take a look)\b/gi, 'consider'],
  [/\bit['’]?s\s+(important|worth|crucial)\s+to\s+note\s+that\b/gi, 'note that'],
  [/\bin\s+today['’]?s\s+\w+[\s-]*(paced|evolving|changing|driven)?\s*(world|landscape|era|environment|age)\b/gi, 'today'],
  [/\bnavigate\s+the\s+(complexities|challenges|intricacies|nuances|waters)\s+of\b/gi, 'handle'],
  [/\bunlock\s+the\s+(power|potential|full potential|secrets|true potential)\s+of\b/gi, 'get more from'],
  [/\b(game[\s-]?changer|paradigm\s+shift)\b/gi, 'shift'],
  [/\b(holistic|comprehensive)\s+(approach|guide|overview|solution|strategy|understanding)\b/gi, '$2'],
  [/\bin\s+the\s+(realm|world|landscape|arena|sphere)\s+of\b/gi, 'in'],
  [/\brich\s+tapestry\s+of\b/gi, 'range of'],
  [/\bat\s+the\s+end\s+of\s+the\s+day\b/gi, ''],
  [/\bthis\s+underscores\s+the\s+(importance|need|value|significance)\s+of\b/gi, 'this matters because'],
  [/\b(leveraging|tapping\s+into)\s+the\s+(power|potential)\s+of\b/gi, 'using'],

  // Buzzwords — replace with plain alternatives
  [/\bleverage(s|d)?\b/gi, (m) => m.endsWith('d') ? 'used' : m.endsWith('s') ? 'uses' : 'use'],
  [/\bleveraging\b/gi, 'using'],
  [/\brobust(ly)?\b/gi, 'solid'],
  [/\bstreamline(d|s)?\b/gi, (m) => m.endsWith('d') ? 'simplified' : m.endsWith('s') ? 'simplifies' : 'simplify'],
  [/\bstreamlining\b/gi, 'simplifying'],
  [/\bseamless(ly)?\b/gi, 'smooth'],
  [/\bcutting[\s-]?edge\b/gi, 'modern'],
  [/\bmultifaceted\b/gi, 'varied'],
  [/\bnuanced\b/gi, 'subtle'],
  [/\bpivotal\b/gi, 'key'],
  [/\bpalpable\b/gi, 'clear'],
  [/\bintricate(ly)?\b/gi, 'detailed'],
  [/\bcamaraderie\b/gi, 'team spirit'],
  [/\bever[\s-]?(evolving|changing|growing|expanding|shifting)\b/gi, 'changing'],
  [/\bfoster(ing|ed)?\b/gi, (m) => m.endsWith('ing') ? 'building' : m.endsWith('ed') ? 'built' : 'build'],
  [/\bempower(s|ed|ing|ment)?\b/gi, (m) => {
    if (m.endsWith('ment')) return 'support';
    if (m.endsWith('ing')) return 'helping';
    if (m.endsWith('ed')) return 'helped';
    if (m.endsWith('s')) return 'helps';
    return 'help';
  }],
  [/\belevate(s|d)?\b/gi, (m) => m.endsWith('d') ? 'improved' : m.endsWith('s') ? 'improves' : 'improve'],
  [/\belevating\b/gi, 'improving'],
  [/\bharness(es|ed|ing)?\b/gi, 'use'],
  [/\bsynerg(y|ies|istic)\b/gi, 'teamwork'],
  [/\bimpactful\b/gi, 'effective'],
  [/\bresonate(s|d)?\b/gi, (m) => m.endsWith('d') ? 'connected' : m.endsWith('s') ? 'connects' : 'connect'],
  [/\bresonating\b/gi, 'connecting'],
  [/\bbest\s+practices\b/gi, 'standards'],
  [/\bactionable\s+insights?\b/gi, 'takeaways'],
  [/\bthought\s+leader(ship)?\b/gi, 'expert'],

  // AI Filler — delete
  [/\bwhen\s+it\s+comes\s+to\b/gi, 'for'],
  [/\bthe\s+key\s+to\s+(\w+)\s+is\b/gi, '$1 needs'],
  [/\b(it['’]?s\s+no\s+secret\s+that|needless\s+to\s+say|it\s+goes\s+without\s+saying)\s*,?\s*/gi, ''],

  // AI Transitions — delete or simplify
  [/^(Additionally|Furthermore|Moreover|Consequently|Subsequently),\s*/gim, ''],
  [/\b(that\s+said|that\s+being\s+said|having\s+said\s+that)\b,?\s*/gi, 'still,'],
  [/\b(in\s+conclusion|to\s+summarize|to\s+sum\s+up|all\s+in\s+all)\b,?\s*/gi, ''],
  [/^(Interestingly|Notably|Importantly|Crucially|Ultimately),\s*/gim, ''],

  // Em dashes — replace with comma or period
  [/\s*\u2014\s*/g, ', '],

  // Emoji bullets — strip
  [/[\u2705\u2611\u2714\u2716\u274C\u274E]\s*/g, ''],
  [/[0-9]\uFE0F?\u20E3\s*/g, ''],
  [/[\u27A1\u2794\u27A4\u25B8\u25BA\u25B6\u23E9]\uFE0F?\s*/g, ''],
];

/**
 * Rewrite text using local rules only (fast, free, deterministic).
 * Returns { text, changeCount, changes: [{ from, to, category }] }
 */
function localRewrite(text) {
  let result = text;
  const changes = [];
  let changeCount = 0;

  for (const [pattern, replacement] of REPLACEMENTS) {
    const re = new RegExp(pattern.source, pattern.flags);
    result = result.replace(re, (match, ...args) => {
      const replaced = typeof replacement === 'function'
        ? replacement(match)
        : match.replace(re, replacement);
      changes.push({ from: match, to: replaced });
      changeCount++;
      return replaced;
    });
  }

  // Collapse double spaces and orphan punctuation introduced by deletions
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: result, changeCount, changes };
}

/**
 * Claude-powered rewrite (optional). Stub until worker endpoint is ready.
 * Requires env.CLAUDE_ENDPOINT to be configured in settings.
 */
async function claudeRewrite(text, settings = {}) {
  if (!settings.claudeEndpoint) {
    throw new Error('Claude rewrite requires CLAUDE_ENDPOINT in settings');
  }
  const res = await fetch(settings.claudeEndpoint + '/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, style: settings.style || 'neutral' }),
  });
  if (!res.ok) throw new Error(`Rewrite endpoint returned ${res.status}`);
  const data = await res.json();
  return { text: data.rewritten || text, source: 'claude' };
}

/**
 * Smart rewrite: local first, optionally escalate to Claude for edge cases.
 */
async function autoFix(text, settings = {}) {
  const scanBefore = scanText(text);
  const local = localRewrite(text);
  const scanAfter = scanText(local.text);

  // If local rewrite still leaves high-severity issues and Claude is available,
  // try one pass with Claude.
  if (settings.useClaude && settings.claudeEndpoint && scanAfter.highCount > 0) {
    try {
      const claude = await claudeRewrite(local.text, settings);
      const scanFinal = scanText(claude.text);
      return {
        text: claude.text,
        source: 'local+claude',
        scoreBefore: scanBefore.score,
        scoreAfter: scanFinal.score,
        changes: local.changes,
      };
    } catch (err) {
      // Fall through to local-only result
    }
  }

  return {
    text: local.text,
    source: 'local',
    scoreBefore: scanBefore.score,
    scoreAfter: scanAfter.score,
    changes: local.changes,
  };
}

module.exports = { localRewrite, claudeRewrite, autoFix };
