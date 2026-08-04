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
  path.join(__dirname, "../fonts/RIT-tnjoy-extrabold.ttf"),
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

// ── Blue-grid panel background asset (the textured background that
// sits behind the title text) ───────────────────────────────────
// Resolution order:
//   1. PANEL_BG_IMAGE env var, if set
//   2. <this-file's-dir>/../assets/blue_panel_bg.png
//   3. <process cwd>/assets/blue_panel_bg.png
//   4. <process cwd>/server/assets/blue_panel_bg.png
function resolvePanelBgPath() {
  const candidates = [
    process.env.PANEL_BG_IMAGE,
    "C:\\Users\\adars\\Downloads\\news_channel-main\\news_channel-main\\server\\assets\\blue_panel_bg.png", // confirmed-working absolute path
    path.join(__dirname, "assets/blue_panel_bg.png"),
    path.join(__dirname, "../assets/blue_panel_bg.png"),
    path.join(process.cwd(), "assets/blue_panel_bg.png"),
    path.join(process.cwd(), "server/assets/blue_panel_bg.png"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    console.log("[Panel] checking background asset at:", candidate);
    if (fs.existsSync(candidate)) {
      console.log("[Panel] found background asset at:", candidate);
      return candidate;
    }
  }
  console.warn(
    "[Panel] blue_panel_bg.png not found in any candidate location — " +
    "falling back to a flat gradient. Checked:", candidates
  );
  return null;
}

// NOTE: intentionally does NOT cache a failed (null) result — if the
// file wasn't there on the first render but shows up later without a
// server restart, the next poster render will pick it up.
let _panelBgImageCache = null; // caches a SUCCESSFUL load only
async function loadPanelBgImage() {
  if (_panelBgImageCache) return _panelBgImageCache;

  const resolvedPath = resolvePanelBgPath();
  if (!resolvedPath) return null;

  try {
    const rawBuf   = fs.readFileSync(resolvedPath);
    // Re-encode through sharp first — avoids @napi-rs/canvas's format
    // auto-detection misfiring on files that don't cleanly match its
    // expected PNG signature (seen as a spurious "Invalid SVG image" error).
    const cleanBuf = await sharp(rawBuf).png().toBuffer();
    const img      = await loadImage(cleanBuf);
    console.log(`[Panel] background asset loaded: ${img.width}x${img.height}px`);
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
// NEW POSTER LAYOUT HELPERS (matches the reference template:
// single photo + circular badge + blue title panel)
// ═══════════════════════════════════════════════════════════════

// Small semi-transparent watermark text, used in the corners and
// faintly over the photo area.
function drawWatermark(ctx, text, x, y, opts = {}) {
  const {
    size    = 20,
    color   = "rgba(255,255,255,0.65)",
    align   = "left",
    angle   = 0,
    weight  = "600",
  } = opts;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.font         = `${weight} ${size}px English`;
  ctx.fillStyle    = color;
  ctx.textAlign    = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Circular "shock" badge (e.g. the roach photo) with a red/white ring,
// overlapping the bottom edge of the photo.
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
  // 1. SINGLE PHOTO — top 50% of the poster, one full-width
  //    cover-fit image.
  // ═════════════════════════════════════════════════════════
  const IMG_H = Math.round(H * 0.5);

  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, IMG_H);

  try {
    const img1 = await loadImage(newsItem.image);
    drawCover(ctx, img1, 0, 0, W, IMG_H);
  } catch (e) {
    console.warn("[Poster] photo failed:", e.message);
  }

  // ═════════════════════════════════════════════════════════
  // 2. Blue-grid panel — uses the cropped background image asset,
  //    stretched to cover the area below the photo.
  // ═════════════════════════════════════════════════════════
  const PANEL_FALLBACK_COLOR = "#0d2a6e";
  const PANEL_TOP_PADDING    = 28; // px of breathing room under the photo

  const panelBgImg = await loadPanelBgImage();

  ctx.fillStyle = PANEL_FALLBACK_COLOR;
  ctx.fillRect(0, IMG_H, W, PANEL_TOP_PADDING);

  if (panelBgImg) {
    drawCover(
      ctx,
      panelBgImg,
      0,
      IMG_H + PANEL_TOP_PADDING,
      W,
      H - IMG_H - PANEL_TOP_PADDING
    );
  } else {
    const panelGrad = ctx.createLinearGradient(0, IMG_H + PANEL_TOP_PADDING, 0, H);
    panelGrad.addColorStop(0, PANEL_FALLBACK_COLOR);
    panelGrad.addColorStop(1, "#081022");
    ctx.fillStyle = panelGrad;
    ctx.fillRect(0, IMG_H + PANEL_TOP_PADDING, W, H - IMG_H - PANEL_TOP_PADDING);
  }

  // ═════════════════════════════════════════════════════════
  // 4. Circular badge photo, overlapping the bottom edge of the photo
  // ═════════════════════════════════════════════════════════
  const BADGE_RADIUS = Math.round(W * 0.095);
  const BADGE_CX = Math.round(W * 0.53);
  const BADGE_CY = Math.round(IMG_H * 0.08);

  if (newsItem.badgeImage) {
    try {
      const badgeImg = await loadImage(newsItem.badgeImage);
      await drawCircleBadge(ctx, badgeImg, BADGE_CX, BADGE_CY, BADGE_RADIUS);
    } catch (e) {
      console.warn("[Poster] badge image failed:", e.message);
    }
  }

  // faint watermark over the photo area (bottom-left of the photo band)
  drawWatermark(
    ctx,
    newsItem.watermark || "FLASH KERALAM",
    W * 0.18,
    IMG_H * 0.84,
    { size: 18, color: "rgba(255,255,255,0.35)", align: "left" }
  );

  // ═════════════════════════════════════════════════════════
  // 5. Main white title text, centered in the blue panel.
  //
  //    UPDATED: odd lines (1st, 3rd, 5th...) are rendered BIGGER
  //    than even lines (2nd, 4th, 6th...). EVEN_LINE_SIZE_RATIO
  //    controls how much smaller the even lines are relative to
  //    the fitted base size — tweak this single constant to
  //    change the size difference.
  // ═════════════════════════════════════════════════════════
  const PAD      = 52;
  const TEXT_TOP = IMG_H + PANEL_TOP_PADDING + 24;
  const TEXT_BOT = H - 50;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

  let titleLines;
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    titleLines = newsItem.titleLines;
  } else {
    titleLines = [newsItem.title || ""];
  }

  // Search UPWARD from small to large, keeping the largest size that
  // still fits the panel — a fixed starting cap would lock in that
  // size whenever the text is short, instead of growing to fill the
  // space and center properly.
  const LINE_H_RATIO = 0.85;
  const FIT_MARGIN   = 0.98; // use nearly all of the available height
  const MIN_SIZE     = 28;
  const MAX_SIZE     = 220;

  // Odd lines (index 0, 2, 4... i.e. 1st, 3rd, 5th...) use the full
  // fitted size. Even lines (index 1, 3, 5... i.e. 2nd, 4th, 6th...)
  // use this fraction of that size instead.
  const EVEN_LINE_SIZE_RATIO = 0.72;

  // Extra gap inserted between letters (tracking), applied via the
  // canvas's native letterSpacing so Malayalam conjuncts/vowel signs
  // still shape correctly — scales with font size.
  const LETTER_SPACING_RATIO = 0.06;

  // Helper: font size for a given wrapped-line index (0-based).
  const sizeForLine = (baseSize, idx) =>
    idx % 2 === 0 ? baseSize : Math.round(baseSize * EVEN_LINE_SIZE_RATIO);

  let TITLE_SIZE   = MIN_SIZE;
  let wrappedTitle = []; // array of line strings

  // Wrapping still measures using the (larger) odd-line size for each
  // segment — this is the conservative choice so lines never overflow
  // TEXT_W even though even lines end up a bit smaller/narrower.
  //
  // IMPORTANT: the row-to-row rhythm (LINE_H) is UNIFORM — always based
  // on the base/odd size — regardless of whether a given line is big or
  // small. That's what keeps the gap between every pair of lines equal;
  // only the glyphs drawn inside each equal-height row change size.
  for (let size = MIN_SIZE; size <= MAX_SIZE; size += 2) {
    ctx.font = `900 ${size}px Malayalam`;
    setLetterSpacing(ctx, size * LETTER_SPACING_RATIO);
    const wrapped = [];
    for (const seg of titleLines) {
      if (seg) wrapped.push(...wrapText(ctx, seg, TEXT_W));
    }

    const totalH = wrapped.length * size * LINE_H_RATIO;

    const fits = totalH <= TEXT_H * FIT_MARGIN;
    if (!fits) break; // sizes only get worse from here — stop searching
    TITLE_SIZE   = size;
    wrappedTitle = wrapped;
  }

  // Uniform row height for every line, based on the base (odd-line) size.
  const LINE_H     = Math.round(TITLE_SIZE * LINE_H_RATIO);
  const totalTextH = wrappedTitle.length * LINE_H;
  let rowTop = TEXT_TOP + Math.round((TEXT_H - totalTextH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle"; // center each line's glyphs within its equal-height row

  wrappedTitle.forEach((line, i) => {
    const lineSize = sizeForLine(TITLE_SIZE, i);
    const rowCenterY = rowTop + LINE_H / 2;
    ctx.save();
    ctx.font          = `900 ${lineSize}px Malayalam`;
    setLetterSpacing(ctx, lineSize * LETTER_SPACING_RATIO);
    // Last 2 lines render in accent gold; all lines above that stay white.
    const isAccentLine = i >= wrappedTitle.length - 2;
    ctx.fillStyle     = isAccentLine ? "#ffde59" : "#ffffff";
    ctx.strokeStyle   = isAccentLine ? "#ffde59" : "#ffffff";
    ctx.shadowColor   = "rgba(0,0,0,0.6)";
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    // Stroke first, then fill — this fattens the letterforms beyond
    // what the loaded ttf's own "bold" weight provides, since
    // @napi-rs/canvas can only render the weight(s) actually baked
    // into the font file itself. Stroke width scales with each
    // line's own size so smaller (even) lines don't look over-stroked.
    ctx.lineWidth   = Math.max(2, Math.round(lineSize * 0.045));
    ctx.lineJoin    = "round";
    // Whole-string draw (not per-character) so the font shapes
    // Malayalam conjuncts/vowel signs correctly; letterSpacing above
    // adds the gap after shaping.
    ctx.strokeText(line, CX, rowCenterY);
    ctx.fillText(line, CX, rowCenterY);
    ctx.restore();
    rowTop += LINE_H;
  });

  // ═════════════════════════════════════════════════════════
  // 7. Bottom-corner watermarks
  // ═════════════════════════════════════════════════════════
  const wmText = newsItem.watermark || "FLASH KERALAM";
  drawWatermark(ctx, wmText, 28, H - 26, { size: 19, align: "left" });
  drawWatermark(ctx, wmText, W - 28, H - 26, { size: 19, align: "right" });

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
