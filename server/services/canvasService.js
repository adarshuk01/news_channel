// ─────────────────────────────────────────────────────────────
// FLASH KERALAM — DYNAMIC COLOR GRID NEWS POSTER
// RANDOM RED / GREEN / BLUE THEME EACH RENDER
// ─────────────────────────────────────────────────────────────

const {
  createCanvas,
  GlobalFonts,
  loadImage,
} = require("@napi-rs/canvas");

const path = require("path");

// ─────────────────────────────────────
// FONT REGISTRATION
// ─────────────────────────────────────

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
  "Malayalam"
);

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// ─────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────

const W            = 1080;
const H            = 1350;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ═════════════════════════════════════════════════════════════
// COLOR THEMES
// Each theme defines all colours used throughout the poster
// ═════════════════════════════════════════════════════════════

const THEMES = {
  red: {
    name:         "red",
    gridTop:      "#c40000",
    gridMid:      "#a80000",
    gridBot:      "#7a0000",
    fadeRgb:      "196, 0, 0",       // image-to-panel fade
    imgFallback:  "#c40000",
  },
  green: {
    name:         "green",
    gridTop:      "#0a6e2e",
    gridMid:      "#085c26",
    gridBot:      "#054518",
    fadeRgb:      "10, 110, 46",
    imgFallback:  "#0a6e2e",
  },
  blue: {
    name:         "blue",
    gridTop:      "#1a3a7a",
    gridMid:      "#142e66",
    gridBot:      "#0d1f4a",
    fadeRgb:      "26, 58, 122",
    imgFallback:  "#1a3a7a",
  },
};

// ─────────────────────────────────────
// Pick one theme at random each call
// ─────────────────────────────────────

function pickRandomTheme() {
  const keys  = Object.keys(THEMES);
  const key   = keys[Math.floor(Math.random() * keys.length)];
  const theme = THEMES[key];
  console.log(`[Theme] Selected: ${theme.name}`);
  return theme;
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════
// DRAW THEMED GRID BACKGROUND
// ═════════════════════════════════════════════════════════════

function drawGridBackground(ctx, theme, yStart, height) {
  // Gradient fill using theme colours
  const bg = ctx.createLinearGradient(0, yStart, 0, yStart + height);
  bg.addColorStop(0,   theme.gridTop);
  bg.addColorStop(0.5, theme.gridMid);
  bg.addColorStop(1,   theme.gridBot);

  ctx.fillStyle = bg;
  ctx.fillRect(0, yStart, W, height);

  // White grid overlay
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = 1;

  const gridSize = 45;

  for (let x = 0; x <= W; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, yStart);
    ctx.lineTo(x, yStart + height);
    ctx.stroke();
  }

  for (let y = yStart; y <= yStart + height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.restore();
}

// ═════════════════════════════════════════════════════════════
// DRAW POSTER
// ═════════════════════════════════════════════════════════════

async function drawPoster(ctx, newsItem, theme) {

  // ─────────────────────────────────
  // IMAGE SECTION (top ~52%)
  // ─────────────────────────────────

  const IMG_H = Math.round(H * 0.52);

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W     - dw) / 2;
    const dy    = (IMG_H - dh) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, IMG_H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);

    // Bottom fade — blends into the chosen theme colour
    const { fadeRgb } = theme;
    const fade = ctx.createLinearGradient(0, IMG_H * 0.65, 0, IMG_H);
    fade.addColorStop(0,   `rgba(${fadeRgb}, 0)`);
    fade.addColorStop(0.7, `rgba(${fadeRgb}, 0.6)`);
    fade.addColorStop(1,   `rgba(${fadeRgb}, 0.95)`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    ctx.restore();
  } catch (err) {
    console.log("[News Image Error]", err.message);
    ctx.fillStyle = theme.imgFallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ─────────────────────────────────
  // WATERMARK ON IMAGE
  // ─────────────────────────────────

  ctx.save();
  ctx.font         = "bold 18px English";
  ctx.fillStyle    = "rgba(255,255,255,0.55)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.fillText("FLASH KERALAM", 16, IMG_H - 32);
  ctx.restore();

  // ─────────────────────────────────
  // THEMED GRID TEXT SECTION
  // ─────────────────────────────────

  const TEXT_TOP = IMG_H;
  const TEXT_BOT = H - 40;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;

  drawGridBackground(ctx, theme, TEXT_TOP, TEXT_H);

  // ─────────────────────────────────
  // HEADING TEXT
  // ─────────────────────────────────

  const headingText = newsItem.heading || "";

  if (headingText) {
    ctx.save();
    ctx.font          = "bold 46px Malayalam";
    ctx.fillStyle     = "#ffe566";
    ctx.textAlign     = "center";
    ctx.textBaseline  = "top";
    ctx.shadowColor   = "rgba(0,0,0,0.6)";
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillText(headingText, W / 2, TEXT_TOP + 22);
    ctx.restore();
  }

  // ─────────────────────────────────
  // MAIN TITLE — ALL WHITE
  // ─────────────────────────────────

  const PAD    = 44;
  const TEXT_W = W - PAD * 2;
  const CX     = W / 2;

  const TITLE_TOP_OFFSET = headingText ? 80 : 20;
  const TITLE_AREA_TOP   = TEXT_TOP + TITLE_TOP_OFFSET;
  const TITLE_AREA_H     = TEXT_H   - TITLE_TOP_OFFSET;

  let allSegments = [];

  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    allSegments = newsItem.titleLines;
  } else if (newsItem.title) {
    allSegments = [newsItem.title];
  }

  if (newsItem.lastLine) {
    allSegments = [
      ...(Array.isArray(newsItem.titleLines)
        ? newsItem.titleLines
        : [newsItem.title || ""]),
      newsItem.lastLine,
    ];
  }

  let FONT_SIZE = 82;
  let allLines  = [];
  let bestFit   = { size: 36, lines: [] };

  while (FONT_SIZE >= 36) {
    ctx.font = `bold ${FONT_SIZE}px Malayalam`;
    allLines  = [];

    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }

    const LINE_H     = Math.round(FONT_SIZE * 1.20);
    const totalTextH = allLines.length * LINE_H;

    if (totalTextH <= TITLE_AREA_H - 20) {
      bestFit   = { size: FONT_SIZE, lines: allLines, lineHeight: LINE_H, totalH: totalTextH };
      FONT_SIZE += 2;
      break;
    }

    FONT_SIZE -= 2;
  }

  FONT_SIZE     = bestFit.size;
  allLines      = bestFit.lines;
  const LINE_H  = bestFit.lineHeight || Math.round(FONT_SIZE * 1.20);
  const totalTH = bestFit.totalH    || (allLines.length * LINE_H);

  let drawY = TITLE_AREA_TOP + Math.round((TITLE_AREA_H - totalTH) / 2) - 20;
  if (drawY < TITLE_AREA_TOP) drawY = TITLE_AREA_TOP;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.fillStyle     = "#ffffff";
    ctx.shadowColor   = "rgba(0,0,0,0.7)";
    ctx.shadowBlur    = 16;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillText(allLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H;
  }

  // ─────────────────────────────────
  // FOOTER WATERMARKS
  // ─────────────────────────────────

  const FOOT_Y = H - 28;

  ctx.save();
  ctx.font      = "bold 16px English";
  ctx.fillStyle = "rgba(255,255,255,0.35)";

  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("FLASH KERALAM", 20, FOOT_Y);

  ctx.textAlign = "right";
  ctx.fillText("FLASH KERALAM", W - 20, FOOT_Y);
  ctx.restore();
}

// ═════════════════════════════════════════════════════════════
// AD STRIP
// ═════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  if (adImg) {
    const scaleW = W   / adImg.width;
    const scaleH = adH / adImg.height;
    const scale  = Math.max(scaleW, scaleH);

    const drawW = adImg.width  * scale;
    const drawH = adImg.height * scale;
    const drawX = (W   - drawW) / 2;
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

  // Fallback ad
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

// ═════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Pick a random colour theme ──────────────────────────────
  // Pass newsItem.theme = "red" | "green" | "blue" to force one,
  // or leave it unset for a random pick every render.
  const theme = newsItem.theme && THEMES[newsItem.theme]
    ? THEMES[newsItem.theme]
    : pickRandomTheme();

  // ── Ad strip ────────────────────────────────────────────────
  const hasAd   = Boolean(newsItem.adBannerUrl);
  let adImg     = null;
  let actualAdH = 0;

  if (hasAd) {
    try {
      console.log("[Ad] Loading:", newsItem.adBannerUrl);
      adImg     = await loadImage(newsItem.adBannerUrl);
      console.log(`[Ad] Loaded OK: ${adImg.width}x${adImg.height}px`);
      actualAdH = computeAdHeight(adImg);
      console.log(`[Ad] Strip height: ${actualAdH}px`);
    } catch (err) {
      console.error("[Ad] Failed to load image:", err.message);
      console.error("[Ad] URL was:", newsItem.adBannerUrl);
      adImg     = null;
      actualAdH = DEFAULT_AD_H;
    }
  } else {
    console.log("[Ad] No adBannerUrl provided — skipping ad strip entirely.");
  }

  const totalH = H + actualAdH;
  console.log(`[Canvas] ${W}x${totalH} (poster ${H}${actualAdH ? ` + ad ${actualAdH}` : ", no ad"})`);

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext("2d");

  await drawPoster(ctx, newsItem, theme);

  if (actualAdH > 0) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };