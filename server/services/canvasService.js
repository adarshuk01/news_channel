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
const H = 1280;

// ─── hard-break a single word that is wider than maxWidth ────────────────────
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

// ─── word-wrap with hard-break fallback ──────────────────────────────────────
function wrapText(ctx, text, maxWidth) {
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

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ═══════════════════════════════════════════════════════
  // 1. BACKGROUND FALLBACK
  // ═══════════════════════════════════════════════════════
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, W, H);

  // ═══════════════════════════════════════════════════════
  // 2. FULL-HEIGHT IMAGE — cover crop
  // ═══════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════
  // 3. GRADIENT OVERLAYS
  // ═══════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════
  // 4. TOP-LEFT BRAND + DATE
  // ═══════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════
  // 5. MALAYALAM TITLE — LEFT-ALIGNED, FILLS THE FRAME
  //
  //  Strategy:
  //  • Available text zone  : from ZONE_TOP down to TITLE_BOT
  //  • Start at MAX_FONT and shrink 2px at a time until the
  //    wrapped block fits inside the zone height.
  //  • This makes short headlines huge; longer ones scale down
  //    but always stretch to fill as much vertical space as
  //    possible.
  //  • MALAYALAM_SAFETY shrinks the wrap-width slightly so
  //    ligatures (which measure ~12% wider than measureText)
  //    don't overflow the right edge.
  // ═══════════════════════════════════════════════════════
  const PAD_L           = 36;
  const PAD_R           = 40;
  const MALAYALAM_SAFETY = 0.88;
  const TEXT_W          = (W - PAD_L - PAD_R) * MALAYALAM_SAFETY;

  // Bottom anchor — leave room for handle + small breathing gap
  const TITLE_BOT = H - 80;

  // Top boundary — text block must not go above this
  // (sits just below where the image "reads" as a photo, ~35 % down)
  const ZONE_TOP  = Math.round(H * 0.38);

  // Max usable height for the text block
  const MAX_TEXT_H = TITLE_BOT - ZONE_TOP;   // ≈ 798 px — nearly half the poster

  // Collect segments
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

  // ── Binary-search for the largest font that fits ─────────────────────────
  // (faster than stepping 2 px at a time across a wide range)
const MAX_FONT = 55;
const MIN_FONT = 28;

  let lo = MIN_FONT, hi = MAX_FONT, bestSize = MIN_FONT, bestLines = [];

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);

    ctx.font          = `bold ${mid}px Malayalam`;
    ctx.letterSpacing = "0px";

    const wrapped = [];
    for (const seg of allSegments) {
      wrapped.push(...wrapText(ctx, seg, TEXT_W));
    }

    const blockH = wrapped.length * Math.round(mid * 1.10);

    if (blockH <= MAX_TEXT_H) {
      // Fits — try larger
      bestSize  = mid;
      bestLines = wrapped;
      lo = mid + 1;
    } else {
      // Doesn't fit — try smaller
      hi = mid - 1;
    }
  }

  const FONT_SIZE = bestSize;
  const LINE_H    = Math.round(FONT_SIZE * 1.15);
  const totalH    = bestLines.length * LINE_H;

  // Bottom-anchor the block so text "grows upward" from TITLE_BOT
  let drawY = TITLE_BOT - totalH;

  for (let i = 0; i < bestLines.length; i++) {
    ctx.save();

    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    ctx.textAlign     = "left";          // ← left-aligned
    ctx.textBaseline  = "top";

    // Shadow layer 1 — tight dark
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 22;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(bestLines[i], PAD_L, drawY);

    // Shadow layer 2 — wide soft
    ctx.shadowColor   = "rgba(0,0,0,0.70)";
    ctx.shadowBlur    = 40;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.fillText(bestLines[i], PAD_L, drawY);

    ctx.restore();
    drawY += LINE_H;
  }

  // ═══════════════════════════════════════════════════════
  // 6. BOTTOM HANDLE / WATERMARK
  // ═══════════════════════════════════════════════════════
  ctx.save();
  ctx.font          = "bold 22px English";
  ctx.letterSpacing = "0px";
  ctx.fillStyle     = "rgba(255,255,255,0.80)";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.shadowColor   = "rgba(0,0,0,0.8)";
  ctx.shadowBlur    = 8;
  ctx.fillText(newsItem.handle || "@flashkeralam", PAD_L, H - 46);
  ctx.restore();

  // ── Reset ────────────────────────────────────────────────────────────────
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };