const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path  = require("path");
const sharp = require("sharp");
const fs    = require("fs");
const os    = require("os");
// This is the Gemini art-director file. Keep the name you already use for it.
const geminiDirector = require("./geminiArtDirector.js");

// fluent-ffmpeg + ffmpeg-static for frame extraction
let ffmpeg;
try {
  ffmpeg = require("fluent-ffmpeg");
  const ffmpegPath  = require("ffmpeg-static");
  const ffprobePath = require("ffprobe-static").path;

  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    console.error("❌ ffmpeg binary missing:", ffmpegPath);
  }

  if (ffprobePath && fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(ffprobePath);
  } else {
    console.error("❌ ffprobe binary missing:", ffprobePath);
  }
} catch (err) {
  console.error("[Video] fluent-ffmpeg setup failed:", err.message);
  ffmpeg = null;
}

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// Malayalam first, English as fallback (so "SFI" etc. always render)
const HEAD_FONT = "Malayalam, English";

// ── Asset video path ─────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

const W            = 1080;
const H            = 1350;          // 4:5 poster
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand defaults (override per item) ───────────────────────
const DEFAULT_BRAND = process.env.BRAND_NAME || "FLASH KERALAM";

// ── The ONE colour scheme: yellow headline + white text ──────
// Same for every story, whatever the category.
const YELLOW = { head: "#ffd60a", headLight: "#ffd60a" }; // flat, like the reference
const WHITE  = "#ffffff";

// ── Synthetic bold ────────────────────────────────────────────
// The Malayalam font has no real heavier cut, so we stroke the glyph
// outline before filling it, which fattens every stroke.
const MALAYALAM_BOLD_W = 0.028; // stroke width as a fraction of font size

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = fontSize * MALAYALAM_BOLD_W + extraWidth;
  ctx.save();
  ctx.lineJoin    = "round";
  ctx.miterLimit  = 2;
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function computeAdHeight(adImg) {
  if (!adImg) return DEFAULT_AD_H;
  const naturalH = Math.round((adImg.height / adImg.width) * W);
  return Math.min(MAX_AD_H, Math.max(DEFAULT_AD_H, naturalH));
}

function toNodeBuffer(data) {
  if (Buffer.isBuffer(data))       return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data))    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError(`toNodeBuffer: unsupported type ${Object.prototype.toString.call(data)}`);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return toNodeBuffer(await res.arrayBuffer());
}

async function fetchAsJpegBuffer(url) {
  const raw = await fetchBuffer(url);
  return toNodeBuffer(await sharp(raw).jpeg().toBuffer());
}

async function canvasToBuffer(canvas, mime = "image/png") {
  const result = canvas.toBuffer(mime);
  return Buffer.isBuffer(result) ? result : toNodeBuffer(await result);
}

// ═══════════════════════════════════════════════════════════════
// VIDEO FRAME EXTRACTION (unchanged)
// ═══════════════════════════════════════════════════════════════

function extractVideoFrame(videoPath, atSecond = 1) {
  return new Promise((resolve) => {
    if (!ffmpeg) {
      console.warn("[Video] fluent-ffmpeg not available — skipping frame extract");
      return resolve(null);
    }

    if (!fs.existsSync(videoPath)) {
      console.warn("[Video] File not found:", videoPath);
      return resolve(null);
    }

    try {
      const stat = fs.statSync(videoPath);
      if (stat.size === 0) {
        console.warn("[Video] File is zero bytes:", videoPath);
        return resolve(null);
      }
    } catch (e) {
      console.warn("[Video] Could not stat file:", videoPath, e.message);
      return resolve(null);
    }

    const tmpFile = path.join(os.tmpdir(), `ad_frame_${Date.now()}.png`);
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      console.error("[Video] Frame extraction timed out:", videoPath);
      fs.unlink(tmpFile, () => {});
      finish(null);
    }, 15000);

    ffmpeg(videoPath)
      .on("error", (err) => {
        clearTimeout(timer);
        console.error("[Video] Frame extraction failed:", err.message);
        fs.unlink(tmpFile, () => {});
        finish(null);
      })
      .on("end", async () => {
        clearTimeout(timer);
        try {
          if (!fs.existsSync(tmpFile)) {
            console.error("[Video] Expected frame file was never written:", tmpFile);
            return finish(null);
          }
          const raw     = fs.readFileSync(tmpFile);
          const jpegBuf = toNodeBuffer(await sharp(raw).jpeg().toBuffer());
          fs.unlink(tmpFile, () => {});
          finish(jpegBuf);
        } catch (e) {
          console.error("[Video] Sharp conversion failed:", e.message);
          fs.unlink(tmpFile, () => {});
          finish(null);
        }
      })
      .screenshots({
        timestamps: [atSecond],
        filename:   path.basename(tmpFile),
        folder:     path.dirname(tmpFile),
        size:       `${W}x?`,
      });
  });
}

