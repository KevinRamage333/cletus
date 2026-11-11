/**
 * Renders public/cletus-whitepaper.pdf from the canonical whitepaper module.
 * Usage: npx tsx scripts/render-whitepaper-pdf.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { COMPANY_LEGAL } from '../src/lib/company.ts';
import {
  DISCLAIMER_PARAS,
  DISCLAIMER_TITLE,
  PHASES,
  SECTIONS,
  WHITEPAPER_ABSTRACT,
  WHITEPAPER_DATE,
  WHITEPAPER_TAGLINE,
  WHITEPAPER_TITLE,
  WHITEPAPER_VERSION,
} from '../src/lib/whitepaper.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPdf = join(root, 'public/cletus-whitepaper.pdf');
const outHtml = join('/tmp', 'cletus-whitepaper-print.html');

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function blocksHtml(blocks: (typeof SECTIONS)[number]['blocks']) {
  return blocks
    .map((b) => {
      if (b.type === 'p' || b.type === 'callout') return `<p>${esc(b.text)}</p>`;
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    })
    .join('\n');
}

const phases = PHASES.map(
  (p) => `<article class="phase">
    <div class="phase-head"><span class="kicker">${esc(p.phase)}</span><h3>${esc(p.name)}</h3><span class="pill">${esc(p.status)}</span></div>
    <p class="gate"><strong>Gate:</strong> ${esc(p.gate)}</p>
    <p>${esc(p.body)}</p>
  </article>`,
).join('\n');

const sections = SECTIONS.map((s) => {
  const extra = s.id === 'roadmap' ? phases : '';
  return `<section id="${s.id}"><h2>${esc(s.title)}</h2>${blocksHtml(s.blocks)}${extra}</section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(WHITEPAPER_TITLE)}</title>
<style>
  @page { size: letter; margin: 0.7in 0.75in 0.8in 0.75in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #07080b; color: #e6ebf5; }
  body { font: 11pt/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; }
  .page { max-width: 7.5in; margin: 0 auto; padding: 0 0.1in 0.2in; }
  header.hero { display: flex; gap: 24px; align-items: flex-start; border-bottom: 1px solid #D4AF37; padding-bottom: 18px; margin-bottom: 22px; }
  header.hero img { width: 88px; height: 88px; border-radius: 50%; border: 2px solid #D4AF37; }
  .kicker { color: #D4AF37; letter-spacing: 0.04em; text-transform: uppercase; font-size: 8.5pt; font-family: system-ui, sans-serif; }
  h1 { font-size: 28pt; line-height: 1.1; margin: 6px 0 8px; color: #F5E08F; font-weight: 800; font-family: system-ui, sans-serif; }
  .tag { font-size: 12pt; color: #d6d3c8; margin: 0; }
  .meta { font-size: 9pt; color: #8a96b0; margin-top: 8px; font-family: system-ui, sans-serif; }
  h2 { font-family: system-ui, sans-serif; font-size: 14pt; color: #D4AF37; margin: 22px 0 8px; page-break-after: avoid; }
  h3 { font-family: system-ui, sans-serif; font-size: 12pt; color: #fff; margin: 0; }
  p { margin: 0 0 9px; }
  ul { margin: 0 0 10px; padding-left: 1.2em; }
  li { margin: 0 0 4px; }
  .abstract { border: 1px solid rgba(212,175,55,0.4); background: #111015; padding: 14px 16px; border-radius: 10px; margin-bottom: 18px; }
  .abstract h2 { margin-top: 0; }
  .phase { border: 1px solid #2e2717; background: #111015; padding: 12px 14px; border-radius: 10px; margin: 10px 0; page-break-inside: avoid; }
  .phase-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 6px; }
  .pill { font-family: system-ui, sans-serif; font-size: 8pt; color: #F5E08F; border: 1px solid rgba(212,175,55,0.5); border-radius: 999px; padding: 1px 8px; }
  .gate { font-size: 9.5pt; color: #b4a894; }
  .disclaimer { border: 1px solid rgba(212,175,55,0.55); background: #1a1508; padding: 14px 16px; border-radius: 10px; margin-top: 20px; page-break-inside: avoid; }
  .disclaimer h2 { color: #F59E0B; margin-top: 0; }
  footer.end { margin-top: 22px; padding-top: 10px; border-top: 1px solid #2e2717; font-size: 8.5pt; color: #8a96b0; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <img src="${join(root, 'public/cletus-logo.png')}" alt="Cletus logo" />
      <div>
        <div class="kicker">${esc(COMPANY_LEGAL)}</div>
        <h1>${esc(WHITEPAPER_TITLE)}</h1>
        <p class="tag">${esc(WHITEPAPER_TAGLINE)}</p>
        <p class="meta">Version ${esc(WHITEPAPER_VERSION)} · ${esc(WHITEPAPER_DATE)}</p>
      </div>
    </header>
    <section class="abstract">
      <h2>Abstract</h2>
      <p>${esc(WHITEPAPER_ABSTRACT)}</p>
    </section>
    ${sections}
    <section class="disclaimer" id="disclaimer">
      <h2>${esc(DISCLAIMER_TITLE)}</h2>
      ${DISCLAIMER_PARAS.map((p) => `<p>${esc(p)}</p>`).join('\n')}
    </section>
    <footer class="end">© 2026 ${esc(COMPANY_LEGAL)}. Not financial advice. No token. No guaranteed returns. The trading strategy is experimental.</footer>
  </div>
</body>
</html>`;

mkdirSync(dirname(outPdf), { recursive: true });
writeFileSync(outHtml, html);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto('file://' + outHtml, { waitUntil: 'networkidle' });
await page.pdf({
  path: outPdf,
  format: 'Letter',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div></div>`,
  footerTemplate: `<div style="font-size:8px; color:#8a96b0; width:100%; padding:0 0.75in; font-family:system-ui,sans-serif; display:flex; justify-content:space-between;">
    <span>Cletus Whitepaper v${WHITEPAPER_VERSION} · Not financial advice</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`,
  margin: { top: '0.65in', bottom: '0.7in', left: '0.7in', right: '0.7in' },
});
await browser.close();
console.log('wrote', outPdf);
