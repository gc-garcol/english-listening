// Builds public/blog/*.html and public/sitemap.xml from content/blog/*.html.
// Each source file starts with a JSON header comment:
//   <!-- {"title": "...", "description": "...", "date": "2026-10-27", "order": 1} -->
// followed by the article body HTML. Run: npm run build:blog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'content/blog');
const outDir = path.join(root, 'public/blog');
const SITE = 'https://betterme.site';

// Static pages listed in the sitemap besides the blog.
const PAGES = [
  { loc: '/', priority: '1.0' },
  { loc: '/usage.html', priority: '0.8' },
  { loc: '/blog/', priority: '0.8' },
  { loc: '/about.html', priority: '0.5' },
  { loc: '/contact.html', priority: '0.3' },
  { loc: '/privacy.html', priority: '0.3' },
  { loc: '/terms.html', priority: '0.3' },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function readArticles() {
  return fs.readdirSync(srcDir)
    .filter((f) => f.endsWith('.html'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
      if (!m) throw new Error(`${file}: missing JSON header comment`);
      const meta = JSON.parse(m[1]);
      const body = raw.slice(m[0].length);
      const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      return { ...meta, slug: file.replace(/\.html$/, ''), body, words };
    })
    .sort((a, b) => a.order - b.order);
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} tháng ${Number(m)}, ${y}`;
}

function head({ title, description, canonical, type = 'website', jsonLd }) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="google-adsense-account" content="ca-pub-6125199294054172" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta name="theme-color" content="#161a35" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="English Listening" />
  <meta property="og:locale" content="vi_VN" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:title" content="${escape(title)}" />
  <meta property="og:description" content="${escape(description)}" />
  <meta property="og:image" content="${SITE}/og-image.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6125199294054172" crossorigin="anonymous"></script>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-4XBHWQ6CJJ"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-4XBHWQ6CJJ');
  </script>
</head>
<body>
  <header class="topbar page-topbar">
    <a class="brand" href="/" style="text-decoration: none">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9Z"/></svg>
      <span>English Listening</span>
    </a>
    <span class="spacer" style="flex: 1"></span>
    <a class="btn btn-ghost" href="/blog/">Bài viết</a>
    <a class="btn btn-primary" href="/">Luyện nghe ngay</a>
  </header>
`;
}

const FOOTER = `
  <footer class="site-footer">
    <a href="/">App</a> · <a href="/usage.html">Usage</a> · <a href="/blog/">Bài viết</a> · <a href="/about.html">Giới thiệu</a> · <a href="/contact.html">Liên hệ</a> · <a href="/terms.html">Điều khoản</a> · <a href="/privacy.html">Privacy Policy</a>
  </footer>
</body>
</html>
`;

function articlePage(a, all) {
  const url = `${SITE}/blog/${a.slug}.html`;
  const i = all.indexOf(a);
  const related = [1, 2, 3].map((k) => all[(i + k) % all.length]);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.updated || a.date,
    inLanguage: 'vi',
    image: `${SITE}/og-image.jpg`,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'English Listening', url: `${SITE}/about.html` },
    publisher: { '@type': 'Organization', name: 'English Listening', url: `${SITE}/` },
  };
  return head({ title: `${a.title} · English Listening`, description: a.description, canonical: url, type: 'article', jsonLd }) + `
  <main class="usage prose">
    <nav class="crumbs muted"><a href="/">Trang chủ</a> › <a href="/blog/">Bài viết</a></nav>
    <article class="panel">
      <h1>${escape(a.title)}</h1>
      <p class="muted">${formatDate(a.date)} · ${Math.max(1, Math.round(a.words / 220))} phút đọc</p>
${a.body.trim()}
    </article>

    <section class="panel cta">
      <h2>Thử ngay với một video bạn thích</h2>
      <p>Dán link YouTube vào <a href="/">English Listening</a>, nghe từng câu và gõ lại — app chấm từng từ, miễn phí, không cần đăng ký.</p>
    </section>

    <section class="panel">
      <h2>Bài viết liên quan</h2>
      <ul>
${related.map((r) => `        <li><a href="/blog/${r.slug}.html">${escape(r.title)}</a></li>`).join('\n')}
      </ul>
    </section>
  </main>
` + FOOTER;
}

function indexPage(all) {
  const url = `${SITE}/blog/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Bài viết luyện nghe tiếng Anh · English Listening',
    url,
    inLanguage: 'vi',
    blogPost: all.map((a) => ({ '@type': 'BlogPosting', headline: a.title, url: `${SITE}/blog/${a.slug}.html`, datePublished: a.date })),
  };
  return head({
    title: 'Bài viết luyện nghe tiếng Anh: phương pháp, phát âm, IELTS, TOEIC · English Listening',
    description: 'Các bài hướng dẫn luyện nghe tiếng Anh bằng chép chính tả: nối âm, âm cuối, dạng yếu, lộ trình luyện nghe, mẹo IELTS và TOEIC Listening, cách chọn video YouTube theo trình độ.',
    canonical: url,
    jsonLd,
  }) + `
  <main class="usage prose">
    <h1>Bài viết luyện nghe tiếng Anh</h1>
    <p class="lead muted">Hướng dẫn thực hành để luyện nghe hiệu quả hơn với phương pháp chép chính tả: từ cách nghe nối âm, âm cuối đến lộ trình cho người ôn IELTS, TOEIC.</p>
    <div class="post-list">
${all.map((a) => `      <a class="panel post-card" href="/blog/${a.slug}.html">
        <h2>${escape(a.title)}</h2>
        <p>${escape(a.description)}</p>
        <span class="muted">${formatDate(a.date)} · ${Math.max(1, Math.round(a.words / 220))} phút đọc</span>
      </a>`).join('\n')}
    </div>
  </main>
` + FOOTER;
}

function sitemap(all) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...PAGES.map((p) => ({ loc: SITE + p.loc, lastmod: today, priority: p.priority })),
    ...all.map((a) => ({ loc: `${SITE}/blog/${a.slug}.html`, lastmod: a.updated || a.date, priority: '0.6' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
}

const articles = readArticles();
fs.mkdirSync(outDir, { recursive: true });
for (const a of articles) fs.writeFileSync(path.join(outDir, `${a.slug}.html`), articlePage(a, articles));
fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(articles));
fs.writeFileSync(path.join(root, 'public/sitemap.xml'), sitemap(articles));
for (const a of articles) console.log(`${String(a.words).padStart(5)} words  blog/${a.slug}.html`);
console.log(`Built ${articles.length} articles, blog/index.html and sitemap.xml`);
