// Automated assertions for the landing pipeline animation.
// Usage: node scripts/verify-pipeline-anim.cjs  (dev server must run on :3019)
// Requires puppeteer-core + local Chrome. Asserts, sampled over ~45s:
//   A1 pooled >= binned            (a lead must be pooled before it is binned)
//   A2 binned == sum of bin counts (the stat equals the three tier boxes)
//   A3 pool visibly populated      (>=3 live dots — no flights from an empty pool)
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--window-size=1440,2600', '--disable-gpu', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2600 });
  await page.goto('http://localhost:3019/zh', { waitUntil: 'networkidle2', timeout: 60000 });

  const read = () =>
    page.evaluate(() => {
      const line = Array.from(document.querySelectorAll('.font-mono span'))
        .map((e) => e.textContent.replace(/\s+/g, ' ').trim())
        .join(' | ');
      const bins = Array.from(document.querySelectorAll('svg text'))
        .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
        .filter((t) => /^\d+ 条$/.test(t))
        .map((t) => parseInt(t));
      const hits = Array.from(document.querySelectorAll('svg text'))
        .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
        .find((t) => /条命中/.test(t));
      const poolDots = Array.from(document.querySelectorAll('svg circle')).filter(
        (c) => parseFloat(c.getAttribute('opacity') || '0') > 0.05 && c.getAttribute('r') === '4'
      ).length;
      return { line, bins, hits, poolDots };
    });

  let failures = 0;
  for (const wait of [10000, 15000, 20000]) {
    await new Promise((r) => setTimeout(r, wait));
    const s = await read();
    const pooled = (s.line.match(/(\d+) 条真实线索已入池/) || [])[1];
    const binned = (s.line.match(/(\d+) 条已打分入档/) || [])[1];
    const binSum = s.bins.reduce((a, b) => a + (b || 0), 0);
    const a1 = pooled && binned && +pooled >= +binned;
    const a2 = binned && +binned === binSum;
    const a3 = s.poolDots >= 3;
    if (!a1 || !a2 || !a3) failures += 1;
    console.log(
      `pooled=${pooled} binned=${binned} bins=[${s.bins.join(',')}] sum=${binSum} ` +
        `poolDots=${s.poolDots} hits="${s.hits || '-'}" | ` +
        `A1 pooled>=binned:${a1 ? 'PASS' : 'FAIL'} A2 binned==sum:${a2 ? 'PASS' : 'FAIL'} A3 pool alive:${a3 ? 'PASS' : 'FAIL'}`
    );
  }
  await browser.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} SAMPLE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
