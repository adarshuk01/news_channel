// ═══════════════════════════════════════════════════════════════
// GEMINI TYPESETTER  (geminiArtDirector.js)
//
// The TITLE IS NEVER REWRITTEN. Every word, spelling, number and
// punctuation mark stays exactly as you wrote it.
//
// Gemini can decide three things (each one is optional):
//
//   1. LAYOUT     UPPER part (big YELLOW) / LOWER part (big WHITE) and where
//                 each part breaks into lines.
//   2. HIGHLIGHT  which consecutive words are the IMPORTANT part of the title
//                 (the poster paints them on a yellow marker bar).
//   3. FOCUS      the point of the photo that must stay visible when cropped.
//
// SAFETY: Gemini answers with NUMBERS ONLY (word counts / word positions).
// The text is always rebuilt from your own title words, so nothing Gemini
// types can ever reach the poster. If the numbers are invalid (or Gemini is
// unavailable) the poster uses its own safe local logic.
//
// getDirection() returns null on ANY problem. It never throws.
//
// ENV:
//   GEMINI_API_KEY            one key, or several separated by commas
//   GEMINI_DIRECTOR_ENABLED   "false" switches Gemini off completely
//   GEMINI_DIRECTOR_LAYOUT    "false" = Gemini may not choose the split
//   GEMINI_DIRECTOR_MODELS    default "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.8-flash"
//   GEMINI_DIRECTOR_TIMEOUT_MS  per request, default 30000
//   GEMINI_DIRECTOR_TOTAL_MS    all models together, default 75000
//   GEMINI_DIRECTOR_SEND_IMAGE  "false" = text only (no photo focus)
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");
const fs     = require("fs");
try { require("dotenv").config(); } catch { /* dotenv optional here */ }

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Layout limits (they only shape line breaks; the words never change).
const HEAD_MAX_LINES = 5;   // upper yellow part
const SUB_MAX_LINES  = 3;   // lower white part
const LINE_MAX_WORDS = 4;
const LINE_MAX_CHARS = 34;  // a multi-word line longer than this is rejected
const TOTAL_BUDGET_MS = Number(process.env.GEMINI_DIRECTOR_TOTAL_MS) || 75000;

// Highlight limits
const HL_MIN_WORDS = 2;
const HL_MAX_WORDS = 8;

// ── Config helpers ───────────────────────────────────────────
function getKeys() {
  return (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && !/PASTE_YOUR_KEY/i.test(k));
}

