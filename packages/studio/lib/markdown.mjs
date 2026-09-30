/**
 * Markdown for a studio's posts, rendered once at build time into HTML the site serves as it is.
 *
 * A small, safe subset (site/SITE.md lists it): headings, paragraphs, **bold**, *italic*, ~~struck~~,
 * `code`, fenced code blocks, links, images, lists, quotes and rules. Everything else is text: raw HTML in
 * a post is escaped, never passed through, and a link or image goes only to an https:// address or a path
 * on the studio's own site (`/…`), so a post can never run a script or point at `javascript:`.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** A link or image address a post may use: https://…, or a path on this site. Anything else is null. */
export function safeUrl(value, { images = false } = {}) {
  const url = String(value ?? '').trim();
  if (!url || /[\s<>"'`\\]/.test(url)) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (!images && /^#[A-Za-z0-9_-]{1,64}$/.test(url)) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

const HOLD = /\u0000(\d+)\u0000/g;
const unescapeHtml = (v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function emphasis(s) {
  return s
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, (m, pre, t) => `${pre}<em>${t}</em>`)
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, (m, pre, t) => `${pre}<em>${t}</em>`)
    .replace(/~{2}([^~]+)~{2}/g, '<s>$1</s>');
}

/* Inline: code spans, images and links are held aside as finished HTML (so emphasis never reaches inside an
   address), then emphasis and line breaks, then the held pieces go back. */
function inline(text) {
  const kept = [];
  const hold = (html) => { kept.push(html); return `\u0000${kept.length - 1}\u0000`; };
  let s = String(text).replace(/\u0000/g, '').replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, title) => {
    const url = safeUrl(unescapeHtml(src), { images: true });
    return url ? hold(`<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" decoding="async"${title ? ` title="${title}"` : ''}>`) : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const url = safeUrl(unescapeHtml(href));
    if (!url) return label;
    return hold(`<a href="${escapeHtml(url)}"${/^https:/.test(url) ? ' rel="noopener"' : ''}>${emphasis(label)}</a>`);
  });
  s = s.replace(/&lt;(https:\/\/[^\s&]+)&gt;/g, (m, href) => {
    const url = safeUrl(href);
    return url ? hold(`<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a>`) : m;
  });
  s = emphasis(s).replace(/ {2,}\n|\\\n/g, '<br>').replace(/\n/g, ' ');
  for (let guard = 0; guard < 8 && HOLD.test(s); guard++) s = s.replace(HOLD, (_, i) => kept[Number(i)]);
  return s;
}

/**
 * Markdown to HTML. Headings shift down one level (a post's page has its title as the one h1), so `#` is h2.
 * Returns the HTML and the plain text (for a feed's summary and the post record's text).
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join('\n'))}</p>`); para = []; } };
  const LIST = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^(```|~~~)\s*([A-Za-z0-9_+-]{0,20})\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      for (i += 1; i < lines.length && !lines[i].startsWith(fence[1]); i++) body.push(lines[i]);
      out.push(`<pre><code${fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,5})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { flush(); const n = Math.min(6, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line.trim());
    if (img) {
      flush();
      const url = safeUrl(img[2], { images: true });
      if (url) out.push(`<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(img[1])}" loading="lazy" decoding="async">${img[3] ? `<figcaption>${inline(img[3])}</figcaption>` : ''}</figure>`);
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quote = [];
      for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
      i -= 1;
      out.push(`<blockquote>${renderMarkdown(quote.join('\n')).html}</blockquote>`);
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]);
      const items = [];
      for (; i < lines.length; i++) {
        const m = LIST.exec(lines[i]);
        if (m && /\d/.test(m[1]) === ordered) items.push([m[2]]);
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1].push(lines[i].trim());
        else break;
      }
      i -= 1;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((parts) => `<li>${inline(parts.join('\n'))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  const html = out.join('\n');
  const text = unescapeHtml(html.replace(/<\/?(?:p|h\d|li|ul|ol|blockquote|pre|figure|figcaption|hr|br)\b[^>]*>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return { html, text };
}
