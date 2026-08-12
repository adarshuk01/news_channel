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
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
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
// default layout below, which now paints its own dark photo-backed
// title panel instead) ───────────────────────────────────────────
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
// NEW POSTER LAYOUT HELPERS
// (matches the reference template: dark photo-backed title panel
// with multi-size gold headline + social row, then a full-width
// two-photo split, with a circular "compare" badge straddling the
// seam between the two zones)
// ═══════════════════════════════════════════════════════════════

// Small semi-transparent watermark text.
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

// Circular "compare" badge with a red/white ring, straddling the
// boundary between the title panel and the photo strip below it.
async function drawCircleBadge(ctx, badgeImg, cx, cy, radius) {
  const ringOuter = radius + 12;

  // drop shadow behind the ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.filter = "blur(6px)";
  ctx.fill();
  ctx.restore();

  // red outer ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
  ctx.fillStyle = "#e30613";
  ctx.fill();
  ctx.restore();

  // white gap ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // clipped photo
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

// Simple flat-icon Facebook glyph (blue circle + white "f") drawn
// entirely in canvas primitives — no external asset required.
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
  // vertical stroke of the "f"
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.06, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.06, cy + r * 0.55);
  ctx.stroke();
  // hook at top
  ctx.beginPath();
  ctx.arc(cx + r * 0.32, cy - r * 0.42, r * 0.28, Math.PI, Math.PI * 1.55, false);
  ctx.lineWidth = r * 0.28;
  ctx.stroke();
  // crossbar
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.28, cy - r * 0.02);
  ctx.lineTo(cx + r * 0.32, cy - r * 0.02);
  ctx.lineWidth = r * 0.26;
  ctx.stroke();
  ctx.restore();
}

// Simple flat-icon Instagram glyph (rounded gradient square + ring +
// dot) drawn entirely in canvas primitives.
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

// Draws the "f  📷  <label>" social-proof row.
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

// Default alternating emphasis: 1st, 3rd, 5th... lines (odd,
// 1-indexed) render bigger than the 2nd, 4th, 6th... lines — matches
// the reference poster's big/small/big/small headline rhythm.
const ODD_LINE_SIZE_MULT  = 1.25;
const EVEN_LINE_SIZE_MULT = 0.85;

