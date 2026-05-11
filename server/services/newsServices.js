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
    sitemapUrl: "https://malayalam.news18.com/commonfeeds/v1/mal/sitemap/google-news.xml",
    baseUrl:    "https://malayalam.news18.com",
    icon:       "https://static.news18.com/static/img/logo-news18-favicon-32.png",
    channel:    "News18 Malayalam",
  },
};

// Default browser-like headers to avoid blocks
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

/**
 * Safely fetch a URL and return a Cheerio instance.
 * Throws a descriptive error on failure.
 */
async function loadPage(url) {
  try {
    const { data } = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    });

    return cheerio.load(data, {
      xmlMode: true,
      decodeEntities: true,
    });

  } catch (err) {
    throw new Error(`Failed to fetch "${url}": ${err.message}`);
  }
}

/** Strip leading "Live " labels that some outlets prefix to titles. */
const stripLive = (text) => text.replace(/^Live\s*/gi, "").trim();

/** Strip CDATA wrappers */
const stripCdata = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();

/** Resolve a possibly-relative URL against a base. */
const resolve = (base, href = "") =>
  href.startsWith("http") ? href : base + href;

/** Validate image URL */
const isValidImage = (url) =>
  !!url &&
  /^https?:\/\//i.test(url) &&
  /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url);

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
    const raw = $(el).html();

    const getTag = (tag) => {
      const match = raw.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"));
      return match
        ? match[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1").trim()
        : "";
    };

    const getAttr = (tag, attr) => {
      const match = raw.match(new RegExp(`<${tag}[^>]*${attr}="(.*?)"`, "s"));
      return match ? match[1] : "";
    };

    const title   = stripLive(getTag("title"));
    const link    = getTag("link");
    const summary = getTag("description");
    const pubDate = getTag("pubDate");

    let image =
      getAttr("media:content", "url") ||
      getAttr("enclosure", "url") ||
      "";

    image = image.trim();

    if (!isValidImage(image)) {
      console.log("[Asianet] ⏭️ Skipping (invalid image):", image);
      return;
    }

    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  });

  console.log(`[Asianet] ✅ Valid RSS articles: ${news.length}`);
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
        console.log(`[Oneindia] ✅ RSS fetched via ${proxy.name}, length: ${candidate.length}`);
        rawXml = candidate;
        break;
      }
      console.log(`[Oneindia] ⚠️ ${proxy.name} returned no valid XML`);
    } catch (err) {
      console.log(`[Oneindia] ⚠️ ${proxy.name} failed: ${err.message}`);
    }
  }

  if (!rawXml) {
    console.error("[Oneindia] ❌ All proxy attempts failed — skipping source");
    return [];
  }

  const _stripCdata = (s = "") =>
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
     .replace(/<[^>]+>/g, "")
     .trim();

  const getTag = (chunk, tag) => {
    const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? _stripCdata(m[1]) : "";
  };

  const itemChunks = rawXml.split(/<item>/).slice(1);
  const news = [];

  for (const chunk of itemChunks) {
    const endIdx = chunk.indexOf("</item>");
    const itemXml = endIdx !== -1 ? chunk.slice(0, endIdx) : chunk;

    const title   = stripLive(getTag(itemXml, "title"));
    const link    = getTag(itemXml, "link");
    const summary = getTag(itemXml, "description").replace(/<[^>]+>/g, "").trim();
    const pubDate = getTag(itemXml, "pubDate");

    const imgMatch = itemXml.match(/url="(https?:\/\/[^"]+)"/);
    const image    = imgMatch ? imgMatch[1].trim() : "";

    if (!isValidImage(image)) {
      console.log("[Oneindia] ⏭️ Skipping:", title.slice(0, 40), "| img:", image.slice(0, 60));
      continue;
    }

    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  }

  console.log(`[Oneindia] ✅ Valid articles parsed: ${news.length}`);
  return news;
}

// ─────────────────────────────────────────────
//  News18 Malayalam scraper  (News Sitemap XML)
// ─────────────────────────────────────────────

/**
 * Fetches News18 Malayalam articles from their Google News Sitemap.
 * The sitemap contains <url> entries with:
 *   - <loc>           → article URL
 *   - <lastmod>       → last modified ISO timestamp
 *   - <news:news>     → publication date, title, keywords
 *   - <image:image>   → <image:loc> for the thumbnail
 *
 * Tries direct fetch first, then falls back to proxy if blocked.
 */
async function scrapeNews18Malayalam() {
  const { sitemapUrl, icon, channel } = SOURCES.news18;

  // Try fetching the sitemap directly first, then via proxy
  const attempts = [
    {
      name: "direct",
      buildUrl: () => sitemapUrl,
      headers: DEFAULT_HEADERS,
    },
    {
      name: "allorigins",
      buildUrl: () => `https://api.allorigins.win/raw?url=${encodeURIComponent(sitemapUrl)}`,
      headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] },
    },
    {
      name: "allorigins-json",
      buildUrl: () => `https://api.allorigins.win/get?url=${encodeURIComponent(sitemapUrl)}`,
      headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] },
    },
  ];

  let rawXml = null;

  for (const attempt of attempts) {
    try {
      const { data } = await axios.get(attempt.buildUrl(), {
        timeout: 15000,
        headers: attempt.headers,
      });

      // allorigins-json wraps the response in a `contents` key
      const candidate =
        attempt.name === "allorigins-json"
          ? data && data.contents
            ? data.contents
            : null
          : typeof data === "string"
          ? data
          : null;

      if (candidate && (candidate.includes("<url>") || candidate.includes("<loc>"))) {
        console.log(`[News18] ✅ Sitemap fetched via ${attempt.name}, length: ${candidate.length}`);
        rawXml = candidate;
        break;
      }
      console.log(`[News18] ⚠️ ${attempt.name} returned no valid XML`);
    } catch (err) {
      console.log(`[News18] ⚠️ ${attempt.name} failed: ${err.message}`);
    }
  }

  if (!rawXml) {
    console.error("[News18] ❌ All fetch attempts failed — skipping source");
    return [];
  }

  // Use cheerio in xmlMode to parse the sitemap
  const $ = cheerio.load(rawXml, { xmlMode: true, decodeEntities: true });
  const news = [];

  $("url").each((_, el) => {
    const loc = $(el).find("loc").first().text().trim();

    // news:title
    const rawTitle = $(el).find("news\\:title, title").first().text().trim();
    const title    = stripLive(stripCdata(rawTitle));

    // news:publication_date (ISO 8601) or lastmod
    const pubDateRaw =
      $(el).find("news\\:publication_date").first().text().trim() ||
      $(el).find("lastmod").first().text().trim();
    const readableTime = pubDateRaw
      ? new Date(pubDateRaw).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";

    // news:keywords (optional)
    const keywords = stripCdata($(el).find("news\\:keywords").first().text().trim());

    // image:loc
    const rawImage = stripCdata(
      $(el).find("image\\:loc").first().text().trim()
    );
    const image = rawImage.trim();

    if (!title || !loc) return;

    // Only include items with a valid image (consistent with other scrapers)
    if (!isValidImage(image)) {
      console.log("[News18] ⏭️ Skipping (no valid image):", title.slice(0, 50));
      return;
    }

    news.push({
      title,
      link:        loc,
      summary:     keywords, // keywords double as a brief summary
      image,
      readableTime,
      icon,
      channel,
    });
  });

  console.log(`[News18] ✅ Valid articles parsed: ${news.length}`);
  return news;
}

// ─────────────────────────────────────────────
//  Exported fetchers
// ─────────────────────────────────────────────

// -- Manorama --

/** Latest Kerala news (Manorama) */
exports.fetchManoramaLatestNews = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/news/latest-news.html`,
    "#Just_in_Slot > div > ul > li",
  );

/** Technology news (Manorama) */
exports.fetchManoramaTechNews = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/technology/technology-news.html`,
    "#Tech___Gadgets_SubsectionPage_Technology_News > div > ul > li",
  );

// -- Asianet --

exports.fetchAsianetLatestNews = () =>
  scrapeAsianet(
    `${SOURCES.asianet.baseUrl}/rss`,
    "div._2asjQ.gawidget_homeheadline > div > figure",
  );

// -- MediaOne --

/** Sports news (MediaOne) */
exports.fetchMediaOneSportsNews = () =>
  scrapeMediaOneSports(`${SOURCES.mediaone.baseUrl}/sports`);

// -- Oneindia --

/** Latest news (Oneindia Malayalam) */
exports.fetchOneindiaLatestNews = () => scrapeOneindia();

// -- News18 Malayalam --

/** Latest news (News18 Malayalam) from news sitemap */
exports.fetchNews18MalayalamLatestNews = () => scrapeNews18Malayalam();

// ─────────────────────────────────────────────
//  Aggregate helpers
// ─────────────────────────────────────────────

/**
 * Fetch all latest news from every source in parallel.
 * Failed sources are skipped gracefully; errors are logged to stderr.
 * @returns {Promise<Array>} Merged array sorted by source order.
 */
exports.fetchAllLatestNews = async () => {
  const results = await Promise.allSettled([
    exports.fetchManoramaLatestNews(),
    exports.fetchAsianetLatestNews(),
    exports.fetchOneindiaLatestNews(),
    exports.fetchNews18MalayalamLatestNews(),   // ← NEW
  ]);

  return results
    .filter((r) => {
      if (r.status === "rejected") {
        console.error("[NewsService] fetchAllLatestNews error:", r.reason?.message);
        return false;
      }
      return true;
    })
    .flatMap((r) => r.value);
};

/**
 * Fetch all news across every category and source in parallel.
 * @returns {Promise<{ latest: Array, tech: Array, sports: Array }>}
 */
exports.fetchAllNews = async () => {
  const [latest, tech, sports] = await Promise.allSettled([
    exports.fetchAllLatestNews(),
    exports.fetchManoramaTechNews(),
    exports.fetchMediaOneSportsNews(),
  ]);

  const safe = (r, label) => {
    if (r.status === "rejected") {
      console.error(`[NewsService] fetchAllNews (${label}) error:`, r.reason?.message);
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