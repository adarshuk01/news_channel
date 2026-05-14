// ─────────────────────────────────────────────────────────────
// FLASH KERALAM — VIRAL INSTAGRAM NEWS POSTER
// Premium Cinematic Malayalam Breaking News Design
// ─────────────────────────────────────────────────────────────

const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");

// ─────────────────────────────────────
// FONT REGISTRATION
// ─────────────────────────────────────
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/Rachana-Regular.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/RIT-tnjoy-extrabold.ttf"),
  "MalayalamBold"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/Oswald-Bold.ttf"),
  "OswaldBold"
);

// ─────────────────────────────────────
// DIMENSIONS
// ─────────────────────────────────────
const W     = 1080;
const H     = 1350;
const AD_H  = 180;
const IMG_H = 790;

// ─────────────────────────────────────
// HELPERS
// ─────────────────────────────────────
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Finds the largest font size so the wrapped title fills
 * the available height as completely as possible.
 *
 * For each possible line-count (1..6) we binary-search the
 * maximum font size that still wraps into that many lines
 * AND whose total rendered block fits within usableH.
 * We pick whichever candidate fills the most vertical space.
 */
function fitTitleToArea(ctx, text, maxWidth, usableH, fontFamily) {
  let bestSize  = 28;
  let bestLines = wrapText(ctx, text, maxWidth) || [text];
  let bestFill  = 0;

  for (let targetLines = 1; targetLines <= 6; targetLines++) {
    // binary-search largest size that wraps into ≤ targetLines
    let lo = 24, hi = 220, size = 24;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.font = `bold ${mid}px "${fontFamily}"`;
      const wrapped = wrapText(ctx, text, maxWidth);
      if (wrapped.length <= targetLines) {
        size = mid;
        lo   = mid + 1;
      } else {
        hi   = mid - 1;
      }
    }

    ctx.font = `bold ${size}px "${fontFamily}"`;
    const lines  = wrapText(ctx, text, maxWidth);
    const lh     = size * 1.28;
    const totalH = lines.length * lh;

    // Only accept if it actually fits in the available space
    if (totalH <= usableH && totalH > bestFill) {
      bestFill  = totalH;
      bestSize  = size;
      bestLines = lines;
    }
  }

  return { size: bestSize, lines: bestLines };
}

// ─────────────────────────────────────
// LOGO — simple bold black tag
// ─────────────────────────────────────
function drawLogo(ctx) {
  ctx.save();

  const logoText = "FLASH KERALAM";
  const fontSize = 32;
  const paddingX = 22;
  const paddingY = 12;
  const radius   = 6;

  ctx.font = `bold ${fontSize}px "OswaldBold"`;
  const textWidth = ctx.measureText(logoText).width;

  const boxW = textWidth + paddingX * 2;
  const boxH = fontSize  + paddingY * 2;
  const X    = W - boxW - 36;
  const Y    = 30;

  // Black rounded rectangle background
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(X + radius, Y);
  ctx.lineTo(X + boxW - radius, Y);
  ctx.quadraticCurveTo(X + boxW, Y,        X + boxW, Y + radius);
  ctx.lineTo(X + boxW, Y + boxH - radius);
  ctx.quadraticCurveTo(X + boxW, Y + boxH, X + boxW - radius, Y + boxH);
  ctx.lineTo(X + radius, Y + boxH);
  ctx.quadraticCurveTo(X, Y + boxH,        X, Y + boxH - radius);
  ctx.lineTo(X, Y + radius);
  ctx.quadraticCurveTo(X, Y,               X + radius, Y);
  ctx.closePath();
  ctx.fill();

  // White bold text
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.fillText(logoText, X + paddingX, Y + paddingY);

  ctx.restore();
}

