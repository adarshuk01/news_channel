const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path  = require("path");
const sharp = require("sharp");
const fs    = require("fs");
const os    = require("os");

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

// ── Fonts ─────────────────────────────────────────────────────
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam_SemiCondensed-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam_SemiCondensed-Bold.ttf"),
  "English"
);

// Optional HEAVY Malayalam font (the thick look of the reference poster).
// Drop ONE of these into server/fonts/ (first one found is used):
//   AnekMalayalam_SemiCondensed-ExtraBold.ttf
//   AnekMalayalam-ExtraBold.ttf
//   AnekMalayalam_Condensed-ExtraBold.ttf
//   Manjari-Bold.ttf
//   NotoSansMalayalam-Black.ttf
// Without one, the normal Bold font is used with a light extra stroke.
const HEAVY_CANDIDATES = [
  "AnekMalayalam_SemiCondensed-ExtraBold.ttf",
  "AnekMalayalam-ExtraBold.ttf",
  "AnekMalayalam_Condensed-ExtraBold.ttf",
  "Manjari-Bold.ttf",
  "NotoSansMalayalam-Black.ttf",
].map((f) => path.join(__dirname, "../fonts", f));

let hasHeavy = false;
for (const p of HEAVY_CANDIDATES) {
  try {
    if (fs.existsSync(p)) {
      GlobalFonts.registerFromPath(p, "MalayalamHeavy");
      hasHeavy = true;
      console.log("[Fonts] heavy headline font:", path.basename(p));
      break;
    }
  } catch (e) {
    console.warn("[Fonts] could not load", p, e.message);
  }
}

const HEAD_FONT = hasHeavy ? "MalayalamHeavy, Malayalam, English" : "Malayalam, English";

// ── Asset paths ──────────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

const W            = 1080;
const H            = 1350;          // 4:5 poster
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ═══════════════════════════════════════════════════════════════
// DESIGN CONSTANTS  (poster layout copied from the reference image)
//
//   0%  – 47%   news photo, fully visible to ~35%, melting into the dark
//   44%         BIG YELLOW headline (3-5 centred lines, same size)
//               glowing red/orange divider with a bright flare
//               WHITE sub-lines with a black outline (1-2 lines)
//   corners     red diagonal ribbon top-left and bottom-right
//   background  near-black with crimson glow on the left / right edges
// ═══════════════════════════════════════════════════════════════

const BG_BASE_RGB = [10, 2, 4];
const BG_BASE     = "#0a0204";
const GLOW_RGB    = [176, 8, 22];
const YELLOW      = "#ffe000";
const WHITE       = "#ffffff";

// Photo
// The photo height follows the text: the headline block is measured first, sits at the
// bottom, and the photo fills everything above it (fading out behind the first line).
const PHOTO_REF_END      = Math.round(H * 0.50);    // only tells Gemini the photo shape
const PHOTO_OVERLAP      = Math.round(H * 0.032);   // photo runs this far behind the first line
const PHOTO_FADE_LEN     = Math.round(H * 0.072);   // length of the fade into the dark
const PHOTO_MAX_TEXT_TOP = Math.round(H * 0.600);   // a very short title never starts lower
const PHOTO_FOCUS_Y    = 0.15;          // 0 = keep top of photo, 1 = keep bottom

// Text block  (numbers measured from the reference poster, 650 x 847 → 1080 x 1350)
const TEXT_TOP      = Math.round(H * 0.400);   // top of the first yellow line
const BOTTOM_MARGIN = 70;                      // space under the last white line

// The font size is NOT fixed: every block is made as BIG as possible so that its
// widest line reaches this width (the reference fills about 86% of the poster).
const HEAD_TARGET_W = Math.round(W * 0.915);   // widest YELLOW line
const SUB_TARGET_W  = Math.round(W * 0.905);   // widest WHITE line

const HEAD_MAX       = 240;                    // upper limit of the yellow font size
const HEAD_MIN       = 44;
const HEAD_MAX_LINES = 5;                      // 4 lines are tried first, then 5
// Line pitch of the yellow block (x font size). The reference stacks the lines
// tightly; if the block is too tall, the pitch is tightened step by step BEFORE
// the font is made smaller.
const HEAD_LH_TRY    = [1.22, 1.18, 1.14, 1.10, 1.06];

const SUB_MAX_RATIO = 1.0;                     // white is never bigger than yellow
const SUB_MIN       = 34;
const SUB_LH        = 1.26;
const SUB_MAX_LINES = 3;

const DIV_BLOCK = 60;                          // vertical room taken by the divider

function computeAdHeight(adImg) {
  if (!adImg) return DEFAULT_AD_H;
  const naturalH = Math.round((adImg.height / adImg.width) * W);
  return Math.min(MAX_AD_H, Math.max(DEFAULT_AD_H, naturalH));
}

// Stroke thickness (ad strip text only)
const MALAYALAM_BOLD_W = 0.012;

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = Math.max(0, fontSize * MALAYALAM_BOLD_W + extraWidth);
  ctx.save();
  if (lineWidth > 0.01) {
    ctx.lineJoin    = "round";
    ctx.miterLimit  = 2;
    ctx.lineWidth   = lineWidth;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

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
// AI DIRECTOR (Gemini)
//
// Decides which words are the BIG YELLOW headline, which are the WHITE
// sub-lines, where every line breaks, and which point of the photo must stay
// visible. It answers with NUMBERS only; the text is always cut from the
// original title, so no word can change.
// If geminiArtDirector.js is missing, disabled or fails, the poster silently
// uses its own local split.
//   newsItem.aiDirector = false   → never ask the AI
//   newsItem.direction            → pass an already fetched direction
// ═══════════════════════════════════════════════════════════════

let _director = null;
function getDirector() {
  if (_director !== null) return _director || null;
  try {
    _director = require("./geminiArtDirector");
  } catch (e) {
    console.warn("[Poster] geminiArtDirector not found next to this file – using the local split:", e.message);
    _director = false;
  }
  return _director || null;
}

async function askDirector(newsItem) {
  if (newsItem.direction) return newsItem.direction;
  if (newsItem.aiDirector === false) return null;
  const d = getDirector();
  if (!d || !d.isEnabled()) return null;
  try {
    return await d.getDirection(newsItem, {
      layout:     true,
      focus:      newsItem.showPhoto !== false && Boolean(newsItem.image),
      photoRatio: (W / PHOTO_REF_END).toFixed(2),
    });
  } catch (e) {
    console.warn("[Poster] director failed:", e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// VIDEO FRAME EXTRACTION
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

  const line1    = "ADVERTISE WITH US";
  const line2    = "Send us a message";
  const LINE_GAP = 58;
  const midY     = yOffset + adH / 2;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.8)";
  ctx.shadowBlur   = 14;

  ctx.font      = "42px Malayalam, English";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  fillTextBold(ctx, line1, W / 2, midY - LINE_GAP / 2, 42);

  const goldGrad = ctx.createLinearGradient(0, midY, 0, midY + 50);
  goldGrad.addColorStop(0, "#ffe566");
  goldGrad.addColorStop(1, "#ffaa00");

  ctx.font      = "44px Malayalam, English";
  ctx.fillStyle = goldGrad;
  fillTextBold(ctx, line2, W / 2, midY + LINE_GAP / 2, 44);

  ctx.restore();

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND  –  near-black base, crimson glow on the left / right edges,
// deep red towards the bottom
// ═══════════════════════════════════════════════════════════════

function drawBase(ctx) {
  ctx.fillStyle = BG_BASE;
  ctx.fillRect(0, 0, W, H);
}

// Soft elliptical glow (centre → edge fades to transparent)
function radialGlow(ctx, cx, cy, rx, ry, rgb, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const stops = [[0, 1], [0.3, 0.7], [0.6, 0.35], [0.85, 0.1], [1, 0]];
  for (const [t, k] of stops) {
    g.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * k).toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function drawGlow(ctx, glowY) {
  // deepening red towards the bottom
  const v = ctx.createLinearGradient(0, H * 0.52, 0, H);
  v.addColorStop(0, "rgba(70,0,8,0)");
  v.addColorStop(1, "rgba(70,0,8,0.60)");
  ctx.fillStyle = v;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);

  // crimson glow on both side edges, around the divider
  radialGlow(ctx, 0, glowY, W * 0.50, H * 0.26, GLOW_RGB, 0.62);
  radialGlow(ctx, W, glowY, W * 0.50, H * 0.26, GLOW_RGB, 0.62);

  // soft red glow behind the text block itself
  radialGlow(ctx, W / 2, glowY, W * 0.70, H * 0.20, [150, 8, 20], 0.28);

  // bottom corners a little stronger
  radialGlow(ctx, 0, H, W * 0.42, H * 0.14, [190, 10, 25], 0.50);
  radialGlow(ctx, W, H, W * 0.42, H * 0.14, [190, 10, 25], 0.55);
}

// ═══════════════════════════════════════════════════════════════
// PHOTO  –  full width at the top, melting into the dark background
//   newsItem.showPhoto = false  → no photo
// ═══════════════════════════════════════════════════════════════

async function drawPhoto(ctx, src, focus, photoEnd) {
  try {
    const img = await loadImage(src);
    const fadeStart = Math.max(0, photoEnd - PHOTO_FADE_LEN);

    // cover-fit into W x photoEnd
    const scale = Math.max(W / img.width, photoEnd / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    let dx      = (W - dw) / 2;
    let dy      = -Math.max(0, dh - photoEnd) * PHOTO_FOCUS_Y;

    // AI photo focus (0..1 from the top-left of the photo): keep that point
    // visible, placed in the upper-middle of the visible area (above the fade)
    if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y)) {
      dx = Math.min(0, Math.max(W - dw,         W / 2 - focus.x * dw));
      dy = Math.min(0, Math.max(photoEnd - dh, photoEnd * 0.36 - focus.y * dh));
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, photoEnd);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    // fade: lay the background colour over the photo with growing opacity
    const [r, g, b] = BG_BASE_RGB;
    const fade = ctx.createLinearGradient(0, fadeStart, 0, photoEnd);
    fade.addColorStop(0.00, `rgba(${r},${g},${b},0)`);
    fade.addColorStop(0.25, `rgba(${r},${g},${b},0.20)`);
    fade.addColorStop(0.50, `rgba(${r},${g},${b},0.58)`);
    fade.addColorStop(0.75, `rgba(${r},${g},${b},0.90)`);
    fade.addColorStop(1.00, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, fadeStart, W, photoEnd - fadeStart + 1);

    return true;
  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// CORNER RIBBONS  –  red diagonal band top-left, red band with a gold
// edge bottom-right
// ═══════════════════════════════════════════════════════════════

function drawCornerRibbons(ctx) {
  // ── top-left ──
  const a = Math.round(W * 0.155);
  ctx.save();

  const g1 = ctx.createLinearGradient(0, 0, a * 0.8, a * 0.8);
  g1.addColorStop(0.0, "#7a0008");
  g1.addColorStop(0.6, "#e2101a");
  g1.addColorStop(1.0, "#ff3a2a");
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(a, 0); ctx.lineTo(0, a);
  ctx.closePath();
  ctx.fill();

  // dark stripe across the band
  const b = a * 0.70, bw = a * 0.075;
  ctx.fillStyle = "rgba(30,0,4,0.85)";
  ctx.beginPath();
  ctx.moveTo(b, 0); ctx.lineTo(b + bw, 0); ctx.lineTo(0, b + bw); ctx.lineTo(0, b);
  ctx.closePath();
  ctx.fill();

  // light edge
  ctx.strokeStyle = "rgba(255,150,120,0.95)";
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.moveTo(a, 0); ctx.lineTo(0, a);
  ctx.stroke();
  ctx.restore();

  // ── bottom-right ──
  const c = Math.round(W * 0.145);
  ctx.save();

  const g2 = ctx.createLinearGradient(W - c * 0.55, H - c * 0.55, W, H);
  g2.addColorStop(0.0, "#ff2a1a");
  g2.addColorStop(0.5, "#c80812");
  g2.addColorStop(1.0, "#6a0008");
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.moveTo(W, H - c); ctx.lineTo(W, H); ctx.lineTo(W - c, H);
  ctx.closePath();
  ctx.fill();

  // second, darker band inside
  ctx.fillStyle = "rgba(40,0,6,0.55)";
  ctx.beginPath();
  ctx.moveTo(W, H - c * 0.60); ctx.lineTo(W, H - c * 0.46); ctx.lineTo(W - c * 0.46, H); ctx.lineTo(W - c * 0.60, H);
  ctx.closePath();
  ctx.fill();

  // gold glowing edge
  const gold = ctx.createLinearGradient(W, H - c, W - c, H);
  gold.addColorStop(0.0, "rgba(255,200,90,0)");
  gold.addColorStop(0.5, "rgba(255,214,120,1)");
  gold.addColorStop(1.0, "rgba(255,200,90,0)");
  ctx.shadowColor = "rgba(255,170,60,0.9)";
  ctx.shadowBlur  = 14;
  ctx.strokeStyle = gold;
  ctx.lineWidth   = 4;
  ctx.beginPath();
  ctx.moveTo(W, H - c); ctx.lineTo(W - c, H);
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// DIVIDER  –  glowing red / orange line with a bright flare in the middle
// ═══════════════════════════════════════════════════════════════

function drawDivider(ctx, y) {
  const cx = W / 2;
  const half = W * 0.34;

  radialGlow(ctx, cx, y, W * 0.42, 36, [255, 70, 20], 0.55);

  ctx.save();
  const lg = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  lg.addColorStop(0.00, "rgba(255,60,20,0)");
  lg.addColorStop(0.22, "rgba(255,90,30,0.85)");
  lg.addColorStop(0.50, "rgba(255,238,205,1)");
  lg.addColorStop(0.78, "rgba(255,90,30,0.85)");
  lg.addColorStop(1.00, "rgba(255,60,20,0)");
  ctx.shadowColor = "rgba(255,90,30,0.95)";
  ctx.shadowBlur  = 16;
  ctx.fillStyle   = lg;
  ctx.fillRect(cx - half, y - 1.5, half * 2, 3);
  ctx.restore();

  radialGlow(ctx, cx, y, 120, 10, [255, 245, 220], 0.95);
}

// ═══════════════════════════════════════════════════════════════
// TEXT  –  what goes in the yellow block and what goes in the white block
//
//   Where the split comes from (first match wins):
//
//   1. newsItem.subtitle  (or subTitleLines)  → title = yellow, subtitle = white
//      newsItem.titleLines = ["line", "line"] fixes the yellow line breaks
//   2. title with "|" :  "yellow part | white part"
//      (with more than 2 parts, the LAST one is white, the others are yellow)
//   3. the AI director (Gemini): decides the split AND the line breaks
//   4. local split: ~2/3 of the words yellow, the rest white
//      (prefers to cut after  ’ ” . ! ? ; : ,  )
//
//   newsItem.uppercase = true  → upper-case everything (English posts)
// ═══════════════════════════════════════════════════════════════

function cleanText(s, upper) {
  const t = String(s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return upper ? t.toUpperCase() : t;
}

const wordsOf = (s) => String(s).split(" ").filter(Boolean);

function joinLines(v) {
  return Array.isArray(v)
    ? v.map((l) => (typeof l === "string" ? l : l && l.text)).filter(Boolean).join(" ")
    : String(v ?? "");
}

function linesOf(v, c) {
  if (!Array.isArray(v)) return null;
  const out = v.map((l) => c(typeof l === "string" ? l : l && l.text)).filter(Boolean);
  return out.length ? out : null;
}

// AI lines are only used when, joined, they are EXACTLY the title's words
function sanitizeAiLayout(layout, rawTitle, c) {
  if (!layout || !Array.isArray(layout.headLines) || !layout.headLines.length) return null;
  const head = layout.headLines.map(c).filter(Boolean);
  const sub  = (Array.isArray(layout.subLines) ? layout.subLines : []).map(c).filter(Boolean);
  if (!head.length) return null;

  const got  = wordsOf([...head, ...sub].join(" "));
  const want = wordsOf(c(rawTitle));
  if (got.length !== want.length || got.some((w, i) => w !== want[i])) return null;
  return { head, sub };
}

function localSplit(words) {
  const N = words.length;
  if (N < 4) return { head: words, sub: [] };

  const target = Math.round(N * 0.66);
  const lo = Math.max(2, Math.ceil(N * 0.5));
  const hi = Math.min(N - 1, Math.ceil(N * 0.8));

  let cut = Math.max(lo, Math.min(hi, target));
  let bestDist = Infinity;
  for (let n = lo; n <= hi; n++) {
    if (/[’”"'.!?;:,।…]$/.test(words[n - 1])) {
      const d = Math.abs(n - target);
      if (d < bestDist) { bestDist = d; cut = n; }
    }
  }
  return { head: words.slice(0, cut), sub: words.slice(cut) };
}

// → { head: {text, lines|null}, sub: {text, lines|null} | null }
function buildCopy(newsItem) {
  const up = newsItem.uppercase === true;
  const c  = (s) => cleanText(s, up);

  const mk = (text, lines) => {
    const t = c(text);
    return t ? { text: t, lines: lines && lines.length ? lines : null } : null;
  };

  const rawTitle = joinLines(newsItem.titleLines) || String(newsItem.title || "");

  // 1) explicit subtitle
  const subRaw = joinLines(newsItem.subTitleLines) || String(newsItem.subtitle || "");
  if (c(subRaw)) {
    const head = mk(rawTitle, linesOf(newsItem.titleLines, c));
    if (!head) return { head: mk(subRaw, linesOf(newsItem.subTitleLines, c)), sub: null };
    return { head, sub: mk(subRaw, linesOf(newsItem.subTitleLines, c)) };
  }

  // 2) "yellow | white"
  if (rawTitle.includes("|")) {
    const parts = rawTitle.split("|").map(c).filter(Boolean);
    if (parts.length === 1) return { head: mk(parts[0]), sub: null };
    return {
      head: mk(parts.slice(0, -1).join(" ")),
      sub:  mk(parts[parts.length - 1]),
    };
  }

  // 2b) explicit yellow line breaks, no subtitle
  const fixed = linesOf(newsItem.titleLines, c);
  if (fixed) return { head: mk(fixed.join(" "), fixed), sub: null };

  // 3) lines chosen by the AI director (checked word for word against the title)
  const ai = sanitizeAiLayout(newsItem.aiLayout, rawTitle, c);
  if (ai) {
    return {
      head: mk(ai.head.join(" "), ai.head),
      sub:  ai.sub.length ? mk(ai.sub.join(" "), ai.sub) : null,
    };
  }

  // 4) local split
  const words = wordsOf(c(rawTitle));
  if (!words.length) return { head: null, sub: null };
  if (newsItem.autoTiers === false) return { head: mk(words.join(" ")), sub: null };

  const sp = localSplit(words);
  return {
    head: mk(sp.head.join(" ")),
    sub:  sp.sub.length ? mk(sp.sub.join(" ")) : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// LINE WRAPPING + FITTING
// ═══════════════════════════════════════════════════════════════

function wrapTokens(ctx, words, maxW) {
  const space = ctx.measureText(" ").width;
  const lines = [];
  let cur = [];
  let curW = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.t).width;
    const add = cur.length ? space + ww : ww;
    if (cur.length && curW + add > maxW) {
      lines.push({ words: cur, width: curW });
      cur = [{ ...w, w: ww }];
      curW = ww;
    } else {
      cur.push({ ...w, w: ww });
      curW += add;
    }
  }
  if (cur.length) lines.push({ words: cur, width: curW });
  return lines;
}

// Same number of lines as greedy wrapping, but with even line lengths
function balancedWrap(ctx, words, maxW) {
  const first = wrapTokens(ctx, words, maxW);
  const n = first.length;
  if (n < 2) return first;

  let lo = maxW * 0.45, hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapTokens(ctx, words, mid).length <= n) hi = mid; else lo = mid;
  }
  return wrapTokens(ctx, words, hi);
}

// Lays one block (yellow or white) out at one font size.
// Fixed lines (from the AI / the caller) are kept; otherwise it wraps by itself.
function layoutBlock(ctx, block, size, maxW, maxLines) {
  ctx.font = `${size}px ${HEAD_FONT}`;
  let lines;
  if (block.lines) {
    lines = block.lines.map((t) => ({ t, w: ctx.measureText(t).width }));
  } else {
    const toks = wordsOf(block.text).map((t) => ({ t }));
    lines = balancedWrap(ctx, toks, maxW).map((l) => ({
      t: l.words.map((w) => w.t).join(" "),
      w: l.width,
    }));
  }
  const ok = lines.length <= maxLines && lines.every((l) => l.w <= maxW + 1);
  return { lines, ok };
}

// Finds the BIGGEST yellow size where the widest yellow line reaches HEAD_TARGET_W
// and everything still fits the height. The white block is sized on its own so that
// ITS widest line reaches SUB_TARGET_W (never bigger than the yellow size).
function layoutPosterOnce(ctx, copy, availH) {

  const attempt = (maxLines) => {
    for (let size = HEAD_MAX; size >= HEAD_MIN; size -= 2) {
      const hb = layoutBlock(ctx, copy.head, size, HEAD_TARGET_W, maxLines);
      if (!hb.ok) continue;

      let sb = null;
      let subSize = 0;
      if (copy.sub) {
        for (subSize = Math.round(size * SUB_MAX_RATIO); subSize >= SUB_MIN; subSize -= 2) {
          sb = layoutBlock(ctx, copy.sub, subSize, SUB_TARGET_W, SUB_MAX_LINES);
          if (sb.ok) break;
        }
        if (!sb || !sb.ok) continue;
      }

      // tighten the line pitch before giving up font size
      for (const f of HEAD_LH_TRY) {
        const headLH = Math.round(size * f);
        // the white lines use the SAME line-height factor as the yellow lines
        const subLH  = Math.round(subSize * f);
        const total  = hb.lines.length * headLH + (sb ? DIV_BLOCK + sb.lines.length * subLH : 0);
        if (total <= availH) {
          return {
            headSize: size, headLH, headLines: hb.lines,
            subSize, subLH, subLines: sb ? sb.lines : null,
            total,
          };
        }
      }
    }
    return null;
  };

  const best = attempt(4) || attempt(HEAD_MAX_LINES);
  if (best) return best;

  // nothing fits (a very long title): smallest sizes, tightest pitch
  const hb = layoutBlock(ctx, copy.head, HEAD_MIN, HEAD_TARGET_W, 99);
  const sb = copy.sub ? layoutBlock(ctx, copy.sub, SUB_MIN, SUB_TARGET_W, 99) : null;
  const headLH = Math.round(HEAD_MIN * HEAD_LH_TRY[HEAD_LH_TRY.length - 1]);
  const subLH  = Math.round(SUB_MIN * HEAD_LH_TRY[HEAD_LH_TRY.length - 1]);
  return {
    headSize: HEAD_MIN, headLH, headLines: hb.lines,
    subSize: sb ? SUB_MIN : 0, subLH, subLines: sb ? sb.lines : null,
    total: hb.lines.length * headLH + (sb ? DIV_BLOCK + sb.lines.length * subLH : 0),
  };
}

// Tries the line breaks chosen by the AI / the caller AND the poster's own balanced
// wrapping, and keeps whichever gives the BIGGER font. The AI breaks win unless the
// own wrapping is clearly bigger (4%+). This is what stops a title whose AI lines
// pair two long words from ending up with a small font.
function layoutPoster(ctx, copy, availH) {
  const hasHL = Boolean(copy.head && copy.head.lines);
  const hasSL = Boolean(copy.sub && copy.sub.lines);

  const base = layoutPosterOnce(ctx, copy, availH);
  if (!hasHL && !hasSL) return base;

  const variants = [];
  if (hasHL) variants.push({ ...copy, head: { ...copy.head, lines: null } });
  if (hasSL) variants.push({ ...copy, sub:  { ...copy.sub,  lines: null } });
  if (hasHL && hasSL) {
    variants.push({
      head: { ...copy.head, lines: null },
      sub:  { ...copy.sub,  lines: null },
    });
  }

  const score = (L) => L.headSize * 2 + L.subSize;
  let best = base;
  for (const v of variants) {
    const L = layoutPosterOnce(ctx, v, availH);
    if (score(L) > score(best)) best = L;
  }
  return score(best) >= score(base) * 1.04 ? best : base;
}

// ═══════════════════════════════════════════════════════════════
// TEXT DRAWING
// ═══════════════════════════════════════════════════════════════

function strokeFill(ctx, text, x, y, fill, strokeColor, strokeW) {
  ctx.save();
  ctx.lineJoin   = "round";
  ctx.miterLimit = 2;
  if (strokeW > 0.01) {
    ctx.lineWidth   = strokeW;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Yellow: soft black shadow underneath, then the crisp yellow glyphs.
function drawYellowLine(ctx, text, x, y, size) {
  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.70)";
  ctx.shadowBlur    = Math.round(size * 0.12);
  ctx.shadowOffsetY = Math.round(size * 0.05);
  ctx.fillStyle     = YELLOW;
  ctx.fillText(text, x, y);
  ctx.restore();

  // heavy font: no extra stroke; normal Bold font: a light stroke to thicken it
  strokeFill(ctx, text, x, y, YELLOW, YELLOW, hasHeavy ? 0 : size * 0.028);
}

// White: black outline + soft shadow, white glyphs on top.
function drawWhiteLine(ctx, text, x, y, size) {
  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.75)";
  ctx.shadowBlur    = Math.round(size * 0.14);
  ctx.shadowOffsetY = Math.round(size * 0.05);
  strokeFill(ctx, text, x, y, WHITE, "#000000", size * 0.07);
  ctx.restore();

  // crisp pass without shadow
  strokeFill(ctx, text, x, y, WHITE, "#000000", size * 0.07);
}

function drawCopy(ctx, L, top) {
  let y = top;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "alphabetic";

  ctx.font = `${L.headSize}px ${HEAD_FONT}`;
  L.headLines.forEach((ln, i) => {
    const base = y + i * L.headLH + L.headLH / 2 + L.headSize * 0.33;
    drawYellowLine(ctx, ln.t, W / 2, base, L.headSize);
  });
  y += L.headLines.length * L.headLH;

  if (L.subLines) {
    drawDivider(ctx, y + DIV_BLOCK * 0.46);
    y += DIV_BLOCK;

    ctx.font = `${L.subSize}px ${HEAD_FONT}`;
    L.subLines.forEach((ln, i) => {
      const base = y + i * L.subLH + L.subLH / 2 + L.subSize * 0.33;
      drawWhiteLine(ctx, ln.t, W / 2, base, L.subSize);
    });
  }

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
//
//   newsItem options:
//     title                 the headline (never rewritten)
//     subtitle / subTitleLines   force the white lines
//     titleLines            force the yellow line breaks
//     "yellow | white"      split with a | inside the title
//     autoTiers   false     everything yellow, no white block
//     uppercase   true      upper-case all text
//     showPhoto   false     no photo
//     image                 photo url / path / buffer
//     aiDirector  false     do not ask Gemini
//     adBannerUrl, adResourceType   ad strip (unchanged)
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── AI director: yellow / white split, line breaks, photo focus ──
  const direction = await askDirector(newsItem);

  // title was too long for the design → use the short, meaning-preserving version
  if (direction && direction.shortTitle) {
    console.log("[Poster] long title shortened by AI:", direction.shortTitle);
    newsItem = { ...newsItem, title: direction.shortTitle };
  }

  if (direction && direction.headLines) {
    newsItem = {
      ...newsItem,
      aiLayout: { headLines: direction.headLines, subLines: direction.subLines || [] },
    };
  }

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

  // ── 1. Measure the headline first: its height decides the photo height ──
  const copy    = buildCopy(newsItem);
  const bottomY = H - BOTTOM_MARGIN;
  let layout    = null;
  let startY    = TEXT_TOP;

  if (copy.head) {
    layout = layoutPoster(ctx, copy, bottomY - TEXT_TOP);
    // the block sits at the bottom; short titles move it down so the photo grows,
    // long titles move it up so the photo shrinks
    startY = Math.round(Math.min(PHOTO_MAX_TEXT_TOP, Math.max(TEXT_TOP, bottomY - layout.total)));
  }
  const photoEnd = startY + PHOTO_OVERLAP;
  const glowY    = layout
    ? startY + (layout.subLines ? layout.headLines.length * layout.headLH + DIV_BLOCK * 0.46 : layout.total * 0.6)
    : H * 0.74;

  // ── 2. Base, photo + fade, glow, corner ribbons ─────────────
  drawBase(ctx);
  if (newsItem.showPhoto !== false && newsItem.image) {
    await drawPhoto(ctx, newsItem.image, direction && direction.focus, photoEnd);
  }
  drawGlow(ctx, glowY);
  drawCornerRibbons(ctx);

  // ── 2b. Headline: yellow block, divider, white block ────────
  if (layout) drawCopy(ctx, layout, startY);

  // ── 3. Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 4. Ad strip ─────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
