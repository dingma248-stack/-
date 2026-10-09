/**
 * Inlines the bundled JS and CSS into the HTML so the whole game is one file
 * that runs straight from disk (file://) with no server. Browsers refuse to
 * load module scripts from file:// URLs, but inline module scripts are fine.
 */

const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

/** @param {{ fileName: string }} opts */
export function singleFile({ fileName }) {
  return {
    name: 'mistport:single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const htmlKey = Object.keys(bundle).find((k) => k.endsWith('.html'));
      if (!htmlKey) return this.error('single-file: no HTML in bundle');
      const html = bundle[htmlKey];
      const lookup = (url) => {
        const key = url.replace(/^\.?\//, '');
        const file = bundle[key];
        if (!file) this.error(`single-file: ${url} is not in the bundle`);
        delete bundle[key];
        return file;
      };
      // swap tags for placeholders first so the leftover check only sees the page itself
      const inlined = [];
      const slot = (tag) => `\0${inlined.push(tag) - 1}\0`;
      const page = String(html.source)
        .replace(/<link rel="modulepreload"[^>]*>\n?/g, '')
        .replace(/<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g, (_m, url) => {
          const code = lookup(url).code;
          if (/<!--/.test(code) && /<script/i.test(code)) this.error(`single-file: ${url} contains "<!--" and "<script"`);
          return slot(`<script type="module">${escapeScript(code)}</script>`);
        })
        .replace(/<link rel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g, (_m, url) => {
          const css = String(lookup(url).source);
          if (/<\/style/i.test(css)) this.error(`single-file: ${url} contains "</style"`);
          return slot(`<style>${css}</style>`);
        });
      const left = Object.keys(bundle).filter((k) => k !== htmlKey);
      if (left.length) this.error(`single-file: not inlined: ${left.join(', ')}`);
      if (/\s(src|href)="(?!data:)[^"]*"/.test(page)) this.error('single-file: HTML still references external files');
      const out = page.replace(/\0(\d+)\0/g, (_m, i) => inlined[+i]);
      html.source = out;
      html.fileName = fileName;
    },
  };
}
