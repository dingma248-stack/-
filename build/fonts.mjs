import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { normalizePath } from 'vite';
import subsetFont from 'subset-font';

/**
 * Serves `virtual:fonts.css`: the @fontsource faces the game uses, cut down to
 * the characters that actually appear in the game's source, and inlined as
 * base64 woff2. Noto Serif SC alone ships ~100 unicode-range files per weight;
 * this turns ~60 font requests (~2 MB) into a few hundred KB inside the CSS,
 * and lets the single-file build work offline from file://.
 */

const require = createRequire(import.meta.url);
const VID = 'virtual:fonts.css';
const RID = '\0' + VID;
const TEXT_EXT = /\.(ts|css|html)$/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Every character in the given files/dirs, plus all of printable ASCII. */
function collectChars(root, sources) {
  const set = new Set();
  for (let c = 0x20; c < 0x7f; c++) set.add(c);
  for (const s of sources) {
    const abs = path.resolve(root, s);
    const files = fs.statSync(abs).isDirectory() ? walk(abs, []) : [abs];
    for (const f of files) for (const ch of fs.readFileSync(f, 'utf8')) set.add(ch.codePointAt(0));
  }
  set.delete(0x0a);
  set.delete(0x0d);
  set.delete(0x09);
  return [...set].sort((a, b) => a - b);
}

function parseRange(s) {
  return s.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

function formatRange(cps) {
  const out = [];
  for (let i = 0; i < cps.length; ) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    const hex = (n) => n.toString(16);
    out.push(i === j ? `U+${hex(cps[i])}` : `U+${hex(cps[i])}-${hex(cps[j])}`);
    i = j + 1;
  }
  return out.join(',');
}

async function generate(faces, chars) {
  const all = [];
  for (const face of faces) {
    const cssPath = require.resolve(`@fontsource/${face}.css`);
    const css = fs.readFileSync(cssPath, 'utf8');
    for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      const body = m[1];
      const prop = (k) => body.match(new RegExp(`${k}:\\s*([^;]+);`))?.[1].trim();
      const woff2 = body.match(/url\(([^)]+\.woff2)\)/)?.[1];
      const range = prop('unicode-range');
      if (!woff2 || !range) continue;
      const rs = parseRange(range);
      all.push({ prop, file: path.resolve(path.dirname(cssPath), woff2), cps: chars.filter((c) => rs.some(([a, b]) => c >= a && c <= b)) });
    }
  }
  // For overlapping ranges the browser uses the last face declared, so earlier faces of the
  // same family/style/weight never show those code points: leave them out of their subsets.
  const claimed = new Map();
  for (let i = all.length - 1; i >= 0; i--) {
    const f = all[i];
    const k = `${f.prop('font-family')}|${f.prop('font-style')}|${f.prop('font-weight')}`;
    if (!claimed.has(k)) claimed.set(k, new Set());
    const taken = claimed.get(k);
    f.cps = f.cps.filter((c) => !taken.has(c));
    for (const c of f.cps) taken.add(c);
  }
  const jobs = [];
  for (const { prop, file, cps } of all) {
    if (!cps.length) continue;
    jobs.push(
      (async () => {
        const src = fs.readFileSync(file);
        const text = String.fromCodePoint(...cps);
        const data = await subsetFont(src, text, { targetFormat: 'woff2' });
        return (
          `@font-face{font-family:${prop('font-family')};font-style:${prop('font-style')};font-weight:${prop('font-weight')};` +
          `font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');unicode-range:${formatRange(cps)}}`
        );
      })(),
    );
  }
  // keep @fontsource's declaration order
  return (await Promise.all(jobs)).join('\n') + '\n';
}

/**
 * @param {{ faces: string[], sources: string[] }} opts
 *   faces: @fontsource CSS entry points without extension, e.g. 'noto-serif-sc/400'.
 *   sources: files/dirs (relative to the project root) whose text the fonts must cover.
 */
export function fontSubset({ faces, sources }) {
  let root = process.cwd();
  let key = '';
  let pending = null;

  // anything that changes the output: the character set, the font packages, this generator
  const inputs = () => [
    faces,
    require('subset-font/package.json').version,
    ...new Set(faces.map((f) => `${f.split('/')[0]}@${require(`@fontsource/${f.split('/')[0]}/package.json`).version}`)),
    fs.readFileSync(new URL(import.meta.url), 'utf8'),
  ];

  const build = () => {
    const chars = collectChars(root, sources);
    const nextKey = crypto.createHash('sha1').update(JSON.stringify([chars, ...inputs()])).digest('hex').slice(0, 16);
    if (nextKey === key && pending) return pending;
    key = nextKey;
    const dir = path.join(root, 'node_modules/.cache/mistport-fonts');
    const cacheFile = path.join(dir, `${key}.css`);
    pending = fs.existsSync(cacheFile)
      ? Promise.resolve(fs.readFileSync(cacheFile, 'utf8'))
      : generate(faces, chars).then((css) => {
          fs.mkdirSync(dir, { recursive: true });
          // write-then-rename so a concurrent build never reads half a file
          const tmp = `${cacheFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, css);
          fs.renameSync(tmp, cacheFile);
          for (const f of fs.readdirSync(dir)) if (f.endsWith('.css') && f !== `${key}.css`) fs.rmSync(path.join(dir, f), { force: true });
          return css;
        });
    // don't remember a failure (e.g. a read-only cache dir) for this key
    pending.catch(() => {
      if (key === nextKey) pending = null;
    });
    return pending;
  };

  return {
    name: 'mistport:font-subset',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VID ? RID : null;
    },
    load(id) {
      return id === RID ? build() : null;
    },
    // dev server: new text in the source may need new glyphs
    handleHotUpdate({ file, server, modules }) {
      // Vite hands over forward-slash paths on every OS; path.resolve gives backslashes on Windows
      const inSources = sources.some((s) => {
        const rel = path.relative(normalizePath(path.resolve(root, s)), file);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      });
      if (!TEXT_EXT.test(file) || !inSources) return;
      const before = key;
      build().catch((err) => server.config.logger.error(`[font-subset] ${err?.message ?? err}`));
      if (key === before) return;
      const mod = server.moduleGraph.getModuleById(RID);
      if (!mod) return;
      server.moduleGraph.invalidateModule(mod);
      return [...modules, mod];
    },
  };
}
