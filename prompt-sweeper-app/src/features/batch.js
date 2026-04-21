// Batch folder processor
// Walks a folder, reads each supported file, scans + optionally rewrites,
// writes cleaned copies to a sibling folder, generates a per-file report.
//
// Supported: .md, .txt
// TODO: .docx via mammoth, .pdf via pdf-parse (install + wire when needed)

const fs = require('fs');
const path = require('path');
const { scanText } = require('../engine/scanner');
const { localRewrite } = require('../engine/rewriter');

const SUPPORTED_EXTS = ['.md', '.txt'];

async function processBatch(folderPath, options = {}) {
  if (!fs.existsSync(folderPath)) throw new Error('Folder not found');

  const outDir = options.outDir || path.join(folderPath, '_cleaned');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(folderPath)
    .filter(f => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(folderPath, f));

  const results = [];
  for (const file of files) {
    try {
      const original = fs.readFileSync(file, 'utf8');
      const beforeScan = scanText(original);
      const rewrite = localRewrite(original);
      const afterScan = scanText(rewrite.text);

      const outPath = path.join(outDir, path.basename(file));
      fs.writeFileSync(outPath, rewrite.text);

      results.push({
        file: path.basename(file),
        scoreBefore: beforeScan.score,
        scoreAfter: afterScan.score,
        issuesBefore: beforeScan.issues.length,
        issuesAfter: afterScan.issues.length,
        changes: rewrite.changeCount,
        outPath,
      });
    } catch (err) {
      results.push({ file: path.basename(file), error: err.message });
    }
  }

  // Write a report
  const reportPath = path.join(outDir, 'batch-report.md');
  fs.writeFileSync(reportPath, buildReport(folderPath, results));

  return {
    filesProcessed: results.length,
    outDir,
    reportPath,
    results,
  };
}

function buildReport(folder, results) {
  const lines = [
    '# Prompt Sweeper Batch Report',
    '',
    `**Folder:** \`${folder}\``,
    `**Date:** ${new Date().toISOString()}`,
    `**Files processed:** ${results.length}`,
    '',
    '| File | Score Before | Score After | Issues Before | Issues After | Changes |',
    '|------|--------------|-------------|---------------|--------------|---------|',
  ];
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.file} | - | - | - | - | ERROR: ${r.error} |`);
    } else {
      lines.push(`| ${r.file} | ${r.scoreBefore} | ${r.scoreAfter} | ${r.issuesBefore} | ${r.issuesAfter} | ${r.changes} |`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { processBatch };