function getModels() {
  const list = (process.env.GEMINI_DIRECTOR_MODELS ||
    "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.8-flash")
    .split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : ["gemini-3.5-flash-lite"];
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

// ── Small result cache (same title + photo + mode = same direction) ──
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

// True when the caller supplies the lower (white) text themselves
function hasExplicitSub(newsItem) {
  const s = newsItem.subtitle || newsItem.subTitleLines;
  return Array.isArray(s) ? s.some(Boolean) : Boolean(s && String(s).trim());
}

// May Gemini choose the sentence split + line breaks?
function layoutAllowed(newsItem) {
  return process.env.GEMINI_DIRECTOR_LAYOUT !== "false" &&
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
// modes = { layout:boolean, highlight:boolean, focus:boolean }
function buildPrompt({ title, titleTokens, photoRatio, modes }) {
  const numbered = titleTokens.map((w, i) => `${i + 1}. ${w}`).join("\n");
  const total = titleTokens.length;

  const lines = [
    "You are the TYPESETTER of a Malayalam (Kerala) news channel's social-media posters.",
    "You do NOT write or edit news and you never output any title words. You only answer with NUMBERS that say how the given words are split, broken into lines or emphasised.",
  ];

  if (modes.layout) {
    lines.push(
      "Poster layout: a dark top half with a BIG YELLOW upper text, and under it a BIG WHITE lower text. The news photo fills the bottom half of the poster.",
      "IMPORTANT: every line is stretched to fill the FULL width of the poster. A line with one short word becomes gigantic and wastes the space, so the text must be set in FEW, LONG lines (2 to 3 words each) that look like a block of equal-width lines."
    );
  } else if (modes.highlight) {
    lines.push(
      "Poster layout: the headline is set in white capital letters at the bottom of a news photo. The MOST IMPORTANT part of the headline is painted on a yellow marker bar (like a highlighter pen) so that a viewer who only glances at the poster still gets the key point."
    );
  }

  lines.push(
    "",
    "STORY TITLE:",
    title,
    "",
    `THE TITLE AS ${total} NUMBERED WORDS (in order):`,
    numbered,
    "",
    "Do:"
  );

  let n = 1;

  if (modes.layout) {
    lines.push(
      `${n++}. SPLIT THE TITLE BY MEANING into two consecutive parts. The two parts are painted in DIFFERENT COLOURS, so the colour change must mark where one complete thought ends and the next begins:`,
      "   - UPPER part (YELLOW) = the first complete sentence / main statement (who did what). It uses the FIRST words of the list.",
      "   - LOWER part (WHITE) = the second complete sentence / clause: the follow-up, the reason, the question, the result or the reaction. It uses ALL the remaining words.",
      "   - Read the whole title first and find the point where the first thought is FINISHED and a new thought STARTS. Typical boundaries: a ; or : or . or ? or !, a comma that closes a full clause, the end of a quotation, or a finished verb followed by a new subject.",
      "   - Decide by MEANING only. Do NOT cut by length and do NOT aim for a fixed percentage. The upper part may be longer or shorter than the lower part.",
      "   - BOTH parts must make complete sense when read alone (no dangling fragment).",
      "   - Never cut inside a name, a number, a quotation, or between a noun and the word that describes it.",
      "   - Only if the whole title is truly ONE single thought with no second clause, put ALL words in the UPPER part and leave the LOWER part empty.",
      `${n++}. BREAK each part into LINES:`,
      "   - UPPER part: exactly 3 or 4 lines (2 only if the title is very short). LOWER part: 1 or 2 lines (never more than 2 unless the title is very long). The WHOLE poster must have 6 lines or fewer.",
      `   - 2 to 3 words per line (at most ${LINE_MAX_WORDS}). NEVER put just one short word on a line when a neighbouring word could join it.`,
      "   - Aim for lines of 16 to 26 characters, and make all lines of a part about EQUAL in length.",
      "   - Break at natural phrase boundaries, but equal line length matters more than perfect phrasing. Never end a line on a lone connector word. Keep a number with the word it counts (for example \"1000 പോയിന്റ്\" stays together).",
      "HOW TO ANSWER the layout (NUMBERS ONLY, never words):",
      "   - headLineWordCounts = for each yellow line from top to bottom, how many words it contains.",
      "   - subLineWordCounts  = for each white line from top to bottom, how many words it contains (empty list if no lower part).",
      `   - ALL numbers together must add up to exactly ${total}, because every word is used once, in order: the yellow lines take words 1, 2, 3 ... and the white lines take the words after them.`,
      `   - Example for a 10-word title: headLineWordCounts [2,3,2], subLineWordCounts [3]  (2+3+2+3 = 10).`
    );
  }

  if (modes.highlight) {
    lines.push(
      `${n++}. HIGHLIGHT: choose the IMPORTANT part of the title, one run of CONSECUTIVE words that will be painted on the yellow bar.`,
      "   - It must be the single most newsworthy phrase: the key claim, the shocking fact, the decision, the number or amount, the main accusation or the main result. Ask yourself: if the viewer reads ONLY these words, which ones tell the story?",
      `   - Length: ${HL_MIN_WORDS} to ${HL_MAX_WORDS} words, and never more than about half of the title. Never the whole title.`,
      "   - It must be a complete, meaningful phrase that reads naturally on its own (for example a full verb phrase, or a name together with what he/she did). Do not start or end it on a lone connector, postposition or filler word.",
      "   - Never cut inside a name, a number with its unit, or a quotation. Keep a number with the word it counts.",
      "   - If the title is a quotation followed by the speaker's name, pick the important part INSIDE the quoted statement, not the speaker's name.",
      "   - Do NOT pick the opening words just because they come first. Pick by importance.",
      "HOW TO ANSWER the highlight (NUMBERS ONLY, never words):",
      `   - highlightStart = the number of the FIRST highlighted word (1 to ${total}).`,
      `   - highlightEnd   = the number of the LAST highlighted word (highlightStart to ${total}). Both are positions from the numbered list above.`
    );
  }

  if (modes.focus) {
    lines.push(
      `${n++}. focusX / focusY: where the main subject of the attached photo is (face, person, vehicle, key object), as fractions of the photo from the top-left corner (0 to 1). The photo fills the BOTTOM of the poster as a band of about ${photoRatio}:1 (width:height) and is cropped to that shape. Pick the point that must stay clearly visible; faces should be kept. If the subject is centred, use 0.5 and 0.5.`
    );
  }

  lines.push("", "Return only the JSON object.");
  return lines.join("\n");
}

function buildSchema(modes) {
  const properties = {};
  const required = [];

  if (modes.focus) {
    properties.focusX = { type: "number" };
    properties.focusY = { type: "number" };
    required.push("focusX", "focusY");
  }
  if (modes.layout) {
    properties.headLineWordCounts = { type: "array", items: { type: "integer" } };
    properties.subLineWordCounts  = { type: "array", items: { type: "integer" } };
    required.push("headLineWordCounts", "subLineWordCounts");
  }
  if (modes.highlight) {
    properties.highlightStart = { type: "integer" };
    properties.highlightEnd   = { type: "integer" };
    required.push("highlightStart", "highlightEnd");
  }
  return { type: "object", properties, required };
}

// ── One request ──────────────────────────────────────────────
async function callGemini(key, model, prompt, imgBuf, schema, timeoutOverride) {
  const timeoutMs = timeoutOverride || Number(process.env.GEMINI_DIRECTOR_TIMEOUT_MS) || 30000;

  const parts = [{ text: prompt }];
  if (imgBuf) {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: imgBuf.toString("base64") } });
  }

  const generationConfig = {
    temperature: 0.2, // typesetting needs accuracy, not creativity
    // Gemini 3.x models always think and thinking counts as output, so give them room
    maxOutputTokens: /gemini-2\.5/.test(model) ? 2000 : 4000,
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
// VALIDATION  (the title must come back word for word)
// ═══════════════════════════════════════════════════════════════

const INVISIBLE = /[\u200b\u200c\u200d]/g;
const normTok   = (w) => String(w).replace(INVISIBLE, "").trim();
const clamp01   = (n) => Math.min(1, Math.max(0, n));

const tokensOf = (text) => String(text).split(/\s+/).filter(Boolean);

// A number must never be cut by a line break
const badNumberCut = (line) => /\d,$/.test(line) || /^,\d/.test(line);

// The model answers with word COUNTS per line. The lines are cut from the
// ORIGINAL title words, so no word can ever change. Returns
// {headLines, subLines} or null.
function rebuildFromCounts(headC, subC, titleTokens) {
  if (!Array.isArray(headC) || !Array.isArray(subC)) return null;
  const toInts = (arr) => arr.map((n) => Math.round(Number(n)));
  const head = toInts(headC);
  const sub  = toInts(subC);
  if (!head.length) return null;
  if (head.length > HEAD_MAX_LINES || sub.length > SUB_MAX_LINES) return null;

  const all = [...head, ...sub];
  if (all.some((c) => !Number.isFinite(c) || c < 1 || c > LINE_MAX_WORDS)) return null;
  if (all.reduce((a, b) => a + b, 0) !== titleTokens.length) return null;

  let pos = 0;
  const rebuilt = all.map((c) => {
    const line = titleTokens.slice(pos, pos + c).join(" ");
    pos += c;
    return line;
  });

  if (rebuilt.some(badNumberCut)) return null;
  if (rebuilt.some((l) => tokensOf(l).length > 1 && Array.from(l).length > LINE_MAX_CHARS)) return null;

  const headLines = rebuilt.slice(0, head.length);
  const subLines  = rebuilt.slice(head.length);

  if (subLines.length) {
    const headWords = headLines.join(" ").split(" ").length;
    const subWords  = subLines.join(" ").split(" ").length;
    if (headWords < 3 || subWords < 2) return null;
  }
  return { headLines, subLines };
}

// The model answers with the 1-based position of the first and last
// highlighted word. The text is cut from the ORIGINAL title words.
// Returns { start, end, total, text } (start/end are 0-based, inclusive) or null.
function rebuildHighlight(startRaw, endRaw, titleTokens) {
  const total = titleTokens.length;
  if (total < 3) return null;                       // too short to highlight a part

  const s = Math.round(Number(startRaw));
  const e = Math.round(Number(endRaw));
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (s < 1 || e < s || e > total) return null;

  const len    = e - s + 1;
  const maxLen = Math.min(HL_MAX_WORDS, Math.max(HL_MIN_WORDS, Math.ceil(total * 0.6)));
  if (len < HL_MIN_WORDS || len > maxLen || len >= total) return null;

  const picked = titleTokens.slice(s - 1, e);
  if (badNumberCut(picked.join(" "))) return null;  // would cut a number like "1,000"

  // do not split a number across the edge of the highlight
  const before = titleTokens[s - 2];
  const after  = titleTokens[e];
  if (before && /\d,$/.test(before)) return null;
  if (after  && /^,\d/.test(after))  return null;

  return { start: s - 1, end: e - 1, total, text: picked.join(" ") };
}

function sanitize(raw, titleTokens, modes) {
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/```json|```/gi, "").trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const out = {};

  if (modes.focus) {
    const fx = Number(obj.focusX), fy = Number(obj.focusY);
    if (Number.isFinite(fx) && Number.isFinite(fy)) {
      out.focus = { x: clamp01(fx), y: clamp01(fy) };
    }
  }

  if (modes.layout) {
    const r = rebuildFromCounts(obj.headLineWordCounts, obj.subLineWordCounts, titleTokens);
    if (r) {
      out.headLines = r.headLines;
      out.subLines  = r.subLines;
    }
  }

  if (modes.highlight) {
    const h = rebuildHighlight(obj.highlightStart, obj.highlightEnd, titleTokens);
    if (h) out.highlight = h;
  }

  return Object.keys(out).length ? out : null;
}

// Does this plan contain everything that was asked for?
function isComplete(p, modes) {
  if (!p) return false;
  if (modes.layout && !p.headLines) return false;
  if (modes.highlight && !p.highlight) return false;
  return true;
}

/**
 * Ask Gemini how to typeset the title (highlight, line split, photo focus).
 * The title words are never changed.
 *
 * @param {object} newsItem  same object that goes to createNewsPoster
 * @param {object} [opts]
 * @param {string}  [opts.photoRatio="1.38"]
 * @param {boolean} [opts.layout]     false = do not ask for the yellow/white split
 *                                    (default: allowed unless the item/env forbids it)
 * @param {boolean} [opts.highlight=false]  true = also pick the important words
 * @param {boolean} [opts.focus=true]       false = do not ask for the photo focus
 * @param {boolean} [opts.sendImage=true]   false = never send the photo
 * @param {number}  [opts.totalMs]    time budget for all models together
 * @param {number}  [opts.timeoutMs]  time limit for one request
 * @returns {Promise<null | {
 *   focus?: {x:number, y:number},
 *   highlight?: {start:number, end:number, total:number, text:string},  // 0-based, inclusive
 *   rewritten?: boolean,
 *   headText?: string, subText?: string,
 *   headLines?: string[]|null, subLines?: string[]|null,
 * }>}
 */
async function getDirection(newsItem, opts = {}) {
  try {
    if (!isEnabled() || newsItem.aiDirector === false) return null;

    const photoRatio = opts.photoRatio || "1.38";
    const title = getTitleText(newsItem);
    if (!title) return null;

    const titleTokens = tokensOf(title);

    const wantLayout    = opts.layout === false ? false : layoutAllowed(newsItem);
    const wantHighlight = opts.highlight === true && titleTokens.length >= 3;
    const wantFocus     = opts.focus !== false;

    // Photo (optional, used for the crop focus)
    let imgBuf = null;
    if (wantFocus && opts.sendImage !== false &&
        process.env.GEMINI_DIRECTOR_SEND_IMAGE !== "false" && newsItem.image) {
      try {
        imgBuf = await prepareImage(newsItem.image);
      } catch (e) {
        console.warn("[Director] Photo not sent (focus stays centred):", e.message);
      }
    }

    const modes = { layout: wantLayout, highlight: wantHighlight, focus: !!imgBuf };

    // Nothing to ask for
    if (!modes.layout && !modes.highlight && !modes.focus) return null;

    const totalBudget = Number(opts.totalMs) || TOTAL_BUDGET_MS;

    // "v11-highlight" = prompt version. Change it to redo cached titles.
    const modeKey  = `${modes.layout ? "L" : "-"}${modes.highlight ? "H" : "-"}${modes.focus ? "F" : "-"}`;
    const cacheKey = crypto.createHash("sha1")
      .update("v11-highlight|").update(title).update("|").update(modeKey)
      .update("|").update(imgBuf ? crypto.createHash("sha1").update(imgBuf).digest("hex") : "no-img")
      .digest("hex");

    let plan = cacheGet(cacheKey);
    if (!plan) {
      const prompt = buildPrompt({ title, titleTokens, photoRatio, modes });
      const schema = buildSchema(modes);
      const keys   = getKeys();
      const models = getModels();

      let best = null; // usable partial answer (e.g. photo focus only)
      const startedAt = Date.now();

      outer:
      for (const model of models) {
        for (const key of keys) {
          if (!pairAvailable(key, model)) continue;
          if (Date.now() - startedAt > totalBudget) break outer;
          try {
            // up to 2 tries per model: the 2nd try tells the model what went wrong
            let p = null;
            for (let attempt = 0; attempt < 2 && !isComplete(p, modes); attempt++) {
              if (attempt > 0 && Date.now() - startedAt > totalBudget) break;
              const pr = attempt === 0 ? prompt
                : prompt + `\n\nYour previous answer was rejected. Check: all numbers must be whole numbers from the numbered list (1 to ${titleTokens.length}); line word counts must add up to exactly ${titleTokens.length}; highlightEnd must be greater than highlightStart and the highlight must be shorter than the whole title.`;
              const text = await callGemini(key, model, pr, imgBuf, schema, opts.timeoutMs);
              p = sanitize(text, titleTokens, modes);
            }

            if (isComplete(p, modes)) {
              plan = p;
              console.log(`[Director] ✅ ${model}: split=${p.headLines ? "ai" : "local"} highlight=${p.highlight ? "ai" : "local"}`);
              cacheSet(cacheKey, plan);
              break outer;
            }

            if (p && !best) best = p;
            console.warn(`[Director] ${model}: ${p ? "answer failed the word-for-word check" : "unusable answer"} — trying next`);
          } catch (e) {
            if (e.rateLimited) {
              // Short per-minute limit → wait what Google says; otherwise assume daily quota
              const wait = e.retryMs && e.retryMs <= 10 * 60 * 1000 ? e.retryMs + 1000 : 30 * 60 * 1000;
              cooldownUntil.set(`${key}|${model}`, Date.now() + wait);
              console.warn(`[Director] Rate limit on ${model} — paused ${Math.round(wait / 1000)}s`);
            } else if (e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504) {
              // Google is overloaded (not a key problem): pause this model briefly, try the next
              cooldownUntil.set(`${key}|${model}`, Date.now() + 20 * 1000);
              console.warn(`[Director] ${model} overloaded (${e.status}) — trying next model`);
              continue outer;
            } else if (e.status === 404 || e.status === 400) {
              // Model not available / request shape not supported → skip this model for a while
              deadModels.set(model, Date.now() + 10 * 60 * 1000);
              console.warn(`[Director] ${model} unavailable: ${e.message}`);
              continue outer;
            } else {
              // timeout / network / server error: try the NEXT model (not the local logic yet)
              console.warn(`[Director] ${model} failed: ${e.message} — trying next model`);
              continue outer;
            }
          }
        }
      }

      if (!plan && best) plan = best; // partial; the poster fills the rest itself
    }

    if (!plan) {
      console.warn("[Director] No direction available — using the local logic");
      return null;
    }

    const result = {};
    if (plan.focus)     result.focus = plan.focus;
    if (plan.highlight) result.highlight = plan.highlight;

    if (plan.headLines) {
      result.rewritten = true;
      result.headLines = plan.headLines;
      result.headText  = plan.headLines.join(" ");
      result.subLines  = plan.subLines && plan.subLines.length ? plan.subLines : null;
      result.subText   = (plan.subLines || []).join(" ");
    }

    return Object.keys(result).length ? result : null;
  } catch (e) {
    console.warn("[Director] Crashed, using the local logic:", e.message);
    return null;
  }
}

module.exports = {
  getDirection,
  isEnabled,
  // exported for tests
  _internal: { sanitize, rebuildFromCounts, rebuildHighlight, tokensOf },
};
