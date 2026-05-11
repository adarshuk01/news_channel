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
    icon: "https://upload.wikimedia.org/wikipedia/commons/6/62/Media_One_Logo.png",
    channel: "MediaOne",
  },

  oneindia: {
    rssUrl: "https://malayalam.oneindia.com/rss/feeds/malayalam-news-fb.xml",
    icon: "https://imagesvs.oneindia.com/images/oneindia-lm-logo-1721304500709.svg",
    channel: "Oneindia",
  },

  news18: {
    sitemapUrl:
      "https://malayalam.news18.com/commonfeeds/v1/mal/sitemap/google-news.xml",

    sitemapFallback:
      "https://malayalam.news18.com/sitemap/news-sitemap.xml",

    baseUrl: "https://malayalam.news18.com",

    icon:
      "https://static.news18.com/static/img/logo-news18-favicon-32.png",

    channel: "News18 Malayalam",
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

    return cheerio.load(data, {
      xmlMode: true,
      decodeEntities: true,
    });
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
// FULL HTML CLEANER
// ─────────────────────────────────────────────

function cleanHtmlText(text = "") {
  if (!text) return "";

  // CDATA
  text = stripCdata(text);

  // remove script/style/twitter junk
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/pic\.twitter\.com\/\S+/gi, "")
    .replace(/https?:\/\/t\.co\/\S+/gi, "");

  // HTML → TEXT
  text = cheerio.load(`<div>${text}</div>`).text();

  // decode entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // remove remaining tags
  text = text.replace(/<[^>]*>/g, " ");

  // normalize spaces
  text = text
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();

  return text;
}

// ─────────────────────────────────────────────
// XML HELPERS
// ─────────────────────────────────────────────

function xmlTag(xml, tag) {
  const esc = tag.replace(":", "\\:");

  const re = new RegExp(
    `<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`,
    "i"
  );

  const m = xml.match(re);

  return m ? stripCdata(m[1]).trim() : "";
}

function xmlAttr(xml, tag, attr) {
  const esc = tag.replace(":", "\\:");

  const re = new RegExp(
    `<${esc}[^>]*\\s${attr}="([^"]*)"`,
    "i"
  );

  const m = xml.match(re);

  return m ? m[1].trim() : "";
}

function splitUrlChunks(xml) {
  const chunks = [];

  let pos = 0;

  while (true) {
    const open = xml.indexOf("<url>", pos);

    if (open === -1) break;

    const close = xml.indexOf("</url>", open);

    if (close === -1) break;

    chunks.push(xml.slice(open + 5, close));

    pos = close + 6;
  }

  return chunks;
}

// ─────────────────────────────────────────────
// NEWS18
// ─────────────────────────────────────────────

async function fetchNews18RawXml() {
  const target =
    SOURCES.news18.sitemapUrl;

  const { data } = await axios.get(target, {
    headers: DEFAULT_HEADERS,
    timeout: 15000,
  });

  return data;
}

async function scrapeNews18Malayalam() {
  const { icon, channel } =
    SOURCES.news18;

  const rawXml =
    await fetchNews18RawXml();

  const chunks =
    splitUrlChunks(rawXml);

  const news = [];

  for (const chunk of chunks) {
    const loc = xmlTag(chunk, "loc");

    if (!loc) continue;

    const title = stripLive(
      xmlTag(chunk, "news:title") ||
        xmlTag(chunk, "title")
    );

    const summary = cleanHtmlText(
      xmlTag(chunk, "news:keywords") ||
        xmlTag(chunk, "description") ||
        ""
    );

    const image =
      xmlTag(chunk, "image:loc") ||
      xmlAttr(chunk, "enclosure", "url");

    const pubDate =
      xmlTag(
        chunk,
        "news:publication_date"
      ) || "";

    if (!isValidImage(image)) continue;

    news.push({
      title,
      link: loc,
      summary,
      image,
      readableTime: pubDate,
      icon,
      channel,
    });
  }

  return news;
}

// ─────────────────────────────────────────────
// MANORAMA
// ─────────────────────────────────────────────

async function scrapeManorama(
  url,
  selector
) {
  const {
    baseUrl,
    icon,
    channel,
  } = SOURCES.manorama;

  const $ = await loadPage(url);

  const news = [];

  $(selector).each((_, el) => {
    const anchor = $(el).find(
      "h2 a"
    );

    const title = stripLive(
      anchor.text().trim()
    );

    const link = resolve(
      baseUrl,
      anchor.attr("href")
    );

    const summary = cleanHtmlText(
      $(el)
        .find(".cmp-story-list__dispn")
        .html() || ""
    );

    const imgEl = $(el).find(
      ".cmp-story-list__image-block img"
    );

    const image =
      imgEl.attr("data-src") ||
      imgEl.attr("data-websrc") ||
      "";

    const readableTime = $(el)
      .find(".cmp-story-list__date")
      .text()
      .trim();

    if (title && link) {
      news.push({
        title,
        link,
        summary,
        image,
        readableTime,
        icon,
        channel,
      });
    }
  });

  return news;
}

// ─────────────────────────────────────────────
// ASIANET
// ─────────────────────────────────────────────

async function scrapeAsianet(url) {
  const { icon, channel } =
    SOURCES.asianet;

  const $ = await loadPage(url);

  const news = [];

  $("item").each((_, el) => {
    const raw = $(el).html();

    const getTag = (tag) => {
      const esc = tag.replace(
        ":",
        "\\:"
      );

      const re = new RegExp(
        `<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`,
        "i"
      );

      const m = raw.match(re);

      return m
        ? stripCdata(m[1]).trim()
        : "";
    };

    const getAttr = (tag, attr) => {
      const m = raw.match(
        new RegExp(
          `<${tag}[^>]*${attr}="(.*?)"`,
          "s"
        )
      );

      return m ? m[1] : "";
    };

    const title = stripLive(
      getTag("title")
    );

    const link = getTag("link");

    let summary = cleanHtmlText(
      getTag("content:encoded") ||
        getTag("description")
    );

    const words = summary.split(" ");

    if (words.length > 500) {
      summary =
        words
          .slice(0, 500)
          .join(" ") + "...";
    }

    const pubDate =
      getTag("pubDate");

    const image =
      getAttr(
        "media:content",
        "url"
      ) ||
      getAttr(
        "enclosure",
        "url"
      ) ||
      "";

    if (!isValidImage(image))
      return;

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

  return news;
}

// ─────────────────────────────────────────────
// MEDIAONE
// ─────────────────────────────────────────────

async function scrapeMediaOneSports(
  url
) {
  const {
    baseUrl,
    icon,
    channel,
  } = SOURCES.mediaone;

  const $ = await loadPage(url);

  const articles = [];

  $(".d-flex.flex-wrap").each(
    (_, el) => {
      const title = $(el)
        .find(
          ".list-item-right h3.story-title"
        )
        .text()
        .trim();

      const href =
        $(el)
          .find("a")
          .attr("href") || "";

      const link = resolve(
        baseUrl,
        href
      );

      const summary =
        cleanHtmlText(
          $(el)
            .find(
              ".list-item-right p"
            )
            .html() || ""
        );

      const rawImage =
        $(el)
          .find(".story-img img")
          .attr("data-src") || "";

      const image =
        rawImage.startsWith("https")
          ? rawImage
          : resolve(
              baseUrl,
              rawImage
            );

      const readableTime =
        $(el)
          .find(
            ".time-as-duration"
          )
          .text()
          .trim();

      if (title && link) {
        articles.push({
          title,
          link,
          summary,
          image,
          readableTime,
          icon,
          channel,
        });
      }
    }
  );

  return articles;
}

// ─────────────────────────────────────────────
// ONEINDIA
// ─────────────────────────────────────────────

async function scrapeOneindia() {
  const {
    rssUrl,
    icon,
    channel,
  } = SOURCES.oneindia;

  const { data } = await axios.get(
    rssUrl,
    {
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    }
  );

  const rawXml = data;

  const news = [];

  const items =
    rawXml.split("<item>");

  for (const chunk of items.slice(1)) {
    const itemXml =
      chunk.split("</item>")[0];

    const getTag = (tag) => {
      const m = itemXml.match(
        new RegExp(
          `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
          "i"
        )
      );

      return m
        ? stripCdata(m[1]).trim()
        : "";
    };

    const title = stripLive(
      getTag("title")
    );

    const link = getTag("link");

    const summary = cleanHtmlText(
      getTag("description")
    );

    const pubDate =
      getTag("pubDate");

    const imgM = itemXml.match(
      /url="(https?:\/\/[^"]+)"/
    );

    const image = imgM
      ? imgM[1]
      : "";

    if (!isValidImage(image))
      continue;

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
  }

  return news;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

exports.fetchManoramaLatestNews =
  () =>
    scrapeManorama(
      `${SOURCES.manorama.baseUrl}/news/latest-news.html`,
      "#Just_in_Slot > div > ul > li"
    );

exports.fetchAsianetLatestNews =
  () =>
    scrapeAsianet(
      `${SOURCES.asianet.baseUrl}/rss`
    );

exports.fetchMediaOneSportsNews =
  () =>
    scrapeMediaOneSports(
      `${SOURCES.mediaone.baseUrl}/sports`
    );

exports.fetchOneindiaLatestNews =
  () => scrapeOneindia();

exports.fetchNews18MalayalamLatestNews =
  () => scrapeNews18Malayalam();

// ─────────────────────────────────────────────
// AGGREGATE
// ─────────────────────────────────────────────

exports.fetchAllLatestNews =
  async () => {
    const results =
      await Promise.allSettled([
        exports.fetchManoramaLatestNews(),
        exports.fetchAsianetLatestNews(),
        exports.fetchOneindiaLatestNews(),
        exports.fetchNews18MalayalamLatestNews(),
      ]);

    return results
      .filter(
        (r) => r.status === "fulfilled"
      )
      .flatMap((r) => r.value);
  };

exports.fetchAllNews =
  async () => {
    const [
      latest,
      sports,
    ] = await Promise.allSettled([
      exports.fetchAllLatestNews(),
      exports.fetchMediaOneSportsNews(),
    ]);

    return {
      latest:
        latest.status === "fulfilled"
          ? latest.value
          : [],

      sports:
        sports.status === "fulfilled"
          ? sports.value
          : [],
    };
  };