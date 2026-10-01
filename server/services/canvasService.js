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
const H            = 1380;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand palette (new design: dark / black + gold-yellow) ─────
const BG_TOP     = "#1c0a07";
const BG_MID     = "#0c0504";
const BG_DEEP    = "#060202";
const GOLD_LIGHT = "#ffe033";
const GOLD_DARK  = "#ffb400";
const FADE_RGB   = "8,4,3";            // colour the photo fades into

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
// BACKGROUND — near-black with warm orange sun-flare, top right
// ═══════════════════════════════════════════════════════════════

function drawBackground(ctx) {
  // Base: dark red-brown at the top fading to near-black
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0,    BG_TOP);
  base.addColorStop(0.38, BG_MID);
  base.addColorStop(1,    BG_DEEP);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Big warm glow from the top-right corner
  const glow = ctx.createRadialGradient(W * 0.97, -10, 10, W * 0.97, -10, W * 0.85);
  glow.addColorStop(0,    "rgba(255,150,40,0.80)");
  glow.addColorStop(0.35, "rgba(220,100,25,0.38)");
  glow.addColorStop(1,    "rgba(120,40,10,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Light rays fanning out from the corner
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle   = "#ffcf80";
  const ox = W * 0.97, oy = -10;
  const rays = [
    [-2.55, -2.45], [-2.30, -2.22], [-2.05, -1.97], [-1.82, -1.76],
  ];
  for (const [a1, a2] of rays) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a1) * 1500, oy - Math.sin(a1) * 1500);
    ctx.lineTo(ox + Math.cos(a2) * 1500, oy - Math.sin(a2) * 1500);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Hot white core of the flare
  const core = ctx.createRadialGradient(W * 0.97, 0, 0, W * 0.97, 0, 150);
  core.addColorStop(0,   "rgba(255,240,200,0.95)");
  core.addColorStop(0.4, "rgba(255,190,90,0.40)");
  core.addColorStop(1,   "rgba(255,150,40,0)");
  ctx.fillStyle = core;
  ctx.fillRect(W - 320, 0, 320, 320);

  // Soft ember glow behind the lower headline / photo seam
  const ember = ctx.createRadialGradient(W * 0.5, H * 0.46, 20, W * 0.5, H * 0.46, W * 0.65);
  ember.addColorStop(0, "rgba(200,85,20,0.30)");
  ember.addColorStop(1, "rgba(200,85,20,0)");
  ctx.fillStyle = ember;
  ctx.fillRect(0, H * 0.25, W, H * 0.45);
}

// ═══════════════════════════════════════════════════════════════
// "READ CAPTION" PILL (bottom centre)
// ═══════════════════════════════════════════════════════════════

function drawCaptionPill(ctx, label) {
  const PILL_H   = 72;
  const PAD_X    = 32;
  const cy       = Math.round(H * 0.9335);
  const maxTextW = W * 0.36 - PAD_X * 2;

  ctx.font = "bold 100px English";
  const natW  = ctx.measureText(label).width;
  const size  = Math.min(36, Math.floor((100 * maxTextW) / natW));
  ctx.font    = `bold ${size}px English`;
  const textW = ctx.measureText(label).width;

  const pw = Math.round(textW + PAD_X * 2);
  const px = Math.round((W - pw) / 2);
  const py = cy - PILL_H / 2;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.55)";
  ctx.shadowBlur    = 18;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle     = "#ffffff";
  roundRect(ctx, px, py, pw, PILL_H, PILL_H / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font         = `bold ${size}px English`;
  ctx.fillStyle    = "#111111";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, W / 2, cy + 1);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HEADLINE MODEL
//
//   Every line is centred, with a black drop-shadow. Each line is
//   either YELLOW (gold gradient) or WHITE, and either BIG or normal.
//
//   Inputs:
//     newsItem.titleLines  []   strings OR { text, yellow, big }
//     newsItem.title       ""   single string (auto-wrapped)
//     newsItem.yellowLines []   line indexes drawn in yellow
//                               (strings only, default [0, 1])
//     newsItem.bigLines    []   line indexes drawn larger
//                               (strings only, default [1])
//     newsItem.quoted      bool wrap headline in ' … ' (default false)
//     newsItem.captionLabel ""  pill text (default "READ CAPTION")
//     newsItem.showCaption bool show the pill (default true)
//
//   Legacy keys highlightLines / lastLine are appended as yellow lines.
//
//   Poster in the reference, as data:
//     titleLines: [
//       { text: "കേരളത്തിൽ ഇന്ന്",                         yellow: true,  big: false },
//       { text: "SFI പഠിപ്പുമുടക്ക്;",                     yellow: true,  big: true  },
//       { text: "മുഴുവൻ വിദ്യാഭ്യാസ",                       yellow: false, big: false },
//       { text: "സ്ഥാപനങ്ങളിലും",                           yellow: false, big: false },
//       { text: "വിദ്യാർഥികൾ",                              yellow: true,  big: true  },
//       { text: "പ്രതിഷേധിക്കണമെന്ന്",                     yellow: false, big: false },
//       { text: "നിർദേശം !",                                yellow: false, big: false },
//     ]
// ═══════════════════════════════════════════════════════════════

function resolveHeadline(newsItem) {
  let src = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    src = [...newsItem.titleLines];
  } else if (newsItem.title) {
    src = [newsItem.title];
  }

  if (Array.isArray(newsItem.highlightLines)) {
    for (const t of newsItem.highlightLines) if (t) src.push({ text: t, yellow: true, big: false });
  }
  if (newsItem.lastLine) src.push({ text: newsItem.lastLine, yellow: true, big: false });

  return src
    .filter(Boolean)
    .map((s) => (typeof s === "string"
      ? { text: s }
      : { text: s.text, yellow: s.yellow, big: s.big }))
    .filter((s) => s.text);
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
//
// LAYOUT (top → bottom):
//   1. Dark background with orange sun-flare, top right
//   2. Headline — alternating yellow / white lines, key lines larger
//   3. News photo, lower ~53%, fading into the dark at its top edge
//   4. "READ CAPTION" white pill, bottom centre
//   5. Ad strip (unchanged pipeline), appended below the poster
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

  // ── 2. News photo — lower ~53%, top edge dissolves into the dark ──
  const IMG_TOP = Math.round(H * 0.47);
  const IMG_H   = H - IMG_TOP;

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W - dw) / 2;
    const dy    = (IMG_H - dh) / 2;

    // Draw the photo on its own layer, then mask the top with a gradient
    // so it fades cleanly into the background glow underneath.
    const layer = createCanvas(W, IMG_H);
    const lctx  = layer.getContext("2d");
    lctx.drawImage(img, dx, dy, dw, dh);

    // Slight warm grade to sit with the orange glow
    lctx.fillStyle = "rgba(40,12,0,0.12)";
    lctx.fillRect(0, 0, W, IMG_H);

    lctx.globalCompositeOperation = "destination-in";
    const mask = lctx.createLinearGradient(0, 0, 0, IMG_H);
    mask.addColorStop(0,    "rgba(0,0,0,0)");
    mask.addColorStop(0.14, "rgba(0,0,0,0.30)");
    mask.addColorStop(0.36, "rgba(0,0,0,1)");
    mask.addColorStop(1,    "rgba(0,0,0,1)");
    lctx.fillStyle = mask;
    lctx.fillRect(0, 0, W, IMG_H);

    ctx.drawImage(layer, 0, IMG_TOP);

  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }

  // Soft vignette at the bottom so the caption pill stays legible
  const vig = ctx.createLinearGradient(0, H - 260, 0, H);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, H - 260, W, 260);

  // ── 3. Headline ─────────────────────────────────────────────
  const PAD    = 46;
  const TEXT_W = W - PAD * 2;
  const CX     = W / 2;

  const TEXT_TOP = 90;
  const TEXT_BOT = Math.round(H * 0.555);
  const TEXT_H   = TEXT_BOT - TEXT_TOP;

  const segs = resolveHeadline(newsItem);

  const yellowSet = new Set(Array.isArray(newsItem.yellowLines) ? newsItem.yellowLines : [0, 1]);
  const bigSet    = new Set(Array.isArray(newsItem.bigLines)    ? newsItem.bigLines    : [1]);

  const HEAD_LH   = 1.10;
  const BIG_RATIO = 1.22;

  let headSize  = 80;
  let headLines = [];

  const layout = () => {
    const bigSize = Math.round(headSize * BIG_RATIO);

    // Pass 1: wrap every segment at base size → "units", so flags can be
    // assigned by final line index (works for one long string too).
    const units = [];
    let idx = 0;
    ctx.font = `${headSize}px ${HEAD_FONT}`;
    for (const seg of segs) {
      for (const part of wrapText(ctx, seg.text, TEXT_W)) {
        units.push({
          text:   part,
          yellow: typeof seg.yellow === "boolean" ? seg.yellow : yellowSet.has(idx),
          big:    typeof seg.big    === "boolean" ? seg.big    : bigSet.has(idx),
        });
        idx++;
      }
    }

    // Pass 2: big units are re-wrapped at the larger size.
    headLines = [];
    for (const u of units) {
      const size = u.big ? bigSize : headSize;
      ctx.font = `${size}px ${HEAD_FONT}`;
      for (const t of wrapText(ctx, u.text, TEXT_W)) {
        headLines.push({ text: t, size, big: u.big, yellow: u.yellow });
      }
    }

    return headLines.reduce((a, l) => a + Math.round(l.size * HEAD_LH), 0);
  };

  let totalH = layout();
  while (totalH > TEXT_H && headSize > 34) {
    headSize -= 2;
    totalH = layout();
  }

  let drawY = TEXT_TOP + Math.max(0, Math.round((TEXT_H - totalH) / 2));

  const quoted      = newsItem.quoted === true;
  const lastHeadIdx = headLines.length - 1;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  headLines.forEach((line, i) => {
    let text = line.text;
    if (quoted && i === 0)           text = "'" + text;
    if (quoted && i === lastHeadIdx) text = text + "'";

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
    ctx.shadowBlur    = line.big ? 18 : 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = line.big ? 4 : 3;
    fillTextBold(ctx, text, CX, drawY, line.size);
    ctx.restore();

    drawY += Math.round(line.size * HEAD_LH);
  });

  // ── 4. READ CAPTION pill ────────────────────────────────────
  if (newsItem.showCaption !== false) {
    drawCaptionPill(ctx, newsItem.captionLabel || "READ CAPTION");
  }

  // ── 5. Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 6. Ad strip ─────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
