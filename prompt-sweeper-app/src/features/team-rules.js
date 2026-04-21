// Team rules — custom rule files shared across a team
// File format: JSON array of { pattern, flags, category, severity, replacement }
// Example:
//   [
//     { "pattern": "\\bsynergize\\b", "flags": "gi", "category": "Banned Word", "severity": "high" },
//     { "pattern": "\\bour best-in-class\\b", "flags": "gi", "category": "Brand Voice", "severity": "medium", "replacement": "our" }
//   ]

const fs = require('fs');
const path = require('path');
const settings = require('./settings-store');

function loadTeamRules() {
  const paths = settings.get('teamRules.paths', []);
  const out = [];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const r of raw) {
        try {
          out.push({
            pattern: new RegExp(r.pattern, r.flags || 'gi'),
            category: r.category || 'Team Rule',
            severity: r.severity || 'medium',
            replacement: r.replacement,
          });
        } catch {}
      }
    } catch (e) {
      console.warn(`Could not load team rules from ${p}:`, e.message);
    }
  }
  return out;
}

function importTeamRules(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  // Validate
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Team rules file must be a JSON array');
  raw.forEach(r => {
    if (!r.pattern) throw new Error('Each rule needs a `pattern` field');
    try { new RegExp(r.pattern, r.flags || 'gi'); }
    catch (err) { throw new Error(`Invalid regex: ${r.pattern}`); }
  });

  const paths = settings.get('teamRules.paths', []);
  if (!paths.includes(filePath)) {
    paths.push(filePath);
    settings.set('teamRules.paths', paths);
  }
  return { imported: raw.length, filePath };
}

function removeTeamRulesFile(filePath) {
  const paths = settings.get('teamRules.paths', []);
  settings.set('teamRules.paths', paths.filter(p => p !== filePath));
}

module.exports = { loadTeamRules, importTeamRules, removeTeamRulesFile };
