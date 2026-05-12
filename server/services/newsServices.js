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
    // Primary: direct feed with CF-bypass headers
    directUrl: "https://www.mediaoneonline.com/google_feeds.xml",
    // Fallback: Google News RSS proxy — always open from any server IP
    rssUrl: "https://news.google.com/rss/search?q=site:mediaoneonline.com&hl=ml&gl=IN&ceid=IN:ml",
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
// Headers
// ─────────────────────────────────────────────
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Full browser-like headers to bypass Cloudflare on datacenter IPs
const CF_BYPASS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ml;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://www.google.com/",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadPage(url, headers = DEFAULT_HEADERS) {
  const { data } = await axios.get(url, { headers, timeout: 15000 });
  return cheerio.load(data, { xmlMode: true, decodeEntities: true });
}

async function fetchRaw(url, headers = DEFAULT_HEADERS) {
  const { data } = await axios.get(url, { headers, timeout: 15000 });
  return data;
}

const stripLive  = (t = "") => t.replace(/^Live\s*/gi, "").trim();
const stripCdata = (s = "") => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
const resolve    = (base, href = "") => href.startsWith("http") ? href : base + href;

const isValidImage = (url = "") => {
  if (!url) return false;
  const clean = url.split("?")[0];
  return /^https?:\/\//i.test(url) && /\.(jpg|jpeg|png|webp|gif)$/i.test(clean);
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
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
  return text;
}

function getXmlTag(xml, tag) {
  const esc = tag.replace(":", "\\:");
  const m = xml.match(new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i"));
  return m ? stripCdata(m[1]).trim() : "";
}

function getXmlAttr(xml, tag, attr) {
  const esc = tag.replace(":", "\\:");
  const m = xml.match(new RegExp(`<${esc}[^>]*\\s${attr}="([^"]*)"`, "i"));
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
    const anchor       = $(el).find("h2 a");
    const title        = stripLive(anchor.text().trim());
    const link         = resolve(baseUrl, anchor.attr("href"));
    const summary      = cleanHtmlText($(el).find(".cmp-story-list__dispn").html() || "");
    const imgEl        = $(el).find(".cmp-story-list__image-block img");
    const image        = imgEl.attr("data-src") || imgEl.attr("data-websrc") || "";
    const readableTime = $(el).find(".cmp-story-list__date").text().trim();
    if (title && link) news.push({ title, link, summary, image, readableTime, icon, channel });
  });

  return news;
}

// ─────────────────────────────────────────────
// ASIANET
// ─────────────────────────────────────────────
const ASIANET_WORD_LIMIT = 40;

async function scrapeAsianet(url) {
  const { icon, channel } = SOURCES.asianet;
  const $ = await loadPage(url);
  const news = [];

  $("item").each((_, el) => {
    const raw = $(el).html();
    const getTag  = (tag) => { const esc = tag.replace(":", "\\:"); const m = raw.match(new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i")); return m ? stripCdata(m[1]).trim() : ""; };
    const getAttr = (tag, attr) => { const m = raw.match(new RegExp(`<${tag}[^>]*${attr}="(.*?)"`, "s")); return m ? m[1] : ""; };

    const title   = stripLive(getTag("title"));
    const link    = getTag("link");
    const pubDate = getTag("pubDate");
    const image   = getAttr("media:content", "url") || getAttr("enclosure", "url") || "";

    let summary = cleanHtmlText(getTag("content:encoded") || getTag("description"));
    const words = summary.split(" ").filter(Boolean);
    if (words.length > ASIANET_WORD_LIMIT) summary = words.slice(0, ASIANET_WORD_LIMIT).join(" ") + "...";

    if (!isValidImage(image)) return;
    if (title && link) news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
  });

  return news;
}

// ─────────────────────────────────────────────
// MEDIAONE
//
// Problem: mediaoneonline.com uses Cloudflare WAF which
// blocks requests from Vercel/AWS datacenter IPs.
//
// Strategy:
//   1. Try direct RSS with full CF-bypass headers
//   2. If Cloudflare returns an HTML challenge (non-XML),
//      fall back to Google News RSS proxy which is always
//      open from any server IP worldwide.
// ─────────────────────────────────────────────
const MEDIAONE_WORD_LIMIT = 40;

function parseMediaOneXml(data, icon, channel, requireImage = true) {
  const news  = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];

    const title   = stripLive(getXmlTag(itemXml, "title"));
    const link    = getXmlTag(itemXml, "link") || getXmlTag(itemXml, "guid");
    const pubDate = getXmlTag(itemXml, "pubDate");

    const image =
      getXmlAttr(itemXml, "enclosure", "url") ||
      getXmlAttr(itemXml, "media:content", "url") ||
      (() => { const m = itemXml.match(/<img[^>]+src=['"]([^'"]+)['"]/i); return m ? m[1] : ""; })();

    let summary = cleanHtmlText(
      getXmlTag(itemXml, "description") || getXmlTag(itemXml, "content:encoded")
    );
    const words = summary.split(" ").filter(Boolean);
    if (words.length > MEDIAONE_WORD_LIMIT) summary = words.slice(0, MEDIAONE_WORD_LIMIT).join(" ") + "...";

    if (requireImage && !isValidImage(image)) continue;
    if (title && link) news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
  }

  return news;
}

