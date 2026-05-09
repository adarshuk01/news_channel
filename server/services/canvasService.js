"use strict";

const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs   = require("fs");

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

const W = 1080;
const H = 1350; // slightly taller — better for Instagram portrait ratio (4:5)

// ─── Text wrap ───────────────────────────────────────────────
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

// ─── Rounded rect path ───────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ─── Arrow-head polygon for breaking tag ─────────────────────
function arrowPill(ctx, x, y, w, h, tip = 22) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + tip, y + h / 2);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// ─── Draw source badge (pill) ─────────────────────────────────
function drawSourceBadge(ctx, label, cx, y) {
  ctx.save();
  ctx.font = "bold 22px English";
  const tw  = ctx.measureText(label).width;
  const pw  = tw + 60;    // padding + dot space
  const ph  = 42;
  const bx  = cx - pw / 2;

  // semi-transparent pill background
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, bx, y, pw, ph, ph / 2);
  ctx.fill();

  // pill border
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth   = 1.5;
  roundRect(ctx, bx, y, pw, ph, ph / 2);
  ctx.stroke();

  // red dot
  ctx.fillStyle = "#e8000d";
  ctx.beginPath();
  ctx.arc(bx + 22, y + ph / 2, 6, 0, Math.PI * 2);
  ctx.fill();

  // label
  ctx.fillStyle    = "rgba(255,255,255,0.55)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.font         = "bold 20px English";
  ctx.letterSpacing = "2px";
  ctx.fillText(label.toUpperCase(), bx + 36, y + ph / 2 + 1);

  ctx.restore();
}


// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────
async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ═══════════════════════════════════════════════════════
  // 1. BACKGROUND
  // ═══════════════════════════════════════════════════════
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);

  // Subtle halftone texture
  ctx.save();
  ctx.globalAlpha = 0.016;
  ctx.fillStyle   = "#ffffff";
  for (let row = 0; row < H; row += 14) {
    for (let col = 0; col < W; col += 14) {
      ctx.beginPath();
      ctx.arc(col, row, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Red radial glow (bottom-left) for dramatic depth
  ctx.save();
  const glow = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.8);
  glow.addColorStop(0,   "rgba(232,0,13,0.14)");
  glow.addColorStop(0.5, "rgba(232,0,13,0.04)");
  glow.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 2. IMAGE — top 56%
  // ═══════════════════════════════════════════════════════
  const IMG_H = Math.round(H * 0.56);

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

    // Cinematic warm tint
    ctx.fillStyle = "rgba(15,3,0,0.2)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Strong bottom fade — pulls eye to text
    const fade = ctx.createLinearGradient(0, IMG_H * 0.25, 0, IMG_H);
    fade.addColorStop(0,   "rgba(10,10,12,0)");
    fade.addColorStop(0.55,"rgba(10,10,12,0.65)");
    fade.addColorStop(1,   "rgba(10,10,12,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    // Vignette sides
    const lf = ctx.createLinearGradient(0, 0, 100, 0);
    lf.addColorStop(0, "rgba(10,10,12,0.75)");
    lf.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = lf;
    ctx.fillRect(0, 0, 100, IMG_H);

    const rf = ctx.createLinearGradient(W - 100, 0, W, 0);
    rf.addColorStop(0, "rgba(10,10,12,0)");
    rf.addColorStop(1, "rgba(10,10,12,0.75)");
    ctx.fillStyle = rf;
    ctx.fillRect(W - 100, 0, 100, IMG_H);

    // Top vignette
    const tf = ctx.createLinearGradient(0, 0, 0, 120);
    tf.addColorStop(0, "rgba(10,10,12,0.75)");
    tf.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = tf;
    ctx.fillRect(0, 0, W, 120);

    ctx.restore();
  } catch {
    // Fallback gradient image placeholder
    const fallback = ctx.createLinearGradient(0, 0, W, IMG_H);
    fallback.addColorStop(0, "#1c1010");
    fallback.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ═══════════════════════════════════════════════════════
  // 3. TOP HEADER BAR
  // ═══════════════════════════════════════════════════════
  const HDR_H = 78;

  // Frosted glass bar
  ctx.save();
  const hdrGrad = ctx.createLinearGradient(0, 0, 0, HDR_H);
  hdrGrad.addColorStop(0, "rgba(8,8,10,0.88)");
  hdrGrad.addColorStop(1, "rgba(8,8,10,0.6)");
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(0, 0, W, HDR_H);
  ctx.restore();

  // Left red accent stripe
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, 0, 7, HDR_H);

  // FLASH (white)
  ctx.save();
  ctx.font          = "bold 34px English";
  ctx.letterSpacing = "8px";
  ctx.fillStyle     = "#ffffff";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText("FLASH", 34, HDR_H / 2);
  ctx.restore();

  // KERALAM (red)
  ctx.save();
  ctx.font          = "bold 34px English";
  ctx.letterSpacing = "8px";
  const flashW      = ctx.measureText("FLASH").width + 42 + 8;
  ctx.fillStyle     = "#e8000d";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText("KERALAM", 34 + flashW, HDR_H / 2);
  ctx.restore();

  // Date — right side
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const monthStr= now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const weekday = now.toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase();

  // Date pill background
  ctx.save();
  roundRect(ctx, W - 180, 16, 150, HDR_H - 32, 6);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  ctx.font         = "bold 24px English";
  ctx.fillStyle    = "#ffffff";
  ctx.fillText(`${day} ${monthStr}`, W - 32, HDR_H / 2 - 10);
  ctx.font         = "bold 15px English";
  ctx.fillStyle    = "rgba(255,255,255,0.42)";
  ctx.letterSpacing = "2px";
  ctx.fillText(`${weekday} · ${year}`, W - 32, HDR_H / 2 + 13);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 4. AD BANNER (if provided) — small strip below header
  // ═══════════════════════════════════════════════════════
  if (newsItem.adBannerPath && fs.existsSync(newsItem.adBannerPath)) {
    try {
      const adImg  = await loadImage(newsItem.adBannerPath);
      const AD_H   = 60;
      const AD_Y   = HDR_H + 6;
      const scale  = AD_H / adImg.height;
      const adW    = Math.min(adImg.width * scale, W - 80);
      const adX    = (W - adW) / 2;

      ctx.save();
      ctx.globalAlpha = 0.88;
      roundRect(ctx, adX - 4, AD_Y, adW + 8, AD_H, 4);
      ctx.clip();
      ctx.drawImage(adImg, adX, AD_Y, adW, AD_H);
      ctx.restore();
    } catch { /* skip silently */ }
  }

  // ═══════════════════════════════════════════════════════
  // 5. ARROW-SHAPED BREAKING TAG
  // ═══════════════════════════════════════════════════════
  const tagLabel  = (newsItem.tag || "BREAKING NEWS").toUpperCase();
  const TAG_Y     = IMG_H - 66;
  const TAG_X     = 54;
  const TAG_H     = 50;

  ctx.save();
  ctx.font          = "bold 22px English";
  ctx.letterSpacing = "5px";
  const tagTW       = ctx.measureText(tagLabel).width;
  const TAG_W       = tagTW + 52;

  // Arrow polygon
  ctx.fillStyle = "#e8000d";
  arrowPill(ctx, TAG_X, TAG_Y - TAG_H / 2, TAG_W, TAG_H, 20);
  ctx.fill();

  // Shine
  const shine = ctx.createLinearGradient(TAG_X, TAG_Y - TAG_H / 2, TAG_X, TAG_Y);
  shine.addColorStop(0, "rgba(255,255,255,0.18)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  arrowPill(ctx, TAG_X, TAG_Y - TAG_H / 2, TAG_W, TAG_H, 20);
  ctx.fill();

  // Live dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(TAG_X + 20, TAG_Y, 7, 0, Math.PI * 2);
  ctx.fill();

  // Tag text
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.4)";
  ctx.shadowBlur   = 4;
  ctx.fillText(tagLabel, TAG_X + 36, TAG_Y + 1);

  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 6. LEFT ACCENT BAR (image → text zone bridge)
  // ═══════════════════════════════════════════════════════
  const ACCENT_TOP  = IMG_H - 10;
  const ACCENT_BOT  = H - 70;
  const accentGrad  = ctx.createLinearGradient(0, ACCENT_TOP, 0, ACCENT_BOT);
  accentGrad.addColorStop(0,   "#e8000d");
  accentGrad.addColorStop(0.7, "rgba(232,0,13,0.5)");
  accentGrad.addColorStop(1,   "rgba(232,0,13,0)");
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, ACCENT_TOP, 6, ACCENT_BOT - ACCENT_TOP);

  // ═══════════════════════════════════════════════════════
  // 7. TEXT ZONE DECORATIONS
  // ═══════════════════════════════════════════════════════
  const TZ_Y = IMG_H - 8;

  // Bold red rule
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(54, TZ_Y + 32, 72, 5);
  ctx.restore();

  // Subtle thin white extension
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(54 + 80, TZ_Y + 34, W - 54 - 80 - 54, 2);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 8. MALAYALAM TITLE — red highlight blocks
  // ═══════════════════════════════════════════════════════
  const PAD      = 54;
  const TEXT_TOP = TZ_Y + 60;
  const TEXT_BOT = H - 130;   // leave room for source badge + footer
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;

  // Resolve title segments
  let allSegments = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    allSegments = newsItem.titleLines;
  } else if (newsItem.title) {
    allSegments = [newsItem.title];
  }
  if (newsItem.lastLine) {
    allSegments = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine,
    ];
  }

  // Find best font size
  let FONT_SIZE = 84;
  let allLines  = [];
  const GAP     = 12;

  while (FONT_SIZE >= 44) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }
    const V_PAD  = Math.round(FONT_SIZE * 0.24);
    const blockH = FONT_SIZE + V_PAD * 2;
    if (allLines.length * (blockH + GAP) - GAP <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const V_PAD  = Math.round(FONT_SIZE * 0.24);
  const blockH = FONT_SIZE + V_PAD * 2;
  const totalH = allLines.length * (blockH + GAP) - GAP;
  let drawY    = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";

    const lineW = ctx.measureText(allLines[i]).width;
    const rectX = PAD - 14;
    const rectY = drawY - V_PAD;
    const rectW = lineW + 28;
    const rectH = blockH;

    // Red tapered rectangle (subtle taper)
    ctx.fillStyle = "#e8000d";
    ctx.beginPath();
    ctx.moveTo(rectX,           rectY);
    ctx.lineTo(rectX + rectW + 10, rectY);
    ctx.lineTo(rectX + rectW,   rectY + rectH);
    ctx.lineTo(rectX,           rectY + rectH);
    ctx.closePath();
    ctx.fill();

    // Subtle top shine
    const shine = ctx.createLinearGradient(0, rectY, 0, rectY + rectH * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.12)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.moveTo(rectX,           rectY);
    ctx.lineTo(rectX + rectW + 10, rectY);
    ctx.lineTo(rectX + rectW,   rectY + rectH * 0.5);
    ctx.lineTo(rectX,           rectY + rectH * 0.5);
    ctx.closePath();
    ctx.fill();

    // White text with subtle shadow
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = 5;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(allLines[i], PAD, drawY);

    ctx.restore();
    drawY += blockH + GAP;
  }

  // ═══════════════════════════════════════════════════════
  // 9. SOURCE BADGE (credibility signal)
  // ═══════════════════════════════════════════════════════
  if (newsItem.source) {
    drawSourceBadge(ctx, newsItem.source, W / 2, H - 122);
  }

  // ═══════════════════════════════════════════════════════
  // 10. SOLID RED FOOTER BAR (strong brand anchor)
  // ═══════════════════════════════════════════════════════
  const FOOT_H = 70;
  const FOOT_Y = H - FOOT_H;

  // Solid red bar
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, FOOT_Y, W, FOOT_H);
  ctx.restore();

  // Subtle inner shine on footer
  ctx.save();
  const footShine = ctx.createLinearGradient(0, FOOT_Y, 0, FOOT_Y + FOOT_H * 0.5);
  footShine.addColorStop(0, "rgba(255,255,255,0.1)");
  footShine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = footShine;
  ctx.fillRect(0, FOOT_Y, W, FOOT_H * 0.5);
  ctx.restore();

  // Brand: FLASH KERALAM
  ctx.save();
  ctx.font          = "bold 28px English";
  ctx.letterSpacing = "7px";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillStyle     = "#ffffff";
  ctx.fillText("FLASH", 32, FOOT_Y + FOOT_H / 2);
  const fW = ctx.measureText("FLASH").width + 38;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText("KERALAM", 32 + fW, FOOT_Y + FOOT_H / 2);
  ctx.restore();

  // Website — centered
  ctx.save();
  ctx.font          = "bold 18px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "rgba(255,255,255,0.55)";
  ctx.textAlign     = "center";
  ctx.textBaseline  = "middle";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + FOOT_H / 2);
  ctx.restore();

  // Hashtag — right
  ctx.save();
  ctx.font          = "bold 17px English";
  ctx.letterSpacing = "1px";
  ctx.fillStyle     = "rgba(255,255,255,0.45)";
  ctx.textAlign     = "right";
  ctx.textBaseline  = "middle";
  ctx.fillText("#FlashKeralam", W - 30, FOOT_Y + FOOT_H / 2);
  ctx.restore();

  // ── Reset ─────────────────────────────────────────────
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };