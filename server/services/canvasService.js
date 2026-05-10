const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS DIMENSIONS
//   Main poster : 1080 × 1280  (always)
//   Ad strip    : 1080 × AD_H  (appended below when adBannerUrl is provided)
//   Final output: 1080 × (1280 + AD_H)  OR  1080 × 1280  (no ad)
// ─────────────────────────────────────────────────────────────────────────────
const W         = 1080;
const H         = 1280;   // poster height — never changes
const AD_H      = 180;    // height of the ad strip below the poster

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// DRAW POSTER onto a canvas context (always 1080 × 1280, drawn at y=0)
// ═══════════════════════════════════════════════════════════════════════════════

async function drawPoster(ctx, newsItem) {

  // ── 1. BACKGROUND ────────────────────────────────────────────
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);

  // Halftone dot texture
  ctx.save();
  ctx.globalAlpha = 0.018;
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row < H; row += 12)
    for (let col = 0; col < W; col += 12) {
      ctx.beginPath();
      ctx.arc(col, row, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.restore();

  // ── 2. IMAGE — top 52 % ──────────────────────────────────────
  const IMG_H = Math.round(H * 0.52);

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

    ctx.fillStyle = "rgba(20,5,0,0.18)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Bottom fade — starts later and stays lighter for a natural falloff
    const fade = ctx.createLinearGradient(0, IMG_H * 0.55, 0, IMG_H);
    fade.addColorStop(0,   "rgba(10,10,12,0)");
    fade.addColorStop(0.7, "rgba(10,10,12,0.50)");
    fade.addColorStop(1,   "rgba(10,10,12,0.85)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    const topFade = ctx.createLinearGradient(0, 0, 0, 100);
    topFade.addColorStop(0, "rgba(10,10,12,0.7)");
    topFade.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, 100);

    ctx.restore();
  } catch {
    const fallback = ctx.createLinearGradient(0, 0, W, IMG_H);
    fallback.addColorStop(0, "#1c1a20");
    fallback.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. TOP HEADER BAR ────────────────────────────────────────
  const headerH = 72;

  ctx.save();
  ctx.fillStyle = "rgba(10,10,12,0.85)";
  ctx.fillRect(0, 0, W, headerH);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, 0, 6, headerH);
  ctx.restore();

  // Breaking tag — left side
  const tagLabel = (newsItem.tag || "BREAKING NEWS").toUpperCase();
  const tagCY    = headerH / 2;
  const tagX     = 24;
  const tagH     = 40;

  ctx.save();
  ctx.font          = "bold 17px English";
  ctx.letterSpacing = "3px";
  const tagTextW    = ctx.measureText(tagLabel).width;
  const tagW        = tagTextW + 52;

  ctx.fillStyle = "#e8000d";
  roundRect(ctx, tagX, tagCY - tagH / 2, tagW, tagH, 5);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(tagX + 18, tagCY, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(tagLabel, tagX + 32, tagCY + 1);
  ctx.restore();

  // Brand — right side of header
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(W - 230, 14, 1, headerH - 28);

  ctx.font          = "bold 26px English";
  ctx.letterSpacing = "5px";
  ctx.textBaseline  = "middle";
  ctx.textAlign     = "right";

  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", W - 22, headerH / 2);

  const keralamW = ctx.measureText("KERALAM").width;
  ctx.fillStyle  = "#ffffff";
  ctx.fillText("FLASH ", W - 22 - keralamW, headerH / 2);
  ctx.restore();

  // ── 4. RED RULE + DATE BLOCK ─────────────────────────────────
  const PAD    = 54;
  const RULE_Y = IMG_H + 24;

  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(PAD, RULE_Y, 64, 5);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(PAD + 72, RULE_Y + 1.5, W - PAD - 72 - PAD, 2);
  ctx.restore();

  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const weekday = now.toLocaleDateString("en-IN", { weekday: "long" }).toUpperCase();
  const DATE_Y  = RULE_Y + 22;

  ctx.save();
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  ctx.font          = "bold 22px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "#ffffff";
  ctx.fillText(`${day} ${month} ${year}`, PAD, DATE_Y);

  const dmW = ctx.measureText(`${day} ${month} ${year}`).width + 14;
  ctx.font      = "bold 16px English";
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.fillText("·", PAD + dmW, DATE_Y + 3);
  ctx.fillText(weekday, PAD + dmW + 18, DATE_Y + 3);
  ctx.restore();

  // ── 5. MALAYALAM TITLE — red tapered bg + white text ─────────
  const TEXT_TOP = DATE_Y + 48;
  const TEXT_BOT = H - 148;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;

  let allSegments = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    allSegments = newsItem.titleLines;
  } else if (newsItem.title) {
    allSegments = [newsItem.title];
  }
  if (newsItem.lastLine) {
    allSegments = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine
    ];
  }

  let FONT_SIZE = 82;
  let allLines  = [];
  const GAP     = 10;

  while (FONT_SIZE >= 40) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) allLines.push(...wrapText(ctx, seg, TEXT_W));
    const V_PAD  = Math.round(FONT_SIZE * 0.22);
    const blockH = FONT_SIZE + V_PAD * 2;
    if (allLines.length * (blockH + GAP) - GAP <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const V_PAD  = Math.round(FONT_SIZE * 0.22);
  const blockH = FONT_SIZE + V_PAD * 2;
  const totalH = allLines.length * (blockH + GAP) - GAP;
  let   drawY  = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";

    const lineW = ctx.measureText(allLines[i]).width;
    const rectX = PAD - 12;
    const rectY = drawY - V_PAD;
    const rectW = lineW + 24;
    const rectH = blockH;

    // Red tapered rectangle
    ctx.fillStyle = "#e8000d";
    ctx.beginPath();
    ctx.moveTo(rectX,          rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW,  rectY + rectH);
    ctx.lineTo(rectX,          rectY + rectH);
    ctx.closePath();
    ctx.fill();

    // Shine on top half
    const shine = ctx.createLinearGradient(0, rectY, 0, rectY + rectH * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.10)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.moveTo(rectX,             rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW,     rectY + rectH * 0.5);
    ctx.lineTo(rectX,             rectY + rectH * 0.5);
    ctx.closePath();
    ctx.fill();

    // White text
    ctx.shadowColor   = "rgba(0,0,0,0.6)";
    ctx.shadowBlur    = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(allLines[i], PAD, drawY);

    ctx.restore();
    drawY += blockH + GAP;
  }

  // ── 6. SOURCE TAG ────────────────────────────────────────────
  if (newsItem.source) {
    const srcLabel = ("● " + newsItem.source).toUpperCase();
    const SRC_Y    = H - 138;
    const srcH     = 42;

    ctx.save();
    ctx.font          = "bold 16px English";
    ctx.letterSpacing = "3px";
    const srcW        = ctx.measureText(srcLabel).width + 36;

    ctx.fillStyle = "rgba(255,255,255,0.09)";
    roundRect(ctx, PAD - 12, SRC_Y - srcH / 2, srcW, srcH, 6);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth   = 1.5;
    roundRect(ctx, PAD - 12, SRC_Y - srcH / 2, srcW, srcH, 6);
    ctx.stroke();

    ctx.fillStyle    = "rgba(255,255,255,0.75)";
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(srcLabel, PAD + 6, SRC_Y + 1);
    ctx.restore();
  }

  // ── 7. FOOTER BAR ────────────────────────────────────────────
  const FOOT_H = 72;
  const FOOT_Y = H - FOOT_H;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, FOOT_Y, W, FOOT_H);

  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, FOOT_Y, W, 3);

  ctx.textBaseline = "middle";

  ctx.font          = "bold 18px English";
  ctx.letterSpacing = "4px";
  ctx.fillStyle     = "rgba(255,255,255,0.55)";
  ctx.textAlign     = "left";
  ctx.fillText("FLASH", 28, FOOT_Y + FOOT_H / 2);

  const fW = ctx.measureText("FLASH").width;
  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", 28 + fW + 12, FOOT_Y + FOOT_H / 2);

  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "rgba(255,255,255,0.30)";
  ctx.textAlign     = "center";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + FOOT_H / 2);

  ctx.font          = "bold 14px English";
  ctx.letterSpacing = "1px";
  ctx.fillStyle     = "rgba(255,255,255,0.22)";
  ctx.textAlign     = "right";
  ctx.fillText("#FlashKeralam", W - 28, FOOT_Y + FOOT_H / 2);

  ctx.restore();

  // ── Reset ─────────────────────────────────────────────────────
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";
  ctx.shadowColor   = "transparent";
  ctx.shadowBlur    = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRAW AD STRIP onto a canvas context at yOffset below the poster
// ═══════════════════════════════════════════════════════════════════════════════

async function drawAdStrip(ctx, bannerUrl, yOffset) {
  if (bannerUrl) {
    try {
      const adImg = await loadImage(bannerUrl);
      const scale = W / adImg.width;
      const drawH = Math.min(adImg.height * scale, AD_H);
      const drawY = yOffset + (AD_H - drawH) / 2;
      ctx.drawImage(adImg, 0, drawY, W, drawH);
      return;
    } catch (e) {
      console.warn("Ad banner load failed:", e.message);
    }
  }

  // Fallback placeholder
  ctx.save();
  ctx.fillStyle = "#111113";
  ctx.fillRect(0, yOffset, W, AD_H);

  // Thin separator at top of ad strip
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, yOffset, W, 1.5);

  ctx.font          = "bold 52px English";
  ctx.letterSpacing = "6px";
  ctx.fillStyle     = "rgba(255,255,255,0.15)";
  ctx.textAlign     = "center";
  ctx.textBaseline  = "middle";
  ctx.fillText("YOUR AD HERE", W / 2, yOffset + AD_H / 2);

  ctx.font          = "bold 20px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "rgba(255,255,255,0.08)";
  ctx.fillText("DM @flashkeralam to advertise", W / 2, yOffset + AD_H / 2 + 52);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
//
// newsItem shape:
//   image        {string}    URL / local path to main photo
//   titleLines   {string[]}  Malayalam text segments (array)
//   title        {string}    fallback if titleLines absent
//   lastLine     {string}    optional extra line appended last
//   tag          {string}    pill label, e.g. "BREAKING NEWS"
//   source       {string}    optional source badge text
//   adBannerUrl  {string}    optional ad image URL
//                            When present  → output is 1080 × (1280 + 180)
//                            When absent   → output is 1080 × 1280  (no ad strip)
// ═══════════════════════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {
  const hasAd    = !!(newsItem.adBannerUrl);
  const totalH   = hasAd ? H + AD_H : H;   // poster + optional ad strip

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext("2d");

  // Draw the main 1080×1280 poster at y = 0
  await drawPoster(ctx, newsItem);

  // Stitch the ad strip immediately below when provided
  if (hasAd) {
    await drawAdStrip(ctx, newsItem.adBannerUrl, H);
  }

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };