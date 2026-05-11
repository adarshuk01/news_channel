"use strict";

const axios   = require("axios");
const cheerio = require("cheerio");

// ─────────────────────────────────────────────
//  Source configuration
// ─────────────────────────────────────────────
const SOURCES = {
  manorama: {
    baseUrl: "https://www.manoramaonline.com",
    icon:    "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/50/3f/56/503f5669-704b-5689-b68b-88ce6dd7d7e9/AppIcon4NormalUsers-0-0-1x_U007emarketing-0-6-0-85-220.png/512x512bb.jpg",
    channel: "Manorama",
  },
  asianet: {
    baseUrl: "https://www.asianetnews.com",
    icon:    "https://play-lh.googleusercontent.com/P_-tUCKxNAhgNMwSyHF1NQBg0H27KnHiD_7SFf_y5BYFT3cMEV8FqUBiGGGJsJNMUg=w240-h480-rw",
    channel: "Asianet",
  },
  mediaone: {
    baseUrl: "https://www.mediaoneonline.com",
    icon:    "https://upload.wikimedia.org/wikipedia/commons/6/62/Media_One_Logo.png",
    channel: "MediaOne",
  },
  oneindia: {
    rssUrl:  "https://malayalam.oneindia.com/rss/feeds/malayalam-news-fb.xml",
    icon:    "https://imagesvs.oneindia.com/images/oneindia-lm-logo-1721304500709.svg",
    channel: "Oneindia",
  },
  news18: {
    // Primary Google News Sitemap
    sitemapUrl:      "https://malayalam.news18.com/commonfeeds/v1/mal/sitemap/google-news.xml",
    // Fallback standard news sitemap
    sitemapFallback: "https://malayalam.news18.com/sitemap/news-sitemap.xml",
    baseUrl: "https://malayalam.news18.com",
    icon:    "https://static.news18.com/static/img/logo-news18-favicon-32.png",
    channel: "News18 Malayalam",
  },
};

// Default browser-like headers
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

async function loadPage(url) {
  try {
    const { data } = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    });
    return cheerio.load(data, { xmlMode: true, decodeEntities: true });
  } catch (err) {
    throw new Error(`Failed to fetch "${url}": ${err.message}`);
  }
}

const stripLive  = (text) => text.replace(/^Live\s*/gi, "").trim();
const stripCdata = (s = "") => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
const resolve    = (base, href = "") => href.startsWith("http") ? href : base + href;

const isValidImage = (url) => {
  if (!url) return false;
  const clean = url.split("?")[0];
  return /^https?:\/\//i.test(url) && /\.(jpg|jpeg|png|webp|gif)$/i.test(clean);
};

// ─────────────────────────────────────────────
//  Raw XML helpers  (namespace-safe, no cheerio)
//  These work reliably on Vercel where cheerio's
//  namespace selectors (news\:title) often fail.
// ─────────────────────────────────────────────

/**
 * Extract text content of the FIRST matching tag (handles namespaced tags).
 * e.g. xmlTag(chunk, "news:title")  or  xmlTag(chunk, "loc")
 */
function xmlTag(xml, tag) {
  const esc = tag.replace(":", "\\:").replace(".", "\\.");
  const re  = new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i");
  const m   = xml.match(re);
  return m ? stripCdata(m[1]).trim() : "";
}

/**
 * Extract an attribute value from the first matching tag.
 * e.g. xmlAttr(chunk, "enclosure", "url")
 */
function xmlAttr(xml, tag, attr) {
  const esc = tag.replace(":", "\\:").replace(".", "\\.");
  const re  = new RegExp(`<${esc}[^>]*\\s${attr}="([^"]*)"`, "i");
  const m   = xml.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Split sitemap XML into individual <url>…</url> chunks.
 */
function splitUrlChunks(xml) {
  const chunks = [];
  let pos = 0;
  while (true) {
    const open  = xml.indexOf("<url>", pos);
    if (open === -1) break;
    const close = xml.indexOf("</url>", open);
    if (close === -1) break;
    chunks.push(xml.slice(open + 5, close));
    pos = close + 6;
  }
  return chunks;
}

// ─────────────────────────────────────────────
//  News18 fetch strategy
//  Tries direct → multiple proxies → rss2json
//  for BOTH the primary and fallback sitemap URLs.
// ─────────────────────────────────────────────

function buildNews18Attempts(targetUrl) {
  const enc = encodeURIComponent(targetUrl);
  return [
    // 1. Direct request — works locally, often blocked on Vercel US egress IPs
    {
      name: "direct",
      run: async () => {
        const { data } = await axios.get(targetUrl, {
          headers: DEFAULT_HEADERS,
          timeout: 12000,
        });
        return typeof data === "string" ? data : null;
      },
    },
    // 2. allorigins raw
    {
      name: "allorigins-raw",
      run: async () => {
        const { data } = await axios.get(
          `https://api.allorigins.win/raw?url=${enc}`,
          { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 15000 }
        );
        return typeof data === "string" ? data : null;
      },
    },
    // 3. allorigins JSON wrapper
    {
      name: "allorigins-json",
      run: async () => {
        const { data } = await axios.get(
          `https://api.allorigins.win/get?url=${enc}`,
          { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 15000 }
        );
        return data && typeof data.contents === "string" ? data.contents : null;
      },
    },
    // 4. corsproxy.io
    {
      name: "corsproxy",
      run: async () => {
        const { data } = await axios.get(
          `https://corsproxy.io/?${enc}`,
          { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 15000 }
        );
        return typeof data === "string" ? data : null;
      },
    },
    // 5. codetabs
    {
      name: "codetabs",
      run: async () => {
        const { data } = await axios.get(
          `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`,
          { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 15000 }
        );
        return typeof data === "string" ? data : null;
      },
    },
    // 6. rss2json — reconstructs minimal XML from its JSON response
    {
      name: "rss2json",
      run: async () => {
        const { data } = await axios.get(
          `https://api.rss2json.com/v1/api.json?rss_url=${enc}`,
          { timeout: 15000 }
        );
        if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
        // Build synthetic sitemap XML so the rest of the parser works unchanged
        const urlBlocks = data.items.map((it) => {
          const img =
            it.thumbnail ||
            (it.enclosure && it.enclosure.link) ||
            "";
          return [
            "<url>",
            `  <loc>${it.link || ""}</loc>`,
            `  <news:title>${it.title || ""}</news:title>`,
            `  <news:publication_date>${it.pubDate || ""}</news:publication_date>`,
            `  <image:loc>${img}</image:loc>`,
            `  <news:keywords>${(it.description || "").replace(/<[^>]+>/g, "")}</news:keywords>`,
            "</url>",
          ].join("\n");
        });
        return `<urlset>\n${urlBlocks.join("\n")}\n</urlset>`;
      },
    },
  ];
}

/**
 * Try every proxy strategy for both sitemap URLs.
 * Returns the first raw XML string that contains <url> or <loc> tags.
 */
async function fetchNews18RawXml() {
  const { sitemapUrl, sitemapFallback } = SOURCES.news18;

  for (const targetUrl of [sitemapUrl, sitemapFallback]) {
    const attempts = buildNews18Attempts(targetUrl);

    for (const attempt of attempts) {
      try {
        const xml = await attempt.run();
        if (xml && (xml.includes("<url>") || xml.includes("<loc>"))) {
          console.log(
            `[News18] ✅ Got XML via "${attempt.name}" from ${targetUrl} (${xml.length} chars)`
          );
          return xml;
        }
        console.log(`[News18] ⚠️  "${attempt.name}" returned no usable XML`);
      } catch (err) {
        console.log(`[News18] ⚠️  "${attempt.name}" threw: ${err.message}`);
      }
    }
    console.log(`[News18] All attempts failed for: ${targetUrl} — trying fallback…`);
  }

  return null;
}

// ─────────────────────────────────────────────
//  News18 Malayalam scraper
// ─────────────────────────────────────────────

async function scrapeNews18Malayalam() {
  const { icon, channel } = SOURCES.news18;

  const rawXml = await fetchNews18RawXml();
  if (!rawXml) {
    console.error("[News18] ❌ All fetch strategies exhausted — skipping source");
    return [];
  }

  const chunks = splitUrlChunks(rawXml);
  console.log(`[News18] Parsing ${chunks.length} <url> blocks`);

  const news = [];

  for (const chunk of chunks) {
    const loc = xmlTag(chunk, "loc");
    if (!loc || !loc.startsWith("http")) continue;

    // Title: news:title preferred, fall back to plain title
    const rawTitle = xmlTag(chunk, "news:title") || xmlTag(chunk, "title") || "";
    const title    = stripLive(rawTitle);
    if (!title) continue;

    // Date: news:publication_date → lastmod → pubDate
    const pubDateRaw =
      xmlTag(chunk, "news:publication_date") ||
      xmlTag(chunk, "lastmod") ||
      xmlTag(chunk, "pubDate") ||
      "";
    let readableTime = "";
    if (pubDateRaw) {
      try {
        readableTime = new Date(pubDateRaw).toLocaleString("en-IN", {
          timeZone:   "Asia/Kolkata",
          day:        "2-digit",
          month:      "short",
          year:       "numeric",
          hour:       "2-digit",
          minute:     "2-digit",
        });
      } catch {
        readableTime = pubDateRaw;
      }
    }

    // Summary / keywords
    const summary = xmlTag(chunk, "news:keywords") || xmlTag(chunk, "description") || "";

    // Image: image:loc → enclosure[url] → media:content[url]
    const image =
      xmlTag(chunk, "image:loc") ||
      xmlAttr(chunk, "enclosure", "url") ||
      xmlAttr(chunk, "media:content", "url") ||
      "";

    if (!isValidImage(image)) {
      console.log("[News18] ⏭️  Skipping (no valid image):", title.slice(0, 50));
      continue;
    }

    news.push({ title, link: loc, summary, image, readableTime, icon, channel });
  }

  console.log(`[News18] ✅ ${news.length} valid articles`);
  return news;
}

// ─────────────────────────────────────────────
//  Manorama scraper
// ─────────────────────────────────────────────

async function scrapeManorama(url, selector) {
  const { baseUrl, icon, channel } = SOURCES.manorama;
  const $    = await loadPage(url);
  const news = [];

  $(selector).each((_, el) => {
    const anchor   = $(el).find("h2 a");
    const title    = stripLive(anchor.text().trim());
    const link     = resolve(baseUrl, anchor.attr("href"));
    const summary  = $(el).find(".cmp-story-list__dispn").text().trim();

    const imgEl    = $(el).find(".cmp-story-list__image-block > a > img");
    const rawImage = imgEl.attr("data-src") || imgEl.attr("data-websrc") || "";
    const image    = rawImage ? rawImage.split("?")[0] : "";

    const timeEl       = $(el).find(".cmp-story-list__date.en-font.text-sub-color");
    const timeText     = timeEl.text().trim();
    const timeAttr     = timeEl.attr("data-publish-date");
    const readableTime =
      timeText || (timeAttr ? new Date(parseInt(timeAttr, 10)).toLocaleString() : "");

    if (title && link) {
      news.push({ title, link, summary, image, readableTime, icon, channel });
    }
  });

  return news;
}

// ─────────────────────────────────────────────
//  Asianet scraper
// ─────────────────────────────────────────────

async function scrapeAsianet(url) {
  const { icon, channel } = SOURCES.asianet;
  let $;
  try {
    $ = await loadPage(url);
  } catch (err) {
    console.error("[Asianet] ❌ RSS failed:", err.message);
    return [];
  }

  const news = [];
  $("item").each((_, el) => {
    const raw     = $(el).html();
    const getTag  = (tag) => {
      const m = raw.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"));
      return m ? m[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1").trim() : "";
    };
    const getAttr = (tag, attr) => {
      const m = raw.match(new RegExp(`<${tag}[^>]*${attr}="(.*?)"`, "s"));
      return m ? m[1] : "";
    };

    const title   = stripLive(getTag("title"));
    const link    = getTag("link");
    const summary = getTag("description");
    const pubDate = getTag("pubDate");
    const image   = (getAttr("media:content", "url") || getAttr("enclosure", "url") || "").trim();

    if (!isValidImage(image)) return;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  });

  console.log(`[Asianet] ✅ ${news.length} articles`);
  return news;
}

// ─────────────────────────────────────────────
//  MediaOne scraper
// ─────────────────────────────────────────────

async function scrapeMediaOneSports(url) {
  const { baseUrl, icon, channel } = SOURCES.mediaone;
  const $        = await loadPage(url);
  const articles = [];

  $(".d-flex.flex-wrap").each((_, el) => {
    const title        = $(el).find(".list-item-right h3.story-title").text().trim();
    const href         = $(el).find("a").attr("href") || "";
    const link         = resolve(baseUrl, href);
    const summary      = $(el).find(".list-item-right p").text().trim();
    const rawImage     = $(el).find(".story-img img").attr("data-src") || "";
    const image        = rawImage.startsWith("https") ? rawImage : resolve(baseUrl, rawImage);
    const category     = $(el).find(".sports-header a").text().trim();
    const readableTime = $(el).find(".time-as-duration").text().trim();

    if (title && link) {
      articles.push({ title, link, summary, image, category, readableTime, icon, channel });
    }
  });

  return articles;
}

// ─────────────────────────────────────────────
//  Oneindia Malayalam scraper  (RSS feed)
// ─────────────────────────────────────────────

async function scrapeOneindia() {
  const { rssUrl, icon, channel } = SOURCES.oneindia;

  const proxies = [
    {
      name: "allorigins",
      buildUrl: () => `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`,
      extract:  (data) => (typeof data === "string" ? data : null),
    },
    {
      name: "allorigins-json",
      buildUrl: () => `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`,
      extract:  (data) => (data && data.contents ? data.contents : null),
    },
    {
      name: "corsproxy",
      buildUrl: () => `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`,
      extract:  (data) => (typeof data === "string" ? data : null),
    },
    {
      name: "codetabs",
      buildUrl: () => `https://api.codetabs.com/v1/proxy?quest=${rssUrl}`,
      extract:  (data) => (typeof data === "string" ? data : null),
    },
  ];

  let rawXml = null;
  for (const proxy of proxies) {
    try {
      const { data } = await axios.get(proxy.buildUrl(), {
        timeout: 15000,
        headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] },
      });
      const candidate = proxy.extract(data);
      if (candidate && candidate.includes("<item>")) {
        console.log(`[Oneindia] ✅ via ${proxy.name} (${candidate.length} chars)`);
        rawXml = candidate;
        break;
      }
    } catch (err) {
      console.log(`[Oneindia] ⚠️  ${proxy.name}: ${err.message}`);
    }
  }

  if (!rawXml) {
    console.error("[Oneindia] ❌ All proxies failed");
    return [];
  }

  const _strip = (s = "") =>
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
  const getTag = (chunk, tag) => {
    const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? _strip(m[1]) : "";
  };

  const news = [];
  for (const chunk of rawXml.split(/<item>/).slice(1)) {
    const end     = chunk.indexOf("</item>");
    const itemXml = end !== -1 ? chunk.slice(0, end) : chunk;

    const title   = stripLive(getTag(itemXml, "title"));
    const link    = getTag(itemXml, "link");
    const summary = getTag(itemXml, "description");
    const pubDate = getTag(itemXml, "pubDate");
    const imgM    = itemXml.match(/url="(https?:\/\/[^"]+)"/);
    const image   = imgM ? imgM[1].trim() : "";

    if (!isValidImage(image)) continue;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  }

  console.log(`[Oneindia] ✅ ${news.length} articles`);
  return news;
}

