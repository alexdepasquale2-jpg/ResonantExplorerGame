/* Inline every stylesheet and script into one self-contained HTML file.
 *
 *   node tools/build.mjs                -> dist/resonant.html
 *   node tools/build.mjs out.html       -> out.html
 *
 * The result opens from the filesystem with no server and no network access,
 * which is what a WebView shell (Capacitor/Cordova/TWA) needs for a real
 * mobile package — those want one asset, not a directory of relative links.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const out = resolve(target || join(ROOT, 'dist', 'resonant.html'));

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  `<style>\n${readFileSync(join(ROOT, href), 'utf8')}\n</style>`);

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  `<script>\n${readFileSync(join(ROOT, src), 'utf8')}\n</script>`);

/* Guard rather than trust the regexes: a renamed attribute order in index.html
 * would silently ship a bundle that 404s on a phone with no network. */
if (/<script src=|<link rel="stylesheet"/.test(html)) {
  console.error('build: an external reference survived inlining');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(1)} kB)`);
