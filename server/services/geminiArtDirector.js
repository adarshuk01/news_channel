// ═══════════════════════════════════════════════════════════════
// GEMINI TYPESETTER  (geminiArtDirector.js)
//
// The TITLE IS NEVER REWRITTEN. Every word, spelling, number and
// punctuation mark stays exactly as you wrote it.
//
// Gemini only decides HOW the title is set on the poster:
//
//   UPPER part  (big YELLOW)  = a complete sentence / clause
//   LOWER part  (big WHITE)   = the rest, also a complete sentence / clause
//
// and where each part breaks into lines. Every line is later stretched to the
// full poster width, so the lines must be FEW and LONG (2-3 words each),
// never one word per line. It also gives the photo crop focus.
//
// SAFETY: the answer is accepted only when the words are IDENTICAL to your
// title (same words, same order). The output text is then rebuilt from your
// own title, so nothing Gemini types can ever reach the poster. If the check
// fails (or Gemini is unavailable) the poster uses its own safe local split
// of the original title.
//
// getDirection() returns null on ANY problem. It never throws.
//
// When newsItem.subtitle / subTitleLines is given, or newsItem.aiRewrite is
// false, or GEMINI_DIRECTOR_LAYOUT=false, Gemini only gives the photo focus.
//
// ENV:
//   GEMINI_API_KEY            one key, or several separated by commas
//   GEMINI_DIRECTOR_ENABLED   "false" switches Gemini off completely
//   GEMINI_DIRECTOR_LAYOUT    "false" = Gemini may not choose the split (focus only)
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
// The poster can merge lines on its own, so these are the outer limits that
// we still ACCEPT; the prompt asks for fewer (3-4 yellow, 2 white).
const HEAD_MAX_LINES = 5;   // upper yellow part
const SUB_MAX_LINES  = 3;   // lower white part
const LINE_MAX_WORDS = 4;
const LINE_MAX_CHARS = 34;  // a multi-word line longer than this is rejected
const TOTAL_BUDGET_MS = Number(process.env.GEMINI_DIRECTOR_TOTAL_MS) || 75000; // all models together

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

// ── Small result cache (same title + photo = same direction) ──
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
function buildPrompt({ title, hasImage, photoRatio, layout }) {
  const lines = [
    "You are the TYPESETTER of a Malayalam (Kerala) news channel's social-media posters.",
    "You do NOT write or edit news. You only decide how the given title is split and broken into lines.",
    "Poster layout: a dark top half with a BIG YELLOW upper text, and under it a BIG WHITE lower text. The news photo fills the bottom half of the poster.",
    "IMPORTANT: every line is stretched to fill the FULL width of the poster. A line with one short word becomes gigantic and wastes the space, so the text must be set in FEW, LONG lines (2 to 3 words each) that look like a block of equal-width lines.",
    "",
    "STORY TITLE:",
    title,
    "",
    "Do:",
  ];

  if (layout) {
    lines.push(
      "1. SPLIT THE TITLE BY MEANING into two consecutive parts. The two parts are painted in DIFFERENT COLOURS, so the colour change must mark where one complete thought ends and the next begins:",
      "   - UPPER part (YELLOW) = the first complete sentence / main statement (who did what).",
      "   - LOWER part (WHITE) = the second complete sentence / clause: the follow-up, the reason, the question, the result or the reaction.",
      "   - Read the whole title first and find the point where the first thought is FINISHED and a new thought STARTS. Typical boundaries: a ; or : or . or ? or !, a comma that closes a full clause, the end of a quotation, or a finished verb followed by a new subject.",
      "   - Decide by MEANING only. Do NOT cut by length, do NOT count words, do NOT aim for a fixed percentage. The upper part may be longer or shorter than the lower part.",
      "   - BOTH parts must make complete sense when read alone (no dangling fragment, no part that starts in the middle of a thought).",
      "   - Never cut inside a name, a number, a quotation, or between a noun and the word that describes it.",
      "   - Only if the whole title is truly ONE single thought with no second clause, put ALL words in the UPPER part and leave the LOWER part empty.",
      "2. BREAK each part into LINES (the most important layout rule):",
      "   - UPPER part: exactly 3 or 4 lines (2 only if the title is very short). LOWER part: 1 or 2 lines (never more than 2 unless the title is very long). The WHOLE poster must have 6 lines or fewer.",
      `   - 2 to 3 words per line (at most ${LINE_MAX_WORDS}). NEVER put just one short word on a line when a neighbouring word could join it. Single-word lines are allowed only for one very long word.`,
      "   - Aim for lines of 16 to 26 characters, and make all lines of a part about EQUAL in length (the last line must not be much shorter than the others).",
      "   - Break at natural phrase boundaries, but equal line length is more important than perfect phrasing. Never end a line on a lone connector word. Never split a number across lines. A line must never end with a number's comma. Keep a number with the word it counts (for example \"1000 പോയിന്റ്\" stays together).",
      "   - Example of a GOOD result: 4 yellow lines of 2 words each + 2 white lines of 2-3 words each. Example of a BAD result: 5 yellow lines with one word each.",
      "THE WORDS MUST NOT CHANGE (the most important rule):",
      "   - Copy the title EXACTLY: the same words, the same spelling, the same order, the same numbers, the same punctuation.",
      "   - Do NOT add, remove, replace, reorder, translate, shorten, correct or merge any word. If you put the upper lines and the lower lines together, you must get the original title back, word for word.",
      "   - Do not add quotation marks or any new punctuation."
    );
  }

  const n = layout ? 3 : 1;
  lines.push(
    hasImage
      ? `${n}. focusX / focusY: where the main subject of the attached photo is (face, person, vehicle, key object), as fractions of the photo from the top-left corner (0 to 1). The photo fills the BOTTOM of the poster as a band of about ${photoRatio}:1 (width:height) and is cropped to that shape. Pick the point that must stay clearly visible; faces should be kept. If the subject is centred, use 0.5 and 0.5.`
      : `${n}. focusX / focusY: use 0.5 and 0.5 (no photo is attached).`,
    "",
    "Return only the JSON object."
  );
  return lines.join("\n");
}

function buildSchema(layout) {
  const properties = {
    focusX: { type: "number" },
    focusY: { type: "number" },
  };
  const required = ["focusX", "focusY"];

  if (layout) {
    properties.headLines = { type: "array", items: { type: "string" } };
    properties.subLines  = { type: "array", items: { type: "string" } };
    required.push("headLines", "subLines");
  }
  return { type: "object", properties, required };
}

// ── One request ──────────────────────────────────────────────
async function callGemini(key, model, prompt, imgBuf, schema) {
  const timeoutMs = Number(process.env.GEMINI_DIRECTOR_TIMEOUT_MS) || 30000;

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

// Takes the model's lines, checks them against the ORIGINAL title tokens and
// rebuilds both parts from the original words. Returns {headLines, subLines}
// or null.
function rebuildFromTitle(headRaw, subRaw, titleTokens) {
  if (!Array.isArray(headRaw) || !Array.isArray(subRaw)) return null;

  const clean = (arr) => arr
    .map((l) => String(l == null ? "" : l).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const headL = clean(headRaw);
  const subL  = clean(subRaw);
  if (!headL.length) return null;
  if (headL.length > HEAD_MAX_LINES || subL.length > SUB_MAX_LINES) return null;

  const all = [...headL, ...subL];
  const counts = all.map((l) => tokensOf(l).length);
  if (counts.some((c) => c < 1 || c > LINE_MAX_WORDS)) return null;
  if (all.some(badNumberCut)) return null;
  // one line must stay short enough to be set big (a single long word is fine)
  if (all.some((l) => tokensOf(l).length > 1 && Array.from(l).length > LINE_MAX_CHARS)) return null;

  // The words must be IDENTICAL to the title (same words, same order)
  const got = all.flatMap(tokensOf).map(normTok);
  const exp = titleTokens.map(normTok);
  if (got.length !== exp.length || got.some((t, i) => t !== exp[i])) return null;

  // Rebuild the lines from the ORIGINAL words, using the model's line breaks
  let pos = 0;
  const rebuilt = counts.map((c) => {
    const line = titleTokens.slice(pos, pos + c).join(" ");
    pos += c;
    return line;
  });

  const headCount = headL.length;
  const headLines = rebuilt.slice(0, headCount);
  const subLines  = rebuilt.slice(headCount);

  // When there is a lower part, both parts need enough words to be a sentence
  if (subLines.length) {
    const headWords = headLines.join(" ").split(" ").length;
    const subWords  = subLines.join(" ").split(" ").length;
    if (headWords < 3 || subWords < 2) return null;
  }

  return { headLines, subLines };
}

function sanitize(raw, titleTokens, layout) {
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/```json|```/gi, "").trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const out = {};

  const fx = Number(obj.focusX), fy = Number(obj.focusY);
  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    out.focus = { x: clamp01(fx), y: clamp01(fy) };
  }

  if (layout) {
    const r = rebuildFromTitle(obj.headLines, obj.subLines, titleTokens);
    if (r) {
      out.headLines = r.headLines;
      out.subLines  = r.subLines;
    }
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Ask Gemini how to typeset the title (and where to crop the photo).
 * The title words are never changed.
 *
 * @param {object} newsItem  same object that goes to createNewsPoster
 * @returns {Promise<null | {
 *   focus?: {x:number, y:number},
 *   rewritten?: boolean,      // true = Gemini chose the split / line breaks
 *   headText?: string, subText?: string,
 *   headLines?: string[]|null, subLines?: string[]|null,
 * }>}
 */
async function getDirection(newsItem, { photoRatio = "1.38" } = {}) {
  try {
    if (!isEnabled() || newsItem.aiDirector === false) return null;

    const title = getTitleText(newsItem);
    if (!title) return null;

    const layout      = layoutAllowed(newsItem);
    const titleTokens = tokensOf(title);

    // Photo (optional, used for the crop focus)
    let imgBuf = null;
    if (process.env.GEMINI_DIRECTOR_SEND_IMAGE !== "false" && newsItem.image) {
      try {
        imgBuf = await prepareImage(newsItem.image);
      } catch (e) {
        console.warn("[Director] Photo not sent (focus stays centred):", e.message);
      }
    }

    // "v9-meaning" = few-long-lines prompt. Change it to redo cached titles.
    const cacheKey = crypto.createHash("sha1")
      .update("v9-meaning|").update(title).update("|").update(layout ? "layout" : "focus")
      .update("|").update(imgBuf ? crypto.createHash("sha1").update(imgBuf).digest("hex") : "no-img")
      .digest("hex");

    let plan = cacheGet(cacheKey);
    if (!plan) {
      const prompt = buildPrompt({ title, hasImage: !!imgBuf, photoRatio, layout });
      const schema = buildSchema(layout);
      const keys   = getKeys();
      const models = getModels();

      let best = null; // usable photo focus, but without a valid split
      const startedAt = Date.now();

      outer:
      for (const model of models) {
        for (const key of keys) {
          if (!pairAvailable(key, model)) continue;
          if (Date.now() - startedAt > TOTAL_BUDGET_MS) break outer;
          try {
            // up to 2 tries per model: the 2nd try tells the model what went wrong
            let p = null;
            for (let attempt = 0; attempt < 2 && !(p && (!layout || p.headLines)); attempt++) {
              const pr = attempt === 0 ? prompt
                : prompt + "\n\nYour previous answer was rejected: the words did not match the title exactly, or a line had too many words. Copy EVERY word of the title exactly once, in the same order, split by meaning into the upper (yellow) and lower (white) sentence, then break into lines.";
              const text = await callGemini(key, model, pr, imgBuf, schema);
              p = sanitize(text, titleTokens, layout);
            }

            if (p && (!layout || p.headLines)) {
              plan = p;
              console.log(`[Director] ✅ ${model}: split=${p.headLines ? "ai" : "local"}`);
              cacheSet(cacheKey, plan);
              break outer;
            }

            if (p && !best) best = p;
            console.warn(`[Director] ${model}: ${p ? "split failed the word-for-word check" : "unusable answer"} — trying next`);
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
              // timeout / network / server error: try the NEXT model (not the local split yet)
              console.warn(`[Director] ${model} failed: ${e.message} — trying next model`);
              continue outer;
            }
          }
        }
      }

      if (!plan && best) plan = best; // focus only; the poster splits the title itself
    }

    if (!plan) {
      console.warn("[Director] No direction available — using the local split");
      return null;
    }

    const result = {};
    if (plan.focus) result.focus = plan.focus;

    if (plan.headLines) {
      result.rewritten = true;
      result.headLines = plan.headLines;
      result.headText  = plan.headLines.join(" ");
      result.subLines  = plan.subLines && plan.subLines.length ? plan.subLines : null;
      result.subText   = (plan.subLines || []).join(" ");
    }

    return Object.keys(result).length ? result : null;
  } catch (e) {
    console.warn("[Director] Crashed, using the local split:", e.message);
    return null;
  }
}

module.exports = {
  getDirection,
  isEnabled,
  // exported for tests
  _internal: { sanitize, rebuildFromTitle, tokensOf },
};
