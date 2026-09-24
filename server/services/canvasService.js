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

const W            = 1080;
const H            = 1380;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand palette ──────────────────────────────────────────────
// primary: deep navy blue · headline: white · highlight: yellow
// accent: dark navy
const NAVY_TOP   = "#12204f";
const NAVY_MID   = "#0b1442";
const NAVY_DEEP  = "#050a24";
const GOLD_LIGHT = "#ffe033";
const GOLD_DARK  = "#ffb400";
const BAND_INK   = "#0b1442";   // dark navy text on the yellow bars

// ── Synthetic bold ────────────────────────────────────────────
// raghumalayalamsans-regular.ttf has no real Bold cut, so `bold`
// in ctx.font is silently ignored by @napi-rs/canvas and the text
// renders at regular weight. To get real visual weight we stroke
// the glyph outline before filling it, which fattens every stroke.
const MALAYALAM_BOLD_W = 0.055; // stroke width as a fraction of font size

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = fontSize * MALAYALAM_BOLD_W + extraWidth;
  ctx.save();
  ctx.lineJoin   = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth  = lineWidth;
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill (solid or gradient)
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

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
// AD STRIP
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
// TEXT MODEL
//
//   headline lines → white, centred. The LAST headline line is
//                    rendered noticeably larger (the payload line).
//   yellow bars     → dark-navy ink on ragged golden-yellow
//                     backgrounds, one bar per line, each sized to
//                     its own text (max "one or two compact bars").
//
//   DEFAULT: put every line — headline AND subheadline — in ONE
//   newsItem.titleLines array (or a single newsItem.title string;
//   auto-wrap handles it the same way). The split into headline vs.
//   yellow bars is computed against the ACTUAL WRAPPED LINE COUNT
//   after word-wrap, not against how many array items you passed
//   in — so this works whether you hand it one long string or many
//   short pre-broken lines.
//
//   Accepted input keys:
//     newsItem.titleLines      [] headline text (array or 1 string
//                                  via newsItem.title)
//     newsItem.title           "" same as titleLines with 1 item
//     newsItem.highlightLines  [] explicit yellow-bar lines — opts
//                                  OUT of the automatic split
//     newsItem.lastLine        "" single yellow-bar line (legacy key)
//     newsItem.bandLineCount   int → how many trailing WRAPPED
//                                  lines become yellow bars when no
//                                  explicit bars are given
//                                  (default 2; 0 disables it)
//     newsItem.quoted          bool → wraps headline in ' … ' (default true)
//     newsItem.yellowTailLines int → how many trailing HEADLINE
//                                  lines render in gold text color
//                                  instead of white (default 0)
// ═══════════════════════════════════════════════════════════════

function resolveCopy(newsItem) {
  let headInput = [];
  let bandInput = [];

  const explicitBands = Boolean(
    (Array.isArray(newsItem.highlightLines) && newsItem.highlightLines.length) ||
    newsItem.lastLine
  );

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

  return { headInput, bandInput, explicitBands };
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
//
// LAYOUT (top → bottom):
//   1. News photo, ~46% of the poster height, navy gradient fade
//      in its lower half so it blends into the background below.
//   2. Malayalam headline — white, centred, tight leading, last
//      line enlarged, wrapped in quote marks by default.
//   3. Yellow subheadline bar(s) — dark navy ink on gold.
//   4. Ad strip (unchanged pipeline), appended below the poster.
//   (No branding lockup and no footer — removed per request.)
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

  // ── 1. Deep navy gradient background ──────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0,    NAVY_TOP);
  bgGrad.addColorStop(0.5,  NAVY_MID);
  bgGrad.addColorStop(1,    NAVY_DEEP);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── 2. News photo — top ~46%, matching the reference exactly:
  //      the photo fades to navy only in its lower half and ends
  //      cleanly, with the branding lockup sitting just below it
  //      on the solid background — no overlap, no early dissolve ──
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

    // Subtle navy tint so the photo sits in the brand palette
    ctx.fillStyle = "rgba(8,16,52,0.22)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Fade photo → navy at the bottom, starting at the midpoint —
    // matches the reference's clean, single fade with no early
    // dissolve and no bleed past the photo's own bottom edge.
    const fade = ctx.createLinearGradient(0, IMG_H * 0.52, 0, IMG_H);
    fade.addColorStop(0, "rgba(6,13,44,0)");
    fade.addColorStop(1, "rgba(6,13,44,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    ctx.restore();

  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#1a2a60");
    fallback.addColorStop(1, NAVY_MID);
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Headline + yellow subheadline bars — vertically centred
  //      in the space between the photo and the bottom margin.
  //      (No branding lockup / date badge — removed per request.) ──
  const PAD       = 46;
  const TEXT_W    = W - PAD * 2;
  const BAND_PX   = 22;
  const BAND_W    = TEXT_W - BAND_PX * 2;
  const CX        = W / 2;

  const BOTTOM_MARGIN = 40;
  const TEXT_TOP  = IMG_H + 36;
  const TEXT_BOT  = H - BOTTOM_MARGIN;
  const TEXT_H    = TEXT_BOT - TEXT_TOP;

  const { headInput, bandInput, explicitBands } = resolveCopy(newsItem);

  const BAND_LINE_COUNT = Number.isInteger(newsItem.bandLineCount)
    ? Math.max(0, newsItem.bandLineCount)
    : 2;

  const HEAD_LH    = 1.08;
  const BIG_RATIO  = 1.34;
  const BAND_RATIO = 0.60;
  const BAND_LH    = 1.30;
  const BAND_GAP   = 8;
  const BLOCK_GAP  = 22;

  const YELLOW_TAIL = Number.isInteger(newsItem.yellowTailLines)
    ? Math.max(0, newsItem.yellowTailLines)
    : 0;

  let headSize  = 84;
  let bigSize   = 0;
  let bandSize  = 0;
  let headLines = [];
  let bandLines = [];

  const layout = () => {
    bigSize  = Math.round(headSize * BIG_RATIO);
    bandSize = Math.round(headSize * BAND_RATIO);

    let raw = [];
    ctx.font = `${headSize}px Malayalam`;
    for (const seg of headInput) raw.push(...wrapText(ctx, seg, TEXT_W));

    let headRaw = raw;
    let bandSourceText = null;

    if (!explicitBands && BAND_LINE_COUNT > 0 && raw.length > BAND_LINE_COUNT) {
      const bandRawLines = raw.slice(-BAND_LINE_COUNT);
      headRaw = raw.slice(0, -BAND_LINE_COUNT);
      bandSourceText = bandRawLines.join(" ");
    }

    ctx.font  = `${bandSize}px Malayalam`;
    bandLines = [];
    if (explicitBands) {
      for (const seg of bandInput) bandLines.push(...wrapText(ctx, seg, BAND_W));
    } else if (bandSourceText) {
      bandLines.push(...wrapText(ctx, bandSourceText, BAND_W));
    }

    headLines = [];
    if (headRaw.length) {
      const setup = headRaw.slice(0, -1);
      ctx.font = `${bigSize}px Malayalam`;
      const payload = wrapText(ctx, headRaw[headRaw.length - 1], TEXT_W);
      headLines = [
        ...setup.map((t) => ({ text: t, size: headSize, big: false })),
        ...payload.map((t) => ({ text: t, size: bigSize,  big: true  })),
      ];

      const yellowStart = Math.max(0, headLines.length - YELLOW_TAIL);
      headLines.forEach((l, i) => { l.yellow = i >= yellowStart; });
    }

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

  const quoted      = newsItem.quoted !== false;
  const lastHeadIdx = headLines.length - 1;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  headLines.forEach((line, i) => {
    let text = line.text;
    if (quoted && i === 0)           text = "'" + text;
    if (quoted && i === lastHeadIdx) text = text + "'";

    ctx.save();
    ctx.font = `${line.size}px Malayalam`;

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
    fillTextBold(ctx, text, CX, drawY, line.size);
    ctx.restore();

    drawY += Math.round(line.size * HEAD_LH);
  });

  if (bandLines.length) {
    drawY += BLOCK_GAP;
    const bandH = Math.round(bandSize * BAND_LH);

    ctx.font = `${bandSize}px Malayalam`;
    for (const line of bandLines) {
      const tw = ctx.measureText(line).width;
      const bw = Math.min(TEXT_W, tw + BAND_PX * 2);
      const bx = CX - bw / 2;

      ctx.save();
      ctx.shadowColor   = "rgba(0,0,0,0.45)";
      ctx.shadowBlur    = 14;
      ctx.shadowOffsetY = 4;

      const bandGrad = ctx.createLinearGradient(0, drawY, 0, drawY + bandH);
      bandGrad.addColorStop(0, GOLD_LIGHT);
      bandGrad.addColorStop(1, GOLD_DARK);
      ctx.fillStyle = bandGrad;
      roundRect(ctx, bx, drawY, bw, bandH, 6);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.font         = `${bandSize}px Malayalam`;
      ctx.fillStyle    = BAND_INK;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      fillTextBold(ctx, line, CX, drawY + bandH / 2 + 1, bandSize);
      ctx.restore();

      drawY += bandH + BAND_GAP;
    }
  }

  // ── 5. Reset ─────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 6. Ad strip ──────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