// Normalizes a titleLines entry into { text, sizeMult, color }.
// `index` is the entry's position in the titleLines array (0-based)
// and drives the default odd/even size alternation. Accepts a plain
// string, or an object such as { text: "...", size: 1.3 } /
// { text: "...", emphasis: true } to override the default for that
// specific line.
function normalizeTitleLine(entry, index) {
  const defaultMult = index % 2 === 0 ? ODD_LINE_SIZE_MULT : EVEN_LINE_SIZE_MULT;

  if (typeof entry === "string") {
    return { text: entry, sizeMult: defaultMult, color: null };
  }
  const sizeMult = entry.size || (entry.emphasis != null
    ? (entry.emphasis ? 1.35 : 1)
    : defaultMult);
  return { text: entry.text || "", sizeMult, color: entry.color || null };
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
  // Load the main photo up front — it's used both as the dimmed
  // backdrop behind the headline AND as the single full-width
  // photo strip lower down.
  // ═════════════════════════════════════════════════════════
  let img1 = null;
  try { img1 = await loadImage(newsItem.image); }
  catch (e) { console.warn("[Poster] photo failed:", e.message); }

  // ═════════════════════════════════════════════════════════
  // 1. TITLE PANEL — top portion of the poster: a dimmed/darkened
  //    photo backdrop (cover-fit, blurred) with the bold gold
  //    headline on top, a faint diagonal watermark, and the
  //    social-proof row near the bottom of the panel.
  // ═════════════════════════════════════════════════════════
  const TITLE_H = Math.round(H * 0.46);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, TITLE_H);

  if (img1) {
    ctx.save();
    ctx.filter = "blur(18px)";
    drawCover(ctx, img1, -40, -40, W + 80, TITLE_H + 80);
    ctx.restore();
  }

  // dark scrim so the gold text stays readable over any photo
  const scrim = ctx.createLinearGradient(0, 0, 0, TITLE_H);
  scrim.addColorStop(0,   "rgba(0,0,0,0.72)");
  scrim.addColorStop(0.6, "rgba(0,0,0,0.58)");
  scrim.addColorStop(1,   "rgba(0,0,0,0.78)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, TITLE_H);

  // faint diagonal "watermark" text across the middle of the panel
  const wmText = newsItem.watermark || "FLASH KERALAM";
  drawWatermark(ctx, wmText, W / 2, TITLE_H * 0.42, {
    size: 22, color: "rgba(255,255,255,0.28)", align: "center", weight: "700",
  });

  // ═════════════════════════════════════════════════════════
  // 2. HEADLINE — multiple lines, each line individually sized
  //    (some lines rendered noticeably larger for emphasis, as
  //    in the reference poster) and auto-fit to the panel.
  // ═════════════════════════════════════════════════════════
  const PAD        = 44;
  const TEXT_TOP    = 58;
  const SOCIAL_ROW_H = 52;
  const TEXT_BOT    = TITLE_H - SOCIAL_ROW_H - 4;
  const TEXT_H      = TEXT_BOT - TEXT_TOP;
  const TEXT_W      = W - PAD * 2;
  const CX          = W / 2;

  let rawLines;
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    rawLines = newsItem.titleLines.map((entry, i) => normalizeTitleLine(entry, i));
  } else {
    rawLines = [normalizeTitleLine(newsItem.title || "", 0)];
  }

  const LINE_H_RATIO         = 1.06;
  const FIT_MARGIN           = 0.98;
  const MIN_BASE             = 20;
  const MAX_BASE             = 120;
  const LETTER_SPACING_RATIO = 0.02;

  // Search upward for the largest BASE size such that every line
  // (base * that line's own sizeMult, wrapped independently) still
  // fits inside TEXT_H — this is what produces the "some lines
  // bigger than others" look while keeping the whole block sized
  // to fill the available space.
  let BASE_SIZE = MIN_BASE;
  let fittedLines = []; // [{ text, size, color }]

  for (let base = MIN_BASE; base <= MAX_BASE; base += 1) {
    const wrapped = [];
    for (const line of rawLines) {
      const size = Math.round(base * line.sizeMult);
      ctx.font = `900 ${size}px Malayalam`;
      setLetterSpacing(ctx, size * LETTER_SPACING_RATIO);
      const segs = line.text ? wrapText(ctx, line.text, TEXT_W) : [];
      for (const seg of segs) {
        wrapped.push({ text: seg, size, color: line.color });
      }
    }
    const totalH = wrapped.reduce((sum, l) => sum + l.size * LINE_H_RATIO, 0);
    if (totalH > TEXT_H * FIT_MARGIN) break;
    BASE_SIZE   = base;
    fittedLines = wrapped;
  }

  const totalTextH = fittedLines.reduce((sum, l) => sum + l.size * LINE_H_RATIO, 0);
  let drawY = TEXT_TOP + Math.round((TEXT_H - totalTextH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  for (const line of fittedLines) {
    const lineH = Math.round(line.size * LINE_H_RATIO);
    ctx.save();
    ctx.font = `900 ${line.size}px Malayalam`;
    setLetterSpacing(ctx, line.size * LETTER_SPACING_RATIO);

    // gold gradient fill (bright yellow → amber), like the reference
    const goldGrad = ctx.createLinearGradient(0, drawY, 0, drawY + line.size);
    goldGrad.addColorStop(0, "#fff27a");
    goldGrad.addColorStop(1, "#ffc400");

    ctx.fillStyle     = line.color || goldGrad;
    ctx.shadowColor    = "rgba(0,0,0,0.85)";
    ctx.shadowBlur      = 8;
    ctx.shadowOffsetX  = 2;
    ctx.shadowOffsetY  = 2;

    // dark outline to punch the gold text off busy photo backdrops —
    // stroked twice (a heavier pass, then a slightly lighter one) to
    // fatten the letterforms further than the font's own weight
    // allows, giving a bolder, more solid headline look.
    ctx.lineJoin    = "round";
    ctx.strokeStyle = "rgba(20,14,0,0.95)";
    ctx.lineWidth   = Math.max(3, Math.round(line.size * 0.11));
    ctx.strokeText(line.text, CX, drawY + (lineH - line.size) / 2);
    ctx.lineWidth   = Math.max(2, Math.round(line.size * 0.07));
    ctx.strokeText(line.text, CX, drawY + (lineH - line.size) / 2);
    ctx.fillText(line.text, CX, drawY + (lineH - line.size) / 2);
    ctx.restore();

    drawY += lineH;
  }

  // ═════════════════════════════════════════════════════════
  // 3. SOCIAL ROW — Facebook + Instagram glyphs and the page
  //    name, sitting near the bottom of the title panel.
  // ═════════════════════════════════════════════════════════
  const socialLabel = newsItem.socialLabel || newsItem.watermark || "FLASH KERALAM";
  drawSocialRow(ctx, socialLabel, TITLE_H - SOCIAL_ROW_H / 2 - 6);

  // ═════════════════════════════════════════════════════════
  // 4. SINGLE PHOTO STRIP — full width, one cover-fit photo, no
  //    split and no circular badge overlapping it.
  // ═════════════════════════════════════════════════════════
  const PHOTO_TOP = TITLE_H;
  const PHOTO_H   = H - PHOTO_TOP;

  ctx.fillStyle = "#181818";
  ctx.fillRect(0, PHOTO_TOP, W, PHOTO_H);

  if (img1) drawCover(ctx, img1, 0, PHOTO_TOP, W, PHOTO_H);

  // Black-to-transparent gradient over the top of the photo strip so
  // the transition from the blurred/darkened title panel above into
  // the sharp photo below reads as one continuous fade, not a cut.
  const SEAM_FADE_H = Math.round(PHOTO_H * 0.22);
  const seamFade = ctx.createLinearGradient(0, PHOTO_TOP, 0, PHOTO_TOP + SEAM_FADE_H);
  seamFade.addColorStop(0,   "rgba(0,0,0,0.85)");
  seamFade.addColorStop(0.5, "rgba(0,0,0,0.35)");
  seamFade.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = seamFade;
  ctx.fillRect(0, PHOTO_TOP, W, SEAM_FADE_H);

  // ═════════════════════════════════════════════════════════
  // 5. Bottom-corner watermarks over the photo strip.
  // ═════════════════════════════════════════════════════════
  drawWatermark(ctx, wmText, 28, H - 26, { size: 19, align: "left", color: "rgba(255,255,255,0.75)" });
  drawWatermark(ctx, wmText, W - 28, H - 26, { size: 19, align: "right", color: "rgba(255,255,255,0.75)" });

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
