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
      const stats = Array.from(document.querySelectorAll('.font-mono span')).map((e) =>
        e.textContent.replace(/\s+/g, ' ').trim()
      );
      const line = stats.join(' | ');
      const bins = Array.from(document.querySelectorAll('svg text'))
        .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
        .filter((t) => /^\d+ 条$/.test(t));
      const hits = Array.from(document.querySelectorAll('svg text'))
        .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
        .find((t) => /条命中/.test(t));
      return { line, bins, hits };
    });

  // sample at 10s / 25s / 45s
  for (const wait of [10000, 15000, 20000]) {
    await new Promise((r) => setTimeout(r, wait));
    const s = await read();
    const pooled = (s.line.match(/(\d+) 条真实线索已入池/) || [])[1];
    const binned = (s.line.match(/(\d+) 条已打分入档/) || [])[1];
    const binNums = s.bins.map((b) => parseInt(b));
    const binSum = binNums.reduce((a, b) => a + (b || 0), 0);
    const checks = [
      `pooled=${pooled}`,
      `binned=${binned}`,
      `bins=[${binNums.join(',')}] sum=${binSum}`,
      pooled && binned ? `A1 pooled>=binned: ${+pooled >= +binned ? 'PASS' : 'FAIL'}` : 'A1 ?',
      binned ? `A2 binned==binSum: ${+binned === binSum ? 'PASS' : 'FAIL'}` : 'A2 ?',
      `hits: ${s.hits || '-'}`,
    ];
    console.log(checks.join('  '));
  }
  await browser.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
