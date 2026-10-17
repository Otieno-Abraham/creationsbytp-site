// Writes clean-URL copies of the single page (/bouquets/, /faq/ ...) so deep links work on static hosting.
// The page's script scrolls to the matching section. Output folders are gitignored.
const fs = require('fs'), path = require('path');
const site = path.join(__dirname, 'site');
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
for (const dir of ['bouquets', 'gallery', 'how-to-order', 'order', 'faq']) {
  fs.mkdirSync(path.join(site, dir), { recursive: true });
  fs.writeFileSync(path.join(site, dir, 'index.html'), html);
}
console.log('built clean-URL pages');
