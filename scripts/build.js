// Bundles src/*.js into ONE zero-dependency ES module (dist/uap-dialog.js) that a host project can vendor.
// Plain fs only: the modules are concatenated in dependency order with their import lines removed and `export` dropped
// (index.js's export list is kept as the public surface).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = ['expr', 'parse', 'dialog'];
const strip = (src) => src
  .replace(/^import .*?;\s*$/gm, '')
  .replace(/^export (async function|function|class|const|let)/gm, '$1');
let body = '';
for (const name of ORDER) body += `// ---- ${name}.js\n${strip(readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')).trim()}\n\n`;
const names = [...readFileSync(new URL('../src/index.js', import.meta.url), 'utf8').matchAll(/export \{([^}]*)\}/g)]
  .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const out = `// uap-dialog ${pkg.version} (bundle). Zero dependencies. Source: src/*.js\n${body}export { ${names.join(', ')} };\n`;
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/uap-dialog.js', import.meta.url), out);
console.log(`Built dist/uap-dialog.js (${(out.length / 1024).toFixed(1)} KB; exports: ${names.join(', ')})`);
