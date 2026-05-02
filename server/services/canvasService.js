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
const H = 1580; // ← updated

// ── Layout constants — all derived so changing H ripples everywhere ──
const BOX_X    = 50;
const BOX_Y    = 295;
const BOX_W    = 980;
const FOOTER_H = 210;                       // footer strip height
const BOX_GAP  = 22;                        // gap between box and footer
const BOX_H    = H - BOX_Y - FOOTER_H - BOX_GAP; // fills all remaining space
const BOX_R    = 28;
const TEXT_ZONE_H = Math.round(BOX_H * 0.30); // bottom 30% of box for text

// ── Utility: wrap text ────────────────────────────────────────
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

// ── Utility: rounded rect path ────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ── Draw siren ────────────────────────────────────────────────
function drawSiren(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);

  const glow = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, size * 1.8);
  glow.addColorStop(0,    "rgba(255,40,0,0.55)");
  glow.addColorStop(0.45, "rgba(200,10,0,0.2)");
  glow.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.8, 0, Math.PI * 2);
  ctx.fill();

  const numRays = 14;
  for (let i = 0; i < numRays; i++) {
    const angle  = (i / numRays) * Math.PI * 2;
    const rayLen = size * (i % 2 === 0 ? 1.55 : 1.15);
    ctx.save();
    ctx.rotate(angle);
    const rg = ctx.createLinearGradient(0, 0, rayLen, 0);
    rg.addColorStop(0,   "rgba(255,100,0,0.65)");
    rg.addColorStop(0.5, "rgba(255,30,0,0.25)");
    rg.addColorStop(1,   "rgba(200,0,0,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(size * 0.35, -4);
    ctx.lineTo(rayLen, -1.5);
    ctx.lineTo(rayLen, 1.5);
    ctx.lineTo(size * 0.35, 4);
    ctx.fill();
    ctx.restore();
  }

  const domeGrad = ctx.createRadialGradient(
    -size * 0.22, -size * 0.28, 0,
     0, -size * 0.05, size * 0.72
  );
  domeGrad.addColorStop(0,    "#ff7777");
  domeGrad.addColorStop(0.28, "#ff1800");
  domeGrad.addColorStop(0.7,  "#cc0000");
  domeGrad.addColorStop(1,    "#800000");
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, size * 0.7, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  const spot = ctx.createRadialGradient(
    -size * 0.18, -size * 0.28, 0,
     0, -size * 0.1, size * 0.42
  );
  spot.addColorStop(0,   "rgba(255,255,210,0.98)");
  spot.addColorStop(0.3, "rgba(255,210,80,0.5)");
  spot.addColorStop(1,   "rgba(255,0,0,0)");
  ctx.fillStyle = spot;
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, size * 0.7, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle   = "#111111";
  ctx.beginPath();
  ctx.roundRect(-size * 0.52, size * 0.16, size * 1.04, size * 0.28, 5);
  ctx.fill();
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth   = 2;
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.rect(-size * 0.16, size * 0.44, size * 0.32, size * 0.38);
  ctx.fill();

  ctx.restore();
}

// ── Draw world-map dot pattern ────────────────────────────────
function drawWorldMap(ctx, startX, startY, endX, endY) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle   = "#cc1100";
  const sp = 22;
  const mW = endX - startX;
  const mH = endY - startY;
  for (let x = startX; x < endX; x += sp) {
    for (let y = startY; y < endY; y += sp) {
      const nx = (x - startX) / mW;
      const ny = (y - startY) / mH;
      let show = false;
      if (nx < 0.28 && ny > 0.06 && ny < 0.58) show = true;
      if (nx > 0.14 && nx < 0.30 && ny > 0.58 && ny < 0.96) show = true;
      if (nx > 0.36 && nx < 0.56 && ny > 0.04 && ny < 0.52) show = true;
      if (nx > 0.38 && nx < 0.58 && ny > 0.46 && ny < 0.98) show = true;
      if (nx > 0.50 && ny > 0.03 && ny < 0.70) show = true;
      if (nx > 0.74 && nx < 0.94 && ny > 0.64 && ny < 0.96) show = true;
      if (show) {
        ctx.beginPath();
        ctx.arc(x, y, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// ── Draw Instagram icon ───────────────────────────────────────
function drawInstagramIcon(ctx, cx, cy, size) {
  ctx.save();
  const ig = ctx.createLinearGradient(cx - size, cy + size, cx + size, cy - size);
  ig.addColorStop(0,    "#f09433");
  ig.addColorStop(0.25, "#e6683c");
  ig.addColorStop(0.5,  "#dc2743");
  ig.addColorStop(0.75, "#cc2366");
  ig.addColorStop(1,    "#bc1888");
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.roundRect(cx - size, cy - size, size * 2, size * 2, size * 0.3);
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = size * 0.13;
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.6, cy - size * 0.6, size * 1.2, size * 1.2, size * 0.25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx + size * 0.38, cy - size * 0.42, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ═══════════════════════════════════════════════════════
  // 1. BACKGROUND
  // ═══════════════════════════════════════════════════════
  ctx.fillStyle = "#060000";
  ctx.fillRect(0, 0, W, H);

  const g1 = ctx.createRadialGradient(W * 0.88, 0, 0, W * 0.88, 0, W * 1.1);
  g1.addColorStop(0,    "rgba(200,0,0,0.60)");
  g1.addColorStop(0.35, "rgba(140,0,0,0.30)");
  g1.addColorStop(0.7,  "rgba(60,0,0,0.10)");
  g1.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(0, H * 0.3, 0, 0, H * 0.3, W * 0.65);
  g2.addColorStop(0, "rgba(100,0,0,0.30)");
  g2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // Diagonal streaks (only in header zone)
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.strokeStyle = "#ff2200";
  ctx.lineWidth   = 1.5;
  for (let i = -200; i < W + 300; i += 34) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 320, BOX_Y);
    ctx.stroke();
  }
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 2. WORLD MAP — upper-right quadrant only
  // ═══════════════════════════════════════════════════════
  drawWorldMap(ctx, W * 0.26, 8, W - 8, BOX_Y - 8);

  // ═══════════════════════════════════════════════════════
  // 3. BREAKING NEWS BANNER
  // ═══════════════════════════════════════════════════════
  const SKEW = 26;

  ctx.save();
  ctx.fillStyle   = "#ffffff";
  ctx.globalAlpha = 0.92;
  ctx.fillRect(22, 90, 56, 9);
  ctx.fillRect(22, 112, 56, 9);
  ctx.restore();

  // "BREAKING" red parallelogram
  const BK_X = 84, BK_Y = 48, BK_W = 526, BK_H = 92;
  const redG  = ctx.createLinearGradient(BK_X, BK_Y, BK_X + BK_W, BK_Y + BK_H);
  redG.addColorStop(0, "#e20000");
  redG.addColorStop(1, "#880000");
  ctx.fillStyle = redG;
  ctx.beginPath();
  ctx.moveTo(BK_X + SKEW, BK_Y);
  ctx.lineTo(BK_X + BK_W, BK_Y);
  ctx.lineTo(BK_X + BK_W - SKEW, BK_Y + BK_H);
  ctx.lineTo(BK_X, BK_Y + BK_H);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.font         = "bold 74px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.6)";
  ctx.shadowBlur   = 10;
  ctx.fillText("BREAKING", BK_X + SKEW + 18, BK_Y + BK_H / 2 + 2);
  ctx.restore();

  // "NEWS" gold parallelogram
  const NW_X = 84, NW_Y = BK_Y + BK_H - 8, NW_W = 386, NW_H = 78;
  const goldG = ctx.createLinearGradient(NW_X, NW_Y, NW_X, NW_Y + NW_H);
  goldG.addColorStop(0, "#ffcc00");
  goldG.addColorStop(1, "#ff9900");
  ctx.fillStyle = goldG;
  ctx.beginPath();
  ctx.moveTo(NW_X + SKEW, NW_Y);
  ctx.lineTo(NW_X + NW_W, NW_Y);
  ctx.lineTo(NW_X + NW_W - SKEW, NW_Y + NW_H);
  ctx.lineTo(NW_X, NW_Y + NW_H);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.font         = "bold 70px English";
  ctx.fillStyle    = "#111111";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.shadowBlur   = 0;
  ctx.fillText("NEWS", NW_X + SKEW + 20, NW_Y + NW_H / 2 + 2);
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 4. SIREN — top right
  // ═══════════════════════════════════════════════════════
  drawSiren(ctx, W - 178, 162, 112);

  // ═══════════════════════════════════════════════════════
  // 5. MAIN BOX — glow + dark fill
  // ═══════════════════════════════════════════════════════
  for (let i = 16; i > 0; i--) {
    ctx.save();
    ctx.strokeStyle = `rgba(220,10,0,${0.055 * (i / 16)})`;
    ctx.lineWidth   = i * 3.5;
    roundRect(ctx, BOX_X - i * 1.5, BOX_Y - i * 1.5, BOX_W + i * 3, BOX_H + i * 3, BOX_R + i * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_R);
  ctx.fillStyle = "#120000";
  ctx.fill();
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 6. NEWS IMAGE — clipped into box
  // ═══════════════════════════════════════════════════════
  ctx.save();
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_R);
  ctx.clip();

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(BOX_W / img.width, BOX_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = BOX_X + (BOX_W - dw) / 2;
    const dy    = BOX_Y + (BOX_H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    // Bottom gradient for text legibility
    const fade = ctx.createLinearGradient(
      0, BOX_Y + BOX_H - TEXT_ZONE_H - 90,
      0, BOX_Y + BOX_H
    );
    fade.addColorStop(0,   "rgba(0,0,0,0)");
    fade.addColorStop(0.3, "rgba(0,0,0,0.75)");
    fade.addColorStop(1,   "rgba(0,0,0,0.97)");
    ctx.fillStyle = fade;
    ctx.fillRect(BOX_X, BOX_Y, BOX_W, BOX_H);

    // Side vignettes
    const lv = ctx.createLinearGradient(BOX_X, 0, BOX_X + 90, 0);
    lv.addColorStop(0, "rgba(0,0,0,0.52)");
    lv.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lv;
    ctx.fillRect(BOX_X, BOX_Y, 90, BOX_H);

    const rv = ctx.createLinearGradient(BOX_X + BOX_W - 90, 0, BOX_X + BOX_W, 0);
    rv.addColorStop(0, "rgba(0,0,0,0)");
    rv.addColorStop(1, "rgba(0,0,0,0.52)");
    ctx.fillStyle = rv;
    ctx.fillRect(BOX_X + BOX_W - 90, BOX_Y, 90, BOX_H);
  } catch {
    ctx.fillStyle = "#180000";
    ctx.fillRect(BOX_X, BOX_Y, BOX_W, BOX_H);
  }
  ctx.restore();

  // Red border on top of image
  ctx.save();
  roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, BOX_R);
  ctx.strokeStyle = "#dd0e00";
  ctx.lineWidth   = 7;
  ctx.stroke();
  ctx.restore();

  // ═══════════════════════════════════════════════════════
  // 7. MALAYALAM TITLE TEXT — bottom of box
  // ═══════════════════════════════════════════════════════
  const PAD      = 52;
  const TEXT_W   = BOX_W - PAD * 2;
  const TEXT_TOP = BOX_Y + BOX_H - TEXT_ZONE_H + 14;
  const TEXT_BOT = BOX_Y + BOX_H - 26;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const CX       = W / 2;

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

  let FONT_SIZE = 82; // slightly bigger max since box is taller
  let allLines  = [];
  while (FONT_SIZE >= 34) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }
    const LH = Math.round(FONT_SIZE * 1.2);
    if (allLines.length * LH <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const LINE_H = Math.round(FONT_SIZE * 1.2);
  const totalH = allLines.length * LINE_H;
  let   drawY  = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    ctx.shadowColor   = "rgba(0,0,0,1)";
    ctx.shadowBlur    = 22;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    const isLast       = i === allLines.length - 1;
    const isSecondLast = i === allLines.length - 2;

    if (isLast) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#ffe566");
      g.addColorStop(1, "#ffaa00");
      ctx.fillStyle = g;
    } else if (isSecondLast && allLines.length > 2) {
      const g = ctx.createLinearGradient(0, drawY, 0, drawY + FONT_SIZE);
      g.addColorStop(0, "#fff0aa");
      g.addColorStop(1, "#ffd040");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#f5f5f5";
    }

    ctx.fillText(allLines[i], CX, drawY);
    ctx.restore();
    drawY += LINE_H;
  }

  // ═══════════════════════════════════════════════════════
  // 8. FOOTER BAR — anchored to bottom of canvas
  // ═══════════════════════════════════════════════════════
  const FOOT_Y  = H - FOOTER_H;
  const FOOT_CY = FOOT_Y + FOOTER_H / 2;

  const footGrad = ctx.createLinearGradient(0, FOOT_Y, 0, H);
  footGrad.addColorStop(0, "#1c1c1c");
  footGrad.addColorStop(1, "#080808");
  ctx.save();
  ctx.fillStyle = footGrad;
  ctx.beginPath();
  ctx.roundRect(0, FOOT_Y, W, FOOTER_H, [18, 18, 0, 0]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,60,0,0.35)";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(20, FOOT_Y + 1);
  ctx.lineTo(W - 20, FOOT_Y + 1);
  ctx.stroke();
  ctx.restore();

  // Bell icon
  const bellCX = 80;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.arc(bellCX, FOOT_CY, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font         = "36px English";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🔔", bellCX, FOOT_CY + 1);
  ctx.restore();

  // "FOLLOW FOR / MORE UPDATES >>"
  ctx.save();
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.font         = "bold 30px English";
  ctx.fillStyle    = "#ffffff";
  ctx.fillText("FOLLOW FOR", 138, FOOT_CY - 19);
  ctx.fillStyle = "#ffcc00";
  ctx.fillText("MORE UPDATES >>", 138, FOOT_CY + 19);
  ctx.restore();

  // Divider
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(W / 2 - 1, FOOT_Y + 20, 2, FOOTER_H - 40);
  ctx.restore();

  // Instagram icon + handle
  const igCX = W / 2 + 52;
  drawInstagramIcon(ctx, igCX, FOOT_CY, 33);
  ctx.save();
  ctx.font         = "bold 31px English";
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("flash_keralam", igCX + 50, FOOT_CY);
  ctx.restore();

  // Reset
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing= "0px";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };