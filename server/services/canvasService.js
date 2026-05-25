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

const W            = 1080;
const H            = 1380;
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

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

function computeAdHeight(adImg) {
  if (!adImg) return DEFAULT_AD_H;
  const naturalH = Math.round((adImg.height / adImg.width) * W);
  return Math.min(MAX_AD_H, Math.max(DEFAULT_AD_H, naturalH));
}

// ═════════════════════════════════════════════════════════════
// AD STRIP  (ported from blue matrix design)
// ═════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  // Base black background
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  // ── Real ad image supplied ────────────────────────────────
  if (adImg) {
    const scaleW = W / adImg.width;
    const scaleH = adH / adImg.height;
    const scale  = Math.max(scaleW, scaleH);

    const drawW = adImg.width  * scale;
    const drawH = adImg.height * scale;
    const drawX = (W - drawW) / 2;
    const drawY = yOffset + (adH - drawH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yOffset, W, adH);
    ctx.clip();
    ctx.drawImage(adImg, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Gold top divider line
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
    lineGrad.addColorStop(0.2, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(0.8, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(1,   "rgba(255,180,0,0)");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, yOffset, W, 3);

    return;
  }

  // ── Fallback ad (no image) ────────────────────────────────

  // Dark gradient background
  const bg = ctx.createLinearGradient(0, yOffset, 0, yOffset + adH);
  bg.addColorStop(0, "#0d1b4b");
  bg.addColorStop(1, "#091230");
  ctx.fillStyle = bg;
  ctx.fillRect(0, yOffset, W, adH);

  // Gold top + bottom divider lines
  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
  lineGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  lineGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  lineGrad.addColorStop(1,   "rgba(255,180,0,0)");

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset, W, 3);

  // Subtle dot pattern
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

  // Megaphone emoji backdrop
  ctx.save();
  ctx.font         = "bold 52px English";
  ctx.fillStyle    = "rgba(255,200,60,0.22)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("📢", W / 2, yOffset + adH / 2 - 8);
  ctx.restore();

  // Malayalam fallback text
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

  // Gold bottom divider line
  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
// ═════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Load ad image if URL supplied ────────────────────────
  const hasAd   = Boolean(newsItem.adBannerUrl);
  let adImg     = null;
  let actualAdH = 0; // 0 = no ad strip at all

  if (hasAd) {
    try {
      console.log("[Ad] Loading:", newsItem.adBannerUrl);
      adImg     = await loadImage(newsItem.adBannerUrl);
      console.log(`[Ad] Loaded OK: ${adImg.width}x${adImg.height}px`);
      actualAdH = computeAdHeight(adImg);
      console.log(`[Ad] Strip height: ${actualAdH}px`);
    } catch (err) {
      console.error("[Ad] Failed to load image:", err.message);
      console.error("[Ad] URL was:", newsItem.adBannerUrl);
      // URL was given but image failed — show fallback ad strip
      adImg     = null;
      actualAdH = DEFAULT_AD_H;
    }
  } else {
    console.log("[Ad] No adBannerUrl provided — skipping ad strip entirely.");
  }

  const totalH = H + actualAdH;
  console.log(`[Canvas] ${W}x${totalH} (poster ${H}${actualAdH ? ` + ad ${actualAdH}` : ", no ad"})`);

  const canvas = createCanvas(W, totalH);
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

  // ── 3. Logo — FLASH / KERALAM ─────────────────────────────
  const LOGO_CY  = IMG_H - 30;
  const FLASH_SZ = 64;
  const KER_SZ   = 20;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.shadowColor  = "rgba(0,0,0,0.98)";
  ctx.shadowBlur   = 20;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.font          = `bold ${FLASH_SZ}px English`;
  ctx.fillStyle     = "#ffffff";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "5px";
  ctx.fillText("FLASH", W / 2, LOGO_CY);
  ctx.letterSpacing = "0px";

  ctx.font          = `bold ${KER_SZ}px English`;
  ctx.fillStyle     = "#dddddd";
  ctx.textBaseline  = "top";
  ctx.letterSpacing = "10px";
  ctx.fillText("KERALAM", W / 2 + 5, LOGO_CY + FLASH_SZ / 2 + 4);
  ctx.letterSpacing = "0px";

  ctx.restore();

  // ── 4. Date box — red 3D ─────────────────────────────────
  const now   = new Date();
  const day   = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year  = String(now.getFullYear());

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

  // Main red face
  ctx.globalAlpha = 1;
  const redGrad = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H);
  redGrad.addColorStop(0,    "#ff2828");
  redGrad.addColorStop(0.18, "#dd0000");
  redGrad.addColorStop(0.80, "#bb0000");
  redGrad.addColorStop(1,    "#880000");
  ctx.fillStyle = redGrad;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Specular sheen
  const sheen = ctx.createLinearGradient(BOX_X, BOX_Y, BOX_X, BOX_Y + BOX_H * 0.45);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_RAD);
  ctx.fill();

  // Date text
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
  const PAD      = 52;
  const TEXT_TOP = BOX_Y + BOX_H + 4;
  const TEXT_BOT = H - 50;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;
  const CX       = W / 2;

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

  const LINE_H_RATIO = 1.18;
  let BODY_SIZE = 82;
  let wrappedBody = [];

  while (BODY_SIZE >= 38) {
    ctx.font = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBody = [];
    for (const seg of bodyInput) {
      if (seg) wrappedBody.push(...wrapText(ctx, seg, TEXT_W));
    }
    const bodyH = wrappedBody.length * BODY_SIZE * LINE_H_RATIO;
    if (bodyH <= TEXT_H * 0.62) break;
    BODY_SIZE -= 2;
  }

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
  const totalH2 = wrappedBody.length * LINE_H_BODY + wrappedLast.length * LINE_H_LAST;

  let drawY = TEXT_TOP + Math.round((TEXT_H - totalH2) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

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

  // ── 6. Reset ─────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 7. Ad strip (only when adBannerUrl supplied) ─────────
  if (actualAdH > 0) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };