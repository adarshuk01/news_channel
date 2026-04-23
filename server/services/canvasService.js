const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs   = require("fs");

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/MANDARAM.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

const W = 1080;
const H = 1280;

// Split text into lines respecting maxWidth
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

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── 1. Background: very dark charcoal ────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 57% with dual-gradient overlay ────────
  const IMG_H = Math.round(H * 0.57);

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
    ctx.restore();

    // Heavy bottom fade into background colour
    const bottomFade = ctx.createLinearGradient(0, IMG_H * 0.45, 0, IMG_H);
    bottomFade.addColorStop(0, "rgba(24,24,24,0)");
    bottomFade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = bottomFade;
    ctx.fillRect(0, 0, W, IMG_H);

    // Subtle top vignette for pill-watermark readability
    const topFade = ctx.createLinearGradient(0, 0, 0, 160);
    topFade.addColorStop(0, "rgba(0,0,0,0.50)");
    topFade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, IMG_H);

  } catch {
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#181818");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Brand watermark pill + date ───────────────────────
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "long" });
  const year    = now.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  const BRAND_CY = IMG_H - 52;
  const pillH    = 46;
  const pillRad  = pillH / 2;

  ctx.save();
  ctx.font = "bold 22px English";
  const brandText  = "FLASH KERALAM";
  const brandTextW = ctx.measureText(brandText).width;
  const pillW      = brandTextW + 60;
  const pillX      = W / 2 - pillW / 2;
  const pillY      = BRAND_CY - pillH / 2;

  ctx.globalAlpha = 0.60;
  ctx.fillStyle   = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(pillX + pillRad, pillY);
  ctx.arcTo(pillX + pillW, pillY,         pillX + pillW, pillY + pillH, pillRad);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX,         pillY + pillH, pillRad);
  ctx.arcTo(pillX,         pillY + pillH, pillX,         pillY,         pillRad);
  ctx.arcTo(pillX,         pillY,         pillX + pillW, pillY,         pillRad);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha   = 1;
  ctx.font          = "bold 22px English";
  ctx.fillStyle     = "#1a1a1a";
  ctx.textAlign     = "center";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "3px";
  ctx.fillText(brandText, W / 2, BRAND_CY);
  ctx.letterSpacing = "0px";

  ctx.font         = "bold 22px English";
  ctx.fillStyle    = "#ffcc00";
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.fillText(dateStr, W / 2, pillY + pillH + 10);

  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // ── 4. Malayalam title text ───────────────────────────────
  const PAD      = 54;
  const TEXT_TOP = IMG_H + 40;
  const TEXT_BOT = H - 24;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

  // ── Step A: resolve body lines and last line ──────────────
  let bodyInput = [];
  let lastInput = "";

  if (newsItem.lastLine) {
    lastInput = newsItem.lastLine;
    bodyInput = Array.isArray(newsItem.titleLines)
      ? newsItem.titleLines
      : [newsItem.title || ""];
  } else if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    lastInput = newsItem.titleLines[newsItem.titleLines.length - 1];
    bodyInput = newsItem.titleLines.slice(0, -1);
  } else {
    const full     = newsItem.title || "";
    const spaceIdx = full.lastIndexOf(" ");
    if (spaceIdx > 0) {
      lastInput = full.slice(spaceIdx + 1);
      bodyInput = [full.slice(0, spaceIdx)];
    } else {
      lastInput = full;
      bodyInput = [];
    }
  }

  // ── Step B: body font size ────────────────────────────────
  let BODY_SIZE        = 64;
  let wrappedBodyLines = [];

  while (BODY_SIZE >= 36) {
    ctx.font = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBodyLines = [];
    for (const segment of bodyInput) {
      wrappedBodyLines.push(...wrapText(ctx, segment, TEXT_W));
    }
    if (wrappedBodyLines.length * BODY_SIZE * 1.38 <= TEXT_H * 0.60) break;
    BODY_SIZE -= 3;
  }

  // ── Step C: last-line font size ───────────────────────────
  let LAST_SIZE        = 96;
  let wrappedLastLines = [];

  while (LAST_SIZE >= 44) {
    ctx.font = `bold ${LAST_SIZE}px Malayalam`;
    wrappedLastLines = wrapText(ctx, lastInput, TEXT_W);
    if (wrappedLastLines.length * LAST_SIZE * 1.25 <= TEXT_H * 0.50) break;
    LAST_SIZE -= 4;
  }

  // ── Step D: vertical centering ────────────────────────────
  const LINE_H_BODY = Math.round(BODY_SIZE * 1.25);
  const LINE_H_LAST = Math.round(LAST_SIZE * 1.20);
  const totalTextH  =
    wrappedBodyLines.length * LINE_H_BODY +
    wrappedLastLines.length * LINE_H_LAST;

  let drawY = TEXT_TOP + Math.round((TEXT_H - totalTextH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  // ── Step E: body lines (white, last body line = yellow) ──
  const yellowIdx = wrappedBodyLines.length - 1;

  for (let i = 0; i < wrappedBodyLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${BODY_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.85)";
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    if (i === yellowIdx) {
      const yg = ctx.createLinearGradient(0, drawY, 0, drawY + BODY_SIZE);
      yg.addColorStop(0, "#ffe033");
      yg.addColorStop(1, "#ffaa00");
      ctx.fillStyle = yg;
    } else {
      ctx.fillStyle = "#ffffff";
    }

    ctx.fillText(wrappedBodyLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H_BODY;
  }

  // ── Step F: last line(s) — large white ───────────────────
  for (const line of wrappedLastLines) {
    ctx.save();
    ctx.font          = `bold ${LAST_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 16;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(line, CX, drawY);
    ctx.restore();
    drawY += LINE_H_LAST;
  }

  // ── 5. Reset ──────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };