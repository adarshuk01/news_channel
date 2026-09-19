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

const W            = 1080;
const H            = 1380;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Gold band palette (used by the headline block) ───────────
const GOLD_LIGHT = "#ffd83d";
const GOLD_DARK  = "#f0a90a";
const BAND_INK   = "#141414";   // dark text that sits on the gold bands

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
// AD STRIP  (ported from blue matrix design)
// ═══════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  // Base black background
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  // ── Real ad image supplied ────────────────────────────────
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

    // Gold top divider line
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
    lineGrad.addColorStop(0.2, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(0.8, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(1,   "rgba(255,180,0,0)");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, yOffset, W, 3);

    return;
  }

  // ── Fallback ad (no image) ────────────────────────────────

  // Dark gradient background
  const bg = ctx.createLinearGradient(0, yOffset, 0, yOffset + adH);
  bg.addColorStop(0, "#0d1b4b");
  bg.addColorStop(1, "#091230");
  ctx.fillStyle = bg;
  ctx.fillRect(0, yOffset, W, adH);

  // Gold top + bottom divider lines
  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
  lineGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  lineGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  lineGrad.addColorStop(1,   "rgba(255,180,0,0)");

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset, W, 3);

  // Subtle dot pattern
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

  // Megaphone emoji backdrop
  ctx.save();
  ctx.font         = "bold 52px English";
  ctx.fillStyle    = "rgba(255,200,60,0.22)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("📢", W / 2, yOffset + adH / 2 - 8);
  ctx.restore();

  // Malayalam fallback text
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

  // Gold bottom divider line
  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═══════════════════════════════════════════════════════════════
// TEXT MODEL
//
//   headline lines  → white, centred. The LAST line is rendered
//                     noticeably larger (the payload line).
//   highlight lines → dark ink on ragged golden-yellow bands.
//
//   Accepted input keys:
//     newsItem.titleLines      [] explicit headline lines
//     newsItem.title           "" auto-wrapped headline
//     newsItem.highlightLines  [] gold band lines
//     newsItem.lastLine        "" single gold band line (legacy key)
//     newsItem.quoted          bool → wraps headline in ' … '
// ═══════════════════════════════════════════════════════════════

function resolveCopy(newsItem) {
  let headInput = [];
  let bandInput = [];

  if (Array.isArray(newsItem.highlightLines) && newsItem.highlightLines.length) {
    bandInput = newsItem.highlightLines.filter(Boolean);
  } else if (newsItem.lastLine) {
    bandInput = [newsItem.lastLine];
  }

  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    headInput = newsItem.titleLines.filter(Boolean);
  } else if (newsItem.title) {
    headInput = [newsItem.title];
  }

  return { headInput, bandInput };
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
// (original photo / logo / red date-box layout; headline block
//  uses the stepped-size + gold-band typography)
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Load ad image / probe video ad (unchanged pipeline) ─────
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

  // ── 1. Dark charcoal background ──────────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 46% ───────────────────────────────────
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

    // Fade photo → dark at the bottom
    const fade = ctx.createLinearGradient(0, IMG_H * 0.52, 0, IMG_H);
    fade.addColorStop(0, "rgba(24,24,24,0)");
    fade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
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

  const logoLine1 = newsItem.logoLine1 || "FLASH";
  const logoLine2 = newsItem.logoLine2 || "KERALAM";

  ctx.save();
  ctx.textAlign    = "center";
  ctx.shadowColor  = "rgba(0,0,0,0.98)";
  ctx.shadowBlur   = 20;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.font          = `bold ${FLASH_SZ}px English`;
  ctx.fillStyle     = "#ffffff";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "5px";
  ctx.fillText(logoLine1, W / 2, LOGO_CY);
  ctx.letterSpacing = "0px";

  ctx.font          = `bold ${KER_SZ}px English`;
  ctx.fillStyle     = "#dddddd";
  ctx.textBaseline  = "top";
  ctx.letterSpacing = "10px";
  ctx.fillText(logoLine2, W / 2 + 5, LOGO_CY + FLASH_SZ / 2 + 4);
  ctx.letterSpacing = "0px";

  ctx.restore();

  // ── 4. Date box — red 3D ─────────────────────────────────
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

  const D_GAP  = 10;
  const MYW    = Math.max(monthW, yearW);
  const D_PADX = 26;
  const BOX_H  = 70;
  const BOX_W  = dayW + D_GAP + MYW + D_PADX * 2;
  const BOX_RAD = 7;
  const BOX_X  = W / 2 - BOX_W / 2;
  const BOX_Y  = LOGO_CY + FLASH_SZ / 2 + KER_SZ + 14;

  ctx.save();
  ctx.shadowBlur = 0;

  // Dark offset (3D thickness)
  ctx.globalAlpha = 0.65;
  ctx.fillStyle   = "#5a0000";
  roundRect(ctx, BOX_X + 5, BOX_Y + 5, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Main red face
  ctx.globalAlpha = 1;
  const redGrad = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H);
  redGrad.addColorStop(0,    "#ff2828");
  redGrad.addColorStop(0.18, "#dd0000");
  redGrad.addColorStop(0.80, "#bb0000");
  redGrad.addColorStop(1,    "#880000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Specular sheen
  const sheen = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H * 0.45);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Date text
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

  // ── 5. Malayalam title — stepped sizes, yellow tail lines,
  //      and gold highlight bands ────────────────────────────
  const PAD      = 46;
  const TEXT_W   = W - PAD * 2;
  const BAND_PX  = 22;                   // horizontal padding inside a gold band
  const BAND_W   = TEXT_W - BAND_PX * 2; // usable text width inside a band
  const TEXT_TOP = BOX_Y + BOX_H + 10;
  const TEXT_BOT = H - 50;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const CX       = W / 2;

  const { headInput, bandInput } = resolveCopy(newsItem);

  const HEAD_LH   = 1.06;  // headline lines set tight
  const BIG_RATIO = 1.34;  // final headline line vs the setup lines
  const BAND_RATIO = 0.62; // gold band type vs the setup lines
  const BAND_LH   = 1.30;  // gold band block height vs its type size
  const BAND_GAP  = 8;     // vertical gap between stacked gold bands
  const BLOCK_GAP = 22;    // gap between headline block and gold block

  // ── Color ratio add-on ─────────────────────────────────────
  // Independent of size: whatever the final wrapped line count is,
  // the last N lines always render in yellow, the rest stay white.
  // 5 lines → 3 white + 2 yellow, 4 lines → 2 + 2, 2 lines → 0 + 2, etc.
  // Override per-poster with newsItem.yellowTailLines (default 2).
  const YELLOW_TAIL = Number.isInteger(newsItem.yellowTailLines)
    ? Math.max(0, newsItem.yellowTailLines)
    : 2;

  let headSize  = 88;
  let bigSize   = 0;
  let bandSize  = 0;
  let headLines = [];
  let bandLines = [];

  const layout = () => {
    bigSize  = Math.round(headSize * BIG_RATIO);
    bandSize = Math.round(headSize * BAND_RATIO);

    // Explicit lines are respected; a bare title is auto-wrapped.
    let raw = [];
    ctx.font = `bold ${headSize}px Malayalam`;
    for (const seg of headInput) raw.push(...wrapText(ctx, seg, TEXT_W));

    // Last line is the payload — re-wrap it at the larger size.
    headLines = [];
    if (raw.length) {
      const setup = raw.slice(0, -1);
      ctx.font = `bold ${bigSize}px Malayalam`;
      const payload = wrapText(ctx, raw[raw.length - 1], TEXT_W);
      headLines = [
        ...setup.map((t) => ({ text: t, size: headSize, big: false })),
        ...payload.map((t) => ({ text: t, size: bigSize,  big: true  })),
      ];

      // Apply the color ratio against the FINAL wrapped line count.
      const yellowStart = Math.max(0, headLines.length - YELLOW_TAIL);
      headLines.forEach((l, i) => { l.yellow = i >= yellowStart; });
    }

    ctx.font  = `bold ${bandSize}px Malayalam`;
    bandLines = [];
    for (const seg of bandInput) bandLines.push(...wrapText(ctx, seg, BAND_W));

    const headH = headLines.reduce((a, l) => a + Math.round(l.size * HEAD_LH), 0);
    const bandH = bandLines.length
      ? bandLines.length * Math.round(bandSize * BAND_LH) +
        (bandLines.length - 1) * BAND_GAP + BLOCK_GAP
      : 0;

    return headH + bandH;
  };

  let totalH = layout();
  while (totalH > TEXT_H && headSize > 34) {
    headSize -= 2;
    totalH = layout();
  }

  let drawY = TEXT_TOP + Math.max(0, Math.round((TEXT_H - totalH) / 2));

  // Optional quote marks around the headline block
  const quoted      = Boolean(newsItem.quoted);
  const lastHeadIdx = headLines.length - 1;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  headLines.forEach((line, i) => {
    let text = line.text;
    if (quoted && i === 0)           text = "'" + text;
    if (quoted && i === lastHeadIdx) text = text + "'";

    ctx.save();
    ctx.font = `bold ${line.size}px Malayalam`;

    if (line.yellow) {
      const yg = ctx.createLinearGradient(0, drawY, 0, drawY + line.size);
      yg.addColorStop(0, GOLD_LIGHT);
      yg.addColorStop(1, GOLD_DARK);
      ctx.fillStyle = yg;
    } else {
      ctx.fillStyle = "#ffffff";
    }

    ctx.shadowColor   = "rgba(0,0,0,0.90)";
    ctx.shadowBlur    = line.big ? 20 : 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = line.big ? 4 : 2;
    ctx.fillText(text, CX, drawY);
    ctx.restore();

    drawY += Math.round(line.size * HEAD_LH);
  });

  // Gold bands — each hugs its own text width (ragged, not full-bleed)
  if (bandLines.length) {
    drawY += BLOCK_GAP;
    const bandH = Math.round(bandSize * BAND_LH);

    ctx.font = `bold ${bandSize}px Malayalam`;
    for (const line of bandLines) {
      const tw = ctx.measureText(line).width;
      const bw = Math.min(TEXT_W, tw + BAND_PX * 2);
      const bx = CX - bw / 2;

      ctx.save();
      ctx.shadowColor   = "rgba(0,0,0,0.55)";
      ctx.shadowBlur    = 14;
      ctx.shadowOffsetY = 4;

      const bandGrad = ctx.createLinearGradient(0, drawY, 0, drawY + bandH);
      bandGrad.addColorStop(0, GOLD_LIGHT);
      bandGrad.addColorStop(1, GOLD_DARK);
      ctx.fillStyle = bandGrad;
      roundRect(ctx, bx, drawY, bw, bandH, 5);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.font         = `bold ${bandSize}px Malayalam`;
      ctx.fillStyle    = BAND_INK;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(line, CX, drawY + bandH / 2 + 1);
      ctx.restore();

      drawY += bandH + BAND_GAP;
    }
  }

  // ── 6. Reset ─────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 7. Ad strip (only when a static image ad strip is drawn;
  //      live video ads are composited by the caller instead) ──
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
