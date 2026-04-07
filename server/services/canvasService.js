const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/Rachana-Regular.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

const W = 1080;
const H = 1920;

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

// (icon removed — brand is text-only now)

async function createNewsPoster(newsItem) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── 1. Background: very dark charcoal ────────────────────
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, W, H);

  // ── 2. Photo — top 58% of poster ─────────────────────────
  const IMG_H = Math.round(H * 0.58);
  const IMG_Y = 0;

  try {
    const img = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (W - dw) / 2;
    const dy = (IMG_H - dh) / 2; // vertically center within the slot

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, IMG_Y, W, IMG_H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();

    // Strong fade: photo → dark at the bottom edge of the image area
    const bottomFade = ctx.createLinearGradient(0, IMG_H * 0.55, 0, IMG_H);
    bottomFade.addColorStop(0, "rgba(24,24,24,0)");
    bottomFade.addColorStop(1, "rgba(24,24,24,1)");
    ctx.fillStyle = bottomFade;
    ctx.fillRect(0, 0, W, IMG_H);

  } catch {
    // Fallback gradient if image fails to load
    const fallback = ctx.createLinearGradient(0, 0, 0, IMG_H);
    fallback.addColorStop(0, "#2a2a2a");
    fallback.addColorStop(1, "#181818");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ── 3. Brand watermark + date — centered at image/text boundary ──
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "long" });
  const year    = now.getFullYear();
  const dateStr = `${day} ${month} ${year}`;

  const BRAND_CY = IMG_H - 52;   // vertical centre of the brand pill
  const pillH    = 46;
  const pillRad  = pillH / 2;

  ctx.save();

  // Measure brand text to size pill dynamically
  ctx.font = "bold 22px English";
  const brandText  = "FLASH KERALAM";
  const brandTextW = ctx.measureText(brandText).width;
  const pillW      = brandTextW + 60;
  const pillX      = W / 2 - pillW / 2;
  const pillY      = BRAND_CY - pillH / 2;

  // Semi-transparent white pill
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

  // Brand name — dark, centered inside pill
  ctx.globalAlpha   = 1;
  ctx.font          = "bold 22px English";
  ctx.fillStyle     = "#1a1a1a";
  ctx.textAlign     = "center";
  ctx.textBaseline  = "middle";
  ctx.letterSpacing = "3px";
  ctx.fillText(brandText, W / 2, BRAND_CY);
  ctx.letterSpacing = "0px";

  // Date — centered just below the pill, gold color
  ctx.font         = "bold 22px English";
  ctx.fillStyle    = "#ffcc00";
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.fillText(dateStr, W / 2, pillY + pillH + 10);

  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // ── 4. Malayalam title text ───────────────────────────────
  //
  // Colour scheme (matching reference image):
  //   • All lines except last two → white
  //   • Second-to-last line       → golden yellow
  //   • Last line                 → white, larger font, also wrapped to fit
  //
  // newsItem.titleLines: optional string[] for manual line breaks.
  // newsItem.lastLine:   optional string for the big bottom line separately.
  // newsItem.title:      fallback — full text auto-wrapped.

  const PAD = 54;
  const TEXT_TOP = IMG_H + 58;   // pushed down to clear the date text below pill
  const TEXT_BOT = H - 60;       // bottom margin
  const TEXT_H = TEXT_BOT - TEXT_TOP;
  const TEXT_W = W - PAD * 2;
  const CX = W / 2;

  // ── Step A: resolve body lines and last line ──────────────
  let bodyInput = [];   // lines for the upper (body) block
  let lastInput = "";   // the big bottom line

  if (newsItem.lastLine) {
    // Caller supplied them separately
    lastInput = newsItem.lastLine;
    bodyInput = Array.isArray(newsItem.titleLines)
      ? newsItem.titleLines
      : [newsItem.title || ""];
  } else if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    // Last element of titleLines = big line
    lastInput = newsItem.titleLines[newsItem.titleLines.length - 1];
    bodyInput = newsItem.titleLines.slice(0, -1);
  } else {
    // Auto-split: use title as body, lastLine empty (or split at last space)
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

  // ── Step B: find the best body font size that keeps all
  //           body lines within TEXT_W and the block within TEXT_H * 0.65 ──
  let BODY_SIZE = 76;
  let wrappedBodyLines = [];

  while (BODY_SIZE >= 40) {
    ctx.font = `bold ${BODY_SIZE}px Malayalam`;
    wrappedBodyLines = [];
    for (const segment of bodyInput) {
      const wrapped = wrapText(ctx, segment, TEXT_W);
      wrappedBodyLines.push(...wrapped);
    }
    const bodyBlockH = wrappedBodyLines.length * BODY_SIZE * 1.38;
    // Reserve at least 35% of the text zone for the large last line
    if (bodyBlockH <= TEXT_H * 0.65) break;
    BODY_SIZE -= 3;
  }

  // ── Step C: find the best last-line font size ─────────────
  let LAST_SIZE = 120;
  let wrappedLastLines = [];

  while (LAST_SIZE >= 50) {
    ctx.font = `bold ${LAST_SIZE}px Malayalam`;
    wrappedLastLines = wrapText(ctx, lastInput, TEXT_W);
    // Check all wrapped last lines fit width (wrapText already handles it)
    // But also verify total height fits
    const lastBlockH = wrappedLastLines.length * LAST_SIZE * 1.25;
    if (lastBlockH <= TEXT_H * 0.5) break;
    LAST_SIZE -= 4;
  }

  // ── Step D: compute total height and vertically centre ────
  // Use a consistent line-height ratio for both blocks.
  // textBaseline = "top" so drawY is the TOP of each line — no offset tricks.
  const LINE_H_BODY = Math.round(BODY_SIZE * 1.25);
  const LINE_H_LAST = Math.round(LAST_SIZE * 1.20);

  const totalTextH =
    wrappedBodyLines.length * LINE_H_BODY +
    wrappedLastLines.length * LINE_H_LAST;

  // Start drawY so the block is vertically centred in the text zone
  let drawY = TEXT_TOP + Math.round((TEXT_H - totalTextH) / 2);

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";          // ← consistent: drawY is always the TOP of the glyph

  // ── Step E: draw body lines ───────────────────────────────
  const yellowIdx = wrappedBodyLines.length - 1; // last body line = yellow

  for (let i = 0; i < wrappedBodyLines.length; i++) {
    ctx.save();
    ctx.font         = `bold ${BODY_SIZE}px Malayalam`;
    ctx.shadowColor  = "rgba(0,0,0,0.85)";
    ctx.shadowBlur   = 10;
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

  // ── Step F: draw last line(s) — large white ───────────────
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

  // ── 6. Reset ─────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  return canvas.toBuffer("image/png");
}

module.exports = { createNewsPoster };