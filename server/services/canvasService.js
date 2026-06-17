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
  const ffprobePath = require("ffprobe-static").path; // ← FIX: was missing entirely

  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    console.error("❌ ffmpeg binary missing:", ffmpegPath);
  }

  if (ffprobePath && fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(ffprobePath); // ← FIX: .screenshots() needs this to probe duration/metadata
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
// Place your fallback MP4 at: <project-root>/assets/ad_fallback.mp4
// Override via FALLBACK_VIDEO env var.
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

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
// toNodeBuffer — guarantee a real Node.js Buffer always.
// fetch().arrayBuffer() returns a native ArrayBuffer (NOT a Buffer)
// which crashes sharp / fs.writeFile / Instagram SDK.
// ─────────────────────────────────────────────────────────────
function toNodeBuffer(data) {
  if (Buffer.isBuffer(data))       return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data))    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError(`toNodeBuffer: unsupported type ${Object.prototype.toString.call(data)}`);
}

// Fetch a URL → guaranteed Node.js Buffer
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return toNodeBuffer(await res.arrayBuffer());
}

// Fetch a URL → JPEG Buffer (normalises WebP/PNG/AVIF, strips alpha)
async function fetchAsJpegBuffer(url) {
  const raw = await fetchBuffer(url);
  return toNodeBuffer(await sharp(raw).jpeg().toBuffer());
}

// canvas.toBuffer() → guaranteed Node.js Buffer
async function canvasToBuffer(canvas, mime = "image/png") {
  const result = canvas.toBuffer(mime);
  return Buffer.isBuffer(result) ? result : toNodeBuffer(await result);
}

// ═══════════════════════════════════════════════════════════════
// VIDEO FRAME EXTRACTION
// Extracts one frame from an MP4 file path and returns a JPEG Buffer.
// Returns null if ffmpeg is unavailable or extraction fails.
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

    // ── FIX: guard against zero-byte / unreadable files so ffprobe
    // doesn't hang or throw an uncaught error before .on("error") attaches.
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

    // ── FIX: safety timeout — if ffprobe/ffmpeg hangs (e.g. misconfigured
    // ffprobe path on a malformed file), don't block the whole poster render.
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
// AD STRIP
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

  // Text-only fallback
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
// MAIN POSTER DRAW
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Load ad image ──────────────────────────────────────────
  // Priority:
  //   A) adBannerUrl is an IMAGE  → fetch & decode directly
  //   B) adBannerUrl is a VIDEO   → download to temp, extract frame
  //   C) no banner at all         → extract frame from local ad_fallback.mp4
  //   D) everything fails         → text-only fallback strip
  const hasAdUrl  = Boolean(newsItem.adBannerUrl);
  const isVideoAd = newsItem.adResourceType === "video";
  let   adImg     = null;
  let   actualAdH = DEFAULT_AD_H;

  // ── When the ad is a real video URL, we skip drawing on canvas entirely.
  // The live video will be composited by videoService (FFmpeg vstack).
  // We still need actualAdH for canvas sizing; derive it from the video frame.
  let liveAdVideoUrl = null; // non-null → videoService must composite this

  if (hasAdUrl && !isVideoAd) {
    // ── A) Image banner ───────────────────────────────────────
    try {
      console.log("[Ad] Loading image banner:", newsItem.adBannerUrl);
      const jpegBuf = await fetchAsJpegBuffer(newsItem.adBannerUrl);
      adImg         = await loadImage(jpegBuf);
      actualAdH     = computeAdHeight(adImg);
      console.log(`[Ad] Image banner loaded: ${adImg.width}x${adImg.height}px, strip: ${actualAdH}px`);
    } catch (err) {
      console.error("[Ad] Image banner load failed:", err.message);
      // fall through to local video fallback below
    }
  }

  if (!adImg && hasAdUrl && isVideoAd) {
    // ── B) Video banner — will be composited live by videoService ─
    // Probe dimensions via a single frame so we can size the canvas correctly,
    // but do NOT draw the frame — the real video plays at the bottom instead.
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
      liveAdVideoUrl = newsItem.adBannerUrl; // signal to composite live video
    } catch (err) {
      console.error("[Ad] Video banner probe failed:", err.message);
      liveAdVideoUrl = newsItem.adBannerUrl; // still try compositing
    } finally {
      if (tmpVidPath) {
        try { fs.unlinkSync(tmpVidPath); } catch { /* ignore */ }
      }
    }
  }

  if (!adImg && !liveAdVideoUrl) {
    // ── C) Local ad_fallback.mp4 ──────────────────────────────
    // Also a video — composite live rather than drawing a still frame.
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
      liveAdVideoUrl = FALLBACK_VIDEO_PATH; // local path — videoService handles both URLs and paths
    } catch (err) {
      console.error("[Ad] Local fallback error:", err.message);
      actualAdH      = DEFAULT_AD_H;
      // liveAdVideoUrl stays null → text-only strip drawn on canvas
    }
  }

  // ── Canvas height ──────────────────────────────────────────
  // If a live video ad will be composited by videoService, we omit the ad
  // strip from the canvas (canvas = poster only = H tall).
  // If falling back to a static image/text strip, include it in the canvas.
  const canvasH = liveAdVideoUrl ? H : H + actualAdH;
  const totalH  = H + actualAdH; // reported for logging; actual video height
  console.log(`[Canvas] poster=${H}px  adStrip=${actualAdH}px  liveVideoAd=${!!liveAdVideoUrl}  canvasH=${canvasH}px`);

  const canvas = createCanvas(W, canvasH);
  const ctx    = canvas.getContext("2d");

  // ── 1. Background ─────────────────────────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 46% ────────────────────────────────────
  const IMG_H = Math.round(H * 0.46);

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W - dw) / 2;
    const dy    = (IMG_H - dh) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, IMG_H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    const fade = ctx.createLinearGradient(0, IMG_H * 0.52, 0, IMG_H);
    fade.addColorStop(0, "rgba(24,24,24,0)");
    fade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);
  } catch {
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#181818");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Logo — FLASH / KERALAM ─────────────────────────────
  const LOGO_CY  = IMG_H - 30;
  const FLASH_SZ = 64;
  const KER_SZ   = 20;

  ctx.save();
  ctx.textAlign     = "center";
  ctx.shadowColor   = "rgba(0,0,0,0.98)";
  ctx.shadowBlur    = 20;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.font          = `bold ${FLASH_SZ}px English`;
  ctx.fillStyle     = "#ffffff";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "5px";
  ctx.fillText("FLASH", W / 2, LOGO_CY);
  ctx.letterSpacing = "0px";

  ctx.font          = `bold ${KER_SZ}px English`;
  ctx.fillStyle     = "#dddddd";
  ctx.textBaseline  = "top";
  ctx.letterSpacing = "10px";
  ctx.fillText("KERALAM", W / 2 + 5, LOGO_CY + FLASH_SZ / 2 + 4);
  ctx.letterSpacing = "0px";

  ctx.restore();

  // ── 4. Date box — red 3D ──────────────────────────────────
  const now   = new Date();
  const day   = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year  = String(now.getFullYear());

  ctx.font = "bold 42px English";
  const dayW   = ctx.measureText(day).width;
  ctx.font = "bold 24px English";
  const monthW = ctx.measureText(month).width;
  ctx.font = "bold 19px English";
  const yearW  = ctx.measureText(year).width;

  const D_GAP   = 10;
  const MYW     = Math.max(monthW, yearW);
  const D_PADX  = 26;
  const BOX_H   = 70;
  const BOX_W   = dayW + D_GAP + MYW + D_PADX * 2;
  const BOX_RAD = 7;
  const BOX_X   = W / 2 - BOX_W / 2;
  const BOX_Y   = LOGO_CY + FLASH_SZ / 2 + KER_SZ + 14;

  ctx.save();
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.65;
  ctx.fillStyle   = "#5a0000";
  roundRect(ctx, BOX_X + 5, BOX_Y + 5, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  ctx.globalAlpha = 1;
  const redGrad = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H);
  redGrad.addColorStop(0,    "#ff2828");
  redGrad.addColorStop(0.18, "#dd0000");
  redGrad.addColorStop(0.80, "#bb0000");
  redGrad.addColorStop(1,    "#880000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  const sheen = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H * 0.45);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  const DAY_X = BOX_X + D_PADX;
  const MID_Y = BOX_Y + BOX_H / 2;

  ctx.font         = "bold 42px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(day, DAY_X, MID_Y);

  const MY_X = DAY_X + dayW + D_GAP;
  ctx.font         = "bold 24px English";
  ctx.textBaseline = "bottom";
  ctx.fillText(month, MY_X, MID_Y - 1);

  ctx.font         = "bold 19px English";
  ctx.fillStyle    = "#ffcccc";
  ctx.textBaseline = "top";
  ctx.fillText(year, MY_X, MID_Y + 1);

  ctx.restore();

  // ── 5. Malayalam title text ───────────────────────────────
  const PAD      = 52;
  const TEXT_TOP = BOX_Y + BOX_H + 4;
  const TEXT_BOT = H - 50;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

  let bodyInput = [];
  let lastInput = "";

  if (newsItem.lastLine) {
    lastInput = newsItem.lastLine;
    bodyInput = Array.isArray(newsItem.titleLines)
      ? newsItem.titleLines
      : [newsItem.title || ""];
  } else if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    lastInput = newsItem.titleLines[newsItem.titleLines.length - 1];
    bodyInput  = newsItem.titleLines.slice(0, -1);
  } else {
    const full     = newsItem.title || "";
    const spaceIdx = full.lastIndexOf(" ");
    if (spaceIdx > 0) {
      lastInput = full.slice(spaceIdx + 1);
      bodyInput = [full.slice(0, spaceIdx)];
    } else {
      lastInput = full;
      bodyInput = [];
    }
  }

  const LINE_H_RATIO = 1.18;
  let BODY_SIZE   = 82;
  let wrappedBody = [];

  while (BODY_SIZE >= 38) {
    ctx.font    = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBody = [];
    for (const seg of bodyInput) {
      if (seg) wrappedBody.push(...wrapText(ctx, seg, TEXT_W));
    }
    if (wrappedBody.length * BODY_SIZE * LINE_H_RATIO <= TEXT_H * 0.62) break;
    BODY_SIZE -= 2;
  }

  let LAST_SIZE   = Math.round(BODY_SIZE * 1.7);
  let wrappedLast = [];

  while (LAST_SIZE >= 60) {
    ctx.font    = `bold ${LAST_SIZE}px Malayalam`;
    wrappedLast = lastInput ? wrapText(ctx, lastInput, TEXT_W) : [];
    if (wrappedLast.length * LAST_SIZE * 1.10 <= TEXT_H * 0.42) break;
    LAST_SIZE -= 4;
  }

  const LINE_H_BODY = Math.round(BODY_SIZE * LINE_H_RATIO);
  const LINE_H_LAST = Math.round(LAST_SIZE * 1.10);
  const totalH2     = wrappedBody.length * LINE_H_BODY + wrappedLast.length * LINE_H_LAST;

  let drawY = TEXT_TOP + Math.round((TEXT_H - totalH2) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  const yellowIdx = wrappedBody.length - 1;

  for (let i = 0; i < wrappedBody.length; i++) {
    ctx.save();
    ctx.font          = `bold ${BODY_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.90)";
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    if (i === yellowIdx) {
      const yg = ctx.createLinearGradient(0, drawY, 0, drawY + BODY_SIZE);
      yg.addColorStop(0, "#ffe033");
      yg.addColorStop(1, "#ffaa00");
      ctx.fillStyle = yg;
    } else {
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillText(wrappedBody[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H_BODY;
  }

  for (const line of wrappedLast) {
    ctx.save();
    ctx.font          = `bold ${LAST_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(line, CX, drawY);
    ctx.restore();
    drawY += LINE_H_LAST;
  }

  // ── 6. Reset ──────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 7. Ad strip ───────────────────────────────────────────
  // Only draw a static strip when there's no live video to composite.
  // When liveAdVideoUrl is set, videoService will FFmpeg-stack the real
  // ad video below the poster — we leave the canvas as poster-only.
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  // ── 8. Return { type, buffer, liveAdVideoUrl, adH } ───────
  // type is always "image" — the PNG gets converted to MP4 by
  // videoService.convertImageToVideo() in the controllers.
  // When liveAdVideoUrl is non-null, videoService must composite the ad.
  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };