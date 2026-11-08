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
  path.join(__dirname, "../fonts/AnekMalayalam_SemiCondensed-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// Malayalam first, English as fallback (so "SFI" etc. always render)
const HEAD_FONT = "Malayalam, English";

// ── Asset paths ──────────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

// ── Canvas size: Instagram Reel / Story ratio 9:16 ───────────
// TOTAL height = poster + ad strip = REEL_H, so the final video is 1080x1920.
const W            = 1080;
const REEL_H       = 1920;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Safe side margin (border padding) ────────────────────────
// Phones crop / cover the edges of a reel, so NO text may come closer
// than SAFE_X pixels to the left or right edge.
// Bigger number = more empty border = smaller text.  (80–110 is a good range)
const SAFE_X     = 90;
const TEXT_W_MAX = W - SAFE_X * 2;   // widest a text line may be (900)

// ── Brand defaults (override per item) ───────────────────────
const DEFAULT_BRAND  = process.env.BRAND_NAME  || "FLASH KERALAM";
const DEFAULT_FOOTER = process.env.FOOTER_TEXT || DEFAULT_BRAND;

// ── Colours ──────────────────────────────────────────────────
const YELLOW = { head: "#ffe600", headLight: "#fff04d" };
const WHITE  = "#ffffff";
const CYAN   = "#00c8ff";

// ── Photo placement ──────────────────────────────────────────
// "contain" = the WHOLE original photo is visible (nothing cropped). The text
//             sits RIGHT BELOW the photo, and photo + text are centred as one
//             group in the free space. A blurred copy fills the background.
// "cover"   = photo fills the whole poster (zoomed / cropped), text at bottom.
// Can also be set per item:  newsItem.photoMode = "cover" | "contain"
const PHOTO_MODE   = process.env.PHOTO_MODE || "contain";
const PHOTO_TOP    = 120;  // photo never starts above this (keeps the date clear)
const PHOTO_GAP    = 24;   // gap between the bottom of the photo and the text
const PHOTO_V_BIAS = 0.5;  // where the photo+text group sits in the free space:
                           // 0 = pushed to the top, 0.5 = centred, 1 = pushed to the bottom

// ── Synthetic bold ────────────────────────────────────────────
// Kept VERY thin on purpose: a thick stroke fills the loops and
// conjuncts of Malayalam letters and makes the text unreadable.
// 0 = no extra bold, 0.007 = slight, 0.012 = max you should use.
const MALAYALAM_BOLD_W = 0.007; // stroke width as a fraction of font size

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = fontSize * MALAYALAM_BOLD_W + extraWidth;
  ctx.save();
  ctx.lineJoin    = "round";
  ctx.miterLimit  = 2;
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill
  if (lineWidth > 0) ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

// Rounded rectangle with only the TOP corners rounded (footer bar)
function roundTopRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
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
  ctx.shadowColor  = "rgba(0,0,0,0.6)";
  ctx.shadowBlur   = 5;

  ctx.font      = "42px Malayalam";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
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
// THE POSTER  (1080 wide, height = 1920 - ad strip → 9:16 in total)
//
//   ┌────────────────────────┐
//   │  08.11.2026            │
//   │  ┌──────────────────┐  │
//   │  │  FULL PHOTO      │  │  whole photo visible (fit, not cropped)
//   │  └──────────────────┘  │
//   │   ‘white text’         │  text sits RIGHT BELOW the photo
//   │   YELLOW BIG TEXT      │  (photo + text are centred as one group)
//   │                        │
//   │  ▕  footer text bar ▏  │  cyan bar (showFooter:false hides it)
//   ├────────────────────────┤
//   │  ad strip              │
//   └────────────────────────┘
//     |<-SAFE_X->text<-SAFE_X->|   text never goes into the side borders
//
// newsItem fields
//   title / titleLines   story headline text (used as it is, never rewritten)
//   image                photo
//   photoMode            "contain" (whole photo) or "cover" (fills, cropped)
//   subtitle             optional: string or array of lines for the 2nd (yellow) part.
//   brandName            default "FLASH KERALAM" (or env BRAND_NAME)
//   footerText           text in the cyan bar (default brandName, or env FOOTER_TEXT)
//   date                 optional string / Date for the top-left date (default: today, IST)
//   showDate             false hides the date
//   showFooter           false hides the cyan bar
//   quoted               true / false  (overrides the AI)
//   aiDirector           false = skip Gemini completely
//   aiRewrite            false = Gemini may not write text (focus / quote only)
// ═══════════════════════════════════════════════════════════════

// ── Layout knobs (change these to tune the look) ─────────────
const BAR_H         = 72;    // cyan footer bar height (sits on the bottom edge)
const BAR_X         = Math.max(190, SAFE_X); // bar left/right margin
const TEXT_GAP_BOT  = 30;    // gap between the text block and the bar
const TEXT_GAP_MID  = 12;    // gap between the white part and the yellow part
const WHITE_MAX_FR  = 0.26;  // white text may use at most this fraction of the poster height
const YELLOW_MAX_FR = 0.32;  // yellow text may use at most this fraction of the poster height
const MIN_TEXT_W    = 560;   // narrowest we shrink to when a part is very long

// ── Font size knobs ──────────────────────────────────────────
// TW  = line width the text is stretched to (never more than TEXT_W_MAX)
// cap = biggest font size a line may get
// lh  = line height; Malayalam needs room for the signs above/below letters
const SP = {
  white:  { TW: TEXT_W_MAX, cap: 130, min: 36, lh: 1.22, maxLines: 5 },
  yellow: { TW: TEXT_W_MAX, cap: 240, min: 48, lh: 1.18, maxLines: 5 },
};

// Words per line: smaller number = fewer words per line = BIGGER letters
const WORDS_PER_LINE = 1.5;
const WHITE_MAX_LINES  = 5;
const YELLOW_MAX_LINES = 5;

// Blurred "cover" copy of the photo, used to fill the empty space
// around a fitted photo. Drawn tiny and scaled up = cheap, smooth blur.
function drawBlurredBackground(ctx, img, H) {
  const sw = 36;
  const sh = Math.round(sw * H / W);
  const small = createCanvas(sw, sh);
  const sctx  = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";

  const s  = Math.max(sw / img.width, sh / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  sctx.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);

  // second step makes the blur softer
  const mid = createCanvas(sw * 3, sh * 3);
  const mctx = mid.getContext("2d");
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(small, 0, 0, mid.width, mid.height);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, W, H);
  // darken so the text stays readable
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Draws the photo and returns { top, bottom } of the visible photo area
// (used so the dark gradient starts BELOW the photo).
// img = the already loaded photo (loaded once in createNewsPoster)
function drawPhoto(ctx, newsItem, focus, L, img) {
  const H = L.H;

  // dark base so there is never a white hole if the photo fails
  ctx.fillStyle = "#14100a";
  ctx.fillRect(0, 0, W, H);

  const mode = newsItem.photoMode || PHOTO_MODE;
  let rect = { top: 0, bottom: H * 0.6 };

  if (!img) {
    console.warn("[Poster] main photo missing");
    return rect;
  }

  try {
    if (mode === "cover") {
      // ── fill the whole poster (crops the photo) ──
      const scale = Math.max(W / img.width, H / img.height);
      const dw    = img.width  * scale;
      const dh    = img.height * scale;

      const fx = focus && Number.isFinite(focus.x) ? focus.x : 0.5;
      const fy = focus && Number.isFinite(focus.y) ? focus.y : 0.4;
      let dx = W / 2 - fx * dw;
      let dy = H * 0.32 - fy * dh;
      dx = Math.min(0, Math.max(W - dw, dx));
      dy = Math.min(0, Math.max(H - dh, dy));

      ctx.drawImage(img, dx, dy, dw, dh);
      return { top: 0, bottom: H * 0.28 + 40 };
    }

    // ── contain: whole photo, placed by computeLayout ────────
    drawBlurredBackground(ctx, img, H);

    const p = L.photo;
    if (p) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
      ctx.restore();
      rect = { top: p.y, bottom: p.y + p.h };
    }
  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }
  return rect;
}

