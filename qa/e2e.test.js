// End-to-end QA for the Creations by TP site.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = process.env.SITE || 'http://localhost:8765/';
// Use CHROME_PATH if set, else this PC's Playwright Chromium, else Playwright's own installed browser (CI).
const LOCAL = (process.env.LOCALAPPDATA || '') + '/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const EXE = process.env.CHROME_PATH || (fs.existsSync(LOCAL) ? LOCAL : undefined);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

const results = [];
const fail = (vp, area, msg) => results.push({ vp, area, msg, ok: false });
const pass = (vp, area, msg) => results.push({ vp, area, msg, ok: true });

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  // Tests must never send real order emails: every context answers Web3Forms with a fake success.
  const fakeWeb3Forms = ctx => ctx.route('https://api.web3forms.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'test' }) }));
  const realNewContext = browser.newContext.bind(browser);
  browser.newContext = async opts => { const c = await realNewContext(opts); await fakeWeb3Forms(c); return c; };

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const badResponses = [];
    page.on('console', m => { if (m.type() === 'error' && !/Failed to launch 'sms:/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push('PAGE ERROR: ' + e.message));
    page.on('response', r => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
    page.on('requestfailed', r => { const ft = (r.failure() || {}).errorText || ''; if (/ERR_ABORTED/.test(ft) && /\.(mp4|webp|jpg)$/.test(r.url())) return; if (!/^sms:|ig\.me/.test(r.url())) badResponses.push('FAILED ' + r.url() + ' ' + (r.failure() || {}).errorText); });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // Scroll through the page so lazy media loads
    await page.evaluate(async () => { document.documentElement.style.scrollBehavior = 'auto'; for (let y = 0; y <= document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } });
    await page.waitForTimeout(1000);
    const stillHidden = await page.evaluate(() => [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity < 0.99 && !e.closest('[hidden]')).map(e => (e.id || e.className) + ':' + e.textContent.trim().slice(0, 25)));
    stillHidden.length ? fail(vp.name, 'reveal', stillHidden.length + ' sections never became visible: ' + stillHidden.slice(0, 4).join(' | ')) : pass(vp.name, 'reveal', 'Every section becomes visible on scroll');
    // Title must stay on one line on desktop/tablet
    const h1Lines = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#hero-title .gt')); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; });
    (vp.width > 440 && h1Lines > 1) ? fail(vp.name, 'headings', 'Hero title wraps onto ' + h1Lines + ' lines') : pass(vp.name, 'headings', 'Hero title line count OK (' + h1Lines + ')');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(600);

    // 1. Horizontal overflow
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      culprits: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map(e => e.tagName + '.' + e.className) }));
    overflow.sw > overflow.iw ? fail(vp.name, 'layout', `Horizontal scroll: page ${overflow.sw}px > viewport ${overflow.iw}px (${overflow.culprits.join(', ')})`) : pass(vp.name, 'layout', 'No horizontal scroll');

    // 2. Clipped gradient headings: glyph ink vs painted background box
    const clipped = await page.evaluate(() => {
      const out = [];
      const c = document.createElement('canvas').getContext('2d');
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (!/text/.test(cs.webkitBackgroundClip || cs.backgroundClip)) return;
        if (!el.textContent.trim() || !el.getClientRects().length) return;
        c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const box = el.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(el);
        for (const line of range.getClientRects()) {
          // measure the text on this line
          const words = el.textContent.trim();
          const m = c.measureText(words);
          if (range.getClientRects().length > 1) {
            // multi-line: check vertical only, per line
          } else {
            const inkL = line.left - m.actualBoundingBoxLeft;
            const inkR = line.left + m.actualBoundingBoxRight;
            if (inkL < box.left - 0.5) out.push(`"${words}" left edge cut by ${Math.round(box.left - inkL)}px`);
            if (inkR > box.right + 0.5) out.push(`"${words}" right edge cut by ${Math.round(inkR - box.right)}px`);
          }
          const base = line.top + (line.height + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
          if (base - m.actualBoundingBoxAscent < box.top - 0.5) out.push(`"${words}" top cut by ${Math.round(box.top - (base - m.actualBoundingBoxAscent))}px`);
          if (base + m.actualBoundingBoxDescent > box.bottom + 0.5) out.push(`"${words}" bottom cut by ${Math.round(base + m.actualBoundingBoxDescent - box.bottom)}px`);
        }
      });
      return [...new Set(out)];
    });
    clipped.length ? clipped.forEach(c => fail(vp.name, 'headings', 'Gold text clipped: ' + c)) : pass(vp.name, 'headings', 'No gold/script text clipped');

    // 3. Broken images / media
    const media = await page.evaluate(async () => {
      const bad = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));
      for (const v of document.querySelectorAll('video')) {
        const ok = await fetch(v.currentSrc || v.getAttribute('src'), { method: 'HEAD' }).then(r => r.ok).catch(() => false);
        if (!ok) bad.push(v.getAttribute('src'));
        if (v.poster) { const p = await fetch(v.poster, { method: 'HEAD' }).then(r => r.ok).catch(() => false); if (!p) bad.push(v.poster); }
      }
      return bad;
    });
    media.length ? fail(vp.name, 'media', 'Broken media: ' + media.join(', ')) : pass(vp.name, 'media', 'All images/videos/posters load');

    // 4. In-page anchors resolve
    const anchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.querySelector(h)));
    anchors.length ? fail(vp.name, 'links', 'Dead anchors: ' + anchors.join(', ')) : pass(vp.name, 'links', 'All in-page links have targets');

    // 5. Touch targets (mobile only)
    if (vp.mobile) {
      const small = await page.evaluate(() => [...document.querySelectorAll('a, button, input, select, textarea, summary, [role=button]')]
        .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width && r.height && cs.visibility !== 'hidden' && (r.height < 44 || r.width < 44) && !e.closest('p, li'); })
        .map(e => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || e.id).trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
      small.length ? fail(vp.name, 'touch', `${small.length} tap targets < 44px: ` + small.slice(0, 8).join('; ')) : pass(vp.name, 'touch', 'All tap targets >= 44px');
    }

    // 6. Accessibility (axe-core, WCAG 2 A/AA)
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(v => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}` + (v.nodes[0] ? ` e.g. ${v.nodes[0].target.join(' ')}` : '')));
    axe.length ? axe.forEach(a => fail(vp.name, 'a11y', a)) : pass(vp.name, 'a11y', 'axe-core: no WCAG A/AA violations');

    // 7. Order form: empty submit shows an error and focuses the field
    const formCheck = await page.evaluate(async () => {
      const f = document.getElementById('orderForm'); if (!f) return 'no form';
      f.querySelectorAll('input, textarea').forEach(i => i.value = '');
      f.requestSubmit();
      await new Promise(r => setTimeout(r, 50));
      const errShown = !!document.querySelector('[aria-invalid="true"]') || getComputedStyle(document.getElementById('toast')).display !== 'none';
      return errShown && document.activeElement && document.activeElement.id === 'name' ? 'ok' : `error=${errShown} focus=${document.activeElement && document.activeElement.id}`;
    });
    formCheck === 'ok' ? pass(vp.name, 'form', 'Empty submit shows error + focuses Name') : fail(vp.name, 'form', 'Empty submit: ' + formCheck);

    // Date min must be at least 3 days out in LOCAL time
    const dateMin = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [document.getElementById('date').min, want]; });
    dateMin[0] === dateMin[1] ? pass(vp.name, 'form', 'Date min = today + 3 (local)') : fail(vp.name, 'form', `Date min ${dateMin[0]} expected ${dateMin[1]}`);

    // Fill & build message, delivery toggle
    await page.fill('#name', 'Test Buyer');
    await page.fill('#phone', '3025550100');
    await page.fill('#date', dateMin[1]);
    await page.selectOption('#method', 'Delivery');
    const addrVisible = await page.isVisible('#addr');
    addrVisible ? pass(vp.name, 'form', 'Delivery reveals address field') : fail(vp.name, 'form', 'Address field not shown for Delivery');
    await page.fill('#addr', '1 Main St, Wilmington DE');
    await page.fill('#topper', 'Happy Birthday Kysha');
    const msg = await page.evaluate(() => buildMessage());
    /Delivery to 1 Main St/.test(msg) && /Happy Birthday Kysha/.test(msg) && /Test Buyer/.test(msg) ? pass(vp.name, 'form', 'Order message contains all fields') : fail(vp.name, 'form', 'Message missing fields: ' + msg);

    const link = await page.evaluate(() => { document.getElementById('orderForm').requestSubmit(); return document.getElementById('orderForm').dataset.lastLink || ''; });
    /^sms:\+13023575065[?&]body=/.test(link) && decodeURIComponent(link).includes('Happy Birthday Kysha') ? pass(vp.name, 'form', 'Valid submit builds sms: link to Tanesha with order text') : fail(vp.name, 'form', 'Bad sms link: ' + link.slice(0, 80));
    const invalidLeft = await page.evaluate(() => document.querySelectorAll('[aria-invalid="true"]').length);
    invalidLeft === 0 ? pass(vp.name, 'form', 'Errors clear once fields are fixed') : fail(vp.name, 'form', invalidLeft + ' fields still marked invalid');

    // Size buttons preselect bouquet
    const pre = await page.evaluate(() => { const b = document.querySelector('[data-size*="Large"]'); if (!b) return 'none'; b.click(); return document.getElementById('type').value; });
    /Large/.test(pre) ? pass(vp.name, 'form', 'Order-size buttons preselect bouquet') : fail(vp.name, 'form', 'Preselect failed: ' + pre);

    // 8. No CashApp anywhere, pickup address not public
    const text = (await page.textContent('body')).toLowerCase();
    /cash ?app/.test(text) ? fail(vp.name, 'content', 'CashApp still mentioned') : pass(vp.name, 'content', 'No CashApp mentions');

    // 9. Gallery filters + lightbox (if present)
    if (await page.$('[data-filter]')) {
      const f = await page.evaluate(() => { document.querySelector('[data-filter="Bottle"]').click(); const vis = [...document.querySelectorAll('.g-item')].filter(e => !e.hidden && getComputedStyle(e).display !== 'none').map(e => e.dataset.cat); document.querySelector('[data-filter="all"]').click(); return vis; });
      f.length && f.every(c => c === 'Bottle') ? pass(vp.name, 'gallery', `Filter works (${f.length} Bottle items)`) : fail(vp.name, 'gallery', 'Filter wrong: ' + f.join(','));
    }
    if (await page.$('.g-item')) {
      await page.locator('.g-item').first().scrollIntoViewIfNeeded();
      await page.locator('.g-item').first().click();
      await page.waitForTimeout(350);
      const open = await page.evaluate(() => { const d = document.getElementById('lightbox'); return d && d.open; });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      const closed = await page.evaluate(() => !document.getElementById('lightbox').open);
      const refocus = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('g-item'));
      refocus ? pass(vp.name, 'gallery', 'Focus returns to gallery item after closing') : fail(vp.name, 'gallery', 'Focus lost after closing lightbox');
      open && closed ? pass(vp.name, 'gallery', 'Lightbox opens and closes with Esc') : fail(vp.name, 'gallery', `Lightbox open=${open} closed=${closed}`);
    }

    // Mobile quick bar hidden at top, shown after hero, hidden again at top
    if (vp.width <= 720) {
      const bar = await page.evaluate(async () => { const w = t => new Promise(r => setTimeout(r, t)); const m = document.getElementById('mbar'); document.documentElement.style.scrollBehavior = 'auto';
        scrollTo(0, 0); await w(400); const a = m.classList.contains('show'); scrollTo(0, 2500); await w(400); const b = m.classList.contains('show'); scrollTo(0, 0); await w(400); return [a, b, m.classList.contains('show')]; });
      bar.join() === 'false,true,false' ? pass(vp.name, 'nav', 'Quick bar hides on hero, shows after scrolling') : fail(vp.name, 'nav', 'Quick bar states ' + bar.join());
    }
    // Nav highlight clears on hero (desktop)
    if (vp.width > 720) {
      const cur = await page.evaluate(async () => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('gallery').scrollIntoView(); await new Promise(r => setTimeout(r, 400)); const g = document.querySelector('.nav-links a[aria-current="true"]')?.textContent; scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); return [g, document.querySelectorAll('.nav-links a[aria-current="true"]').length]; });
      cur[0] === 'Gallery' && cur[1] === 0 ? pass(vp.name, 'nav', 'Active nav link tracks section and clears at top') : fail(vp.name, 'nav', 'Nav highlight: ' + cur.join());
    }

    const key = await page.getAttribute('#orderForm', 'data-web3forms-key');
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key || '') && (await page.textContent('#sendLabel')) === 'Send My Order'
      ? pass(vp.name, 'form', 'Order emails are switched on (Web3Forms key present)') : fail(vp.name, 'form', 'Web3Forms key missing or malformed: ' + key);
    // Current prices (client-confirmed): X-Small 150, Small 250, Medium 300, Large 350
    const prices = await page.evaluate(() => [...document.querySelectorAll('.size .price')].map(e => e.textContent.trim()).join(','));
    prices === '$150,$250,$300,$350' ? pass(vp.name, 'content', 'Prices correct: ' + prices) : fail(vp.name, 'content', 'Prices wrong: ' + prices);
    const mail = await page.evaluate(() => ({ links: document.querySelectorAll('a[href="mailto:hello@creationsbytp.com"]').length, ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).email }));
    mail.links >= 2 && mail.ld === 'hello@creationsbytp.com' ? pass(vp.name, 'content', 'Business email hello@ linked (contact + footer + schema)') : fail(vp.name, 'content', 'Email links ' + JSON.stringify(mail));
    // Social links present
    const socials = await page.evaluate(() => ({ tt: document.querySelectorAll('a[href="https://www.tiktok.com/@taneshap1105"]').length, ig: document.querySelectorAll('a[href="https://www.instagram.com/creationsby_tp/"]').length, ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).sameAs.length }));
    socials.tt >= 3 && socials.ig >= 3 && socials.ld === 2 ? pass(vp.name, 'social', `TikTok (${socials.tt}) + Instagram (${socials.ig}) linked, schema sameAs ok`) : fail(vp.name, 'social', JSON.stringify(socials));
    // Every gallery filter shows only its own category, none empty
    const cats = await page.evaluate(() => [...document.querySelectorAll('[data-filter]')].filter(b => b.dataset.filter !== 'all').map(b => { b.click(); const vis = [...document.querySelectorAll('.g-item')].filter(e => !e.hidden); return b.dataset.filter + ':' + vis.length + ':' + vis.every(e => e.dataset.cat === b.dataset.filter); }));
    await page.evaluate(() => document.querySelector('[data-filter="all"]').click());
    cats.every(c => !/:0:|false/.test(c)) ? pass(vp.name, 'gallery', 'All filters non-empty & correct: ' + cats.map(c => c.split(':').slice(0, 2).join('=')).join(' ')) : fail(vp.name, 'gallery', 'Filter issue ' + cats.join(' '));
    // Instagram item in lightbox shows "Watch on Instagram"
    const igLink = await page.evaluate(async () => { const it = [...document.querySelectorAll('.g-item')].find(e => /Burn Away/.test(e.getAttribute('aria-label'))); it.click(); await new Promise(r => setTimeout(r, 300)); const l = document.querySelector('#lbCap a')?.href; document.getElementById('lightbox').close(); return l; });
    /instagram\.com\/creationsby_tp\/reel\//.test(igLink || '') ? pass(vp.name, 'gallery', 'IG items link to original post') : fail(vp.name, 'gallery', 'IG link missing: ' + igLink);

    // Gallery videos autoplay when on screen, pause when filtered out
    const auto = await page.evaluate(async () => {
      const w = t => new Promise(r => setTimeout(r, t));
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelector('[data-filter="all"]').click();
      document.getElementById('galleryGrid').scrollIntoView(); await w(1500);
      const vids = [...document.querySelectorAll('#galleryGrid video')];
      const onScreen = vids.filter(v => { const r = v.getBoundingClientRect(); return r.top < innerHeight * .8 && r.bottom > innerHeight * .2; });
      const playing = onScreen.filter(v => !v.paused).length;
      document.querySelector('[data-filter="Baby"]').click(); await w(300);
      const hiddenPlaying = vids.filter(v => v.closest('[hidden]') && !v.paused).length;
      document.querySelector('[data-filter="all"]').click();
      return { total: vids.length, onScreen: onScreen.length, playing, hiddenPlaying };
    });
    auto.total >= 6 && auto.onScreen > 0 && auto.playing === auto.onScreen && auto.hiddenPlaying === 0
      ? pass(vp.name, 'gallery', `Videos autoplay on screen (${auto.playing}/${auto.onScreen} visible playing, ${auto.total} total), filtered ones paused`)
      : fail(vp.name, 'gallery', 'Autoplay state ' + JSON.stringify(auto));

    // 10. FAQ toggles
    const faq = await page.evaluate(() => { const d = document.querySelectorAll('#faq details')[1]; d.querySelector('summary').click(); return d.open; });
    faq ? pass(vp.name, 'faq', 'FAQ expands') : fail(vp.name, 'faq', 'FAQ did not expand');

    // Errors collected across the run
    consoleErrors.length ? consoleErrors.forEach(e => fail(vp.name, 'console', e.slice(0, 200))) : pass(vp.name, 'console', 'No console / JS errors');
    badResponses.length ? badResponses.forEach(e => fail(vp.name, 'network', e)) : pass(vp.name, 'network', 'No failed requests');

    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, `${vp.name}-top.png`) });
    await page.screenshot({ path: path.join(SHOTS, `${vp.name}-full.png`), fullPage: true });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { document.getElementById('galleryGrid').scrollIntoView(); await new Promise(r => setTimeout(r, 800)); });
    const r = await page.evaluate(() => ({ paused: document.getElementById('heroVid').paused, galleryPlaying: [...document.querySelectorAll('#galleryGrid video')].filter(v => !v.paused).length, hidden: [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity === '0').length }));
    r.paused && r.galleryPlaying === 0 && r.hidden === 0 && !errs.length ? pass('reduced-motion', 'a11y', 'Reduced motion: hero + gallery videos paused, all content visible, no errors') : fail('reduced-motion', 'a11y', JSON.stringify(r) + errs.join(';'));
    await ctx.close();
  }

  for (const scenario of ['success', 'failure', 'nokey']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; let sent = null;
    page.on('pageerror', e => errs.push(e.message));
    await page.route(URL, async route => {
      const res = await route.fetch(); const html = (await res.text()).replace(/data-web3forms-key="[^"]*"/, scenario === 'nokey' ? 'data-web3forms-key=""' : 'data-web3forms-key="TEST-KEY"');
      route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
    });
    await page.route('https://api.web3forms.com/submit', async route => {
      sent = JSON.parse(route.request().postData() || '{}');
      await new Promise(r => setTimeout(r, 300));
      scenario === 'success'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Email sent' }) })
        : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Server error' }) });
    });
    await page.goto(URL, { waitUntil: 'networkidle' });
    const label = await page.textContent('#sendLabel');
    await page.fill('#name', 'Email Tester'); await page.fill('#phone', '3025550100');
    await page.evaluate(() => { document.getElementById('date').value = document.getElementById('date').min; });
    await page.selectOption('#method', 'Delivery'); await page.fill('#addr', '9 Rose Ln'); await page.fill('#topper', 'Happy Retirement');
    if (scenario === 'nokey') {
      const link = await page.evaluate(() => { document.getElementById('orderForm').requestSubmit(); return document.getElementById('orderForm').dataset.lastLink || ''; });
      label === 'Text My Order' && !sent && /^sms:\+13023575065/.test(link)
        ? pass('email-nokey', 'form', 'Without a key: "Text My Order" opens a text, nothing sent to Web3Forms')
        : fail('email-nokey', 'form', `label=${label} sent=${!!sent} link=${link.slice(0, 40)}`);
      errs.length ? fail('email-nokey', 'console', errs.join('; ')) : pass('email-nokey', 'console', 'No JS errors');
      await ctx.close();
      continue;
    }
    await page.click('#sendBtn');
    const busy = await page.getAttribute('#sendBtn', 'aria-busy');
    await page.waitForFunction(() => document.getElementById('orderForm').dataset.sent);
    const out = await page.evaluate(() => ({ sent: document.getElementById('orderForm').dataset.sent, toast: document.getElementById('toast').innerText, cls: document.getElementById('toast').className, link: document.querySelector('#toast a')?.getAttribute('href') || '', btnDisabled: document.getElementById('sendBtn').disabled }));
    const tag = 'email-' + scenario;
    label === 'Send My Order' ? pass(tag, 'form', 'Button reads "Send My Order" when email is configured') : fail(tag, 'form', 'Button label ' + label);
    busy === 'true' ? pass(tag, 'form', 'Button shows sending state') : fail(tag, 'form', 'No busy state');
    if (scenario === 'success') {
      sent && sent.access_key === 'TEST-KEY' && sent.Name === 'Email Tester' && sent['Delivery address'] === '9 Rose Ln' && /Happy Retirement/.test(sent.message) && /^New order:/.test(sent.subject) && sent.botcheck === false
        ? pass(tag, 'form', 'Web3Forms receives key, subject, all fields and full message') : fail(tag, 'form', 'Payload ' + JSON.stringify(sent));
      out.sent === 'true' && /Order sent to Tanesha/.test(out.toast) && /ok/.test(out.cls) && /^sms:\+13023575065/.test(out.link) && !out.btnDisabled
        ? pass(tag, 'form', 'Success message + optional "text her too" link') : fail(tag, 'form', JSON.stringify(out));
    } else {
      out.sent === 'false' && /couldn't send/.test(out.toast) && /bad/.test(out.cls) && /^sms:\+13023575065/.test(out.link) && !out.btnDisabled
        ? pass(tag, 'form', 'Failure falls back to a text-message link, button re-enabled') : fail(tag, 'form', JSON.stringify(out));
    }
    errs.length ? fail(tag, 'console', errs.join('; ')) : pass(tag, 'console', 'No JS errors');
    await ctx.close();
  }
  await browser.close();

  const fails = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.vp}] ${r.area}: ${r.msg}`);
  console.log(`\n${results.length - fails.length} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