// ═══════════════════════════════════════════════════════════════
// AD STRIP (unchanged)
// ═══════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  if (adImg) {
    const scale = Math.max(W / adImg.width, adH / adImg.height);
    const drawW = adImg.width  * scale;
    const drawH = adImg.height * scale;
    const drawX = (W - drawW) / 2;
    const drawY = yOffset + (adH - drawH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yOffset, W, adH);
    ctx.clip();
    ctx.drawImage(adImg, drawX, drawY, drawW, drawH);
    ctx.restore();

    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
    lineGrad.addColorStop(0.2, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(0.8, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(1,   "rgba(255,180,0,0)");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, yOffset, W, 3);

    return;
  }

  const bg = ctx.createLinearGradient(0, yOffset, 0, yOffset + adH);
  bg.addColorStop(0, "#0d1b4b");
  bg.addColorStop(1, "#091230");
  ctx.fillStyle = bg;
  ctx.fillRect(0, yOffset, W, adH);

  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
  lineGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  lineGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  lineGrad.addColorStop(1,   "rgba(255,180,0,0)");

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset, W, 3);

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle   = "#ffffff";
  for (let x = 40; x < W; x += 60) {
    for (let y = yOffset + 20; y < yOffset + adH - 20; y += 40) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.font         = "bold 52px English";
  ctx.fillStyle    = "rgba(255,200,60,0.22)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("📢", W / 2, yOffset + adH / 2 - 8);
  ctx.restore();

  const line1    = "പരസ്യത്തിനായി ഞങ്ങൾക്ക്";
  const line2    = "സന്ദേശം അയയ്ക്കുക";
  const LINE_GAP = 58;
  const midY     = yOffset + adH / 2;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.8)";
  ctx.shadowBlur   = 14;

  ctx.font      = "42px Malayalam";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  fillTextBold(ctx, line1, W / 2, midY - LINE_GAP / 2, 42);

  const goldGrad = ctx.createLinearGradient(0, midY, 0, midY + 50);
  goldGrad.addColorStop(0, "#ffe566");
  goldGrad.addColorStop(1, "#ffaa00");

  ctx.font      = "44px Malayalam";
  ctx.fillStyle = goldGrad;
  fillTextBold(ctx, line2, W / 2, midY + LINE_GAP / 2, 44);

  ctx.restore();

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═══════════════════════════════════════════════════════════════
// THE POSTER (one design only)
//
//   dark charcoal top half:
//     YELLOW headline (3-5 lines, every line scaled to the same width)
//     BIG WHITE lines (who is behind the news)
//     small social icons + brand name row
//   bottom half: the news photo
//
// Yellow + white for every story. No categories, no accent colours.
//
// newsItem fields
//   title / titleLines   story headline text (used as it is, never rewritten)
//   image                photo
//   subtitle             optional: string or array of lines for the white line.
//                        When given, the AI does not rewrite; `title` stays the headline.
//   brandName            default "FLASH KERALAM" (or env BRAND_NAME)
//   showFooter           false hides the icons + brand row
//   quoted               true / false  (overrides the AI)
//   aiDirector           false = skip Gemini completely
//   aiRewrite            false = Gemini may not write text (focus / quote only)
// ═══════════════════════════════════════════════════════════════

// ── Width the text is allowed to fill ────────────────────────
// W is 1080. Text now runs almost edge to edge (about 30px free on each side),
// so the title FILLS the poster like the reference instead of floating in the middle.
const MAX_TEXT_W   = 1020;  // widest a yellow line may be
const MIN_TEXT_W   = 640;   // narrowest we will shrink to when the title is very long
const WHITE_RATIO  = 0.96;  // white lines are almost as wide as the yellow ones

const SP = {
  photoTop: 756,
  zoneTop: 52, zoneBottom: 704, gap: 22,
  // cap = biggest font a line may get, min = smallest.
  // The old caps (135 / 175) stopped short lines from growing, which left empty sides.
  yellow: { TW: MAX_TEXT_W, cap: 215, min: 40, lh: 1.08, maxLines: 5 },
  white:  { TW: Math.round(MAX_TEXT_W * WHITE_RATIO), cap: 270, min: 50, lh: 1.06, maxLines: 3 },
  brandY: 728,
};

async function drawBackground(ctx, newsItem) {
  // dark charcoal base
  const g = ctx.createLinearGradient(0, 0, 0, SP.photoTop);
  g.addColorStop(0, "#2b2b2b");
  g.addColorStop(1, "#222222");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // faint blurred ghost of the news photo in the dark area (like the reference)
  if (newsItem && newsItem.image) {
    try {
      const img = await loadImage(newsItem.image);
      const sw = 48, sh = Math.max(1, Math.round(sw * SP.photoTop / W));
      const small = createCanvas(sw, sh);
      const sctx  = small.getContext("2d");
      const sc = Math.max(sw / img.width, sh / img.height);
      sctx.drawImage(img, (sw - img.width * sc) / 2, (sh - img.height * sc) / 2, img.width * sc, img.height * sc);

      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, 0, 0, W, SP.photoTop);
      ctx.restore();
    } catch (e) {
      console.warn("[Poster] background texture skipped:", e.message);
    }
  }

  // faint grain
  let seed = 777;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * W, y = rnd() * SP.photoTop, sz = 0.6 + rnd() * 1.3;
    ctx.fillStyle = rnd() < 0.5
      ? `rgba(255,255,255,${(0.02 + rnd() * 0.04).toFixed(3)})`
      : `rgba(0,0,0,${(0.05 + rnd() * 0.08).toFixed(3)})`;
    ctx.fillRect(x, y, sz, sz);
  }
}

// Faint channel-name watermark behind the text (set watermark:false to hide)
function drawWatermark(ctx, newsItem) {
  if (newsItem.watermark === false) return;
  const name = String(newsItem.watermark || newsItem.brandName || DEFAULT_BRAND);
  ctx.save();
  ctx.globalAlpha  = 0.16;
  ctx.fillStyle    = "#ffffff";
  ctx.font         = "46px English";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, W / 2, 372);
  ctx.restore();
}

async function drawPhoto(ctx, newsItem, focus) {
  try {
    const PH    = H - SP.photoTop;
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, PH / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;

    const fx = focus && Number.isFinite(focus.x) ? focus.x : 0.5;
    const fy = focus && Number.isFinite(focus.y) ? focus.y : 0.5;
    let dx = W / 2 - fx * dw;
    let dy = PH * 0.45 - fy * dh;
    dx = Math.min(0, Math.max(W - dw, dx));
    dy = Math.min(0, Math.max(PH - dh, dy));

    const layer = createCanvas(W, PH);
    const lctx  = layer.getContext("2d");
    lctx.drawImage(img, dx, dy, dw, dh);

    // short soft edge at the top of the photo
    lctx.globalCompositeOperation = "destination-in";
    const m = lctx.createLinearGradient(0, 0, 0, PH);
    m.addColorStop(0,    "rgba(0,0,0,0)");
    m.addColorStop(0.07, "rgba(0,0,0,1)");
    m.addColorStop(1,    "rgba(0,0,0,1)");
    lctx.fillStyle = m;
    lctx.fillRect(0, 0, W, PH);

    ctx.drawImage(layer, 0, SP.photoTop);
  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }
}

// ── Text layout helpers ──────────────────────────────────────
function wrapWords(ctx, text, maxW) {
  const words = String(text || "").split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(t).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Width of a line at 100px (used to compare / merge lines)
function measureLine(ctx, t) {
  ctx.font = `100px ${HEAD_FONT}`;
  return ctx.measureText(t).width;
}

// Split text into exactly n lines of about EQUAL width (never cuts a word).
function balancedWrap(ctx, text, n) {
  const words = String(text || "").split(" ").filter(Boolean);
  if (n <= 1 || words.length <= 1) return [words.join(" ")];
  n = Math.min(n, words.length);
  const span = (a, b) => measureLine(ctx, words.slice(a, b).join(" "));
  const total = span(0, words.length);
  const avg = total / n;
  const m = words.length;
  const INF = 1e18;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(INF));
  const cut = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  dp[0][0] = 0;
  for (let k = 1; k <= n; k++) {
    for (let j = k; j <= m; j++) {
      for (let i = k - 1; i < j; i++) {
        if (dp[k - 1][i] >= INF) continue;
        const d = span(i, j) - avg;
        const v = dp[k - 1][i] + d * d;
        if (v < dp[k][j]) { dp[k][j] = v; cut[k][j] = i; }
      }
    }
  }
  const lines = [];
  let j = m;
  for (let k = n; k >= 1; k--) {
    const i = cut[k][j];
    lines.unshift(words.slice(i, j).join(" "));
    j = i;
  }
  return lines;
}

// Every line is scaled so that it fills the same width (like the reference
// poster): short lines come out BIG, longer lines a little smaller.
// The measured width includes the synthetic-bold stroke and the shadow
// margin, so the finished line really ends up at cfg.TW wide and never
// runs off the poster edge.
function fitScaledLines(ctx, presetLines, text, cfg, maxH) {
  const REF = 100;
  ctx.font = `${REF}px ${HEAD_FONT}`;

  let lines = presetLines && presetLines.length ? presetLines.slice() : null;
  if (!lines) {
    for (const f of [1, 1.25, 1.5, 1.8, 2.2]) {
      lines = wrapWords(ctx, text, cfg.TW * f);
      if (lines.length <= cfg.maxLines) break;
    }
  }

  // stroke adds (MALAYALAM_BOLD_W + 0.02) * size to the width of a line
  const strokeK = MALAYALAM_BOLD_W + 0.02;

  let items = lines.map((t) => {
    ctx.font = `${REF}px ${HEAD_FONT}`;
    const w = Math.max(1, ctx.measureText(t).width) + REF * strokeK;
    return { text: t, size: Math.min(cfg.cap, Math.max(cfg.min, Math.round(REF * cfg.TW / w))) };
  });

  let h = items.reduce((a, l) => a + l.size * cfg.lh, 0);
  if (h > maxH) {
    const k = maxH / h;
    items = items.map((l) => ({ text: l.text, size: Math.round(l.size * k) }));
    h = maxH;
  }
  return { items, lh: cfg.lh, h: Math.round(h) };
}

function scaleGroup(g, k) {
  const items = g.items.map((l) => ({ text: l.text, size: Math.max(24, Math.round(l.size * k)) }));
  return { items, lh: g.lh, h: Math.round(items.reduce((a, l) => a + l.size * g.lh, 0)) };
}

function drawScaledLines(ctx, group, top, paint) {
  let y = top;
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  for (const l of group.items) {
    ctx.save();
    ctx.font = `${l.size}px ${HEAD_FONT}`;
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = paint(y, l.size);
    fillTextBold(ctx, l.text, W / 2, y, l.size, l.size * 0.02);
    ctx.restore();
    y += Math.round(l.size * group.lh);
  }
}

// ── Brand row: social icons + brand name ─────────────────────
function drawFacebookIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle    = "#0b1257";
  ctx.font         = `${Math.round(r * 1.7)}px English`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("f", cx + r * 0.08, cy + r * 0.12);
  ctx.restore();
}

function drawInstagramIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#0b1257";
  ctx.lineWidth   = Math.max(1.4, r * 0.14);
  const s = r * 1.15;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#0b1257";
  ctx.beginPath();
  ctx.arc(cx + s * 0.27, cy - s * 0.27, Math.max(1.1, r * 0.07), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBrand(ctx, newsItem) {
  const name = String(newsItem.brandName || DEFAULT_BRAND);
  const R = 17, GAP = 10, SEP = 16, SIZE = 32;
  ctx.save();
  ctx.font = `${SIZE}px English`;
  const nameW = ctx.measureText(name).width;
  const total = R * 4 + GAP + SEP + nameW;
  let x = (W - total) / 2;

  drawFacebookIcon(ctx,  x + R,             SP.brandY, R);
  drawInstagramIcon(ctx, x + R * 3 + GAP,   SP.brandY, R);
  x += R * 4 + GAP + SEP;

  ctx.fillStyle    = "rgba(255,255,255,0.92)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x, SP.brandY + 1);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// CONTENT RESOLUTION (AI first, safe local split as fallback)
// ═══════════════════════════════════════════════════════════════

function getTitleText(newsItem) {
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    return newsItem.titleLines
      .map((l) => (typeof l === "string" ? l : l && l.text))
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return String(newsItem.title || "").replace(/\s+/g, " ").trim();
}

// First natural break (, ; : ! ?) that is NOT inside a number like 1,000
// and leaves at least 2 words in the headline part.
function splitAtFirstBreak(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[,;:!?，；،]/.test(ch)) continue;
    if (ch === "," && /\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "")) continue;

    const head = text.slice(0, i + 1).trim();
    const tail = text.slice(i + 1).trim();
    if (head.split(" ").filter(Boolean).length >= 2 && tail) return [head, tail];
  }
  return null;
}

// Uses the ORIGINAL title word for word: no rewriting and no dropped words.
// The end of the title goes to the big white line when it is short enough;
// otherwise the whole title stays yellow.
function localSplit(title) {
  const words = title.split(" ").filter(Boolean);
  const MAX_WHITE = 6;
  const count = (t) => t.split(" ").filter(Boolean).length;

  // 1) split at the first natural break (comma, colon...) if both parts fit
  const parts = splitAtFirstBreak(title);
  if (parts && count(parts[0]) <= 8 && count(parts[1]) <= MAX_WHITE) {
    return { head: parts[0], sub: parts[1] };
  }

  // 2) very short title: all yellow
  if (words.length < 5) return { head: title, sub: "" };

  // 3) otherwise the last words become the white line, if they are few enough
  const k = Math.max(3, Math.round(words.length * 0.6));
  const tail = words.slice(k);
  if (!tail.length || tail.length > MAX_WHITE) return { head: title, sub: "" };
  return { head: words.slice(0, k).join(" "), sub: tail.join(" ") };
}