async function scrapeMediaOne() {
  const { directUrl, rssUrl, icon, channel } = SOURCES.mediaone;

  // ── Attempt 1: direct feed with CF-bypass headers ──
  try {
    const data = await fetchRaw(directUrl, CF_BYPASS_HEADERS);
    const isXml =
      typeof data === "string" &&
      (data.trimStart().startsWith("<?xml") ||
        data.includes("<rss") ||
        data.includes("<item>"));

    if (isXml) {
      const items = parseMediaOneXml(data, icon, channel, true);
      if (items.length > 0) {
        console.log(`[MediaOne] Direct feed OK — ${items.length} items`);
        return items;
      }
    }
    console.warn("[MediaOne] Direct feed returned non-XML (Cloudflare challenge). Falling back to Google News proxy.");
  } catch (err) {
    console.warn(`[MediaOne] Direct fetch error: ${err.message}. Falling back to Google News proxy.`);
  }

  // ── Attempt 2: Google News RSS proxy ──
  // Note: Google News RSS links are redirect URLs to original articles.
  // Images are not included; we relax the image requirement here.
  try {
    const data = await fetchRaw(rssUrl, DEFAULT_HEADERS);
    const items = parseMediaOneXml(data, icon, channel, false); // no image requirement
    console.log(`[MediaOne] Google News proxy — ${items.length} items`);
    return items;
  } catch (err) {
    console.error(`[MediaOne] Both sources failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────
// ONEINDIA
// ─────────────────────────────────────────────
async function scrapeOneindia() {
  const { rssUrl, icon, channel } = SOURCES.oneindia;
  const data  = await fetchRaw(rssUrl, DEFAULT_HEADERS);
  const news  = [];
  const items = data.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml = chunk.split("</item>")[0];
    const title   = stripLive(getXmlTag(itemXml, "title"));
    const link    = getXmlTag(itemXml, "link");
    const summary = cleanHtmlText(getXmlTag(itemXml, "description"));
    const pubDate = getXmlTag(itemXml, "pubDate");
    const imgM    = itemXml.match(/url="(https?:\/\/[^"]+)"/);
    const image   = imgM ? imgM[1] : "";

    if (!isValidImage(image)) continue;
    if (title && link) news.push({ title, link, summary, image, readableTime: pubDate, icon, channel });
  }

  return news;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
exports.fetchManoramaLatestNews  = () =>
  scrapeManorama(
    `${SOURCES.manorama.baseUrl}/news/latest-news.html`,
    "#Just_in_Slot > div > ul > li"
  );
exports.fetchAsianetLatestNews   = () => scrapeAsianet(`${SOURCES.asianet.baseUrl}/rss`);
exports.fetchMediaOneLatestNews  = () => scrapeMediaOne();
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
  return results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
};

exports.fetchAllNews = async () => {
  const latest = await exports.fetchAllLatestNews();
  return { latest, sports: [] };
};