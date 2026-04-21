// Website watchdog — scheduled recurring scans of client sites
// Stores watched sites, runs scans on schedule, emits weekly digest.
// STATUS: Scaffold. Actual scheduling wired via main.js setInterval.
// Email digest uses the user's configured SMTP/service (TODO).

const settings = require('./settings-store');
const { scanUrlGenerateMd } = require('./url-scan');

function addWatchedSite({ url, label, frequency = 'weekly' }) {
  const sites = settings.get('siteWatchdog.sites', []);
  const site = {
    id: Date.now().toString(36),
    url,
    label: label || url,
    frequency, // 'daily' | 'weekly' | 'monthly'
    addedAt: new Date().toISOString(),
    lastScan: null,
    history: [],
  };
  sites.push(site);
  settings.set('siteWatchdog.sites', sites);
  return site;
}

function listWatchedSites() {
  return settings.get('siteWatchdog.sites', []);
}

function removeWatchedSite(id) {
  const sites = settings.get('siteWatchdog.sites', [])
    .filter(s => s.id !== id);
  settings.set('siteWatchdog.sites', sites);
}

/**
 * Run a single scan for a watched site and record the result in history.
 */
async function runSiteScan(id) {
  const sites = settings.get('siteWatchdog.sites', []);
  const site = sites.find(s => s.id === id);
  if (!site) throw new Error('Site not found');

  const result = await scanUrlGenerateMd(site.url);

  site.lastScan = new Date().toISOString();
  site.history = (site.history || []).slice(-20);
  site.history.push({
    date: site.lastScan,
    score: result.score,
    issueCount: result.issueCount,
  });

  settings.set('siteWatchdog.sites', sites);
  return result;
}

/**
 * Build a weekly digest of all watched sites.
 * Returns markdown. Sending via email is a future enhancement.
 */
function buildWeeklyDigest() {
  const sites = listWatchedSites();
  const lines = [
    '# Slop Hog Weekly Digest',
    '',
    `**Week of:** ${new Date().toISOString().slice(0, 10)}`,
    `**Sites watched:** ${sites.length}`,
    '',
    '## Summary',
    '',
    '| Site | Current Score | Trend | Issues |',
    '|------|---------------|-------|--------|',
  ];
  for (const s of sites) {
    const history = s.history || [];
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    const trend = (latest && previous)
      ? (latest.score > previous.score ? '↑' : latest.score < previous.score ? '↓' : '→')
      : '-';
    lines.push(`| ${s.label} | ${latest?.score ?? '-'} | ${trend} | ${latest?.issueCount ?? '-'} |`);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  addWatchedSite,
  listWatchedSites,
  removeWatchedSite,
  runSiteScan,
  buildWeeklyDigest,
};
