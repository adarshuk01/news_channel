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
const H = 1080; // Square format like the template

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Palette matching the template ──────────────────────
  const GOLD       = "#F5C518";   // bright golden yellow for main text
  const GOLD_LIGHT = "#FFD84D";   // lighter gold accent
  const WHITE      = "#FFFFFF";
  const DARK_BG    = "#0D0D0D";   // near-black base
  const OVERLAY    = "rgba(0,0,0,0.55)";

  const PAD    = 48;
  // Text zone: top ~54%, image zone: bottom ~46%
  const TEXT_H = Math.round(H * 0.54);
  const IMG_Y  = TEXT_H;
  const IMG_H  = H - IMG_Y;

  // ══════════════════════════════════════════════════════
  // 1. BASE BACKGROUND — deep dark gradient
  // ══════════════════════════════════════════════════════
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0,   "#111111");
  bgGrad.addColorStop(0.5, "#0A0A0A");
  bgGrad.addColorStop(1,   "#050505");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette corners
  const vig = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ══════════════════════════════════════════════════════
  // 2. PHOTO ZONE — bottom half, full-bleed with blend
  // ══════════════════════════════════════════════════════
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, IMG_Y, W, IMG_H);
  ctx.clip();

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W  - dw) / 2;
    const dy    = IMG_Y + (IMG_H - dh) / 2;

    ctx.drawImage(img, dx, dy, dw, dh);

    // Strong top-fade so photo blends into dark text area
    const fadeTop = ctx.createLinearGradient(0, IMG_Y, 0, IMG_Y + IMG_H * 0.45);
    fadeTop.addColorStop(0,    "rgba(10,10,10,1)");
    fadeTop.addColorStop(0.55, "rgba(10,10,10,0.2)");
    fadeTop.addColorStop(1,    "rgba(10,10,10,0)");
    ctx.fillStyle = fadeTop;
    ctx.fillRect(0, IMG_Y, W, IMG_H);

    // Bottom fade out
    const fadeBot = ctx.createLinearGradient(0, H - IMG_H * 0.3, 0, H);
    fadeBot.addColorStop(0, "rgba(10,10,10,0)");
    fadeBot.addColorStop(1, "rgba(10,10,10,0.7)");
    ctx.fillStyle = fadeBot;
    ctx.fillRect(0, H - IMG_H * 0.5, W, IMG_H * 0.5);

    // Slight warm colour grade overlay
    ctx.fillStyle = "rgba(255,190,0,0.06)";
    ctx.fillRect(0, IMG_Y, W, IMG_H);

  } catch {
    // Fallback gradient if no image
    const fallback = ctx.createLinearGradient(0, IMG_Y, 0, H);
    fallback.addColorStop(0, "#1a1200");
    fallback.addColorStop(1, DARK_BG);
    ctx.fillStyle = fallback;
    ctx.fillRect(0, IMG_Y, W, IMG_H);
  }

  ctx.restore();

  // ══════════════════════════════════════════════════════
  // 3. TITLE TEXT BLOCK — large Malayalam, golden yellow
  //    Matches the bold centered text in the template
  // ══════════════════════════════════════════════════════
  // Date box sits top-right: 148w × 72h starting at y=16
  // Title must start below it so they never overlap
  const TITLE_TOP = 16 + 72 + 10;  // BOX_Y + BOX_H + gap = 98
  const TITLE_BOT = TEXT_H - 60;   // leave room for branding row
  const TITLE_H   = TITLE_BOT - TITLE_TOP;
  const TITLE_W   = W - PAD * 2;

  // Collect text segments
  let segs = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    segs = [...newsItem.titleLines];
  } else if (newsItem.title) {
    segs = [newsItem.title];
  }
  if (newsItem.lastLine) {
    segs = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine
    ];
  }

  // Auto-size font to fill the text zone — tight spacing
  let FS    = 110;
  let lines = [];
  const GAP = 2;   // minimal gap between lines

  while (FS >= 44) {
    ctx.font          = `bold ${FS}px Malayalam`;
    ctx.letterSpacing = "0px";
    lines = [];
    for (const s of segs) {
      lines.push(...wrapText(ctx, s, TITLE_W));
    }
    const lineH = FS * 1.08;   // tight line height
    if (lines.length * lineH + (lines.length - 1) * GAP <= TITLE_H) break;
    FS -= 3;
  }

  const LINE_H  = FS * 1.08;
  const totalTH = lines.length * LINE_H + (lines.length - 1) * GAP;
  const startY  = TITLE_TOP + Math.round((TITLE_H - totalTH) / 2);

  const lastLineIsSpecial = !!newsItem.lastLine;
  let drawY = startY;

  for (let i = 0; i < lines.length; i++) {
    ctx.save();

    const isLast  = i === lines.length - 1 && lastLineIsSpecial;
    const isFirst = i === 0;
    const fSize   = isFirst ? FS + 2 : FS;

    ctx.font          = `bold ${fSize}px Malayalam`;
    ctx.letterSpacing = "0px";
    ctx.textAlign     = "center";
    ctx.textBaseline  = "top";

    if (isLast) {
      // Last accent line — slightly lighter gold with glow
      ctx.shadowColor   = "rgba(255,210,0,0.8)";
      ctx.shadowBlur    = 30;
      ctx.fillStyle     = GOLD_LIGHT;
    } else {
      // All other lines — deep golden yellow matching template
      ctx.shadowColor   = "rgba(0,0,0,0.95)";
      ctx.shadowBlur    = 18;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle     = GOLD;
    }

    ctx.fillText(lines[i], W / 2, drawY);
    ctx.restore();

    drawY += LINE_H + GAP;
  }

  // ══════════════════════════════════════════════════════
  // 4. BRANDING ROW — "White devil media" style
  //    Sits just below the text block, above the photo
  // ══════════════════════════════════════════════════════
  const BRAND_Y = TEXT_H - 48;

  ctx.save();

  // Semi-transparent pill background
  const brandLabel  = (newsItem.brand || newsItem.source || "FLASH KERALAM").toUpperCase();
  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "3px";
  const brandTW     = ctx.measureText(brandLabel).width + 3 * 15;
  const brandW      = brandTW + 64; // icon space + padding
  const brandH      = 36;
  const brandX      = (W - brandW) / 2;

  // Pill fill
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRect(ctx, brandX, BRAND_Y - brandH / 2, brandW, brandH, brandH / 2);
  ctx.fill();

  // Pill border
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth   = 1.5;
  roundRect(ctx, brandX, BRAND_Y - brandH / 2, brandW, brandH, brandH / 2);
  ctx.stroke();

  // Facebook icon circle
  const iconR = 9;
  let   iconX = brandX + 20;
  ctx.fillStyle = "#1877F2";
  ctx.beginPath();
  ctx.arc(iconX, BRAND_Y, iconR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle    = WHITE;
  ctx.font         = "bold 13px English";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("f", iconX, BRAND_Y + 1);

  // Instagram icon circle
  iconX += 24;
  const igGrad = ctx.createLinearGradient(iconX - iconR, BRAND_Y - iconR, iconX + iconR, BRAND_Y + iconR);
  igGrad.addColorStop(0,   "#f09433");
  igGrad.addColorStop(0.25,"#e6683c");
  igGrad.addColorStop(0.5, "#dc2743");
  igGrad.addColorStop(0.75,"#cc2366");
  igGrad.addColorStop(1,   "#bc1888");
  ctx.fillStyle = igGrad;
  ctx.beginPath();
  ctx.arc(iconX, BRAND_Y, iconR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle  = WHITE;
  ctx.lineWidth    = 1.5;
  ctx.beginPath();
  roundRect(ctx, iconX - 5.5, BRAND_Y - 5.5, 11, 11, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(iconX, BRAND_Y, 3, 0, Math.PI * 2);
  ctx.stroke();

  // Brand label text
  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "3px";
  ctx.fillStyle     = "rgba(255,255,255,0.85)";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText(brandLabel, iconX + 18, BRAND_Y + 1);

  ctx.restore();

  // ══════════════════════════════════════════════════════
  // 5. WATERMARK — centred over image (subtle, like template)
  // ══════════════════════════════════════════════════════
  {
    const wm = (newsItem.watermark || newsItem.brand || "FLASH KERALAM");
    ctx.save();
    ctx.font          = "bold 18px English";
    ctx.letterSpacing = "2px";
    ctx.fillStyle     = "rgba(255,255,255,0.28)";
    ctx.textAlign     = "center";
    ctx.textBaseline  = "middle";
    ctx.fillText(wm, W / 2, IMG_Y + IMG_H * 0.28);
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════
  // 6. DATE BOX — top-right corner, like the reference image
  //    Layout: [ big day | divider | MON\nYYYY ]
  // ══════════════════════════════════════════════════════
  {
    const now    = newsItem.date ? new Date(newsItem.date) : new Date();
    const dayStr = String(now.getDate()).padStart(2, "0");
    const monStr = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
    const yrStr  = String(now.getFullYear());

    // Box dimensions
    const BOX_W  = 148;
    const BOX_H  = 72;
    const BOX_X  = W - PAD - BOX_W;
    const BOX_Y  = 16;   // top of canvas with small margin — TITLE starts below this box
    const BOX_R  = 8;

    ctx.save();

    // Box fill — semi-transparent dark with slight warm tint
    ctx.fillStyle = "rgba(10,8,4,0.82)";
    roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_R);
    ctx.fill();

    // Gold border
    ctx.strokeStyle = GOLD;
    ctx.lineWidth   = 2.5;
    roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_R);
    ctx.stroke();

    // Left section: big day number
    const DAY_CX = BOX_X + 46;
    const BOX_CY = BOX_Y + BOX_H / 2;

    ctx.font          = "bold 48px English";
    ctx.letterSpacing = "0px";
    ctx.textAlign     = "center";
    ctx.textBaseline  = "middle";
    ctx.fillStyle     = WHITE;
    ctx.fillText(dayStr, DAY_CX, BOX_CY + 2);

    // Vertical gold divider
    const DIV_X = BOX_X + 82;
    ctx.fillStyle = GOLD;
    ctx.fillRect(DIV_X, BOX_Y + 12, 2, BOX_H - 24);

    // Right section: month on top, year below
    const RIGHT_CX = DIV_X + (BOX_W - (DIV_X - BOX_X)) / 2 + 4;

    ctx.font          = "bold 20px English";
    ctx.letterSpacing = "2px";
    ctx.fillStyle     = GOLD;
    ctx.textAlign     = "center";
    ctx.textBaseline  = "middle";
    ctx.fillText(monStr, RIGHT_CX, BOX_CY - 12);

    ctx.font          = "bold 17px English";
    ctx.letterSpacing = "1px";
    ctx.fillStyle     = "rgba(255,255,255,0.78)";
    ctx.fillText(yrStr, RIGHT_CX, BOX_CY + 13);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════
  // 7. BOTTOM FOOTER STRIP
  // ══════════════════════════════════════════════════════
  const FOOT_H = 52; // footer height
  const FOOT_Y = H - FOOT_H;

  ctx.save();

  // Dark strip
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, FOOT_Y, W, FOOT_H);

  // Top gold accent line
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, FOOT_Y, W, 3);

  const footCY = FOOT_Y + FOOT_H / 2;
  ctx.textBaseline = "middle";

  // Brand name — left
  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "4px";
  ctx.fillStyle     = "rgba(255,255,255,0.6)";
  ctx.textAlign     = "left";
  ctx.fillText((newsItem.brand || "FLASH KERALAM").toUpperCase(), PAD, footCY);

  // Website — centre
  if (newsItem.website) {
    ctx.font          = "bold 13px English";
    ctx.letterSpacing = "1px";
    ctx.fillStyle     = "rgba(255,255,255,0.28)";
    ctx.textAlign     = "center";
    ctx.fillText(newsItem.website, W / 2, footCY);
  }

  // Hashtag — right
  const tag = newsItem.hashtag || ("#" + (newsItem.brand || "FlashKeralam").replace(/\s+/g, ""));
  ctx.font          = "bold 14px English";
  ctx.letterSpacing = "1px";
  ctx.fillStyle     = "rgba(245,197,24,0.75)";
  ctx.textAlign     = "right";
  ctx.fillText(tag, W - PAD, footCY);

  ctx.restore();

  // ── Reset ctx state ───────────────────────────────
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";
  ctx.shadowColor   = "transparent";
  ctx.shadowBlur    = 0;

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };