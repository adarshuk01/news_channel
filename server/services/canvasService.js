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

// ─────────────────────────────────────────────────────────
// HELPER: wrap text to fit maxWidth
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

// ─────────────────────────────────────────────────────────
// DESIGN — Dark Cinematic  (1080 × 1280)
//
// Layout:
//   • Image covers top ~58 %, fades to #0a0a0c at bottom
//   • "FLASH KERALAM" + date float top-left over the image
//   • Large white Malayalam title left-aligned below image
//   • "@flashkeralam" bottom-left, speaker icon bottom-right
// ─────────────────────────────────────────────────────────
async function createNewsPoster(newsItem) {
  const W = 1080;
  const H = 1280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── 1. SOLID DARK BACKGROUND ────────────────────────────
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);

  // ── 2. IMAGE ZONE (top 58 %) ────────────────────────────
  const IMG_H = Math.round(H * 0.58);

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

    // Subtle warm tone
    ctx.fillStyle = "rgba(10,5,0,0.15)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Bottom fade — image melts into the dark background
    const fadeBottom = ctx.createLinearGradient(0, IMG_H * 0.42, 0, IMG_H);
    fadeBottom.addColorStop(0,   "rgba(10,10,12,0)");
    fadeBottom.addColorStop(0.7, "rgba(10,10,12,0.82)");
    fadeBottom.addColorStop(1,   "rgba(10,10,12,1)");
    ctx.fillStyle = fadeBottom;
    ctx.fillRect(0, 0, W, IMG_H);

    // Left-edge vignette (helps header text pop)
    const fadeLeft = ctx.createLinearGradient(0, 0, 160, 0);
    fadeLeft.addColorStop(0, "rgba(0,0,0,0.55)");
    fadeLeft.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fadeLeft;
    ctx.fillRect(0, 0, 160, IMG_H);

    // Right-edge vignette
    const fadeRight = ctx.createLinearGradient(W - 160, 0, W, 0);
    fadeRight.addColorStop(0, "rgba(0,0,0,0)");
    fadeRight.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = fadeRight;
    ctx.fillRect(W - 160, 0, 160, IMG_H);

    // Top-edge vignette (darkens behind the header text)
    const fadeTop = ctx.createLinearGradient(0, 0, 0, 200);
    fadeTop.addColorStop(0, "rgba(0,0,0,0.72)");
    fadeTop.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fadeTop;
    ctx.fillRect(0, 0, W, 200);

    ctx.restore();
  } catch {
    // Fallback when image fails to load
    const fb = ctx.createLinearGradient(0, 0, W, IMG_H);
    fb.addColorStop(0, "#1c1a20");
    fb.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = fb;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. HEADER — floating over image, top-left ───────────
  const HEADER_X  = 36;
  const BRAND_Y   = 38;   // baseline-top of brand line
  const DATE_Y    = BRAND_Y + 40;

  // Brand: "FLASH KERALAM"
  ctx.save();
  ctx.font          = "bold 30px English";
  ctx.letterSpacing = "2px";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "top";
  ctx.fillStyle     = "#ffffff";
  ctx.shadowColor   = "rgba(0,0,0,0.85)";
  ctx.shadowBlur    = 14;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;
  ctx.fillText("FLASH KERALAM", HEADER_X, BRAND_Y);
  ctx.restore();

  // Date line: e.g. "Sun May 3 2026"
  const now     = new Date();
  const weekday = now.toLocaleDateString("en-IN", { weekday: "short" });
  const month   = now.toLocaleDateString("en-IN", { month:   "short" });
  const day     = now.getDate();
  const year    = now.getFullYear();
  const dateStr = `${weekday} ${month} ${day} ${year}`;

  ctx.save();
  ctx.font          = "bold 20px English";
  ctx.letterSpacing = "0px";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "top";
  ctx.fillStyle     = "rgba(255,255,255,0.75)";
  ctx.shadowColor   = "rgba(0,0,0,0.85)";
  ctx.shadowBlur    = 10;
  ctx.fillText(dateStr, HEADER_X, DATE_Y);
  ctx.restore();

  // ── 4. MALAYALAM TITLE ──────────────────────────────────
  const PAD      = 36;
  const TEXT_TOP = IMG_H + 30;          // starts just below image zone
  const TEXT_BOT = H - 72;             // leaves room for bottom handle bar
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;

  // Collect segments
  let segments = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    segments = [...newsItem.titleLines];
  } else if (newsItem.title) {
    segments = [newsItem.title];
  }
  if (newsItem.lastLine) {
    segments = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine,
    ];
  }

  // Auto-shrink font until all lines fit
  let fontSize = 80;
  let allLines  = [];
  const LINE_GAP = 8;

  while (fontSize >= 40) {
    ctx.font          = `bold ${fontSize}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of segments) {
      allLines.push(...wrapText(ctx, seg, TEXT_W));
    }
    const lineH  = Math.round(fontSize * 1.22);
    const totalH = allLines.length * lineH + (allLines.length - 1) * LINE_GAP;
    if (totalH <= TEXT_H) break;
    fontSize -= 2;
  }

  const lineH  = Math.round(fontSize * 1.02);
  const totalH = allLines.length * lineH + (allLines.length - 1) * LINE_GAP;
  let   drawY  = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  for (const line of allLines) {
    ctx.save();
    ctx.font          = `bold ${fontSize}px Malayalam`;
    ctx.letterSpacing = "0px";
    ctx.fillStyle     = "#ffffff";
    ctx.shadowColor   = "rgba(0,0,0,0.9)";
    ctx.shadowBlur    = 20;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillText(line, PAD, drawY);
    ctx.restore();
    drawY += lineH + LINE_GAP;
  }

  // ── 5. BOTTOM HANDLE BAR ────────────────────────────────
  const BAR_H = 72;
  const BAR_Y = H - BAR_H;

  // "@flashkeralam"
  ctx.save();
  ctx.font          = "bold 22px English";
  ctx.letterSpacing = "0px";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillStyle     = "rgba(255,255,255,0.55)";
  ctx.fillText("@flashkeralam", PAD, BAR_Y + BAR_H / 2);
  ctx.restore();

  // Speaker / volume icon — right side
  const ICO_CX = W - PAD - 22;
  const ICO_CY = BAR_Y + BAR_H / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.fillStyle   = "rgba(255,255,255,0.55)";
  ctx.lineWidth   = 3;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  // Speaker body (filled polygon)
  const S = 13; // half-size
  ctx.beginPath();
  ctx.moveTo(ICO_CX - S * 0.85, ICO_CY - S * 0.45);
  ctx.lineTo(ICO_CX - S * 0.3,  ICO_CY - S * 0.45);
  ctx.lineTo(ICO_CX + S * 0.1,  ICO_CY - S);
  ctx.lineTo(ICO_CX + S * 0.1,  ICO_CY + S);
  ctx.lineTo(ICO_CX - S * 0.3,  ICO_CY + S * 0.45);
  ctx.lineTo(ICO_CX - S * 0.85, ICO_CY + S * 0.45);
  ctx.closePath();
  ctx.fill();

  // Sound wave arcs
  ctx.beginPath();
  ctx.arc(ICO_CX + S * 0.1, ICO_CY, S * 0.7, -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ICO_CX + S * 0.1, ICO_CY, S * 1.2, -Math.PI * 0.38, Math.PI * 0.38);
  ctx.stroke();

  ctx.restore();

  // Reset context state
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";
  ctx.shadowColor   = "transparent";
  ctx.shadowBlur    = 0;

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };