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
const H = 1580;

// ═══════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function wrapTextSimple(ctx, text, maxWidth) {
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

function hardBreak(ctx, word, maxWidth) {
  const chars = [...word];
  const lines = [];
  let cur = "";
  for (const ch of chars) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapTextFull(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      cur = test;
    } else if (cur) {
      if (ctx.measureText(word).width > maxWidth) {
        lines.push(cur);
        cur = "";
        const broken = hardBreak(ctx, word, maxWidth);
        for (let j = 0; j < broken.length - 1; j++) lines.push(broken[j]);
        cur = broken[broken.length - 1];
      } else {
        lines.push(cur);
        cur = word;
      }
    } else {
      const broken = hardBreak(ctx, word, maxWidth);
      for (let j = 0; j < broken.length - 1; j++) lines.push(broken[j]);
      cur = broken[broken.length - 1];
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

function resolveSegments(newsItem) {
  let segs = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    segs = newsItem.titleLines;
  } else if (newsItem.title) {
    segs = [newsItem.title];
  }
  if (newsItem.lastLine) {
    segs = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine,
    ];
  }
  return segs;
}

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN A — Split layout: top 58% image + dark text panel below
// ═══════════════════════════════════════════════════════════════════════════
async function designA(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // 1. BACKGROUND
  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = 1;
  for (let i = -H; i < W + H; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  // 2. IMAGE — top 58%
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

    const fade1 = ctx.createLinearGradient(0, IMG_H * 0.38, 0, IMG_H);
    fade1.addColorStop(0,    "rgba(13,15,20,0)");
    fade1.addColorStop(0.75, "rgba(13,15,20,0.85)");
    fade1.addColorStop(1,    "rgba(13,15,20,1)");
    ctx.fillStyle = fade1;
    ctx.fillRect(0, 0, W, IMG_H);

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

  // 3. TOP BAR
  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0,   "rgba(255,180,0,0)");
  accentGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  accentGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  accentGrad.addColorStop(1,   "rgba(255,180,0,0)");
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 3);

  ctx.save();
  ctx.font = "bold 26px English"; ctx.letterSpacing = "4px";
  ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 0.92;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("FLASH", 48, 52);
  ctx.restore();

  ctx.save();
  ctx.font = "bold 26px English"; ctx.letterSpacing = "4px";
  const flashW = ctx.measureText("FLASH").width + 34;
  ctx.fillStyle = "#ffb400"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("KERALAM", 48 + flashW, 52);
  ctx.restore();

  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  ctx.save();
  ctx.font = "bold 20px English";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText(dateStr, W - 48, 52);
  ctx.restore();

  // 4. BREAKING TAG
  const TAG_Y    = IMG_H - 38;
  const tagLabel = newsItem.tag || "BREAKING";

  ctx.save();
  ctx.font = "bold 19px English"; ctx.letterSpacing = "3px";
  const tagTW = ctx.measureText(tagLabel).width + 22;
  const tagW  = tagTW + 48;
  const tagH  = 38;
  const tagX  = W / 2 - tagW / 2;
  const tagCY = TAG_Y;

  const redGrad = ctx.createLinearGradient(tagX, tagCY - tagH / 2, tagX, tagCY + tagH / 2);
  redGrad.addColorStop(0, "#ff2d2d");
  redGrad.addColorStop(1, "#cc0000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, tagX, tagCY - tagH / 2, tagW, tagH, tagH / 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,120,120,0.4)"; ctx.lineWidth = 1.5;
  roundRect(ctx, tagX + 1, tagCY - tagH / 2 + 1, tagW - 2, tagH - 2, tagH / 2 - 1);
  ctx.stroke();

  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tagLabel, W / 2, tagCY + 1);
  ctx.restore();

  // 5. DIVIDER
  const DIV_Y   = IMG_H + 18;
  const divGrad = ctx.createLinearGradient(54, 0, W - 54, 0);
  divGrad.addColorStop(0,    "rgba(255,180,0,0)");
  divGrad.addColorStop(0.15, "rgba(255,180,0,0.9)");
  divGrad.addColorStop(0.85, "rgba(255,180,0,0.9)");
  divGrad.addColorStop(1,    "rgba(255,180,0,0)");
  ctx.fillStyle = divGrad;
  ctx.fillRect(54, DIV_Y, W - 108, 2);

  // 6. MALAYALAM TITLE
  const PAD      = 58;
  const TEXT_TOP = IMG_H + 44;
  const TEXT_BOT = H - 36;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

  const allSegments = resolveSegments(newsItem);

  let FONT_SIZE = 72;
  let allLines  = [];

  while (FONT_SIZE >= 38) {
    ctx.font = `bold ${FONT_SIZE}px Malayalam`; ctx.letterSpacing = "0px";
    allLines  = [];
    for (const seg of allSegments) {
      allLines.push(...wrapTextSimple(ctx, seg, TEXT_W));
    }
    if (allLines.length * Math.round(FONT_SIZE * 1.18) <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const LINE_H = Math.round(FONT_SIZE * 1.18);
  const totalH = allLines.length * LINE_H;
  let drawY    = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign = "center"; ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font = `bold ${FONT_SIZE}px Malayalam`; ctx.letterSpacing = "0px";
    ctx.shadowColor = "rgba(0,0,0,0.95)"; ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;

    const isLast       = i === allLines.length - 1;
    const isSecondLast = i === allLines.length - 2;

    if (isLast) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#ffe566"); g.addColorStop(1, "#ffaa00");
      ctx.fillStyle = g;
    } else if (isSecondLast && allLines.length > 2) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#fff0aa"); g.addColorStop(1, "#ffd040");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#f5f5f5";
    }

    ctx.fillText(allLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H;
  }

  // 7. FOOTER
  const FOOT_Y = H - 34;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, FOOT_Y - 1, W, 1);
  ctx.font = "bold 17px English"; ctx.letterSpacing = "2px";
  ctx.fillStyle = "rgba(255,180,0,0.55)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + 17);
  ctx.restore();

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN B — Full-bleed image with text overlaid at bottom (left-aligned)
// ═══════════════════════════════════════════════════════════════════════════
async function designB(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // 1. BACKGROUND FALLBACK
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, W, H);

  // 2. FULL-HEIGHT IMAGE — cover crop
  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } catch {
    const fallback = ctx.createLinearGradient(0, 0, W, H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#0a0a0a");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, H);
  }

  // 3. GRADIENT OVERLAYS
  const bottomFade = ctx.createLinearGradient(0, H * 0.28, 0, H);
  bottomFade.addColorStop(0,    "rgba(0,0,0,0)");
  bottomFade.addColorStop(0.35, "rgba(0,0,0,0.60)");
  bottomFade.addColorStop(0.65, "rgba(0,0,0,0.85)");
  bottomFade.addColorStop(1,    "rgba(0,0,0,0.95)");
  ctx.fillStyle = bottomFade;
  ctx.fillRect(0, 0, W, H);

  const topFade = ctx.createLinearGradient(0, 0, 0, 200);
  topFade.addColorStop(0,   "rgba(0,0,0,0.72)");
  topFade.addColorStop(0.6, "rgba(0,0,0,0.30)");
  topFade.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, W, 200);

  const leftVig = ctx.createLinearGradient(0, 0, 160, 0);
  leftVig.addColorStop(0, "rgba(0,0,0,0.40)");
  leftVig.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = leftVig;
  ctx.fillRect(0, 0, 160, H);

  // 4. TOP-LEFT BRAND + DATE
  const BRAND_X = 36;
  const BRAND_Y = 44;

  ctx.save();
  ctx.font = "bold 32px English"; ctx.letterSpacing = "1px";
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
  ctx.fillText(newsItem.brand || "FLASH KERALAM", BRAND_X, BRAND_Y);
  ctx.restore();

  const now     = new Date();
  const dateStr = `${now.toLocaleDateString("en-IN", { weekday: "short" })} ${now.toLocaleDateString("en-IN", { month: "short" })} ${now.getDate()} ${now.getFullYear()}`;

  ctx.save();
  ctx.font = "bold 20px English"; ctx.letterSpacing = "0px";
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
  ctx.fillText(dateStr, BRAND_X, BRAND_Y + 42);
  ctx.restore();

  // 5. MALAYALAM TITLE — left-aligned, bottom-anchored
  const PAD_L            = 36;
  const PAD_R            = 40;
  const MALAYALAM_SAFETY = 0.88;
  const TEXT_W           = (W - PAD_L - PAD_R) * MALAYALAM_SAFETY;
  const TITLE_BOT        = H - 80;
  const ZONE_TOP         = Math.round(H * 0.38);
  const MAX_TEXT_H       = TITLE_BOT - ZONE_TOP;
  const MAX_FONT         = 55;
  const MIN_FONT         = 28;

  const allSegments = resolveSegments(newsItem);

  let lo = MIN_FONT, hi = MAX_FONT, bestSize = MIN_FONT, bestLines = [];

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `bold ${mid}px Malayalam`; ctx.letterSpacing = "0px";

    const wrapped = [];
    for (const seg of allSegments) {
      wrapped.push(...wrapTextFull(ctx, seg, TEXT_W));
    }

    if (wrapped.length * Math.round(mid * 1.10) <= MAX_TEXT_H) {
      bestSize  = mid;
      bestLines = wrapped;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const FONT_SIZE = bestSize;
  const LINE_H    = Math.round(FONT_SIZE * 1.15);
  let drawY       = TITLE_BOT - bestLines.length * LINE_H;

  for (let i = 0; i < bestLines.length; i++) {
    ctx.save();
    ctx.font = `bold ${FONT_SIZE}px Malayalam`; ctx.letterSpacing = "0px";
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    ctx.shadowColor = "rgba(0,0,0,0.95)"; ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(bestLines[i], PAD_L, drawY);

    ctx.shadowColor = "rgba(0,0,0,0.70)"; ctx.shadowBlur = 40;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6;
    ctx.fillText(bestLines[i], PAD_L, drawY);

    ctx.restore();
    drawY += LINE_H;
  }

  // 6. BOTTOM HANDLE / WATERMARK
  ctx.save();
  ctx.font = "bold 22px English"; ctx.letterSpacing = "0px";
  ctx.fillStyle = "rgba(255,255,255,0.80)";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 8;
  ctx.fillText(newsItem.handle || "@flashkeralam", PAD_L, H - 46);
  ctx.restore();

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API — randomly picks Design A or Design B on each call
// ═══════════════════════════════════════════════════════════════════════════
async function createNewsPoster(newsItem) {
  const useDesignA = Math.random() < 0.5;
  console.log(`[canvasService] Using Design ${useDesignA ? "A (Split layout)" : "B (Full-bleed)"}`);
  return useDesignA ? designA(newsItem) : designB(newsItem);
}

module.exports = { createNewsPoster };