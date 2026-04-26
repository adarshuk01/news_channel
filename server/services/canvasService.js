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

// ── Utility: wrap text ────────────────────────────────────
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

// ── Utility: rounded rect ─────────────────────────────────
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
  // 1. BACKGROUND — deep ink black with subtle blue tint
  // ═══════════════════════════════════════════════════════
  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, W, H);

  // Subtle diagonal texture lines (premium feel)
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 2. IMAGE — top 58%, cinematic crop with layered overlays
  // ═══════════════════════════════════════════════════════
  const IMG_H = Math.round(H * 0.58);

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W   - dw) / 2;
    const dy    = (IMG_H - dh) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, IMG_H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);

    // Layer 1: deep bottom fade to background
    const fade1 = ctx.createLinearGradient(0, IMG_H * 0.38, 0, IMG_H);
    fade1.addColorStop(0, "rgba(13,15,20,0)");
    fade1.addColorStop(0.75, "rgba(13,15,20,0.85)");
    fade1.addColorStop(1, "rgba(13,15,20,1)");
    ctx.fillStyle = fade1;
    ctx.fillRect(0, 0, W, IMG_H);

    // Layer 2: side vignettes for cinematic frame
    const leftVig = ctx.createLinearGradient(0, 0, 120, 0);
    leftVig.addColorStop(0, "rgba(0,0,0,0.55)");
    leftVig.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = leftVig;
    ctx.fillRect(0, 0, 120, IMG_H);

    const rightVig = ctx.createLinearGradient(W - 120, 0, W, 0);
    rightVig.addColorStop(0, "rgba(0,0,0,0)");
    rightVig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = rightVig;
    ctx.fillRect(W - 120, 0, 120, IMG_H);

    // Layer 3: top vignette
    const topVig = ctx.createLinearGradient(0, 0, 0, 180);
    topVig.addColorStop(0, "rgba(0,0,0,0.60)");
    topVig.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topVig;
    ctx.fillRect(0, 0, W, IMG_H);

    ctx.restore();
  } catch {
    const fallback = ctx.createLinearGradient(0, 0, W, IMG_H);
    fallback.addColorStop(0, "#1a1d26");
    fallback.addColorStop(1, "#0d0f14");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ═══════════════════════════════════════════════════════
  // 3. TOP BAR — brand strip with accent line
  // ═══════════════════════════════════════════════════════

  // Thin gold accent line at very top
  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0,   "rgba(255,180,0,0)");
  accentGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  accentGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  accentGrad.addColorStop(1,   "rgba(255,180,0,0)");
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 3);

  // Brand logo area — top left
  ctx.save();
  ctx.font          = "bold 26px English";
  ctx.letterSpacing = "4px";
  ctx.fillStyle     = "#ffffff";
  ctx.globalAlpha   = 0.92;
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText("FLASH", 48, 52);
  ctx.restore();

  // "KERALAM" in gold
  ctx.save();
  ctx.font          = "bold 26px English";
  ctx.letterSpacing = "4px";
  const flashW = (() => {
    ctx.font = "bold 26px English";
    ctx.letterSpacing = "4px";
    return ctx.measureText("FLASH").width + 34; // approx with letter spacing
  })();
  ctx.fillStyle    = "#ffb400";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("KERALAM", 48 + flashW, 52);
  ctx.restore();

  // Date — top right
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  ctx.save();
  ctx.font         = "bold 20px English";
  ctx.fillStyle    = "rgba(255,255,255,0.55)";
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(dateStr, W - 48, 52);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 4. BREAKING TAG — bold red pill above text block
  // ═══════════════════════════════════════════════════════
  const TAG_Y  = IMG_H - 38;
  const tagLabel = newsItem.tag || "BREAKING";

  ctx.save();
  ctx.font = "bold 19px English";
  ctx.letterSpacing = "3px";
  const tagTW = ctx.measureText(tagLabel).width + 22; // spacing correction
  const tagW  = tagTW + 48;
  const tagH  = 38;
  const tagX  = W / 2 - tagW / 2;
  const tagCY = TAG_Y;

  // Red pill background
  const redGrad = ctx.createLinearGradient(tagX, tagCY - tagH/2, tagX, tagCY + tagH/2);
  redGrad.addColorStop(0, "#ff2d2d");
  redGrad.addColorStop(1, "#cc0000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, tagX, tagCY - tagH / 2, tagW, tagH, tagH / 2);
  ctx.fill();

  // Subtle inner glow on tag
  ctx.strokeStyle = "rgba(255,120,120,0.4)";
  ctx.lineWidth   = 1.5;
  roundRect(ctx, tagX + 1, tagCY - tagH / 2 + 1, tagW - 2, tagH - 2, tagH / 2 - 1);
  ctx.stroke();

  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tagLabel, W / 2, tagCY + 1);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 5. DIVIDER LINE — gold accent under image/above text
  // ═══════════════════════════════════════════════════════
  const DIV_Y = IMG_H + 18;
  const divGrad = ctx.createLinearGradient(54, 0, W - 54, 0);
  divGrad.addColorStop(0,   "rgba(255,180,0,0)");
  divGrad.addColorStop(0.15,"rgba(255,180,0,0.9)");
  divGrad.addColorStop(0.85,"rgba(255,180,0,0.9)");
  divGrad.addColorStop(1,   "rgba(255,180,0,0)");
  ctx.fillStyle = divGrad;
  ctx.fillRect(54, DIV_Y, W - 108, 2);

  // ═══════════════════════════════════════════════════════
  // 6. MALAYALAM TITLE TEXT — premium typography
  // ═══════════════════════════════════════════════════════
  const PAD      = 58;
  const TEXT_TOP = IMG_H + 44;
  const TEXT_BOT = H - 36;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

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

  // ── Step B: find best unified font size ──────────────
  let FONT_SIZE     = 72;
  let allLines      = [];

  while (FONT_SIZE >= 38) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }
    const LINE_H = Math.round(FONT_SIZE * 1.18);
    if (allLines.length * LINE_H <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const LINE_H = Math.round(FONT_SIZE * 1.18);
  const totalH = allLines.length * LINE_H;
  let drawY    = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  // ── Step C: render each line with styling ─────────────
  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    ctx.wordSpacing   = "0px";

    // Drop shadow
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    const isLast       = i === allLines.length - 1;
    const isSecondLast = i === allLines.length - 2;

    if (isLast) {
      // Last line: bright gold gradient
      const gLast = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      gLast.addColorStop(0, "#ffe566");
      gLast.addColorStop(1, "#ffaa00");
      ctx.fillStyle = gLast;
    } else if (isSecondLast && allLines.length > 2) {
      // Second-to-last: warm gold
      const gSecond = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      gSecond.addColorStop(0, "#fff0aa");
      gSecond.addColorStop(1, "#ffd040");
      ctx.fillStyle = gSecond;
    } else {
      // Other lines: crisp white
      ctx.fillStyle = "#f5f5f5";
    }

    ctx.fillText(allLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H;
  }

  // ═══════════════════════════════════════════════════════
  // 7. BOTTOM FOOTER — thin strip
  // ═══════════════════════════════════════════════════════
  const FOOT_Y = H - 34;

  // Footer line
  ctx.save();
  ctx.fillStyle  = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, FOOT_Y - 1, W, 1);

  // Website or tagline
  ctx.font         = "bold 17px English";
  ctx.letterSpacing= "2px";
  ctx.fillStyle    = "rgba(255,180,0,0.55)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + 17);
  ctx.restore();

  // ── Reset ────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing= "0px";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };