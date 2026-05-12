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
    rssUrl: "https://www.mediaoneonline.com/google_feeds.xml",
    icon: "https://upload.wikimedia.org/wikipedia/commons/6/62/Media_One_Logo.png",
    channel: "MediaOne",
  },

  oneindia: {
    rssUrl: "https://malayalam.oneindia.com/rss/feeds/malayalam-news-fb.xml",
    icon: "https://imagesvs.oneindia.com/images/oneindia-lm-logo-1721304500709.svg",
    channel: "Oneindia",
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

const stripLive = (text = "") =>
  text.replace(/^Live\s*/gi, "").trim();

const stripCdata = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();

const resolve = (base, href = "") =>
  href.startsWith("http") ? href : base + href;

const isValidImage = (url = "") => {
  if (!url) return false;
  const clean = url.split("?")[0];
  return (
    /^https?:\/\//i.test(url) &&
    /\.(jpg|jpeg|png|webp|gif)$/i.test(clean)
  );
};

// ─────────────────────────────────────────────
// HTML cleaner
// ─────────────────────────────────────────────
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
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
  return text;
}

// ─────────────────────────────────────────────
// Shared XML helpers
// ─────────────────────────────────────────────

/** Extract text content of the first matching tag (handles CDATA). */
function getXmlTag(xml, tag) {
  const esc = tag.replace(":", "\\:");
  const re = new RegExp(
    `<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`,
    "i"
  );
  const m = xml.match(re);
  return m ? stripCdata(m[1]).trim() : "";
}

/** Extract an attribute value from the first matching tag. */
function getXmlAttr(xml, tag, attr) {
  const esc = tag.replace(":", "\\:");
  const re = new RegExp(`<${esc}[^>]*\\s${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

// ─────────────────────────────────────────────
// MANORAMA
// ─────────────────────────────────────────────
async function scrapeManorama(url, selector) {
  const { baseUrl, icon, channel } = SOURCES.manorama;
  const $ = await loadPage(url);
  const news = [];

  $(selector).each((_, el) => {
    const anchor      = $(el).find("h2 a");
    const title       = stripLive(anchor.text().trim());
    const link        = resolve(baseUrl, anchor.attr("href"));
    const summary     = cleanHtmlText($(el).find(".cmp-story-list__dispn").html() || "");
    const imgEl       = $(el).find(".cmp-story-list__image-block img");
    const image       = imgEl.attr("data-src") || imgEl.attr("data-websrc") || "";
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
const ASIANET_SUMMARY_WORD_LIMIT = 40;

async function scrapeAsianet(url) {
  const { icon, channel } = SOURCES.asianet;
  const $ = await loadPage(url);
  const news = [];

  $("item").each((_, el) => {
    const raw = $(el).html();

    const getTag = (tag) => {
      const esc = tag.replace(":", "\\:");
      const m = raw.match(
        new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i")
      );
      return m ? stripCdata(m[1]).trim() : "";
    };

    const getAttr = (tag, attr) => {
      const m = raw.match(new RegExp(`<${tag}[^>]*${attr}="(.*?)"`, "s"));
      return m ? m[1] : "";
    };

    const title   = stripLive(getTag("title"));
    const link    = getTag("link");
    const pubDate = getTag("pubDate");
    const image   =
      getAttr("media:content", "url") || getAttr("enclosure", "url") || "";

    let summary = cleanHtmlText(getTag("content:encoded") || getTag("description"));
    const words = summary.split(" ").filter(Boolean);
    if (words.length > ASIANET_SUMMARY_WORD_LIMIT) {
      summary = words.slice(0, ASIANET_SUMMARY_WORD_LIMIT).join(" ") + "...";
    }

    if (!isValidImage(image)) return;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  });

  return news;
}

// ─────────────────────────────────────────────
// MEDIAONE  (RSS: google_feeds.xml)
//
// Feed structure per item:
//   <title>           CDATA plain text
//   <description>     CDATA short summary
//   <link>            plain URL
//   <guid>            same as link
//   <pubDate>         plain text
//   <enclosure url="…webp" type="image/jpeg" length="…"/>  ← image
//   <content:encoded> CDATA full HTML body
// ─────────────────────────────────────────────
const MEDIAONE_SUMMARY_WORD_LIMIT = 40;

async function scrapeMediaOne() {
  const { rssUrl, icon, channel } = SOURCES.mediaone;

  const { data } = await axios.get(rssUrl, {
    headers: DEFAULT_HEADERS,
    timeout: 15000,
  });

  const news  = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];

    const title   = stripLive(getXmlTag(itemXml, "title"));
    const link    = getXmlTag(itemXml, "link") || getXmlTag(itemXml, "guid");
    const pubDate = getXmlTag(itemXml, "pubDate");

    // Try enclosure first, then content:encoded src attr, then media:content
    const image =
      getXmlAttr(itemXml, "enclosure", "url") ||
      getXmlAttr(itemXml, "media:content", "url") ||
      (() => {
        const m = itemXml.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
        return m ? m[1] : "";
      })();

    // Build summary: prefer description, fall back to content:encoded
    let rawSummary =
      getXmlTag(itemXml, "description") ||
      getXmlTag(itemXml, "content:encoded");
    let summary = cleanHtmlText(rawSummary);
    const words = summary.split(" ").filter(Boolean);
    if (words.length > MEDIAONE_SUMMARY_WORD_LIMIT) {
      summary = words.slice(0, MEDIAONE_SUMMARY_WORD_LIMIT).join(" ") + "...";
    }

    if (!isValidImage(image)) continue;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
  }

  return news;
}

// ─────────────────────────────────────────────
// ONEINDIA
// ─────────────────────────────────────────────
async function scrapeOneindia() {
  const { rssUrl, icon, channel } = SOURCES.oneindia;

  const { data } = await axios.get(rssUrl, {
    headers: DEFAULT_HEADERS,
    timeout: 15000,
  });

  const news  = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];

    const title   = stripLive(getXmlTag(itemXml, "title"));
    const link    = getXmlTag(itemXml, "link");
    const summary = cleanHtmlText(getXmlTag(itemXml, "description"));
    const pubDate = getXmlTag(itemXml, "pubDate");

    const imgM  = itemXml.match(/url="(https?:\/\/[^"]+)"/);
    const image = imgM ? imgM[1] : "";

    if (!isValidImage(image)) continue;
    if (title && link) {
      news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
    }
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
exports.fetchOneindiaLatestNews  = () => scrapeOneindia();

// ─────────────────────────────────────────────
// AGGREGATE
// ─────────────────────────────────────────────

exports.fetchAllLatestNews = async () => {
  const results = await Promise.allSettled([
    exports.fetchManoramaLatestNews(),
    exports.fetchAsianetLatestNews(),
    exports.fetchOneindiaLatestNews(),
    exports.fetchMediaOneLatestNews(),
  ]);

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
};

exports.fetchAllNews = async () => {
  const latest = await exports.fetchAllLatestNews();
  return { latest, sports: [] };
};