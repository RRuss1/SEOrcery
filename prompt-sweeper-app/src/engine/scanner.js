// Prompt Sweeper — Scan engine
// Pure function: text in, results out. Used by clipboard watchdog, batch, URL scan.

const { RULES } = require('./rules');
const { loadTeamRules } = require('../features/team-rules');

function scanText(text, options = {}) {
  const rules = options.includeTeamRules !== false
    ? [...RULES, ...loadTeamRules()]
    : RULES;

  const issues = [];
  rules.forEach(function (rule) {
    let match;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    while ((match = re.exec(text)) !== null) {
      const duplicate = issues.some(function (iss) {
        return match.index >= iss.start && match.index < iss.end;
      });
      if (!duplicate) {
        issues.push({
          match: match[0],
          start: match.index,
          end: match.index + match[0].length,
          category: rule.category,
          severity: rule.severity,
          replacement: rule.replacement || null,
        });
      }
    }
  });
  issues.sort((a, b) => a.start - b.start);

  const highCount = issues.filter(i => i.severity === 'high').length;
  const medCount  = issues.filter(i => i.severity === 'medium').length;
  const lowCount  = issues.filter(i => i.severity === 'low').length;

  let penalty = (highCount * 15) + (medCount * 8) + (lowCount * 3);

  const uniqueCats = [];
  issues.forEach(i => {
    if (!uniqueCats.includes(i.category)) uniqueCats.push(i.category);
  });
  if (uniqueCats.length >= 6) penalty += 20;
  else if (uniqueCats.length >= 4) penalty += 10;

  const wordCount = text.split(/\s+/).length;
  if (wordCount > 20) {
    const density = issues.length / (wordCount / 100);
    if (density > 8) penalty += 15;
    else if (density > 5) penalty += 8;
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    issues,
    score,
    highCount,
    medCount,
    lowCount,
    uniqueCategories: uniqueCats.length,
    density: wordCount > 0 ? (issues.length / (wordCount / 100)).toFixed(1) : 0,
    wordCount,
  };
}

// Quick boolean check — used by clipboard watchdog
function hasSlop(text, threshold = 'medium') {
  if (!text || text.length < 40) return false;
  const result = scanText(text);
  if (threshold === 'high') return result.highCount > 0;
  if (threshold === 'medium') return result.highCount + result.medCount > 0;
  return result.issues.length > 0;
}

module.exports = { scanText, hasSlop };