// ─────────────────────────────────────
// DATE
// ─────────────────────────────────────
function drawDate(ctx) {
  const dateText = new Date()
    .toLocaleDateString("en-GB", {
      day:   "2-digit",
      month: "long",
      year:  "numeric",
    })
    .toUpperCase();

  ctx.save();
  ctx.font      = `bold 28px "OswaldBold"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(dateText, 42, 50);
  ctx.restore();
}

// ─────────────────────────────────────
// BREAKING BADGE
// ─────────────────────────────────────
function drawBreakingBar(ctx) {
  const centerX = W / 2;
  const y       = IMG_H - 56;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.35)";
  ctx.shadowBlur    = 25;
  ctx.shadowOffsetY = 10;

  ctx.fillStyle = "#df1f26";
  ctx.fillRect(centerX - 190, y, 210, 60);

  ctx.fillStyle = "#0057c8";
  ctx.fillRect(centerX + 20,  y, 140, 60);
  ctx.restore();

  // LIVE tag
  ctx.fillStyle = "#ffe500";
  ctx.fillRect(centerX + 15, y - 18, 62, 22);

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  ctx.font      = `italic bold 40px "OswaldBold"`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("BREAKING", centerX - 85, y + 30);
  ctx.fillText("NEWS",     centerX + 90, y + 30);

  ctx.font      = `bold 14px "OswaldBold"`;
  ctx.fillStyle = "#111111";
  ctx.fillText("LIVE", centerX + 46, y - 7);
  ctx.restore();
}

// ─────────────────────────────────────
// MAIN DRAW
// ─────────────────────────────────────
async function drawPoster(ctx, newsItem) {

  // ── BACKGROUND ──
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ── IMAGE ──
  try {
    const img = await loadImage(newsItem.image);

    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw = img.width  * scale;
    const dh = img.height * scale;
    const dx = (W - dw) / 2;
    const dy = (IMG_H - dh) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, IMG_H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);

    // top vignette
    const topGrad = ctx.createLinearGradient(0, 0, 0, 300);
    topGrad.addColorStop(0, "rgba(0,0,0,0.45)");
    topGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 300);

    // bottom vignette
    const botGrad = ctx.createLinearGradient(0, IMG_H - 250, 0, IMG_H);
    botGrad.addColorStop(0, "rgba(0,0,0,0)");
    botGrad.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, IMG_H - 250, W, 250);

    // frame border
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth   = 2;
    ctx.strokeRect(22, 22, W - 44, IMG_H - 44);

    ctx.restore();

  } catch {
    const grad = ctx.createLinearGradient(0, 0, 0, IMG_H);
    grad.addColorStop(0, "#132235");
    grad.addColorStop(1, "#050d18");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── OVERLAYS ──
  drawDate(ctx);
  drawLogo(ctx);
  drawBreakingBar(ctx);

  // ── WHITE CONTENT PANEL ──
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, IMG_H, W, H - IMG_H);

  // Red accent stripe (6px) at top of panel
  const STRIPE  = 6;
  ctx.fillStyle = "#e41e26";
  ctx.fillRect(0, IMG_H, W, STRIPE);

  // ── TITLE fills the entire white panel ──
  const MARGIN     = 56;          // left/right padding
  const textW      = W - MARGIN * 2;

  const PAD_TOP    = 44;          // gap above first line
  const PAD_BOTTOM = 36;          // gap below last line
  const panelTop   = IMG_H + STRIPE;
  const panelH     = H - panelTop;
  const usableH    = panelH - PAD_TOP - PAD_BOTTOM;

  const title = newsItem.title || "";

  const { size, lines } = fitTitleToArea(
    ctx,
    title,
    textW,
    usableH,
    "MalayalamBold"
  );

  const lh      = size * 1.08;
  const blockH  = lines.length * lh;

  // Vertically centre the text block inside the white panel
  const startY  = panelTop + PAD_TOP + (usableH - blockH) / 2;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  lines.forEach((line, idx) => {
    ctx.font      = `bold ${size}px "MalayalamBold"`;
    ctx.fillStyle = idx === 0 ? "#cf1f26" : "#111111";
    ctx.fillText(line, W / 2, startY + idx * lh);
  });
}

// ─────────────────────────────────────
// AD STRIP
// ─────────────────────────────────────
async function drawAdStrip(ctx, bannerUrl) {
  const yOffset = H;

  if (bannerUrl) {
    try {
      const adImg = await loadImage(bannerUrl);
      const scale = W / adImg.width;
      const drawH = Math.min(adImg.height * scale, AD_H);
      const drawY = yOffset + (AD_H - drawH) / 2;
      ctx.drawImage(adImg, 0, drawY, W, drawH);
      return;
    } catch (err) {
      console.log("Ad error:", err.message);
    }
  }

  ctx.fillStyle = "#101010";
  ctx.fillRect(0, yOffset, W, AD_H);

  ctx.save();
  ctx.font         = `54px "OswaldBold"`;
  ctx.fillStyle    = "rgba(255,255,255,0.15)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("YOUR AD HERE", W / 2, yOffset + AD_H / 2);
  ctx.restore();
}

// ─────────────────────────────────────
// EXPORT
// ─────────────────────────────────────
async function createNewsPoster(newsItem) {
  const hasAd  = !!newsItem.adBannerUrl;
  const totalH = hasAd ? H + AD_H : H;

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext("2d");

  ctx.antialias       = "subpixel";
  ctx.patternQuality  = "best";
  ctx.quality         = "best";
  ctx.textDrawingMode = "path";

  await drawPoster(ctx, newsItem);

  if (hasAd) {
    await drawAdStrip(ctx, newsItem.adBannerUrl);
  }

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };