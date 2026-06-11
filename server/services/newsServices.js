"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

// ─────────────────────────────────────────────
// Source configuration
// ─────────────────────────────────────────────
const SOURCES = {
  manorama: {
    baseUrl: "https://www.manoramaonline.com",
    icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/50/3f/56/503f5669-704b-5689-b68b-88ce6dd7d7e9/AppIcon4NormalUsers-0-0-1x_U007emarketing-0-6-0-85-220.png/512x512bb.jpg",
    channel: "Manorama",
  },

  asianet: {
    baseUrl: "https://www.asianetnews.com",
    icon: "https://play-lh.googleusercontent.com/P_-tUCKxNAhgNMwSyHF1NQBg0H27KnHiD_7SFf_y5BYFT3cMEV8FqUBiGGGJsJNMUg=w240-h480-rw",
    channel: "Asianet",
  },

  mediaone: {
    baseUrl: "https://www.mediaoneonline.com",
    latestUrl: "https://www.mediaoneonline.com/latest-news",
    icon: "https://upload.wikimedia.org/wikipedia/commons/6/62/Media_One_Logo.png",
    channel: "MediaOne",
  },

  oneindia: {
    rssUrl: "https://malayalam.oneindia.com/rss/feeds/malayalam-news-fb.xml",
    icon: "https://imagesvs.oneindia.com/images/oneindia-lm-logo-1721304500709.svg",
    channel: "Oneindia",
  },

  news18: {
    sitemapUrl: "https://malayalam.news18.com/commonfeeds/v1/mal/sitemap/google-news.xml",
    baseUrl: "https://malayalam.news18.com",
    icon: "https://static.news18.com/static/img/logo-news18-favicon-32.png",
    channel: "News18 Malayalam",
  },

  mathrubhumi: {
    apiUrl: "https://www.mathrubhumi.com/263/api/home-api-1",
    baseUrl: "https://www.mathrubhumi.com",
    imageBaseUrl: "https://img.mathrubhumi.com",
    icon: "https://www.mathrubhumi.com/favicon.ico",
    channel: "Mathrubhumi",
  },

  twentyfour: {
    apiUrl: "https://www.twentyfournews.com/wp-json/wp/v2/posts",
    mediaApiUrl: "https://www.twentyfournews.com/wp-json/wp/v2/media",
    icon: "https://www.twentyfournews.com/wp-content/uploads/2017/08/24-news-logo.png",
    channel: "24 News",
    perPage: 20,
  },
};

// ─────────────────────────────────────────────
// Default headers
// ─────────────────────────────────────────────
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadPage(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      Referer: "https://www.google.com/",
      DNT: "1",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      Priority: "u=0, i",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
    },
  });
  return cheerio.load(data);
}

async function fetchRaw(url) {
  const { data } = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 15000,
  });
  return data;
}

async function fetchJson(url) {
  const { data } = await axios.get(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept: "application/json, text/plain, */*",
    },
    timeout: 15000,
  });
  return data;
}

const stripLive = (t = "") => t.replace(/^Live\s*/gi, "").trim();
const stripCdata = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
const resolve = (base, href = "") => {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  return base + href;
};

function cleanHtmlText(text = "") {
  if (!text) return "";
  text = stripCdata(text);
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/pic\.twitter\.com\/\S+/gi, "")
    .replace(/https?:\/\/t\.co\/\S+/gi, "");
  text = cheerio.load(`<div>${text}</div>`).text();
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getXmlTag(xml, tag) {
  const esc = tag.replace(":", "\\:");
  const m = xml.match(
    new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i")
  );
  return m ? stripCdata(m[1]).trim() : "";
}

function getXmlAttr(xml, tag, attr) {
  const esc = tag.replace(":", "\\:");
  const m = xml.match(
    new RegExp(`<${esc}[^>]*\\s${attr}="([^"]*)"`, "i")
  );
  return m ? m[1].trim() : "";
}

const isValidImage = (url = "") => {
  if (!url) return false;
  return (
    /^https?:\/\//i.test(url) &&
    /\.(jpg|jpeg|png|webp|gif)$/i.test(url.split("?")[0])
  );
};

// ─────────────────────────────────────────────
// MANORAMA
// ─────────────────────────────────────────────
async function scrapeManorama(url, selector) {
  const { baseUrl, icon, channel } = SOURCES.manorama;
  const $ = await loadPage(url);
  const news = [];

  $(selector).each((_, el) => {
    const anchor = $(el).find("h2 a");
    const title = stripLive(anchor.text().trim());
    const link = resolve(baseUrl, anchor.attr("href"));
    const summary = cleanHtmlText(
      $(el).find(".cmp-story-list__dispn").html() || ""
    );
    const imgEl = $(el).find(".cmp-story-list__image-block img");
    const image =
      imgEl.attr("data-src") ||
      imgEl.attr("data-websrc") ||
      imgEl.attr("src") ||
      "";
    const readableTime = $(el).find(".cmp-story-list__date").text().trim();

    if (title && link) {
      news.push({ title, link, summary, image, readableTime, icon, channel });
    }
  });

  return news;
}

// ─────────────────────────────────────────────
// ASIANET
// ─────────────────────────────────────────────
async function scrapeAsianet(url) {
  const { icon, channel } = SOURCES.asianet;
  const data = await fetchRaw(url);
  const news = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];
    const title = stripLive(getXmlTag(itemXml, "title"));
    const link = getXmlTag(itemXml, "link");
    const pubDate = getXmlTag(itemXml, "pubDate");
    const image =
      getXmlAttr(itemXml, "media:content", "url") ||
      getXmlAttr(itemXml, "enclosure", "url") ||
      "";

    let summary = cleanHtmlText(
      getXmlTag(itemXml, "content:encoded") ||
        getXmlTag(itemXml, "description")
    );
    const words = summary.split(" ").filter(Boolean);
    if (words.length > 40) summary = words.slice(0, 150).join(" ") + "...";

    if (!isValidImage(image)) continue;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  }

  return news;
}

// ─────────────────────────────────────────────
// MEDIAONE
// ─────────────────────────────────────────────
async function scrapeMediaOne() {
  const { latestUrl, baseUrl, icon, channel } = SOURCES.mediaone;
  const $ = await loadPage(latestUrl);
  const news = [];

  $("#pills-all > ul > li.list-item").each((_, el) => {
    const title = stripLive($(el).find("h3.story-title").text().trim());
    const href = $(el).find("a").attr("href");
    const link = resolve(baseUrl, href);
    const summary = cleanHtmlText($(el).find("p").text().trim());
    const image =
      $(el).find("img").attr("data-src") ||
      $(el).find("img").attr("src") ||
      "";
    const readableTime = $(el).find(".time-as-duration").text().trim();

    if (title && link) {
      news.push({ title, link, summary, image, readableTime, icon, channel });
    }
  });

  return news;
}

// ─────────────────────────────────────────────
// ONEINDIA
// ─────────────────────────────────────────────
async function scrapeOneindia() {
  const { rssUrl, icon, channel } = SOURCES.oneindia;
  const data = await fetchRaw(rssUrl);
  const news = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];
    const title = stripLive(getXmlTag(itemXml, "title"));
    const link = getXmlTag(itemXml, "link");
    const summary = cleanHtmlText(getXmlTag(itemXml, "description"));
    const pubDate = getXmlTag(itemXml, "pubDate");
    const imgM = itemXml.match(/url="(https?:\/\/[^"]+)"/);
    const image = imgM ? imgM[1] : "";

    if (!isValidImage(image)) continue;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  }

  return news;
}

// ─────────────────────────────────────────────
// NEWS18 MALAYALAM — Google News Sitemap
// ─────────────────────────────────────────────
async function scrapeNews18() {
  const { sitemapUrl, icon, channel } = SOURCES.news18;
  const data = await fetchRaw(sitemapUrl);
  const news = [];

  const urlBlocks = data.split("<url>");

  for (const block of urlBlocks.slice(1)) {
    const chunk = block.split("</url>")[0];

    const loc = getXmlTag(chunk, "loc");
    if (!loc || !loc.includes("malayalam.news18.com")) continue;

    const rawTitle =
      getXmlTag(chunk, "news:title") || getXmlTag(chunk, "title");
    const title = stripLive(stripCdata(rawTitle).trim());
    if (!title) continue;

    const pubDate =
      getXmlTag(chunk, "news:publication_date") ||
      getXmlTag(chunk, "lastmod") ||
      "";

    let readableTime = pubDate;
    if (pubDate) {
      try {
        readableTime = new Date(pubDate).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch (_) {
        readableTime = pubDate;
      }
    }

    const rawImageLoc = getXmlTag(chunk, "image:loc");
    const image = stripCdata(rawImageLoc).trim();

    const rawKeywords = getXmlTag(chunk, "news:keywords");
    const summary = stripCdata(rawKeywords).trim();

    if (title && loc) {
      news.push({
        title,
        link: loc,
        summary,
        image: isValidImage(image) ? image : "",
        readableTime,
        icon,
        channel,
      });
    }
  }

  return news;
}

// ─────────────────────────────────────────────
// MATHRUBHUMI — JSON API
// ─────────────────────────────────────────────
async function scrapeMathrubhumi() {
  const { apiUrl, baseUrl, imageBaseUrl, icon, channel } = SOURCES.mathrubhumi;
  const news = [];

  const data = await fetchJson(apiUrl);

  const items = data?.home?.data || [];

  for (const item of items) {
    const elementType = item.elementType;
    if (elementType === 12) continue; // ads
    if (elementType === 11) continue; // trending topic chips

    const title = (item.itemTitle || "").trim();
    if (!title) continue;

    const detailPath = item.itemDetailURL || "";
    let link = "";
    if (detailPath.startsWith("http")) {
      link = detailPath;
    } else if (detailPath) {
      link = resolve(baseUrl, detailPath.replace(/^\/263/, ""));
    }
    if (!link) continue;

    if (item.shareURL && item.shareURL.startsWith("http")) {
      link = item.shareURL;
    }

    let image = "";
    const rawImage = item.itemImageURL || "";
    if (rawImage) {
      const cleanPath = rawImage.split("?")[0];
      if (cleanPath.startsWith("http")) {
        image = cleanPath;
      } else {
        image = imageBaseUrl + cleanPath;
      }
    }

    const summary = (item.itemTitleLead || "").trim();
    const readableTime = (item.publishedTime || "").trim();
    const section = item.subSectionTitle || item.sectionTitle || "";

    news.push({
      title,
      link,
      summary,
      image,
      readableTime,
      icon,
      channel,
      section,
    });
  }

  return news;
}

// ─────────────────────────────────────────────
// TWENTYFOUR NEWS — WordPress REST API
// NOTE: Images are returned as plain URLs.
//       The controller proxies them server-side when posting,
//       to bypass WordPress hotlink protection.
// ─────────────────────────────────────────────
async function scrapeTwentyFour() {
  const { apiUrl, mediaApiUrl, icon, channel, perPage } = SOURCES.twentyfour;
  const news = [];

  const posts = await fetchJson(
    `${apiUrl}?_embed&per_page=${perPage}&_fields=id,title,excerpt,link,featured_media,date`
  );
  if (!Array.isArray(posts) || !posts.length) return news;

  // Collect unique featured_media IDs (skip falsy/zero)
  const mediaIds = [...new Set(posts.map((p) => p.featured_media).filter(Boolean))];

  // Single batch request instead of N individual requests
  const mediaMap = {};
  if (mediaIds.length) {
    try {
      const mediaItems = await fetchJson(
        `${mediaApiUrl}?include=${mediaIds.join(",")}&per_page=${mediaIds.length}&_fields=id,source_url`
      );
      if (Array.isArray(mediaItems)) {
        for (const m of mediaItems) {
          if (m?.id && m?.source_url) {
            mediaMap[m.id] = m.source_url;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ 24 News media batch fetch failed:", err.message);
    }
  }

  for (const post of posts) {
    const title = stripLive(cleanHtmlText(post.title?.rendered || ""));
    if (!title) continue;

    const link = post.link || "";
    if (!link) continue;

    const rawSummary = post.excerpt?.rendered || "";
    const summary = cleanHtmlText(rawSummary);

    // Strip query strings from WP media URLs
    const rawImage = (post.featured_media && mediaMap[post.featured_media]) || "";
    const image = rawImage ? rawImage.split("?")[0] : "";

    let readableTime = "";
    if (post.date) {
      try {
        readableTime = new Date(post.date).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch (_) {
        readableTime = post.date;
      }
    }

    // Plain URL — no base64 conversion here (would bloat API response
    // and cause PayloadTooLargeError). The controller handles proxying.
    news.push({ title, link, summary, image, readableTime, icon, channel });
  }

  return news;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

exports.fetchManoramaLatestNews = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/news/latest-news.html`,
    "#Just_in_Slot > div > ul > li"
  );

exports.fetchAsianetLatestNews = () =>
  scrapeAsianet(`${SOURCES.asianet.baseUrl}/rss`);

exports.fetchMediaOneLatestNews = () => scrapeMediaOne();

exports.fetchOneindiaLatestNews = () => scrapeOneindia();

exports.fetchNews18LatestNews = () => scrapeNews18();

exports.fetchMathrubhumiLatestNews = () => scrapeMathrubhumi();

exports.fetchTwentyFourLatestNews = () => scrapeTwentyFour();

// ─────────────────────────────────────────────
// AGGREGATE
// ─────────────────────────────────────────────

exports.fetchAllLatestNews = async () => {
  const results = await Promise.allSettled([
    exports.fetchManoramaLatestNews(),
    exports.fetchAsianetLatestNews(),
    exports.fetchMediaOneLatestNews(),
    exports.fetchOneindiaLatestNews(),
    exports.fetchNews18LatestNews(),
    exports.fetchMathrubhumiLatestNews(),
    exports.fetchTwentyFourLatestNews(),
  ]);

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
};

exports.fetchAllNews = async () => {
  const latest = await exports.fetchAllLatestNews();
  return { latest, sports: [] };
};