// ═══════════════════════════════════════════════════════════════
// GEMINI ART DIRECTOR + VIRAL SUB-EDITOR  (geminiDirectorService.js)
//
// Gemini (free-tier text/vision model) does two jobs for each story:
//
//   A. REWRITES the title into a short, viral Malayalam poster text:
//        headLines  the BIG headline, 2-4 short lines, 3-8 words in total
//        subLines   the sub-headline, 0-3 short lines, up to ~14 words
//      The text is VALIDATED against your original story before it is used:
//        - every number must exist in the original (1,000 stays 1,000)
//        - enough words must share a root with your original words
//        - word / line limits, and no line may end on a number's comma
//      If anything fails, the poster falls back to a safe local split of
//      your original title. The AI text is never trusted blindly.
//
//   B. DESIGN decisions: quote (‘ ’), accent colour, photo focus.
//
// getDirection() returns null on ANY problem (no key, rate limit, quota,
// timeout, bad JSON, safety block…). It never throws.
//
// When newsItem.subtitle / subTitleLines is given, or newsItem.aiRewrite is
// false, or GEMINI_DIRECTOR_REWRITE=false, Gemini does NOT write text.
//
// ENV:
//   GEMINI_API_KEY            one key, or several separated by commas
//   GEMINI_DIRECTOR_ENABLED   "false" switches the art director off
//   GEMINI_DIRECTOR_REWRITE   "false" = never let the AI write text
//   GEMINI_DIRECTOR_MODELS    default "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash"
//   GEMINI_DIRECTOR_TIMEOUT_MS  per request, default 15000
//   GEMINI_DIRECTOR_SEND_IMAGE  "false" = text only (no photo focus)
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");
const fs     = require("fs");
try { require("dotenv").config(); } catch { /* dotenv optional here */ }

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const ACCENTS = ["gold", "red", "green"];
const CATEGORIES = [
  "breaking", "crime", "accident", "disaster", "sports",
  "politics", "entertainment", "business", "weather", "other",
];

// Limits for the AI-written text
const HEAD_LIMITS = { minWords: 2, maxWords: 9,  maxLines: 4, maxLineWords: 5, allowEmpty: false };
const SUB_LIMITS  = { minWords: 0, maxWords: 18, maxLines: 3, maxLineWords: 7, allowEmpty: true  };

// ── Config helpers ───────────────────────────────────────────
function getKeys() {
  return (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && !/PASTE_YOUR_KEY/i.test(k));
}

function getModels() {
  const list = (process.env.GEMINI_DIRECTOR_MODELS ||
    "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash")
    .split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : ["gemini-2.5-flash"];
}

function isEnabled() {
  return process.env.GEMINI_DIRECTOR_ENABLED !== "false" && getKeys().length > 0;
}

// ── Cool-downs: stop hammering a key/model that is rate-limited ──
const cooldownUntil = new Map(); // "key|model" -> epoch ms
const deadModels    = new Map(); // model -> epoch ms (404 / unsupported)

function pairAvailable(key, model) {
  const now = Date.now();
  return (cooldownUntil.get(`${key}|${model}`) || 0) <= now &&
         (deadModels.get(model) || 0) <= now;
}

function parseRetryMs(errBody, headers) {
  try {
    for (const d of errBody?.error?.details || []) {
      if (d.retryDelay) {
        const s = parseFloat(String(d.retryDelay).replace("s", ""));
        if (!Number.isNaN(s)) return Math.ceil(s * 1000);
      }
    }
  } catch { /* ignore */ }
  const ra = headers?.get?.("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra) * 1000;
  return null;
}

function isRateLimit(status, body) {
  const msg = String(body?.error?.message || "").toLowerCase();
  const st  = String(body?.error?.status  || "");
  return status === 429 || st === "RESOURCE_EXHAUSTED" ||
         msg.includes("quota") || msg.includes("rate limit");
}

// ── Small result cache (same story + photo = same direction) ──
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(k) { return cache.get(k) || null; }
function cacheSet(k, v) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, v);
}

// ── Input helpers ────────────────────────────────────────────
function getTitleText(newsItem) {
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    return newsItem.titleLines
      .map((l) => (typeof l === "string" ? l : l?.text))
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return String(newsItem.title || "").replace(/\s+/g, " ").trim();
}

// True when the caller supplies the sub-headline themselves
function hasExplicitSub(newsItem) {
  const s = newsItem.subtitle || newsItem.subTitleLines;
  return Array.isArray(s) ? s.some(Boolean) : Boolean(s && String(s).trim());
}

function rewriteAllowed(newsItem) {
  return process.env.GEMINI_DIRECTOR_REWRITE !== "false" &&
         newsItem.aiRewrite !== false &&
         !hasExplicitSub(newsItem);
}

async function loadImageBuffer(image) {
  if (Buffer.isBuffer(image)) return image;
  if (typeof image !== "string") throw new Error("unsupported image input");
  if (image.startsWith("data:")) {
    return Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  }
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching news image`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(image);
}

// Small JPEG for the model (cheap + fast)
async function prepareImage(image) {
  const sharp = require("sharp");
  const raw = await loadImageBuffer(image);
  return sharp(raw)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

// ── Prompt + schema ──────────────────────────────────────────
function buildPrompt({ title, summary, hasImage, photoRatio, rewrite }) {
  const lines = [
    "You are the art director and viral sub-editor of a Malayalam (Kerala) news channel's social-media posters.",
    "Poster layout: a news photo on top, then a BIG white headline, then a smaller sub-headline in coloured strips.",
    "",
    "STORY TITLE:",
    title,
    summary ? `\nSTORY SUMMARY (context only):\n${summary}` : "",
    "",
    "Decide:",
    "1. category: the main kind of story.",
    "2. accent: the colour of the sub-headline strips.",
    '   - "red"   for breaking/urgent news, crime, accidents, deaths, disasters, violence.',
    '   - "green" for sports (cricket, football, athletics, games, tournaments).',
    '   - "gold"  for everything else. When unsure, use "gold".',
  ];

  if (rewrite) {
    lines.push(
      "3. headLines: REARRANGE the story into a VIRAL poster headline in MALAYALAM, 2 to 4 short lines (1-3 words per line, 3-8 words in total).",
      "   How to make it viral:",
      "   - Start with the hook: the most shocking, surprising or emotional fact, or the strongest number. Put the twist or outcome last.",
      "   - Short, punchy, spoken-style Malayalam. Cut filler words, long connectors and formal endings.",
      "   - Contrast works well: small number vs big number, promise vs result, before vs after.",
      "   - One idea per line. Each line must be a natural phrase that reads well on its own.",
      "   - An exclamation mark or a question is allowed at the end of ONE line, never more.",
      "   - For a statement by a person, write it as a short quote.",
      "4. subLines: 1 to 3 short lines in MALAYALAM (3-6 words per line, at most 14 words in total) with the remaining context: who / where / what happened. Do not repeat the headline.",
      "SAME-MEANING RULES (very important):",
      "   - Keep exactly the same meaning and facts as the story. You may reorder, shorten and rephrase. You may NOT add, guess, exaggerate or change anything.",
      "   - Keep every important name, place and number from the story. Write numbers exactly as in the story (1,000 or 75,000). Never split a number across lines. A line must never end with a number's comma.",
      "   - No clickbait that hides the subject, such as \"you won't believe\". The poster must still say what happened.",
      "   - For deaths, accidents, crimes and abuse: stay factual and respectful. No dramatic wording, no jokes, no blame that is not in the story.",
      "   - Style example only (do not copy its content): a story about a tourist cheated abroad → headLines [\"1,000 രൂപയുടെ ഔഷധം!\", \"ഈടാക്കിയത് 75,000\"], subLines [\"തായ്‌ലൻഡിൽ ഇന്ത്യൻ വിനോദസഞ്ചാരിക്ക്\", \"കാർഡിൽ നിന്ന് പണം നഷ്ടമായെന്ന് പരാതി\"]."
    );
  }

  const n = rewrite ? 5 : 3;
  lines.push(
    `${n}. quote: true when the big headline is a quotation or a statement attributed to someone (the kind of line written inside quotation marks on a news poster), otherwise false.`,
    hasImage
      ? `${n + 1}. focusX / focusY: where the main subject of the attached photo is (face, person, vehicle, key object), as fractions of the photo from the top-left corner (0 to 1). The photo fills the top of the poster as a band of about ${photoRatio}:1 (width:height) and its lower part fades out, so pick the point that must stay clearly visible. If the subject is centred, use 0.5 and 0.5. Faces should be kept, so favour the upper part of a person.`
      : `${n + 1}. focusX / focusY: use 0.5 and 0.5 (no photo is attached).`,
    "",
    "Return only the JSON object."
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

function buildSchema(rewrite) {
  const properties = {
    category: { type: "string", enum: CATEGORIES },
    accent:   { type: "string", enum: ACCENTS },
    quote:    { type: "boolean" },
    focusX:   { type: "number" },
    focusY:   { type: "number" },
  };
  const required = ["category", "accent", "quote", "focusX", "focusY"];

  if (rewrite) {
    properties.headLines = { type: "array", items: { type: "string" } };
    properties.subLines  = { type: "array", items: { type: "string" } };
    required.push("headLines", "subLines");
  }
  return { type: "object", properties, required };
}

// ── One request ──────────────────────────────────────────────
async function callGemini(key, model, prompt, imgBuf, schema) {
  const timeoutMs = Number(process.env.GEMINI_DIRECTOR_TIMEOUT_MS) || 15000;

  const parts = [{ text: prompt }];
  if (imgBuf) {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: imgBuf.toString("base64") } });
  }

  const generationConfig = {
    temperature: 0.6,
    maxOutputTokens: 700,
    responseMimeType: "application/json",
    responseSchema: schema,
  };
  // 2.5 models "think" by default; this is a small task, so switch it off
  if (/gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body:    JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal:  AbortSignal.timeout(timeoutMs),
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${json?.error?.message || res.statusText}`);
    err.status      = res.status;
    err.rateLimited = isRateLimit(res.status, json);
    err.retryMs     = parseRetryMs(json, res.headers);
    throw err;
  }

  const text = (json?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || "empty response";
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}

// ═══════════════════════════════════════════════════════════════
// TEXT VALIDATION  (the AI's words are checked against the story)
// ═══════════════════════════════════════════════════════════════

const INVISIBLE   = /[\u200b\u200c\u200d]/g;
const PUNCT       = /[‘’'"“”.,;:!?()\[\]|\-–—]/g;
const normWord    = (w) => String(w).replace(INVISIBLE, "").replace(PUNCT, "").trim();
const rootOf      = (w) => Array.from(normWord(w)).slice(0, 3).join("");
const isNumericW  = (w) => /^\d+$/.test(normWord(w));

// "1,000" -> "1000"; returns every number found in the text
function numbersIn(text) {
  const t = String(text).replace(/(\d),(?=\d)/g, "$1");
  return t.match(/\d+/g) || [];
}

function buildSource(sourceText) {
  const words = String(sourceText).split(/\s+/).map(normWord).filter((w) => w.length >= 2 && !isNumericW(w));
  return {
    numbers: new Set(numbersIn(sourceText)),
    roots:   new Set(words.map(rootOf).filter(Boolean)),
  };
}

// Returns the cleaned lines, or null when they fail any check.
function validateLines(lines, source, limits) {
  if (!Array.isArray(lines)) return null;

  const out = lines
    .map((l) => String(l == null ? "" : l).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!out.length) return limits.allowEmpty ? [] : null;
  if (out.length > limits.maxLines) return null;

  const words = out.join(" ").split(" ").filter(Boolean);
  if (words.length < limits.minWords || words.length > limits.maxWords) return null;
  if (out.some((l) => l.split(" ").filter(Boolean).length > limits.maxLineWords)) return null;

  // A number must never be cut by a line break
  if (out.some((l) => /\d,$/.test(l) || /^,\d/.test(l))) return null;

  // Every number must exist in the original story
  for (const num of numbersIn(out.join(" "))) {
    if (!source.numbers.has(num)) return null;
  }

  // Enough words must come from the original story (blocks invented facts)
  const textWords = words.map(normWord).filter((w) => w.length >= 2 && !isNumericW(w));
  if (textWords.length) {
    const matched = textWords.filter((w) => source.roots.has(rootOf(w))).length;
    if (matched / textWords.length < 0.4) return null;
  }

  return out;
}

// ── Validate the model's answer. Every field is checked on its own,
//    so one bad field never spoils the others. ───────────────────
const clamp01 = (n) => Math.min(1, Math.max(0, n));

function sanitize(raw, sourceText, rewrite) {
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/```json|```/gi, "").trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const out = {};

  if (CATEGORIES.includes(obj.category)) out.category = obj.category;
  if (ACCENTS.includes(obj.accent))      out.accent   = obj.accent;
  if (typeof obj.quote === "boolean")    out.quote    = obj.quote;

  const fx = Number(obj.focusX), fy = Number(obj.focusY);
  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    out.focus = { x: clamp01(fx), y: clamp01(fy) };
  }

  if (rewrite) {
    const source = buildSource(sourceText);
    const head   = validateLines(obj.headLines, source, HEAD_LIMITS);
    const sub    = validateLines(obj.subLines,  source, SUB_LIMITS);
    if (head && sub) {
      out.headLines = head;
      out.subLines  = sub;
    }
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Ask Gemini for the viral text + design direction of one poster.
 *
 * @param {object} newsItem  same object that goes to createNewsPoster
 * @returns {Promise<null | {
 *   accent?: "gold"|"red"|"green",
 *   category?: string,
 *   quote?: boolean,
 *   focus?: {x:number, y:number},
 *   rewritten?: boolean,
 *   headText?: string, subText?: string,
 *   headLines?: string[]|null, subLines?: string[]|null,
 * }>}
 */
async function getDirection(newsItem, { photoRatio = "1.74" } = {}) {
  try {
    if (!isEnabled() || newsItem.aiDirector === false) return null;

    const title = getTitleText(newsItem);
    if (!title) return null;

    const rewrite = rewriteAllowed(newsItem);
    const summary = String(newsItem.summary || "").replace(/\s+/g, " ").trim().slice(0, 400);
    const sourceText = `${title} ${summary}`;

    // Photo (optional, used for the crop focus)
    let imgBuf = null;
    if (process.env.GEMINI_DIRECTOR_SEND_IMAGE !== "false" && newsItem.image) {
      try {
        imgBuf = await prepareImage(newsItem.image);
      } catch (e) {
        console.warn("[Director] Photo not sent (focus stays centred):", e.message);
      }
    }

    // "v2" = viral prompt. Change it to get fresh titles for cached stories.
    const cacheKey = crypto.createHash("sha1")
      .update("v2|").update(title).update("|").update(summary).update("|").update(rewrite ? "rewrite" : "hints")
      .update("|").update(imgBuf ? crypto.createHash("sha1").update(imgBuf).digest("hex") : "no-img")
      .digest("hex");

    let plan = cacheGet(cacheKey);
    if (!plan) {
      const prompt = buildPrompt({ title, summary, hasImage: !!imgBuf, photoRatio, rewrite });
      const schema = buildSchema(rewrite);
      const keys   = getKeys();
      const models = getModels();

      let best = null; // usable design hints, but without valid text

      outer:
      for (const model of models) {
        for (const key of keys) {
          if (!pairAvailable(key, model)) continue;
          try {
            const text = await callGemini(key, model, prompt, imgBuf, schema);
            const p    = sanitize(text, sourceText, rewrite);

            if (p && (!rewrite || p.headLines)) {
              plan = p;
              console.log(`[Director] ✅ ${model}: accent=${p.accent || "-"} category=${p.category || "-"} text=${p.headLines ? "ai" : "original"}`);
              cacheSet(cacheKey, plan);
              break outer;
            }

            if (p && !best) best = p;
            console.warn(`[Director] ${model}: ${p ? "text failed validation" : "unusable answer"} — trying next`);
          } catch (e) {
            if (e.rateLimited) {
              // Short per-minute limit → wait what Google says; otherwise assume daily quota
              const wait = e.retryMs && e.retryMs <= 10 * 60 * 1000 ? e.retryMs + 1000 : 30 * 60 * 1000;
              cooldownUntil.set(`${key}|${model}`, Date.now() + wait);
              console.warn(`[Director] Rate limit on ${model} — paused ${Math.round(wait / 1000)}s`);
            } else if (e.status === 404 || e.status === 400) {
              // Model not available / request shape not supported → skip this model for a while
              deadModels.set(model, Date.now() + 10 * 60 * 1000);
              console.warn(`[Director] ${model} unavailable: ${e.message}`);
              continue outer;
            } else {
              // timeout / network / server error: go straight to the default design
              console.warn(`[Director] ${model} failed: ${e.message}`);
              break outer;
            }
          }
        }
      }

      if (!plan && best) plan = best; // design hints only; the poster splits the original title itself
    }

    if (!plan) {
      console.warn("[Director] No direction available — using the default design");
      return null;
    }

    const result = {};
    if (plan.accent)   result.accent   = plan.accent;
    if (plan.category) result.category = plan.category;
    if (plan.focus)    result.focus    = plan.focus;
    if (typeof plan.quote === "boolean") result.quote = plan.quote;

    if (plan.headLines) {
      result.rewritten = true;
      result.headLines = plan.headLines;
      result.headText  = plan.headLines.join(" ");
      result.subLines  = plan.subLines && plan.subLines.length ? plan.subLines : null;
      result.subText   = (plan.subLines || []).join(" ");
    }

    return Object.keys(result).length ? result : null;
  } catch (e) {
    console.warn("[Director] Crashed, using the default design:", e.message);
    return null;
  }
}

module.exports = {
  getDirection,
  isEnabled,
  // exported for tests
  _internal: { sanitize, validateLines, buildSource, numbersIn },
};
