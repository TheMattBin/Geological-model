import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export function measureBundle(directory) {
  const assets = readdirSync(join(directory, 'assets'), { recursive: true })
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => {
      const data = readFileSync(join(directory, 'assets', name));
      return { name, bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length };
    });
  if (!assets.some(({ name }) => name.endsWith('.js'))) throw new Error('No JavaScript build assets found.');
  return assets;
}

export function checkBudget(assets, budget) {
  return [
    ['JavaScript', '.js', budget.javascriptGzipBytes],
    ['CSS', '.css', budget.stylesheetGzipBytes]
  ].map(([name, extension, limit]) => {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(`Invalid ${name} budget.`);
    const bytes = assets.filter((asset) => asset.name.endsWith(extension)).reduce((sum, a) => sum + a.gzipBytes, 0);
    return { name, bytes, limit, passed: bytes <= limit };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assets = measureBundle('dist');
  const results = checkBudget(assets, JSON.parse(readFileSync('bundle-budget.json', 'utf8')));
  const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;
  const report = [
    '## Compressed bundle budget',
    '',
    '| Type | Gzip size | Budget | Result |',
    '| --- | ---: | ---: | --- |',
    ...results.map((r) => `| ${r.name} | ${kib(r.bytes)} | ${kib(r.limit)} | ${r.passed ? 'Pass' : 'Fail'} |`),
    '',
    'Largest compressed assets:',
    '',
    ...assets
      .sort((a, b) => b.gzipBytes - a.gzipBytes)
      .slice(0, 5)
      .map((a) => `- ${a.name}: ${kib(a.gzipBytes)}`),
    ''
  ].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
