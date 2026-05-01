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

    // 🔥 FORCE XML parsing mode
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

/** Resolve a possibly-relative URL against a base. */
const resolve = (base, href = "") =>
  href.startsWith("http") ? href : base + href;

// ─────────────────────────────────────────────
//  Manorama scraper
// ─────────────────────────────────────────────

/**
 * Generic Manorama list-page scraper.
 * @param {string} url
 * @param {string} selector  CSS selector targeting each <li> story card
 */
async function scrapeManorama(url, selector) {
  const { baseUrl, icon, channel } = SOURCES.manorama;
  const $    = await loadPage(url);
  const news = [];

  $(selector).each((_, el) => {
    const anchor   = $(el).find("h2 a");
    const title    = stripLive(anchor.text().trim());
    const link     = resolve(baseUrl, anchor.attr("href"));
    const summary  = $(el).find(".cmp-story-list__dispn").text().trim();

    const imgEl   = $(el).find(".cmp-story-list__image-block > a > img");
    const rawImage = imgEl.attr("data-src") || imgEl.attr("data-websrc") || "";
    const image   = rawImage ? rawImage.split("?")[0] : "";
    console.log('my image', image);

    const timeEl      = $(el).find(".cmp-story-list__date.en-font.text-sub-color");
    const timeText    = timeEl.text().trim();
    const timeAttr    = timeEl.attr("data-publish-date");
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

/**
 * Generic Asianet News list-page scraper.
 *
 * Page structure (as of April 2026):
 *   #root > div > main > div._2asjQ.gawidget_homeheadline > div > figure
 *
 * @param {string} url
 * @param {string} selector  CSS selector targeting each <figure> story card
 */
async function scrapeAsianet(url) {
  const { icon, channel } = SOURCES.asianet;

  let $;
  try {
    $ = await loadPage(url);
    console.log("[Asianet] RSS loaded");
  } catch (err) {
    console.error("[Asianet] ❌ RSS failed:", err.message);
    return [];
  }

  const news = [];

  // ✅ helper: validate image url
  const isValidImage = (url) => {
    if (!url) return false;

    // must be http/https
    if (!/^https?:\/\//i.test(url)) return false;

    // must end with valid image extension
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(url)) return false;

    return true;
  };

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

    // ✅ extract image (priority order)
    let image =
      getAttr("media:content", "url") ||
      getAttr("enclosure", "url") ||
      "";

    image = image.trim();

    // 🔥 skip if invalid image
    if (!isValidImage(image)) {
      console.log("⏭️ Skipping (invalid image):", image);
      return;
    }

    if (title && link) {
      news.push({
        title,
        link,
        summary,
        image,
        readableTime: pubDate,
        icon,
        channel,
      });
    }
  });

  console.log(`[Asianet] ✅ Valid RSS articles: ${news.length}`);
  return news;
}

// ─────────────────────────────────────────────
//  MediaOne scraper
// ─────────────────────────────────────────────

/**
 * MediaOne sports scraper.
 * @param {string} url
 */
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
//  Public API
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

/**
 * Latest news (Asianet).
 * Selector updated April 2026 — targets each <figure> inside the
 * headline grid: div._2asjQ.gawidget_homeheadline > div > figure
 */
exports.fetchAsianetLatestNews = () =>
  scrapeAsianet(
    `${SOURCES.asianet.baseUrl}/rss`,
    "div._2asjQ.gawidget_homeheadline > div > figure",
  );

// -- MediaOne --

/** Sports news (MediaOne) */
exports.fetchMediaOneSportsNews = () =>
  scrapeMediaOneSports(`${SOURCES.mediaone.baseUrl}/sports`);

// ─────────────────────────────────────────────
//  Aggregate helpers
// ─────────────────────────────────────────────

/**
 * Fetch all latest news from every source in parallel.
 * Failed sources are skipped gracefully; errors are logged to stderr.
 * @returns {Promise<Array>} Merged, deduplicated array sorted by source order.
 */
exports.fetchAllLatestNews = async () => {
  const results = await Promise.allSettled([
    exports.fetchManoramaLatestNews(),
    exports.fetchAsianetLatestNews(),
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