// ─────────────────────────────────────────────
//  Exported fetchers
// ─────────────────────────────────────────────

exports.fetchManoramaLatestNews = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/news/latest-news.html`,
    "#Just_in_Slot > div > ul > li"
  );

exports.fetchManoramaTechNews = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/technology/technology-news.html`,
    "#Tech___Gadgets_SubsectionPage_Technology_News > div > ul > li"
  );

exports.fetchAsianetLatestNews = () =>
  scrapeAsianet(`${SOURCES.asianet.baseUrl}/rss`);

exports.fetchMediaOneSportsNews = () =>
  scrapeMediaOneSports(`${SOURCES.mediaone.baseUrl}/sports`);

exports.fetchOneindiaLatestNews = () => scrapeOneindia();

exports.fetchNews18MalayalamLatestNews = () => scrapeNews18Malayalam();

// ─────────────────────────────────────────────
//  Aggregate helpers
// ─────────────────────────────────────────────

exports.fetchAllLatestNews = async () => {
  const results = await Promise.allSettled([
    exports.fetchManoramaLatestNews(),
    exports.fetchAsianetLatestNews(),
    exports.fetchOneindiaLatestNews(),
    exports.fetchNews18MalayalamLatestNews(),
  ]);

  return results
    .filter((r) => {
      if (r.status === "rejected") {
        console.error("[NewsService] error:", r.reason?.message);
        return false;
      }
      return true;
    })
    .flatMap((r) => r.value);
};

exports.fetchAllNews = async () => {
  const [latest, tech, sports] = await Promise.allSettled([
    exports.fetchAllLatestNews(),
    exports.fetchManoramaTechNews(),
    exports.fetchMediaOneSportsNews(),
  ]);

  const safe = (r, label) => {
    if (r.status === "rejected") {
      console.error(`[NewsService] fetchAllNews (${label}):`, r.reason?.message);
      return [];
    }
    return r.value;
  };

  return {
    latest: safe(latest, "latest"),
    tech:   safe(tech,   "tech"),
    sports: safe(sports, "sports"),
  };
};