// ─────────────────────────────────────────────────────────────
// FLASH KERALAM — PREMIUM RED NEWS POSTER
// ATTRACTIVE BREAKING NEWS STYLE
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
const H            = 1280;
const DEFAULT_AD_H = 180;  // fallback height when no image / load fails
const MAX_AD_H     = 320;  // cap so portrait/square images don't blow up

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

// ═════════════════════════════════════════════════════════════
// COMPUTE AD HEIGHT
// Works for any image dimension — caps to MAX_AD_H
// ═════════════════════════════════════════════════════════════

function computeAdHeight(adImg) {
  if (!adImg) return DEFAULT_AD_H;

  // Natural height if we scale image to poster width
  const naturalH = Math.round((adImg.height / adImg.width) * W);

  // Use natural height but clamp between DEFAULT_AD_H and MAX_AD_H
  return Math.min(MAX_AD_H, Math.max(DEFAULT_AD_H, naturalH));
}

// ═════════════════════════════════════════════════════════════
// DRAW POSTER
// ═════════════════════════════════════════════════════════════

async function drawPoster(ctx, newsItem) {

  // ─────────────────────────────────
  // RED BACKGROUND
  // ─────────────────────────────────

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,    "#ff2a2a");
  bg.addColorStop(0.25, "#e60000");
  bg.addColorStop(0.55, "#c40000");
  bg.addColorStop(1,    "#7a0000");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // diagonal texture
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = 1;

  for (let i = -H; i < W + H; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }

  ctx.restore();

  // ─────────────────────────────────
  // NEWS IMAGE
  // ─────────────────────────────────

  const IMG_H = Math.round(H * 0.58);

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

    const fade = ctx.createLinearGradient(0, IMG_H * 0.6, 0, IMG_H);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    ctx.restore();
  } catch (err) {
    console.log("[News Image Error]", err.message);
    ctx.fillStyle = "#900000";
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ─────────────────────────────────
  // TOP ACCENT BAR
  // ─────────────────────────────────

  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0,   "rgba(255,180,0,0)");
  accentGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  accentGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  accentGrad.addColorStop(1,   "rgba(255,180,0,0)");

  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 4);

  // ─────────────────────────────────
  // HEADER BAR
  // ─────────────────────────────────

  const HEADER_H  = 90;
  const HEADER_BG = ctx.createLinearGradient(0, 0, 0, HEADER_H);
  HEADER_BG.addColorStop(0, "rgba(0,0,0,0.55)");
  HEADER_BG.addColorStop(1, "rgba(0,0,0,0.20)");

  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(0, 0, W, HEADER_H);

  // ─────────────────────────────────
  // DATE — pill tag, top right
  // ─────────────────────────────────

  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  const HEADER_CY = HEADER_H / 2;

  ctx.save();
  ctx.font = "bold 26px English";

  const DATE_TW     = ctx.measureText(dateStr).width;
  const DATE_PAD_X  = 22;
  const DATE_PILL_W = DATE_TW + DATE_PAD_X * 2;
  const DATE_PILL_H = 46;
  const DATE_PILL_X = W - 44 - DATE_PILL_W;
  const DATE_PILL_Y = HEADER_CY - DATE_PILL_H / 2;

  const pillGrad = ctx.createLinearGradient(0, DATE_PILL_Y, 0, DATE_PILL_Y + DATE_PILL_H);
  pillGrad.addColorStop(0, "#ffe566");
  pillGrad.addColorStop(1, "#e08800");

  ctx.shadowColor   = "rgba(0,0,0,0.40)";
  ctx.shadowBlur    = 16;
  ctx.shadowOffsetY = 4;

  roundRect(ctx, DATE_PILL_X, DATE_PILL_Y, DATE_PILL_W, DATE_PILL_H, 23);
  ctx.fillStyle = pillGrad;
  ctx.fill();

  ctx.shadowColor = "transparent";
  const sheen = ctx.createLinearGradient(0, DATE_PILL_Y, 0, DATE_PILL_Y + DATE_PILL_H * 0.5);
  sheen.addColorStop(0, "rgba(255,255,255,0.30)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, DATE_PILL_X, DATE_PILL_Y, DATE_PILL_W, DATE_PILL_H, 23);
  ctx.fill();

  ctx.font         = "bold 26px English";
  ctx.fillStyle    = "#1a0a00";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(dateStr, DATE_PILL_X + DATE_PILL_W / 2, HEADER_CY + 1);

  ctx.restore();

  // ─────────────────────────────────
  // LOGO — top left inside header
  // ─────────────────────────────────

  const LOGO_MAX_W   = 600;
  const LOGO_MAX_H   = 300;
  const LOGO_LEFT    = 10;
  const LOGO_CENTER_Y = HEADER_H / 2 + 35;

  try {
    const logo  = await loadImage(path.join(__dirname, "../assets/logo.png"));
    const scale = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height);
    const lw    = logo.width  * scale;
    const lh    = logo.height * scale;
    const lx    = LOGO_LEFT;
    const ly    = LOGO_CENTER_Y - lh / 2;

    ctx.save();
    ctx.shadowColor   = "rgba(0,0,0,0.75)";
    ctx.shadowBlur    = 32;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(logo, lx, ly, lw, lh);
    ctx.restore();

  } catch (err) {
    console.warn("[Logo] Could not load assets/logo.png:", err.message);

    ctx.save();
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.font         = "bold 52px English";
    ctx.fillStyle    = "#ffffff";
    ctx.shadowColor  = "rgba(0,0,0,0.8)";
    ctx.shadowBlur   = 18;
    ctx.fillText("FLASH", LOGO_LEFT, LOGO_CENTER_Y - 30);

    const goldGrad = ctx.createLinearGradient(0, LOGO_CENTER_Y, 0, LOGO_CENTER_Y + 52);
    goldGrad.addColorStop(0, "#ffe566");
    goldGrad.addColorStop(1, "#ffaa00");

    ctx.font      = "bold 52px English";
    ctx.fillStyle = goldGrad;
    ctx.fillText("KERALAM", LOGO_LEFT, LOGO_CENTER_Y + 30);
    ctx.restore();
  }

  // ─────────────────────────────────
  // BREAKING NEWS TAG
  // ─────────────────────────────────

  const tagLabel = newsItem.tag || "BREAKING NEWS";
  const tagW     = 420;
  const tagH     = 72;
  const tagX     = (W - tagW) / 2;
  const tagY     = IMG_H - 36;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.40)";
  ctx.shadowBlur    = 30;
  ctx.shadowOffsetY = 10;

  const tagGrad = ctx.createLinearGradient(0, tagY, 0, tagY + tagH);
  tagGrad.addColorStop(0,    "#4c63ff");
  tagGrad.addColorStop(0.45, "#3148d8");
  tagGrad.addColorStop(1,    "#1e2d8f");

  ctx.fillStyle = tagGrad;
  roundRect(ctx, tagX, tagY, tagW, tagH, 10);
  ctx.fill();
  ctx.restore();

  const gloss = ctx.createLinearGradient(0, tagY, 0, tagY + tagH);
  gloss.addColorStop(0,   "rgba(255,255,255,0.25)");
  gloss.addColorStop(0.4, "rgba(255,255,255,0.08)");
  gloss.addColorStop(1,   "rgba(255,255,255,0)");

  ctx.fillStyle = gloss;
  roundRect(ctx, tagX, tagY, tagW, tagH, 10);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth   = 2;
  roundRect(ctx, tagX, tagY, tagW, tagH, 10);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, tagX + 8, tagY + 8, tagW - 16, 16, 8);
  ctx.fill();

  ctx.save();
  ctx.font         = "italic bold 38px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.35)";
  ctx.shadowBlur   = 12;
  ctx.fillText(tagLabel, W / 2, tagY + tagH / 2 + 1);
  ctx.restore();

  // ─────────────────────────────────
  // TITLE
  // ─────────────────────────────────

  const PAD      = 58;
  const TEXT_TOP = IMG_H + 56;
  const TEXT_BOT = H - 36;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

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

  let FONT_SIZE = 72;
  let allLines  = [];

  while (FONT_SIZE >= 38) {
    ctx.font = `bold ${FONT_SIZE}px Malayalam`;
    allLines  = [];

    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }

    const LINE_H = Math.round(FONT_SIZE * 1.18);
    if (allLines.length * LINE_H <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const LINE_H  = Math.round(FONT_SIZE * 1.18);
  const totalTH = allLines.length * LINE_H;
  let   drawY   = TEXT_TOP + Math.round((TEXT_H - totalTH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    const isLast       = i === allLines.length - 1;
    const isSecondLast = i === allLines.length - 2;

    if (isLast) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#ffe566");
      g.addColorStop(1, "#ffaa00");
      ctx.fillStyle = g;
    } else if (isSecondLast && allLines.length > 2) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#fff0aa");
      g.addColorStop(1, "#ffd040");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#ffffff";
    }

    ctx.fillText(allLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H;
  }

  // ─────────────────────────────────
  // FOOTER
  // ─────────────────────────────────

  const FOOT_Y = H - 34;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0, FOOT_Y - 1, W, 1);

  ctx.font         = "bold 17px English";
  ctx.fillStyle    = "rgba(255,220,120,0.75)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + 17);
  ctx.restore();
}

// ═════════════════════════════════════════════════════════════
// AD STRIP  ← COMPLETELY REWRITTEN
// Handles ALL image dimensions using cover-scale + clip
// ═════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  // ── Black base fill ─────────────────────────────────────────
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  // ── Has a real image → cover-scale + clip ───────────────────
  if (adImg) {

    // Cover scaling: fill full W×adH, crop any overflow
    const scaleW  = W    / adImg.width;
    const scaleH  = adH  / adImg.height;
    const scale   = Math.max(scaleW, scaleH);   // cover (not contain)

    const drawW   = adImg.width  * scale;
    const drawH   = adImg.height * scale;
    const drawX   = (W   - drawW) / 2;          // centre horizontally
    const drawY   = yOffset + (adH - drawH) / 2; // centre vertically

    ctx.save();
    // Clip strictly to the ad strip area — no overflow on any side
    ctx.beginPath();
    ctx.rect(0, yOffset, W, adH);
    ctx.clip();

    ctx.drawImage(adImg, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Subtle top separator line over the image
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
    lineGrad.addColorStop(0.2, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(0.8, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(1,   "rgba(255,180,0,0)");

    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, yOffset, W, 3);

    return;
  }

  // ── No image → Malayalam fallback ───────────────────────────

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

  let adImg     = null;
  let actualAdH = DEFAULT_AD_H;

  if (newsItem.adBannerUrl) {
    try {
      console.log("[Ad] Loading:", newsItem.adBannerUrl);
      adImg = await loadImage(newsItem.adBannerUrl);
      console.log(`[Ad] Loaded OK: ${adImg.width}x${adImg.height}px`);

      // ── Compute height clamped to MAX_AD_H ─────────────────
      actualAdH = computeAdHeight(adImg);
      console.log(`[Ad] Strip height: ${actualAdH}px`);

    } catch (err) {
      console.error("[Ad] Failed to load image:", err.message);
      console.error("[Ad] URL was:", newsItem.adBannerUrl);
      adImg     = null;
      actualAdH = DEFAULT_AD_H;
    }
  }

  const totalH = H + actualAdH;
  console.log(`[Canvas] ${W}x${totalH} (poster ${H} + ad ${actualAdH})`);

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext("2d");

  await drawPoster(ctx, newsItem);
  drawAdStrip(ctx, adImg, H, actualAdH);

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };