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

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam_SemiCondensed-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// ── Asset video path ─────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

// ── Blue-grid panel background asset (kept for backward-compat /
// callers that still pass panel-style items — no longer used by the
// default layout below) ───────────────────────────────────────────
function resolvePanelBgPath() {
  const candidates = [
    process.env.PANEL_BG_IMAGE,
    "C:\\Users\\adars\\Downloads\\news_channel-main\\news_channel-main\\server\\assets\\blue_panel_bg.png",
    path.join(__dirname, "assets/blue_panel_bg.png"),
    path.join(__dirname, "../assets/blue_panel_bg.png"),
    path.join(process.cwd(), "assets/blue_panel_bg.png"),
    path.join(process.cwd(), "server/assets/blue_panel_bg.png"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let _panelBgImageCache = null;
async function loadPanelBgImage() {
  if (_panelBgImageCache) return _panelBgImageCache;
  const resolvedPath = resolvePanelBgPath();
  if (!resolvedPath) return null;
  try {
    const rawBuf   = fs.readFileSync(resolvedPath);
    const cleanBuf = await sharp(rawBuf).png().toBuffer();
    const img      = await loadImage(cleanBuf);
    _panelBgImageCache = img;
    return img;
  } catch (e) {
    console.warn("[Panel] failed to load background asset:", e.message);
    return null;
  }
}

const W            = 1080;
const H            = 1380;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Letter-spacing for the title, done the SAFE way: using the canvas's
// native `letterSpacing` state property rather than splitting the
// string into individual characters. Malayalam (and other complex
// scripts) rely on the font engine shaping consonants + vowel signs +
// conjuncts together — drawing character-by-character breaks that
// shaping and produces garbled glyphs. Setting ctx.letterSpacing and
// calling the normal measureText/fillText/strokeText on the WHOLE
// string keeps shaping intact while still adding the gap.
function setLetterSpacing(ctx, px) {
  try {
    ctx.letterSpacing = `${px}px`;
  } catch (e) {
    // If this build of @napi-rs/canvas doesn't support letterSpacing,
    // fail silently — no extra spacing is far better than broken text.
  }
}

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

// Draw a single image into a rect using "cover" fit (crop to fill).
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

// Draw a single image into a rect using "contain" fit (scale down to
// fit fully inside the rect, no cropping — the whole source image
// stays visible, letterboxed on whichever axis has slack).
function drawContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// Fills a rect with a blurred, darkened "cover" copy of the image —
// used as a backdrop behind a "contain"-fit photo so any letterbox
// gaps read as an intentional soft background instead of empty bars.
function drawBlurredBackdrop(ctx, img, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  try {
    ctx.filter = "blur(50px)";
  } catch (e) {
    // If blur isn't supported in this canvas build, fall back to a
    // plain (unblurred) cover fill rather than throwing.
  }
  // Oversize slightly so the blur's edge softening doesn't leave a
  // visible seam at the rect boundary.
  drawCover(ctx, img, x - 30, y - 30, w + 60, h + 60);
  ctx.filter = "none";
  ctx.restore();

  // Darken so the sharp foreground photo and white text stay legible
  // against it.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
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

// Reads an image from a URL, a local path, or a raw Buffer, converts
// it to grayscale (black & white), and returns a loaded canvas image.
// Used for the main photo strip so it matches the reference design's
// desaturated look, regardless of what format `newsItem.image` is in.
async function loadGrayscaleImage(source) {
  let raw;
  if (Buffer.isBuffer(source)) {
    raw = source;
  } else if (typeof source === "string" && /^https?:\/\//i.test(source)) {
    raw = await fetchBuffer(source);
  } else if (typeof source === "string") {
    raw = fs.readFileSync(source);
  } else {
    throw new TypeError(`loadGrayscaleImage: unsupported source type ${typeof source}`);
  }
  const grayBuf = await sharp(raw).grayscale().png().toBuffer();
  return loadImage(grayBuf);
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
    const scaleW = W / adImg.width;
    const scaleH = adH / adImg.height;
    const scale  = Math.max(scaleW, scaleH);

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

  ctx.font      = "bold 42px Malayalam";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(line1, W / 2, midY - LINE_GAP / 2);

  const goldGrad = ctx.createLinearGradient(0, midY, 0, midY + 50);
  goldGrad.addColorStop(0, "#ffe566");
  goldGrad.addColorStop(1, "#ffaa00");

  ctx.font      = "bold 44px Malayalam";
  ctx.fillStyle = goldGrad;
  ctx.fillText(line2, W / 2, midY + LINE_GAP / 2);
  ctx.restore();

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═══════════════════════════════════════════════════════════════
// DATE / RIBBON BADGE  (kept for backward-compat / callers that
// still want a top ribbon — not used by the default bottom-caption
// layout below, since the reference poster has no top elements.)
// ═══════════════════════════════════════════════════════════════

function formatBadgeDate(d = new Date()) {
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const day    = d.getDate();
  const month  = months[d.getMonth()];
  const year   = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function drawDateRibbon(ctx, text, x, y) {
  ctx.save();
  ctx.font = "900 40px English";
  setLetterSpacing(ctx, 1);
  const textW  = ctx.measureText(text).width;
  const padL   = 34;
  const padR   = 34;
  const h      = 70;
  const r      = h / 2;
  const w      = textW + padL + padR;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.22)";
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "#c8102e";
  ctx.fill();
  ctx.restore();

  ctx.font         = "900 38px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  setLetterSpacing(ctx, 1);
  ctx.fillText(text, x + padL, y + h / 2 + 2);
  ctx.restore();

  return { w, h };
}

// ═══════════════════════════════════════════════════════════════
// LOGO — kept for backward-compat, unused by default layout below.
// ═══════════════════════════════════════════════════════════════
function drawBrandLogo(ctx, line1, line2, rightX, topY) {
  ctx.save();
  ctx.textAlign    = "right";
  ctx.textBaseline = "top";

  ctx.font = "900 50px English";
  setLetterSpacing(ctx, 1);
  ctx.fillStyle = "#c8102e";
  ctx.fillText(line1, rightX, topY);
  const line1H = 50;

  const y2 = topY + line1H + 2;
  ctx.font = "900 50px English";
  setLetterSpacing(ctx, 1);
  ctx.lineJoin    = "round";
  ctx.strokeStyle = "#c8102e";
  ctx.lineWidth   = 7;
  ctx.strokeText(line2, rightX, y2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(line2, rightX, y2);

  ctx.restore();
}

// Small semi-transparent watermark text (bottom-corner credits over
// the photo).
function drawWatermark(ctx, text, x, y, opts = {}) {
  const {
    size    = 20,
    color   = "rgba(255,255,255,0.65)",
    align   = "left",
    angle   = 0,
    weight  = "600",
    font    = "English",
  } = opts;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.font         = `${weight} ${size}px ${font}`;
  ctx.fillStyle    = color;
  ctx.textAlign    = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Circular "compare" badge — kept for backward-compat, unused by
// default layout.
async function drawCircleBadge(ctx, badgeImg, cx, cy, radius) {
  const ringOuter = radius + 12;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.filter = "blur(6px)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
  ctx.fillStyle = "#e30613";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  if (badgeImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((radius * 2) / badgeImg.width, (radius * 2) / badgeImg.height);
    const dw = badgeImg.width * scale;
    const dh = badgeImg.height * scale;
    ctx.drawImage(badgeImg, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#222222";
    ctx.fill();
    ctx.restore();
  }
}

// Simple flat-icon Facebook glyph (kept for backward-compat, unused
// by default layout).
function drawFacebookIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1877f2";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle   = "#ffffff";
  ctx.lineWidth   = r * 0.32;
  ctx.lineCap     = "round";
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.06, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.06, cy + r * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.32, cy - r * 0.42, r * 0.28, Math.PI, Math.PI * 1.55, false);
  ctx.lineWidth = r * 0.28;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.28, cy - r * 0.02);
  ctx.lineTo(cx + r * 0.32, cy - r * 0.02);
  ctx.lineWidth = r * 0.26;
  ctx.stroke();
  ctx.restore();
}

// Simple flat-icon Instagram glyph (kept for backward-compat, unused
// by default layout).
function drawInstagramIcon(ctx, cx, cy, r) {
  const size = r * 2;
  const x = cx - r;
  const y = cy - r;
  const rad = r * 0.55;

  const grad = ctx.createLinearGradient(x, y + size, x + size, y);
  grad.addColorStop(0,    "#ffdb73");
  grad.addColorStop(0.35, "#ee2a7b");
  grad.addColorStop(0.7,  "#8134af");
  grad.addColorStop(1,    "#5851db");

  ctx.save();
  roundRect(ctx, x, y, size, size, rad);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = r * 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.55, cy - r * 0.55, r * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

// "f  📷  <label>" social-proof row (kept for backward-compat, unused
// by default layout).
function drawSocialRow(ctx, label, cy) {
  const iconR   = 15;
  const gap     = 10;
  ctx.save();
  ctx.font = "700 26px English";
  const labelW = ctx.measureText(label).width;
  ctx.restore();

  const totalW = iconR * 2 + gap + iconR * 2 + gap + labelW;
  let x = W / 2 - totalW / 2 + iconR;

  drawFacebookIcon(ctx, x, cy, iconR);
  x += iconR + gap + iconR;
  drawInstagramIcon(ctx, x, cy, iconR);
  x += iconR + gap;

  ctx.save();
  ctx.font         = "700 26px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.6)";
  ctx.shadowBlur   = 6;
  ctx.fillText(label, x, cy + 1);
  ctx.restore();
}

// Normalizes a titleLines entry into { text, color }. The bottom-
// caption layout uses one uniform size for every line (auto-fit),
// so no per-line size multiplier is needed here — only an optional
// per-line color override.
function normalizeTitleLine(entry) {
  if (typeof entry === "string") {
    return { text: entry, color: null };
  }
  return { text: entry.text || "", color: entry.color || null };
}

// Small gold/orange accent dash, drawn above the headline — matches
// the short horizontal tick mark in the reference poster.
function drawAccentDash(ctx, x, y, w = 46, h = 6) {
  ctx.save();
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, "#ffb300");
  grad.addColorStop(1, "#ff8a00");
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// TOP HEADER (monochrome) — the black date-ribbon on the left and
// the black/white "FLASH KERALAM" logo on the right, drawn directly
// on top of the photo (no white bar behind them). Same shapes as
// drawDateRibbon/drawBrandLogo but re-colored to black & white
// instead of red, with a drop shadow for legibility over the image.
// ═══════════════════════════════════════════════════════════════

const HEADER_H = 150; // vertical space the header elements sit within

function drawDateRibbonMono(ctx, text, x, y) {
  ctx.save();
  ctx.font = "900 36px English";
  setLetterSpacing(ctx, 1);
  const textW = ctx.measureText(text).width;
  const padL  = 32;
  const padR  = 34;
  const h     = 60;
  const r     = h / 2;
  const w     = textW + padL + padR;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.5)";
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "#141414";
  ctx.fill();
  ctx.restore();

  ctx.font         = "900 34px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  setLetterSpacing(ctx, 1);
  ctx.fillText(text, x + padL, y + h / 2 + 2);
  ctx.restore();

  return { w, h };
}

// Small solid dot accent between the ribbon and the logo block.
function drawDotMono(ctx, cx, cy, r = 5) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur  = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#141414";
  ctx.fill();
  ctx.restore();
}

function drawBrandLogoMono(ctx, line1, line2, rightX, topY) {
  ctx.save();
  ctx.textAlign    = "right";
  ctx.textBaseline = "top";
  ctx.shadowColor  = "rgba(0,0,0,0.5)";
  ctx.shadowBlur   = 8;

  // Line 1 — solid black fill
  ctx.font = "900 36px English";
  setLetterSpacing(ctx, 1);
  ctx.fillStyle = "#141414";
  ctx.fillText(line1, rightX, topY);
  const line1H = 36;

  // Line 2 — white fill with a bold black outline (stencil look)
  const y2 = topY + line1H + 2;
  ctx.font = "900 36px English";
  setLetterSpacing(ctx, 1);
  ctx.lineJoin    = "round";
  ctx.strokeStyle = "#141414";
  ctx.lineWidth   = 6;
  ctx.strokeText(line2, rightX, y2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(line2, rightX, y2);

  ctx.restore();
}

function drawTopHeaderMono(ctx, dateText, logoLine1, logoLine2) {
  const topPad = 40;

  // Date ribbon, flush left.
  drawDateRibbonMono(ctx, dateText, 0, topPad);

  // Logo block, right-aligned.
  drawBrandLogoMono(ctx, logoLine1, logoLine2, W - 40, topPad - 4);

  // Small dot accent just above-left of the logo block.
  drawDotMono(ctx, W - 250, topPad + 18);
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Load ad image (unchanged logic) ─────────────────────────
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
      actualAdH      = DEFAULT_AD_H;
    }
  }

  const canvasH = liveAdVideoUrl ? H : H + actualAdH;
  console.log(`[Canvas] poster=${H}px  adStrip=${actualAdH}px  liveVideoAd=${!!liveAdVideoUrl}  canvasH=${canvasH}px`);

  const canvas = createCanvas(W, canvasH);
  const ctx    = canvas.getContext("2d");

  // ═════════════════════════════════════════════════════════
  // Load the main photo — converted to grayscale (black & white)
  // to match the reference poster — and draw it FULL BLEED across
  // the entire poster area (not just a lower strip).
  // ═════════════════════════════════════════════════════════
  let img1 = null;
  try { img1 = await loadGrayscaleImage(newsItem.image); }
  catch (e) { console.warn("[Poster] photo failed:", e.message); }

  // Photo fills the full poster height — the header is drawn on top
  // of it afterward, not in a separate white band.
  const PHOTO_TOP = 0;
  const PHOTO_H   = H;

  ctx.fillStyle = "#181818";
  ctx.fillRect(0, PHOTO_TOP, W, PHOTO_H);
  if (img1) {
    // Blurred cover backdrop fills the frame edge-to-edge first...
    drawBlurredBackdrop(ctx, img1, 0, PHOTO_TOP, W, PHOTO_H);
    // ...then the full, uncropped photo is drawn on top ("contain"
    // fit) so nothing from the original image gets cut off, however
    // wide or narrow it is compared to the poster's aspect ratio.
    drawContain(ctx, img1, 0, PHOTO_TOP, W, PHOTO_H);
  }

  // ── Top header (date ribbon + FLASH KERALAM logo), monochrome —
  // drawn directly over the photo, no white background behind it.
  const badgeText  = newsItem.dateText || formatBadgeDate(new Date());
  const logoLine1  = newsItem.logoLine1 || "FLASH";
  const logoLine2  = newsItem.logoLine2 || "KERALAM";
  drawTopHeaderMono(ctx, badgeText, logoLine1, logoLine2);

  // ═════════════════════════════════════════════════════════
  // 1. DARK GRADIENT OVERLAY — fades the lower portion of the photo
  //    to black so the white headline text stays legible, matching
  //    the reference poster's bottom scrim.
  // ═════════════════════════════════════════════════════════
  const OVERLAY_TOP = PHOTO_TOP + Math.round(PHOTO_H * 0.52);
  const overlay = ctx.createLinearGradient(0, OVERLAY_TOP, 0, H);
  overlay.addColorStop(0,    "rgba(0,0,0,0)");
  overlay.addColorStop(0.45, "rgba(0,0,0,0.55)");
  overlay.addColorStop(0.75, "rgba(0,0,0,0.85)");
  overlay.addColorStop(1,    "rgba(0,0,0,0.96)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, OVERLAY_TOP, W, H - OVERLAY_TOP);


  // ═════════════════════════════════════════════════════════
  // 2. HEADLINE — left-aligned, bold white text over the dark
  //    scrim, anchored near the bottom, with a small gold accent
  //    dash above the first line.
  // ═════════════════════════════════════════════════════════
  const PAD_X       = 46;
  const BOTTOM_PAD  = 78;   // leaves room for the watermark row
  const DASH_GAP    = 26;   // space between dash and first text line
  const TEXT_W      = W - PAD_X * 2;
  const TEXT_BOTTOM = H - BOTTOM_PAD;
  const TEXT_TOP    = PHOTO_TOP + Math.round(PHOTO_H * 0.58); // headline block never starts above this

  const LINE_H_RATIO         = 1.18;
  const FIT_MARGIN           = 0.98;
  const MIN_SIZE             = 20;
  const MAX_SIZE             = 64;
  const LETTER_SPACING_RATIO = 0.005;

  let rawLines;
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    rawLines = newsItem.titleLines.map((entry) => normalizeTitleLine(entry));
  } else {
    rawLines = [{ text: newsItem.title || "", color: null }];
  }

  const availH = TEXT_BOTTOM - TEXT_TOP - DASH_GAP - 6; // 6px ≈ dash height

  // Search for the largest uniform font size such that all wrapped
  // lines fit within the available height and width.
  let fittedLines = [];
  let usedSize    = MIN_SIZE;

  for (let size = MIN_SIZE; size <= MAX_SIZE; size += 1) {
    ctx.font = `900 ${size}px Malayalam`;
    setLetterSpacing(ctx, size * LETTER_SPACING_RATIO);

    const wrapped = [];
    for (const line of rawLines) {
      const segs = line.text ? wrapText(ctx, line.text, TEXT_W) : [];
      for (const seg of segs) wrapped.push({ text: seg, color: line.color });
    }
    const totalH = wrapped.length * size * LINE_H_RATIO;
    if (totalH > availH * FIT_MARGIN) break;
    usedSize    = size;
    fittedLines = wrapped;
  }

  const lineH       = Math.round(usedSize * LINE_H_RATIO);
  const totalTextH  = fittedLines.length * lineH;
  const blockBottom = TEXT_BOTTOM;
  const blockTop    = blockBottom - totalTextH;

  // Accent dash sits just above the text block.
  drawAccentDash(ctx, PAD_X, blockTop - DASH_GAP - 6);

  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor  = "rgba(0,0,0,0.6)";
  ctx.shadowBlur   = 10;

  let lineY = blockTop;
  for (const line of fittedLines) {
    ctx.save();
    ctx.font = `900 ${usedSize}px Malayalam`;
    setLetterSpacing(ctx, usedSize * LETTER_SPACING_RATIO);
    ctx.fillStyle = line.color || "#ffffff";
    // Baseline sits near the bottom of the line's box.
    ctx.fillText(line.text, PAD_X, lineY + lineH - Math.round(usedSize * 0.22));
    ctx.restore();
    lineY += lineH;
  }
  ctx.shadowBlur = 0;

  // ═════════════════════════════════════════════════════════
  // 3. Bottom-corner watermarks over the photo.
  // ═════════════════════════════════════════════════════════
  const wmText = newsItem.watermark || `${logoLine1} ${logoLine2}`;
  drawWatermark(ctx, wmText, PAD_X - 18, H - 26, { size: 19, align: "left", color: "rgba(255,255,255,0.75)" });
  drawWatermark(ctx, wmText, W - (PAD_X - 18), H - 26, { size: 19, align: "right", color: "rgba(255,255,255,0.75)" });

  // ── Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";
  setLetterSpacing(ctx, 0);

  // ── Ad strip ─────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
