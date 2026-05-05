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
const H = 1280;

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

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ═══════════════════════════════════════════════════════
  // 1. BACKGROUND
  // ═══════════════════════════════════════════════════════
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);

  // Halftone dot texture
  ctx.save();
  ctx.globalAlpha = 0.018;
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row < H; row += 12) {
    for (let col = 0; col < W; col += 12) {
      ctx.beginPath();
      ctx.arc(col, row, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 2. IMAGE — top 52%
  // ═══════════════════════════════════════════════════════
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

    // Warm tone overlay
    ctx.fillStyle = "rgba(20,5,0,0.18)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Bottom fade
    const fade = ctx.createLinearGradient(0, IMG_H * 0.3, 0, IMG_H);
    fade.addColorStop(0, "rgba(10,10,12,0)");
    fade.addColorStop(0.6, "rgba(10,10,12,0.75)");
    fade.addColorStop(1,   "rgba(10,10,12,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    // Side fades
    const leftFade = ctx.createLinearGradient(0, 0, 80, 0);
    leftFade.addColorStop(0, "rgba(10,10,12,0.8)");
    leftFade.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = leftFade;
    ctx.fillRect(0, 0, 80, IMG_H);

    const rightFade = ctx.createLinearGradient(W - 80, 0, W, 0);
    rightFade.addColorStop(0, "rgba(10,10,12,0)");
    rightFade.addColorStop(1, "rgba(10,10,12,0.8)");
    ctx.fillStyle = rightFade;
    ctx.fillRect(W - 80, 0, 80, IMG_H);

    // Top vignette
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

  // ═══════════════════════════════════════════════════════
  // 3. TOP HEADER BAR
  // ═══════════════════════════════════════════════════════
  const headerH = 72;

  ctx.save();
  ctx.fillStyle = "rgba(10,10,12,0.85)";
  ctx.fillRect(0, 0, W, headerH);
  ctx.restore();

  // Left red accent bar
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, 0, 6, headerH);
  ctx.restore();

  // ── BREAKING NEWS tag (left side of header) ──────────
  const tagLabel  = (newsItem.tag || "BREAKING NEWS").toUpperCase();
  const tagCY     = headerH / 2;
  const tagX      = 24;
  const tagH      = 40;

  ctx.save();
  ctx.font          = "bold 17px English";
  ctx.letterSpacing = "3px";
  const tagTextW    = ctx.measureText(tagLabel).width;
  const tagW        = tagTextW + 52; // dot + padding

  ctx.fillStyle = "#e8000d";
  roundRect(ctx, tagX, tagCY - tagH / 2, tagW, tagH, 5);
  ctx.fill();

  // Animated live dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(tagX + 18, tagCY, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(tagLabel, tagX + 32, tagCY + 1);
  ctx.restore();

  // ── FLASH KERALAM branding (right side of header) ────
  ctx.save();
  // Separator line
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(W - 230, 14, 1, headerH - 28);

  ctx.font          = "bold 26px English";
  ctx.letterSpacing = "5px";
  ctx.textBaseline  = "middle";
  ctx.textAlign     = "right";

  // Measure "FLASH" width to position "KERALAM"
  ctx.fillStyle = "#ffffff";
  const flashW  = ctx.measureText("FLASH").width;

  // Right-align: draw KERALAM first (rightmost), then FLASH before it
  // Total string: "FLASH KERALAM"
  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", W - 22, headerH / 2);

  const keralamW = ctx.measureText("KERALAM").width;
  ctx.fillStyle  = "#ffffff";
  ctx.fillText("FLASH ", W - 22 - keralamW, headerH / 2);

  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 4. RED RULE + DATE BLOCK
  // ═══════════════════════════════════════════════════════
  const PAD        = 54;
  const RULE_Y     = IMG_H + 24;

  // Bold red rule
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(PAD, RULE_Y, 64, 5);
  ctx.restore();

  // Thin white line extending to right
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(PAD + 72, RULE_Y + 1.5, W - PAD - 72 - PAD, 2);
  ctx.restore();

  // ── Date — just above the title ──────────────────────
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const weekday = now.toLocaleDateString("en-IN", { weekday: "long" }).toUpperCase();

  const DATE_Y = RULE_Y + 22;

  ctx.save();
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  // Day + Month in white
  ctx.font          = "bold 22px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "#ffffff";
  ctx.fillText(`${day} ${month} ${year}`, PAD, DATE_Y);

  // Weekday separator dot + weekday
  const dmW = ctx.measureText(`${day} ${month} ${year}`).width + 14;
  ctx.font      = "bold 16px English";
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.fillText("·", PAD + dmW, DATE_Y + 3);
  ctx.fillText(weekday, PAD + dmW + 18, DATE_Y + 3);

  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 5. MALAYALAM TITLE — red bg + white text
  // ═══════════════════════════════════════════════════════
  const TEXT_TOP = DATE_Y + 48;
  const TEXT_BOT = H - 148; // leave room for source tag + footer
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;

  // ── Step A: resolve segments ──────────────────────────
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

  // ── Step B: find best font size ──────────────────────
  let FONT_SIZE = 82;
  let allLines  = [];
  const GAP     = 10;

  while (FONT_SIZE >= 40) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }
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

  // ── Step C: ALL lines — red bg + white text ───────────
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
    ctx.moveTo(rectX, rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW, rectY + rectH);
    ctx.lineTo(rectX, rectY + rectH);
    ctx.closePath();
    ctx.fill();

    // Shine on top half
    const shine = ctx.createLinearGradient(0, rectY, 0, rectY + rectH * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.10)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.moveTo(rectX, rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW, rectY + rectH * 0.5);
    ctx.lineTo(rectX, rectY + rectH * 0.5);
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

  // ═══════════════════════════════════════════════════════
  // 6. SOURCE TAG (below title, above footer)
  // ═══════════════════════════════════════════════════════
  if (newsItem.source) {
    const srcLabel  = ("● " + newsItem.source).toUpperCase();
    const SRC_Y     = H - 138;
    const srcH      = 42;

    ctx.save();
    ctx.font          = "bold 16px English";
    ctx.letterSpacing = "3px";
    const srcTextW    = ctx.measureText(srcLabel).width;
    const srcW        = srcTextW + 36;

    // Dark pill bg
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    roundRect(ctx, PAD - 12, SRC_Y - srcH / 2, srcW, srcH, 6);
    ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth   = 1.5;
    roundRect(ctx, PAD - 12, SRC_Y - srcH / 2, srcW, srcH, 6);
    ctx.stroke();

    // Text
    ctx.fillStyle    = "rgba(255,255,255,0.75)";
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(srcLabel, PAD + 6, SRC_Y + 1);

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════
  // 7. BOTTOM FOOTER
  // ═══════════════════════════════════════════════════════
  const FOOT_H = 72;
  const FOOT_Y = H - FOOT_H;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, FOOT_Y, W, FOOT_H);

  // Red top border
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, FOOT_Y, W, 3);

  ctx.textBaseline = "middle";

  // Brand — FLASH (white) KERALAM (red)
  ctx.font          = "bold 18px English";
  ctx.letterSpacing = "4px";
  ctx.fillStyle     = "rgba(255,255,255,0.55)";
  ctx.textAlign     = "left";
  ctx.fillText("FLASH", 28, FOOT_Y + FOOT_H / 2);

  const fW = ctx.measureText("FLASH").width;
  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", 28 + fW + 12, FOOT_Y + FOOT_H / 2);

  // Website — centre
  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "rgba(255,255,255,0.30)";
  ctx.textAlign     = "center";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + FOOT_H / 2);

  // Hashtag — right
  ctx.font          = "bold 14px English";
  ctx.letterSpacing = "1px";
  ctx.fillStyle     = "rgba(255,255,255,0.22)";
  ctx.textAlign     = "right";
  ctx.fillText("#FlashKeralam", W - 28, FOOT_Y + FOOT_H / 2);

  ctx.restore();

  // ── Reset ─────────────────────────────────────────────
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };