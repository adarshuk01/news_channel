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
const H = 1920;

// ── Ad Banner constants ───────────────────────────────────────
const AD_H      = 250;   // banner height in pixels
const AD_PAD_X  = 24;   // horizontal inset from poster edge
const AD_PAD_Y  = 20;   // gap between bottom of text zone and banner top
const AD_RADIUS = 16;   // rounded corner radius

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

// Clip/stroke a rounded rectangle
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
  const ctx = canvas.getContext("2d");

  // ── 1. Background: very dark charcoal ────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 58% of poster ─────────────────────────
  const IMG_H = Math.round(H * 0.58);

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
    ctx.restore();

    // Strong fade at the bottom of the image
    const bottomFade = ctx.createLinearGradient(0, IMG_H * 0.55, 0, IMG_H);
    bottomFade.addColorStop(0, "rgba(24,24,24,0)");
    bottomFade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = bottomFade;
    ctx.fillRect(0, 0, W, IMG_H);

  } catch {
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#181818");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Brand watermark + date ─────────────────────────────
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
  const TEXT_TOP = IMG_H + 58;

  // Shrink the text zone when a banner is present
  const hasAdBanner = newsItem.adBannerPath && fs.existsSync(newsItem.adBannerPath);
  const AD_TOTAL    = hasAdBanner ? (AD_H + AD_PAD_Y + AD_PAD_X) : 0;
  const TEXT_BOT    = H - 30 - AD_TOTAL;
  const TEXT_H      = TEXT_BOT - TEXT_TOP;
  const TEXT_W      = W - PAD * 2;
  const CX          = W / 2;

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
    const full = newsItem.title || "";
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
  let BODY_SIZE = 76;
  let wrappedBodyLines = [];

  while (BODY_SIZE >= 40) {
    ctx.font = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBodyLines = [];
    for (const segment of bodyInput) {
      wrappedBodyLines.push(...wrapText(ctx, segment, TEXT_W));
    }
    if (wrappedBodyLines.length * BODY_SIZE * 1.38 <= TEXT_H * 0.65) break;
    BODY_SIZE -= 3;
  }

  // ── Step C: last-line font size ───────────────────────────
  let LAST_SIZE = 120;
  let wrappedLastLines = [];

  while (LAST_SIZE >= 50) {
    ctx.font = `bold ${LAST_SIZE}px Malayalam`;
    wrappedLastLines = wrapText(ctx, lastInput, TEXT_W);
    if (wrappedLastLines.length * LAST_SIZE * 1.25 <= TEXT_H * 0.5) break;
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

  // ── Step E: body lines ────────────────────────────────────
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

  // ── 5. Ad Banner ─────────────────────────────────────────
  if (hasAdBanner) {
    const BAN_X = AD_PAD_X;
    const BAN_Y = H - AD_H - AD_PAD_X;          // flush to the bottom with padding
    const BAN_W = W - AD_PAD_X * 2;
    const BAN_H = AD_H;

    try {
      // Load from local file path — no network, always fast
      const adImg = await loadImage(fs.readFileSync(newsItem.adBannerPath));

      ctx.save();

      // Clip to rounded corners
      roundRect(ctx, BAN_X, BAN_Y, BAN_W, BAN_H, AD_RADIUS);
      ctx.clip();

      // Cover-fit: fill banner box without distortion
      const scale = Math.max(BAN_W / adImg.width, BAN_H / adImg.height);
      const dw    = adImg.width  * scale;
      const dh    = adImg.height * scale;
      const dx    = BAN_X + (BAN_W - dw) / 2;
      const dy    = BAN_Y + (BAN_H - dh) / 2;

      ctx.drawImage(adImg, dx, dy, dw, dh);
      ctx.restore();

      // Subtle border
      ctx.save();
      roundRect(ctx, BAN_X, BAN_Y, BAN_W, BAN_H, AD_RADIUS);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();

    } catch (err) {
      // Fallback placeholder if image is corrupted / unreadable
      console.warn("⚠️  Ad banner render failed:", err.message);

      ctx.save();
      roundRect(ctx, BAN_X, BAN_Y, BAN_W, BAN_H, AD_RADIUS);
      ctx.fillStyle = "#2a2a2a";
      ctx.fill();

      ctx.font         = "bold 28px English";
      ctx.fillStyle    = "#555555";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Advertisement", W / 2, BAN_Y + BAN_H / 2);
      ctx.restore();
    }
  }

  // ── 6. Reset ─────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };