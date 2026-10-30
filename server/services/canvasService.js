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

// Malayalam first, English as fallback (so "SFI" etc. always render)
const HEAD_FONT = "Malayalam, English";

// ── Asset video path ─────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

const W            = 1080;
const H            = 1350;          // 4:5 poster, same ratio as the reference
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand palette: dark teal + yellow + cyan ─────────────────
const GOLD_LIGHT    = "#ffe033";    // headline gradient (from your code)
const GOLD_DARK     = "#ffb400";
const FRAME_YELLOW  = "#ffe21a";    // frame border
const CYAN          = "#22dcee";    // separator line
const BG_TOP        = "#0f524f";
const BG_BOTTOM     = "#083a39";
const INNER_TOP     = "#0b4846";
const INNER_BOTTOM  = "#094040";

// Default brand text shown top-right (used when no logo image is given)
const DEFAULT_CHANNEL = "flash keralam";

// ── Layout (all measured from the reference poster) ──────────
const FRAME_X  = 30;
const FRAME_Y  = 90;
const FRAME_W  = W - FRAME_X * 2;
const FRAME_H  = 1311 - FRAME_Y;          // frame bottom ≈ y 1311
const FRAME_R  = 84;                      // corner radius
const BORDER   = 10;                      // yellow border thickness

const SEP_Y    = Math.round(H * 0.533);   // cyan line, photo fades out here
const SEP_X1   = Math.round(W * 0.315);
const SEP_X2   = Math.round(W * 0.685);

// ── Synthetic bold ────────────────────────────────────────────
// The Malayalam font has no real heavier cut, so we stroke the glyph
// outline before filling it, which fattens every stroke.
const MALAYALAM_BOLD_W = 0.055; // stroke width as a fraction of font size

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = fontSize * MALAYALAM_BOLD_W + extraWidth;
  ctx.save();
  ctx.lineJoin    = "round";
  ctx.miterLimit  = 2;
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill (solid or gradient)
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
// BACKGROUND — dark teal, slightly darker towards the corners
// ═══════════════════════════════════════════════════════════════

function drawBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // soft vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ═══════════════════════════════════════════════════════════════
// BRAND MARK (top-right, above the frame)
//   - newsItem.logoUrl  → image, drawn right-aligned
//   - otherwise         → italic text (newsItem.channelName)
// ═══════════════════════════════════════════════════════════════

const BRAND_RIGHT = W - 62;
const BRAND_CY    = 38;

function drawBrandLogo(ctx, logoImg) {
  const targetH = 62;
  const scale   = targetH / logoImg.height;
  const w       = logoImg.width * scale;
  ctx.drawImage(logoImg, BRAND_RIGHT - w, BRAND_CY - targetH / 2, w, targetH);
}

function drawBrandText(ctx, name) {
  const MAX_W = 340;
  let size = 46;
  ctx.font = `bold ${size}px English`;
  while (ctx.measureText(name).width > MAX_W && size > 20) {
    size -= 2;
    ctx.font = `bold ${size}px English`;
  }

  ctx.save();
  ctx.translate(BRAND_RIGHT, BRAND_CY);
  ctx.transform(1, 0, -0.22, 1, 0, 0);       // italic slant
  ctx.font         = `bold ${size}px English`;
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.55)";
  ctx.shadowBlur   = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle    = "#ffffff";
  ctx.fillText(name, 0, 0);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HEADLINE MODEL
//
//   Every line is centred, flat colour (no shadow), as in the reference:
//     YELLOW lines  → scale 1.00
//     WHITE  lines  → scale 1.12 (slightly larger than the yellow)
//
//   AUTO MODE (default) — newsItem.title (or titleLines of plain strings)
//     Split into a yellow part and a white part at the first:
//         "|"      (symbol is dropped), or
//         "," / ";" (symbol stays with the yellow part)
//     No split symbol → the whole headline is yellow.
//     newsItem.autoSplit = false → whole headline yellow.
//
//   MANUAL MODE — newsItem.titleLines as objects, one per block:
//       { text: "കല്ലുകൾക്കിടയിൽ വീണ ഇയർബഡ് എത്ര നോക്കിയിട്ടും കിട്ടിയില്ല", yellow: true  },
//       { text: "ഫോട്ടോ അപ്‌ലോഡ് ചെയ്ത് 5 മിനിറ്റിനുള്ളിൽ കണ്ടെത്തി ചാറ്റ്ജിപിടി", yellow: false }
//     yellow defaults to true; scale optional (default 1.0 / 1.12).
//     Each block is auto-wrapped and balanced.
//
//   Other options:
//     newsItem.channelName  ""    brand text top-right (default "flash keralam")
//     newsItem.logoUrl      ""    brand logo image (overrides the text)
//     newsItem.showChannel  bool  show brand (default true)
//     newsItem.quoted       bool  wrap headline in ' … ' (default false)
// ═══════════════════════════════════════════════════════════════

const YELLOW_SCALE = 1.0;
const WHITE_SCALE  = 1.12;

function splitHeadline(text) {
  const bar = text.indexOf("|");
  if (bar > 0) {
    return [text.slice(0, bar).trim(), text.slice(bar + 1).trim()];
  }
  const m = /[,;，；،]/.exec(text);
  if (!m) return null;
  const cut  = m.index + 1;
  const head = text.slice(0, cut).trim();
  const tail = text.slice(cut).trim();
  return head ? [head, tail] : null;
}

// Returns blocks: { text, yellow, scale }
function resolveHeadline(newsItem) {
  let src = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    src = [...newsItem.titleLines];
  } else if (newsItem.title) {
    src = [newsItem.title];
  }
  src = src.filter(Boolean);

  let segs = [];
  const allPlain = src.length > 0 && src.every((s) => typeof s === "string");

  if (allPlain) {
    const full  = src.join(" ").replace(/\s+/g, " ").trim();
    const parts = newsItem.autoSplit !== false ? splitHeadline(full) : null;
    if (parts) {
      segs.push({ text: parts[0], yellow: true, scale: YELLOW_SCALE });
      if (parts[1]) segs.push({ text: parts[1], yellow: false, scale: WHITE_SCALE });
    } else {
      segs.push({ text: full, yellow: true, scale: YELLOW_SCALE });
    }
  } else {
    segs = src.map((s) => {
      if (typeof s === "string") return { text: s, yellow: true, scale: YELLOW_SCALE };
      const yellow = s.yellow !== false;
      return {
        text:   s.text,
        yellow,
        scale:  typeof s.scale === "number" ? s.scale : (yellow ? YELLOW_SCALE : WHITE_SCALE),
      };
    });
  }

  // Legacy keys: extra yellow lines
  if (Array.isArray(newsItem.highlightLines)) {
    for (const t of newsItem.highlightLines) {
      if (t) segs.push({ text: t, yellow: true, scale: YELLOW_SCALE });
    }
  }
  if (newsItem.lastLine) {
    segs.push({ text: newsItem.lastLine, yellow: true, scale: YELLOW_SCALE });
  }

  return segs.filter((s) => s.text);
}

// ── Word wrapping ────────────────────────────────────────────
function wrapWords(ctx, words, maxW) {
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (cur && ctx.measureText(test).width > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Same number of lines as greedy wrapping, but with the lines evened out
// (ctx.font must already be set).
function wrapBalanced(ctx, text, maxW) {
  const words  = text.split(" ").filter(Boolean);
  const greedy = wrapWords(ctx, words, maxW);
  const n      = greedy.length;
  if (n <= 1) return greedy;

  let lo = 0;
  let hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapWords(ctx, words, mid).length <= n) hi = mid;
    else lo = mid;
  }
  return wrapWords(ctx, words, hi);
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
//
// LAYOUT (top → bottom):
//   1. Dark teal background, brand mark top-right
//   2. Rounded frame with yellow border
//        - news photo at the top, fading into the teal
//        - short cyan separator line
//        - headline: yellow lines, then (larger) white lines
//   3. Ad strip (unchanged pipeline), appended below the poster
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

  // ── 1. Background ───────────────────────────────────────────
  drawBackground(ctx);

  // ── 2. Frame interior: teal fill + news photo (clipped to the frame) ──
  const PHOTO_H = SEP_Y - FRAME_Y;

  ctx.save();
  roundRect(ctx, FRAME_X, FRAME_Y, FRAME_W, FRAME_H, FRAME_R);
  ctx.clip();

  const inner = ctx.createLinearGradient(0, FRAME_Y, 0, FRAME_Y + FRAME_H);
  inner.addColorStop(0, INNER_TOP);
  inner.addColorStop(1, INNER_BOTTOM);
  ctx.fillStyle = inner;
  ctx.fillRect(FRAME_X, FRAME_Y, FRAME_W, FRAME_H);

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(FRAME_W / img.width, PHOTO_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (FRAME_W - dw) / 2;
    const dy    = (PHOTO_H - dh) / 2;

    const layer = createCanvas(FRAME_W, PHOTO_H);
    const lctx  = layer.getContext("2d");
    lctx.drawImage(img, dx, dy, dw, dh);

    // Bottom of the photo melts into the teal
    lctx.globalCompositeOperation = "destination-in";
    const mask = lctx.createLinearGradient(0, 0, 0, PHOTO_H);
    mask.addColorStop(0,    "rgba(0,0,0,1)");
    mask.addColorStop(0.66, "rgba(0,0,0,1)");
    mask.addColorStop(0.90, "rgba(0,0,0,0.25)");
    mask.addColorStop(1,    "rgba(0,0,0,0)");
    lctx.fillStyle = mask;
    lctx.fillRect(0, 0, FRAME_W, PHOTO_H);

    ctx.drawImage(layer, FRAME_X, FRAME_Y);
  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }
  ctx.restore();

  // ── 3. Cyan separator line ──────────────────────────────────
  ctx.save();
  ctx.shadowColor = "rgba(34,220,238,0.7)";
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = CYAN;
  ctx.fillRect(SEP_X1, SEP_Y - 1.5, SEP_X2 - SEP_X1, 3);
  ctx.restore();

  // ── 4. Yellow frame border ──────────────────────────────────
  ctx.save();
  roundRect(
    ctx,
    FRAME_X + BORDER / 2,
    FRAME_Y + BORDER / 2,
    FRAME_W - BORDER,
    FRAME_H - BORDER,
    FRAME_R
  );
  ctx.lineWidth   = BORDER;
  ctx.strokeStyle = FRAME_YELLOW;
  ctx.lineJoin    = "round";
  ctx.stroke();
  ctx.restore();

  // ── 5. Brand mark (top-right) ───────────────────────────────
  if (newsItem.showChannel !== false) {
    let logoImg = null;
    if (newsItem.logoUrl) {
      try {
        logoImg = await loadImage(await fetchBuffer(newsItem.logoUrl));
      } catch (e) {
        console.warn("[Poster] logo failed:", e.message);
      }
    }
    if (logoImg) drawBrandLogo(ctx, logoImg);
    else         drawBrandText(ctx, newsItem.channelName || DEFAULT_CHANNEL);
  }

  // ── 6. Headline ─────────────────────────────────────────────
  const PAD      = 64;                 // kept clear of the frame border
  const TEXT_W   = W - PAD * 2;
  const TEXT_TOP = SEP_Y + 32;
  const TEXT_BOT = FRAME_Y + FRAME_H - 34;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const CX       = W / 2;

  const HEAD_LH   = 1.10;   // line-height multiplier (same as your code)
  const GROUP_GAP = 8;      // extra space between yellow and white blocks

  const segs = resolveHeadline(newsItem);

  const layout = (base) => {
    const lines = [];
    for (const seg of segs) {
      const size = Math.round(base * seg.scale);
      ctx.font   = `${size}px ${HEAD_FONT}`;
      const wrapped = wrapBalanced(ctx, seg.text, TEXT_W);
      for (const t of wrapped) {
        lines.push({ text: t, yellow: seg.yellow, size });
      }
    }
    let h = 0;
    lines.forEach((l, i) => {
      h += Math.round(l.size * HEAD_LH);
      if (i > 0 && lines[i - 1].yellow !== l.yellow) h += GROUP_GAP;
    });
    return { lines, h };
  };

  let base = 80;                       // headSize from your code
  let res  = layout(base);
  while (res.h > TEXT_H && base > 34) {
    base -= 2;
    res = layout(base);
  }

  const headLines = res.lines;
  let drawY = TEXT_TOP + Math.max(0, Math.round((TEXT_H - res.h) / 2)) - 8;

  const quoted      = newsItem.quoted === true;
  const lastHeadIdx = headLines.length - 1;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  headLines.forEach((line, i) => {
    if (i > 0 && headLines[i - 1].yellow !== line.yellow) drawY += GROUP_GAP;

    let text = line.text;
    if (quoted && i === 0)           text = "'" + text;
    if (quoted && i === lastHeadIdx) text = text + "'";

    const lineH = Math.round(line.size * HEAD_LH);

    ctx.save();
    ctx.font = `${line.size}px ${HEAD_FONT}`;

    if (line.yellow) {
      const yg = ctx.createLinearGradient(0, drawY, 0, drawY + line.size);
      yg.addColorStop(0, GOLD_LIGHT);
      yg.addColorStop(1, GOLD_DARK);
      ctx.fillStyle = yg;
    } else {
      ctx.fillStyle = "#ffffff";
    }

    ctx.shadowColor   = "rgba(0,0,0,0.90)";
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    fillTextBold(ctx, text, CX, drawY, line.size);
    ctx.restore();

    drawY += lineH;
  });

  // ── 7. Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 8. Ad strip ─────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
