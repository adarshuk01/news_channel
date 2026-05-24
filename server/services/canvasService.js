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

const W = 1080;
const H = 1380;

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

  // ── 1. Dark charcoal background ──────────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 46% ───────────────────────────────────
  const IMG_H = Math.round(H * 0.46);

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
    ctx.restore();

    // Fade photo → dark at the bottom
    const fade = ctx.createLinearGradient(0, IMG_H * 0.52, 0, IMG_H);
    fade.addColorStop(0, "rgba(24,24,24,0)");
    fade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

  } catch {
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#181818");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Logo — FLASH / KERALAM — centered at image bottom ─
  //  Positioned so it straddles the image/text boundary
  const LOGO_CY  = IMG_H - 30;   // center of FLASH text
  const FLASH_SZ = 64;
  const KER_SZ   = 20;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.shadowColor  = "rgba(0,0,0,0.98)";
  ctx.shadowBlur   = 20;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  // "FLASH" — large bold white
  ctx.font          = `bold ${FLASH_SZ}px English`;
  ctx.fillStyle     = "#ffffff";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "5px";
  ctx.fillText("FLASH", W / 2, LOGO_CY);
  ctx.letterSpacing = "0px";

  // "KERALAM" — small spaced below
  ctx.font          = `bold ${KER_SZ}px English`;
  ctx.fillStyle     = "#dddddd";
  ctx.textBaseline  = "top";
  ctx.letterSpacing = "10px";
  ctx.fillText("KERALAM", W / 2 + 5, LOGO_CY + FLASH_SZ / 2 + 4);
  ctx.letterSpacing = "0px";

  ctx.restore();

  // ── 4. Date box — red 3D, centered, just below KERALAM ───
  const now   = new Date();
  const day   = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year  = String(now.getFullYear());

  // Measure for tight box
  ctx.font = "bold 42px English";
  const dayW   = ctx.measureText(day).width;
  ctx.font = "bold 24px English";
  const monthW = ctx.measureText(month).width;
  ctx.font = "bold 19px English";
  const yearW  = ctx.measureText(year).width;

  const D_GAP  = 10;
  const MYW    = Math.max(monthW, yearW);
  const D_PADX = 26;
  const BOX_H  = 70;
  const BOX_W  = dayW + D_GAP + MYW + D_PADX * 2;
  const BOX_RAD = 7;
  const BOX_X  = W / 2 - BOX_W / 2;
  const BOX_Y  = LOGO_CY + FLASH_SZ / 2 + KER_SZ + 14;

  ctx.save();
  ctx.shadowBlur = 0;

  // Dark offset (3D thickness)
  ctx.globalAlpha = 0.65;
  ctx.fillStyle   = "#5a0000";
  roundRect(ctx, BOX_X + 5, BOX_Y + 5, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Main red face — gradient
  ctx.globalAlpha = 1;
  const redGrad = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H);
  redGrad.addColorStop(0,    "#ff2828");
  redGrad.addColorStop(0.18, "#dd0000");
  redGrad.addColorStop(0.80, "#bb0000");
  redGrad.addColorStop(1,    "#880000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Specular sheen top
  const sheen = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H * 0.45);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Date text inside box
  const DAY_X = BOX_X + D_PADX;
  const MID_Y = BOX_Y + BOX_H / 2;

  ctx.font         = "bold 42px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(day, DAY_X, MID_Y);

  const MY_X = DAY_X + dayW + D_GAP;
  ctx.font         = "bold 24px English";
  ctx.textBaseline = "bottom";
  ctx.fillText(month, MY_X, MID_Y - 1);

  ctx.font         = "bold 19px English";
  ctx.fillStyle    = "#ffcccc";
  ctx.textBaseline = "top";
  ctx.fillText(year, MY_X, MID_Y + 1);

  ctx.restore();

  // ── 5. Malayalam title text ───────────────────────────────
  //
  //  Body lines  → white, compact line-height
  //  2nd-to-last → golden yellow gradient
  //  Last line   → white, ~2.2× larger (big impact line)
  //
  const PAD      = 52;
  const TEXT_TOP = BOX_Y + BOX_H + 8;    // just below date box
  const TEXT_BOT = H - 50;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

  // Resolve inputs
  let bodyInput = [];
  let lastInput = "";

  if (newsItem.lastLine) {
    lastInput = newsItem.lastLine;
    bodyInput = Array.isArray(newsItem.titleLines)
      ? newsItem.titleLines
      : [newsItem.title || ""];
  } else if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    lastInput = newsItem.titleLines[newsItem.titleLines.length - 1];
    bodyInput  = newsItem.titleLines.slice(0, -1);
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

  // Auto-size body font — tight line-height 1.18
  const LINE_H_RATIO = 1.18;   // compact like reference
  let BODY_SIZE = 82;
  let wrappedBody = [];

  while (BODY_SIZE >= 38) {
    ctx.font = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBody = [];
    for (const seg of bodyInput) {
      if (seg) wrappedBody.push(...wrapText(ctx, seg, TEXT_W));
    }
    // Reserve 38% of text zone for the large last line
    const bodyH = wrappedBody.length * BODY_SIZE * LINE_H_RATIO;
    if (bodyH <= TEXT_H * 0.62) break;
    BODY_SIZE -= 2;
  }

  // Auto-size last line — ~2.2× body
  let LAST_SIZE = Math.round(BODY_SIZE * 1.7);
  let wrappedLast = [];

  while (LAST_SIZE >= 60) {
    ctx.font   = `bold ${LAST_SIZE}px Malayalam`;
    wrappedLast = lastInput ? wrapText(ctx, lastInput, TEXT_W) : [];
    const lastH = wrappedLast.length * LAST_SIZE * 1.10;
    if (lastH <= TEXT_H * 0.42) break;
    LAST_SIZE -= 4;
  }

  const LINE_H_BODY = Math.round(BODY_SIZE * LINE_H_RATIO);
  const LINE_H_LAST = Math.round(LAST_SIZE * 1.10);
  const totalH = wrappedBody.length * LINE_H_BODY + wrappedLast.length * LINE_H_LAST;

  // Vertically centre in text zone
  let drawY = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  // Body lines — white, second-to-last = yellow
  const yellowIdx = wrappedBody.length - 1;

  for (let i = 0; i < wrappedBody.length; i++) {
    ctx.save();
    ctx.font          = `bold ${BODY_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.90)";
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

    ctx.fillText(wrappedBody[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H_BODY;
  }

  // Last line — large white
  for (const line of wrappedLast) {
    ctx.save();
    ctx.font          = `bold ${LAST_SIZE}px Malayalam`;
    ctx.shadowColor   = "rgba(0,0,0,0.95)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(line, CX, drawY);
    ctx.restore();
    drawY += LINE_H_LAST;
  }

  // ── 6. Reset ──────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };