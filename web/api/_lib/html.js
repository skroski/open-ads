// Leitura leve de HTML (sem dependências) para a auditoria de páginas.
// Não é um parser completo: cobre o que a análise precisa e degrada com elegância.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export function decodeEntities(s) {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function textOf(fragment) {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function metaTags(html) {
  const out = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    }
    out.push(attrs);
  }
  return out;
}

const TRACKING = [
  ['gtag', /googletagmanager\.com\/gtag\/js|gtag\s*\(/i],
  ['gtm', /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/],
  ['ga', /google-analytics\.com\/(analytics|ga)\.js|G-[A-Z0-9]{6,}/],
  ['google-ads', /googleadservices\.com|AW-\d{6,}/],
  ['meta-pixel', /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\s*\(/i],
  ['clarity', /clarity\.ms/i],
  ['hotjar', /static\.hotjar\.com/i],
];

export function extractAudit(html) {
  const clean = stripNoise(html);
  const metas = metaTags(html);
  const meta = (key) =>
    metas.find((m) => (m.name ?? '').toLowerCase() === key || (m.property ?? '').toLowerCase() === key)?.content;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const robots = (meta('robots') ?? '').toLowerCase();
  const headings = (tag) =>
    Array.from(clean.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')), (m) => textOf(m[1]))
      .filter(Boolean)
      .slice(0, 10)
      .map((t) => t.slice(0, 200));

  const body = textOf(clean);
  return {
    title: title ? textOf(title[1]).slice(0, 300) : undefined,
    metaDescription: meta('description')?.slice(0, 500),
    h1: headings('h1'),
    h2: headings('h2'),
    forms: (clean.match(/<form[\s>]/gi) ?? []).length,
    telLinks: (clean.match(/href=["']tel:/gi) ?? []).length,
    whatsappLinks: (clean.match(/href=["'][^"']*(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/)/gi) ?? []).length,
    hasViewport: metas.some((m) => (m.name ?? '').toLowerCase() === 'viewport'),
    hasCanonical: /<link\b[^>]*rel=["']?canonical["']?[^>]*>/i.test(html),
    noindex: /noindex/.test(robots),
    lang: html.match(/<html\b[^>]*\blang=["']?([a-zA-Z-]{2,10})/i)?.[1],
    trackingTags: TRACKING.filter(([, re]) => re.test(html)).map(([name]) => name),
    wordCount: body ? body.split(/\s+/).length : 0,
  };
}