// Dark gradient (for the text) + light shade at the top (for the date)
// fromY   = where the bottom gradient starts (just under the photo)
// fadeLen = (optional) distance over which it gets dark. Short = text that sits
//           right below the photo is still on a dark background.
function drawShade(ctx, fromY, H, fadeLen) {
  const top = ctx.createLinearGradient(0, 0, 0, 200);
  top.addColorStop(0, "rgba(0,0,0,0.38)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 200);

  const y0 = Math.max(0, Math.min(H - 200, fromY));
  const g = ctx.createLinearGradient(0, y0, 0, H);
  if (fadeLen) {
    const p = Math.min(0.9, Math.max(0.05, fadeLen / (H - y0)));
    g.addColorStop(0,       "rgba(10,6,0,0)");
    g.addColorStop(p * 0.5, "rgba(10,6,0,0.55)");
    g.addColorStop(p,       "rgba(8,5,0,0.88)");
    g.addColorStop(1,       "rgba(4,2,0,0.98)");
  } else {
    g.addColorStop(0,    "rgba(10,6,0,0)");
    g.addColorStop(0.25, "rgba(10,6,0,0.62)");
    g.addColorStop(0.50, "rgba(8,5,0,0.90)");
    g.addColorStop(1,    "rgba(4,2,0,0.98)");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, H - y0);
}

// ── Date (top-left) ──────────────────────────────────────────
function formatDate(d) {
  try {
    const date = d ? new Date(d) : new Date();
    if (isNaN(date.getTime())) return String(d);
    return date
      .toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" })
      .replace(/\//g, ".");
  } catch {
    return "";
  }
}

function drawDate(ctx, newsItem) {
  if (newsItem.showDate === false) return;
  const text = typeof newsItem.date === "string" && newsItem.date.trim()
    ? newsItem.date.trim()
    : formatDate(newsItem.date);
  if (!text) return;

  ctx.save();
  ctx.font         = "36px English";
  ctx.fillStyle    = "rgba(255,255,255,0.95)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor   = "rgba(0,0,0,0.55)";
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, SAFE_X, 50);   // same side margin as the text
  ctx.restore();
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

// Every line is scaled so that it fills the same width: short lines come
// out BIG, longer lines a little smaller. The measured width includes the
// synthetic-bold stroke AND an overhang allowance (Malayalam signs can stick
// out past the measured width), so a line never runs into the side border.
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

  // stroke (bold) + overhang safety margin
  const strokeK = MALAYALAM_BOLD_W + 0.02;
  const TW = Math.min(cfg.TW, TEXT_W_MAX);

  let items = lines.map((t) => {
    ctx.font = `${REF}px ${HEAD_FONT}`;
    const w = Math.max(1, ctx.measureText(t).width) + REF * strokeK;
    return { text: t, size: Math.min(cfg.cap, Math.max(cfg.min, Math.round(REF * TW / w))) };
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

// Fit ONE block of text into a maximum height:
//   1) full width; if too tall, MERGE short neighbouring lines (fewer, longer lines)
//   2) still too tall: narrow the width step by step
//   3) still too tall: scale everything down
function fitInZone(ctx, linesIn, cfg, zoneH) {
  const lines = linesIn.slice();
  const build = (tw) => fitScaledLines(ctx, lines, null, { ...cfg, TW: tw }, 1e6);

  let g = build(cfg.TW);
  while (g.h > zoneH && lines.length > 1) {
    let best = null;
    for (let i = 0; i < lines.length - 1; i++) {
      const w = measureLine(ctx, lines[i] + " " + lines[i + 1]);
      if (!best || w < best.w) best = { w, i };
    }
    if (!best) break;
    lines.splice(best.i, 2, lines[best.i] + " " + lines[best.i + 1]);
    g = build(cfg.TW);
  }

  for (let tw = cfg.TW - 8; g.h > zoneH && tw >= MIN_TEXT_W; tw -= 8) {
    g = build(tw);
  }

  if (g.h > zoneH) g = scaleGroup(g, zoneH / g.h);
  return g;
}

function drawScaledLines(ctx, group, top, paint) {
  let y = top;
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  for (const l of group.items) {
    // line-height is > 1, so push the glyphs down a little to centre them in their row
    const yy = y + Math.round(l.size * (group.lh - 1) / 2);

    ctx.save();
    ctx.font = `${l.size}px ${HEAD_FONT}`;
    // small, soft shadow only: a big blur makes Malayalam letters look smudged
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = paint(yy, l.size);
    fillTextBold(ctx, l.text, W / 2, yy, l.size, 0);
    ctx.restore();
    y += Math.round(l.size * group.lh);
  }
}

// ── Cyan footer bar (no logo) ────────────────────────────────
function drawFooter(ctx, newsItem, L) {
  const barW = W - BAR_X * 2;
  ctx.save();
  ctx.fillStyle = CYAN;
  roundTopRect(ctx, BAR_X, L.barTop, barW, BAR_H, 22);
  ctx.fill();

  const text = String(newsItem.footerText || DEFAULT_FOOTER);
  let size = 40;
  ctx.font = `${size}px English`;
  while (ctx.measureText(text).width > barW - 40 && size > 20) {
    size -= 2;
    ctx.font = `${size}px English`;
  }
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, L.barTop + BAR_H / 2 + 2);
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
// (Used when there is no AI split and no explicit subtitle.)
function localSplit(title) {
  const words = title.split(" ").filter(Boolean);
  const MAX_SUB = 8;
  const count = (t) => t.split(" ").filter(Boolean).length;

  const parts = splitAtFirstBreak(title);
  if (parts && count(parts[0]) <= 8 && count(parts[1]) <= MAX_SUB) {
    return { head: parts[0], sub: parts[1] };
  }

  if (words.length < 5) return { head: title, sub: "" };

  const k = Math.max(3, Math.round(words.length * 0.5));
  const tail = words.slice(k);
  if (!tail.length || tail.length > MAX_SUB) return { head: title, sub: "" };
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

  // Explicit 2nd part from the caller always wins
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

  // Quote marks ‘ ’ (go on the first / white part)
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
// LAYOUT
// H   = poster height (REEL_H minus the ad strip)
// img = the loaded photo (needed to know its size)
//
// contain mode:  photo first, text RIGHT BELOW it, the pair is centred
//                in the free space between the date and the cyan bar.
// cover mode:    text anchored to the bottom, above the bar (old way).
// ═══════════════════════════════════════════════════════════════

function computeLayout(newsItem, direction, H, img) {
  const mctx = createCanvas(10, 10).getContext("2d"); // scratch canvas for measuring
  const c = resolveContent(newsItem, direction);

  const wc = (t) => String(t || "").split(" ").filter(Boolean).length;
  const target = (t, max) => Math.min(max, Math.max(1, Math.round(wc(t) / WORDS_PER_LINE)));
  const hasSecond = (c.subLines && c.subLines.length) || String(c.subText || "").trim();

  const WHITE_MAX_H  = Math.round(H * WHITE_MAX_FR);
  const YELLOW_MAX_H = Math.round(H * YELLOW_MAX_FR);

  // ── 1. The TWO parts: first (white) and second (yellow) ────
  let firstLines = null, secondLines = null;

  if (hasSecond) {
    firstLines = c.headLines && c.headLines.length
      ? c.headLines.slice()
      : balancedWrap(mctx, c.headText, target(c.headText, WHITE_MAX_LINES));
    secondLines = c.subLines && c.subLines.length
      ? c.subLines.slice()
      : balancedWrap(mctx, c.subText, target(c.subText, YELLOW_MAX_LINES));
  } else if (c.headLines && c.headLines.length >= 2) {
    const k = Math.ceil(c.headLines.length / 2);
    firstLines  = c.headLines.slice(0, k);
    secondLines = c.headLines.slice(k);
  } else {
    const words = String(c.headText || "").split(" ").filter(Boolean);
    if (words.length >= 2) {
      const k = Math.ceil(words.length / 2);
      const a = words.slice(0, k).join(" ");
      const b = words.slice(k).join(" ");
      firstLines  = balancedWrap(mctx, a, target(a, WHITE_MAX_LINES));
      secondLines = balancedWrap(mctx, b, target(b, YELLOW_MAX_LINES));
    } else {
      firstLines  = null;
      secondLines = [String(c.headText || "")];
    }
  }

  // ── 2. Fit each part (heights are the REAL text heights) ───
  const white  = firstLines && firstLines.length ? fitInZone(mctx, firstLines, SP.white, WHITE_MAX_H) : null;
  const yellow = fitInZone(mctx, secondLines, SP.yellow, YELLOW_MAX_H);

  // ── 3. Place everything ────────────────────────────────────
  const showFooter = newsItem.showFooter !== false;

  const barTop     = H - BAR_H;
  const textBottom = showFooter ? barTop - TEXT_GAP_BOT : H - 50;

  const blockH = (white ? white.h + TEXT_GAP_MID : 0) + yellow.h;

  // old way: text block anchored at the bottom
  let textTop = textBottom - blockH;
  let photo   = null;

  const mode = newsItem.photoMode || PHOTO_MODE;
  if (mode !== "cover" && img) {
    // biggest photo area = everything above the bottom-anchored text
    const areaTop = PHOTO_TOP;
    const areaBot = Math.max(areaTop + 200, textTop - PHOTO_GAP);
    const scale   = Math.min(W / img.width, (areaBot - areaTop) / img.height);
    const dw      = Math.round(img.width  * scale);
    const dh      = Math.round(img.height * scale);
    const dx      = Math.round((W - dw) / 2);

    // photo + gap + text = one group; centre it in the free space
    const groupH = dh + PHOTO_GAP + blockH;
    const availH = textBottom - areaTop;
    const free   = Math.max(0, availH - groupH);
    const py     = Math.round(areaTop + free * PHOTO_V_BIAS);

    photo   = { x: dx, y: py, w: dw, h: dh };
    textTop = py + dh + PHOTO_GAP;     // text starts right below the photo
  }

  const whiteTop  = white ? textTop : null;
  const yellowTop = white ? textTop + white.h + TEXT_GAP_MID : textTop;

  return { H, white, yellow, whiteTop, yellowTop, barTop, textTop, photo };
}

// ═══════════════════════════════════════════════════════════════
// DRAW THE POSTER
// ═══════════════════════════════════════════════════════════════

function drawPoster(ctx, newsItem, direction, L, img) {
  const photoRect = drawPhoto(ctx, newsItem, direction && direction.focus, L, img);

  const mode = newsItem.photoMode || PHOTO_MODE;
  if (mode === "cover" || !L.photo) {
    // gradient starts a little above the photo's bottom edge so the photo stays clear
    const shadeFrom = Math.min(photoRect.bottom - 40, L.textTop - 160);
    drawShade(ctx, shadeFrom, L.H);
  } else {
    // text sits right under the photo: get dark quickly below the photo edge
    drawShade(ctx, photoRect.bottom - 30, L.H, 170);
  }
  drawDate(ctx, newsItem);

  // 1st part: white
  if (L.white) drawScaledLines(ctx, L.white, L.whiteTop, () => WHITE);

  // 2nd part: yellow, big
  drawScaledLines(ctx, L.yellow, L.yellowTop, (yy, size) => {
    const g = ctx.createLinearGradient(0, yy, 0, yy + size);
    g.addColorStop(0, YELLOW.headLight);
    g.addColorStop(0.5, YELLOW.head);
    g.addColorStop(1, YELLOW.head);
    return g;
  });

  if (newsItem.showFooter !== false) drawFooter(ctx, newsItem, L);
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

  // ── Poster height: poster + ad strip = 1920 (9:16 reel) ─────
  const posterH = REEL_H - actualAdH;

  // ── Load the news photo ONCE (layout needs its size) ────────
  let photoImg = null;
  try {
    photoImg = await loadImage(newsItem.image);
  } catch (e) {
    console.warn("[Poster] main photo failed to load:", e.message);
  }

  // ── AI text direction (never throws; null = safe local split) ──
  let direction = null;
  try {
    direction = await geminiDirector.getDirection(newsItem, {
      photoRatio: (W / posterH).toFixed(2),
    });
  } catch (e) {
    console.warn("[Poster] Art director failed, using default text split:", e.message);
  }

  // ── Layout: measure the text, place photo + text ────────────
  const L = computeLayout(newsItem, direction, posterH, photoImg);

  // With a live video ad the strip is added later, so this canvas is only the poster part
  const canvasH = liveAdVideoUrl ? L.H : REEL_H;
  console.log(`[Canvas] poster=${L.H}px  adStrip=${actualAdH}px  liveVideoAd=${!!liveAdVideoUrl}  canvasH=${canvasH}px  total=${REEL_H}px`);

  const canvas = createCanvas(W, canvasH);
  const ctx    = canvas.getContext("2d");

  // ── Poster body ─────────────────────────────────────────────
  drawPoster(ctx, newsItem, direction, L, photoImg);
  console.log(`[Poster] ai=${direction ? "yes" : "no"} rewritten=${!!(direction && direction.rewritten)}`);

  // ── Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── Ad strip ────────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, L.H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH, posterH: L.H };
}

module.exports = { createNewsPoster, toNodeBuffer };