function resolveContent(newsItem, direction) {
  const title = getTitleText(newsItem);

  let headText = title, headLines = null, subText = "", subLines = null;

  if (direction && direction.headText) {
    headText  = direction.headText;
    headLines = direction.headLines || null;
    subText   = direction.subText || "";
    subLines  = direction.subLines || null;
  } else if (!newsItem.subtitle && !newsItem.subTitleLines) {
    const s = localSplit(title);
    headText = s.head;
    subText  = s.sub;
  }

  // Explicit white line from the caller always wins
  const explicit = newsItem.subtitle || newsItem.subTitleLines;
  if (explicit) {
    if (Array.isArray(explicit)) {
      subLines = explicit.filter(Boolean).map(String);
      subText  = subLines.join(" ");
    } else {
      subLines = null;
      subText  = String(explicit).replace(/\s+/g, " ").trim();
    }
    if (!direction || !direction.headText) { headText = title; headLines = null; }
  }

  // Quote marks ‘ ’
  const alreadyQuoted = /^['"‘“]/.test(headText) || /['"’”]$/.test(headText);
  let quoted = false;
  if (newsItem.quoted === true) quoted = true;
  if (alreadyQuoted) quoted = false;

  if (quoted) {
    if (headLines && headLines.length) {
      headLines = headLines.slice();
      headLines[0] = "‘" + headLines[0];
      headLines[headLines.length - 1] = headLines[headLines.length - 1] + "’";
    }
    headText = "‘" + headText + "’";
  }

  return { headText, headLines, subText, subLines };
}

// ═══════════════════════════════════════════════════════════════
// DRAW THE POSTER
// ═══════════════════════════════════════════════════════════════

async function drawPoster(ctx, newsItem, direction) {
  const c = resolveContent(newsItem, direction);

  await drawBackground(ctx, newsItem);
  drawWatermark(ctx, newsItem);
  await drawPhoto(ctx, newsItem, direction && direction.focus);

  const zoneH    = SP.zoneBottom - SP.zoneTop;
  const hasWhite = (c.subLines && c.subLines.length) || String(c.subText || "").trim();

  // ── 1. Decide the lines ───────────────────────────────────
  // Gemini's lines are used when present; otherwise the text is split into a
  // few BALANCED lines (never one word per line).
  const wc = (t) => String(t || "").split(" ").filter(Boolean).length;
  const target = (t, max) => Math.min(max, Math.max(1, Math.round(wc(t) / 2.5)));

  let headLines = c.headLines && c.headLines.length
    ? c.headLines.slice()
    : balancedWrap(ctx, c.headText, target(c.headText, 4));
  let subLines = hasWhite
    ? (c.subLines && c.subLines.length ? c.subLines.slice() : balancedWrap(ctx, c.subText, target(c.subText, 2)))
    : null;

  const build = (tw) => ({
    yellow: fitScaledLines(ctx, headLines, null, { ...SP.yellow, TW: tw }, 1e6),
    white:  subLines ? fitScaledLines(ctx, subLines, null, { ...SP.white, TW: Math.round(tw * WHITE_RATIO) }, 1e6) : null,
  });
  const totalOf = (g) => g.yellow.h + (g.white ? g.white.h + SP.gap : 0);

  // ── 2. Too tall at full width? MERGE short neighbouring lines ──
  // (fewer, longer lines) instead of shrinking the text and leaving the
  // sides empty. Words and their order never change.
  let g = build(MAX_TEXT_W);
  while (totalOf(g) > zoneH) {
    let best = null;
    const consider = (lines, min, which) => {
      if (!lines || lines.length <= min) return;
      for (let i = 0; i < lines.length - 1; i++) {
        const w = measureLine(ctx, lines[i] + " " + lines[i + 1]);
        if (!best || w < best.w) best = { w, i, which };
      }
    };
    consider(headLines, 2, "h");
    consider(subLines, 1, "s");
    if (!best) break;
    const arr = best.which === "h" ? headLines : subLines;
    arr.splice(best.i, 2, arr[best.i] + " " + arr[best.i + 1]);
    g = build(MAX_TEXT_W);
  }

  // ── 3. Still too tall (very long title)? narrow it step by step ──
  for (let tw = MAX_TEXT_W - 8; totalOf(g) > zoneH && tw >= MIN_TEXT_W; tw -= 8) {
    g = build(tw);
  }
  let yellow = g.yellow, white = g.white;
  const total = totalOf(g);
  if (total > zoneH) {
    const k = zoneH / total;
    yellow = scaleGroup(yellow, k);
    if (white) white = scaleGroup(white, k);
  }
  const wH = white ? white.h + SP.gap : 0;

  const groupH = yellow.h + wH;
  let y = SP.zoneTop + Math.max(0, Math.round((zoneH - groupH) / 2));

  // Yellow headline
  drawScaledLines(ctx, yellow, y, (yy, size) => {
    const g = ctx.createLinearGradient(0, yy, 0, yy + size);
    g.addColorStop(0, YELLOW.headLight);
    g.addColorStop(0.5, YELLOW.head);
    g.addColorStop(1, YELLOW.head);
    return g;
  });
  y += yellow.h + SP.gap;

  // White line
  if (white) drawScaledLines(ctx, white, y, () => WHITE);

  if (newsItem.showFooter !== false) drawBrand(ctx, newsItem);
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Ad pipeline (unchanged) ─────────────────────────────────
  const hasAdUrl  = Boolean(newsItem.adBannerUrl);
  const isVideoAd = newsItem.adResourceType === "video";
  let   adImg     = null;
  let   actualAdH = DEFAULT_AD_H;
  let   liveAdVideoUrl = null;

  if (hasAdUrl && !isVideoAd) {
    try {
      console.log("[Ad] Loading image banner:", newsItem.adBannerUrl);
      const jpegBuf = await fetchAsJpegBuffer(newsItem.adBannerUrl);
      adImg         = await loadImage(jpegBuf);
      actualAdH     = computeAdHeight(adImg);
      console.log(`[Ad] Image banner loaded: ${adImg.width}x${adImg.height}px, strip: ${actualAdH}px`);
    } catch (err) {
      console.error("[Ad] Image banner load failed:", err.message);
    }
  }

  if (!adImg && hasAdUrl && isVideoAd) {
    let tmpVidPath = null;
    try {
      console.log("[Ad] Probing video banner dimensions:", newsItem.adBannerUrl);
      tmpVidPath     = path.join(os.tmpdir(), `ad_video_${Date.now()}.mp4`);
      const vidBuf   = await fetchBuffer(newsItem.adBannerUrl);
      fs.writeFileSync(tmpVidPath, vidBuf);

      const frameBuf = await extractVideoFrame(tmpVidPath, 1);
      if (frameBuf) {
        const probeImg = await loadImage(frameBuf);
        actualAdH      = computeAdHeight(probeImg);
        console.log(`[Ad] Video banner probed: ${probeImg.width}x${probeImg.height}px, strip: ${actualAdH}px`);
      } else {
        console.warn("[Ad] Video banner probe returned null — using default height");
      }
      liveAdVideoUrl = newsItem.adBannerUrl;
    } catch (err) {
      console.error("[Ad] Video banner probe failed:", err.message);
      liveAdVideoUrl = newsItem.adBannerUrl;
    } finally {
      if (tmpVidPath) {
        try { fs.unlinkSync(tmpVidPath); } catch { /* ignore */ }
      }
    }
  }

  if (!adImg && !liveAdVideoUrl) {
    console.log("[Ad] Using local video fallback (live composite):", FALLBACK_VIDEO_PATH);
    try {
      const frameBuf = await extractVideoFrame(FALLBACK_VIDEO_PATH, 1);
      if (frameBuf) {
        const probeImg = await loadImage(frameBuf);
        actualAdH      = computeAdHeight(probeImg);
        console.log(`[Ad] Local fallback probed: ${probeImg.width}x${probeImg.height}px, strip: ${actualAdH}px`);
      } else {
        console.warn("[Ad] Local fallback probe returned null — using default height");
        actualAdH = DEFAULT_AD_H;
      }
      liveAdVideoUrl = FALLBACK_VIDEO_PATH;
    } catch (err) {
      console.error("[Ad] Local fallback error:", err.message);
      actualAdH = DEFAULT_AD_H;
    }
  }

  const canvasH = liveAdVideoUrl ? H : H + actualAdH;
  console.log(`[Canvas] poster=${H}px  adStrip=${actualAdH}px  liveVideoAd=${!!liveAdVideoUrl}  canvasH=${canvasH}px`);

  const canvas = createCanvas(W, canvasH);
  const ctx    = canvas.getContext("2d");

  // ── AI text direction (never throws; null = safe local split) ──
  let direction = null;
  try {
    direction = await geminiDirector.getDirection(newsItem, {
      photoRatio: (W / (H - SP.photoTop)).toFixed(2),
    });
  } catch (e) {
    console.warn("[Poster] Art director failed, using default text split:", e.message);
  }

  // ── Poster body ─────────────────────────────────────────────
  await drawPoster(ctx, newsItem, direction);
  console.log(`[Poster] ai=${direction ? "yes" : "no"} rewritten=${!!(direction && direction.rewritten)}`);

  // ── Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── Ad strip ────────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
