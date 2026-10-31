const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path  = require("path");
const sharp = require("sharp");
const fs    = require("fs");
const os    = require("os");
const geminiPoster = require("./geminiPosterService");

// fluent-ffmpeg + ffmpeg-static for frame extraction
let ffmpeg;
try {
  ffmpeg = require("fluent-ffmpeg");
  const ffmpegPath  = require("ffmpeg-static");
  const ffprobePath = require("ffprobe-static").path;

  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    console.error("❌ ffmpeg binary missing:", ffmpegPath);
  }

  if (ffprobePath && fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(ffprobePath);
  } else {
    console.error("❌ ffprobe binary missing:", ffprobePath);
  }
} catch (err) {
  console.error("[Video] fluent-ffmpeg setup failed:", err.message);
  ffmpeg = null;
}

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/AnekMalayalam-Bold.ttf"),
  "Malayalam"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "English"
);

// Malayalam first, English as fallback (so "SFI" etc. always render)
const HEAD_FONT = "Malayalam, English";

// ── Asset video path ─────────────────────────────────────────
const FALLBACK_VIDEO_PATH =
  process.env.FALLBACK_VIDEO ||
  path.join(__dirname, "../assets/ad_fallback.mp4");

const W            = 1080;
const H            = 1350;          // 4:5 poster, same ratio as the reference
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand palette: black + gold ──────────────────────────────
const GOLD_LIGHT = "#ffe033";
const GOLD_DARK  = "#ffb400";

// Default channel name shown between the headline and the photo
const DEFAULT_CHANNEL = "flash keralam";

// ── Synthetic bold ────────────────────────────────────────────
// The Malayalam font has no real heavier cut, so we stroke the glyph
// outline before filling it, which fattens every stroke.
const MALAYALAM_BOLD_W = 0.028; // stroke width as a fraction of font size

function fillTextBold(ctx, text, x, y, fontSize, extraWidth = 0) {
  const lineWidth = fontSize * MALAYALAM_BOLD_W + extraWidth;
  ctx.save();
  ctx.lineJoin    = "round";
  ctx.miterLimit  = 2;
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill (solid or gradient)
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

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

// ─────────────────────────────────────────────────────────────
function toNodeBuffer(data) {
  if (Buffer.isBuffer(data))       return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data))    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError(`toNodeBuffer: unsupported type ${Object.prototype.toString.call(data)}`);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return toNodeBuffer(await res.arrayBuffer());
}

async function fetchAsJpegBuffer(url) {
  const raw = await fetchBuffer(url);
  return toNodeBuffer(await sharp(raw).jpeg().toBuffer());
}

async function canvasToBuffer(canvas, mime = "image/png") {
  const result = canvas.toBuffer(mime);
  return Buffer.isBuffer(result) ? result : toNodeBuffer(await result);
}

// ═══════════════════════════════════════════════════════════════
// VIDEO FRAME EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractVideoFrame(videoPath, atSecond = 1) {
  return new Promise((resolve) => {
    if (!ffmpeg) {
      console.warn("[Video] fluent-ffmpeg not available — skipping frame extract");
      return resolve(null);
    }

    if (!fs.existsSync(videoPath)) {
      console.warn("[Video] File not found:", videoPath);
      return resolve(null);
    }

    try {
      const stat = fs.statSync(videoPath);
      if (stat.size === 0) {
        console.warn("[Video] File is zero bytes:", videoPath);
        return resolve(null);
      }
    } catch (e) {
      console.warn("[Video] Could not stat file:", videoPath, e.message);
      return resolve(null);
    }

    const tmpFile = path.join(os.tmpdir(), `ad_frame_${Date.now()}.png`);
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      console.error("[Video] Frame extraction timed out:", videoPath);
      fs.unlink(tmpFile, () => {});
      finish(null);
    }, 15000);

    ffmpeg(videoPath)
      .on("error", (err) => {
        clearTimeout(timer);
        console.error("[Video] Frame extraction failed:", err.message);
        fs.unlink(tmpFile, () => {});
        finish(null);
      })
      .on("end", async () => {
        clearTimeout(timer);
        try {
          if (!fs.existsSync(tmpFile)) {
            console.error("[Video] Expected frame file was never written:", tmpFile);
            return finish(null);
          }
          const raw     = fs.readFileSync(tmpFile);
          const jpegBuf = toNodeBuffer(await sharp(raw).jpeg().toBuffer());
          fs.unlink(tmpFile, () => {});
          finish(jpegBuf);
        } catch (e) {
          console.error("[Video] Sharp conversion failed:", e.message);
          fs.unlink(tmpFile, () => {});
          finish(null);
        }
      })
      .screenshots({
        timestamps: [atSecond],
        filename:   path.basename(tmpFile),
        folder:     path.dirname(tmpFile),
        size:       `${W}x?`,
      });
  });
}

// ═══════════════════════════════════════════════════════════════
// AD STRIP (unchanged)
// ═══════════════════════════════════════════════════════════════

function drawAdStrip(ctx, adImg, yOffset, adH) {

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, yOffset, W, adH);

  if (adImg) {
    const scale = Math.max(W / adImg.width, adH / adImg.height);
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

    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
    lineGrad.addColorStop(0.2, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(0.8, "rgba(255,180,0,0.8)");
    lineGrad.addColorStop(1,   "rgba(255,180,0,0)");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, yOffset, W, 3);

    return;
  }

  const bg = ctx.createLinearGradient(0, yOffset, 0, yOffset + adH);
  bg.addColorStop(0, "#0d1b4b");
  bg.addColorStop(1, "#091230");
  ctx.fillStyle = bg;
  ctx.fillRect(0, yOffset, W, adH);

  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0,   "rgba(255,180,0,0)");
  lineGrad.addColorStop(0.2, "rgba(255,180,0,1)");
  lineGrad.addColorStop(0.8, "rgba(255,180,0,1)");
  lineGrad.addColorStop(1,   "rgba(255,180,0,0)");

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset, W, 3);

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

  ctx.save();
  ctx.font         = "bold 52px English";
  ctx.fillStyle    = "rgba(255,200,60,0.22)";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("📢", W / 2, yOffset + adH / 2 - 8);
  ctx.restore();

  const line1    = "പരസ്യത്തിനായി ഞങ്ങൾക്ക്";
  const line2    = "സന്ദേശം അയയ്ക്കുക";
  const LINE_GAP = 58;
  const midY     = yOffset + adH / 2;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.8)";
  ctx.shadowBlur   = 14;

  ctx.font      = "42px Malayalam";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  fillTextBold(ctx, line1, W / 2, midY - LINE_GAP / 2, 42);

  const goldGrad = ctx.createLinearGradient(0, midY, 0, midY + 50);
  goldGrad.addColorStop(0, "#ffe566");
  goldGrad.addColorStop(1, "#ffaa00");

  ctx.font      = "44px Malayalam";
  ctx.fillStyle = goldGrad;
  fillTextBold(ctx, line2, W / 2, midY + LINE_GAP / 2, 44);

  ctx.restore();

  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, yOffset + adH - 3, W, 3);
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND — black, with a golden glow across the top
// ═══════════════════════════════════════════════════════════════

function drawBackground(ctx, theme) {
  const glowRgb = (theme && theme.glow) || "255,196,0";
  // Pure black base
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  // Warm gold-brown wash at the very top, gone by ~22% of the height
  const wash = ctx.createLinearGradient(0, 0, 0, H * 0.22);
  wash.addColorStop(0,   "rgba(88,64,0,0.95)");
  wash.addColorStop(0.5, "rgba(40,28,0,0.55)");
  wash.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H * 0.22);

  // Soft golden glow from the top centre
  const glow = ctx.createRadialGradient(W / 2, -60, 10, W / 2, -60, W * 0.95);
  glow.addColorStop(0,    `rgba(${glowRgb},0.50)`);
  glow.addColorStop(0.45, `rgba(${glowRgb},0.20)`);
  glow.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H * 0.45);
}

// ═══════════════════════════════════════════════════════════════
// CHANNEL ROW — [f] [instagram]  channel name   (centred)
// ═══════════════════════════════════════════════════════════════

function drawFacebookIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle    = "#111111";
  ctx.font         = `bold ${Math.round(r * 1.7)}px English`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("f", cx + r * 0.08, cy + r * 0.12);
  ctx.restore();
}

function drawInstagramIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#111111";
  ctx.lineWidth   = Math.max(1.6, r * 0.14);

  const s = r * 1.15;                       // rounded-square side
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
  ctx.stroke();

  ctx.beginPath();                          // lens
  ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#111111";                // flash dot
  ctx.beginPath();
  ctx.arc(cx + s * 0.27, cy - s * 0.27, Math.max(1.2, r * 0.07), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawChannelRow(ctx, name, cy) {
  const R      = 15;          // icon radius
  const ICON_GAP = 9;
  const TEXT_GAP = 16;
  const SIZE   = 28;

  ctx.save();
  ctx.font = `${SIZE}px English`;
  const textW  = ctx.measureText(name).width;
  const iconsW = R * 4 + ICON_GAP;
  const totalW = iconsW + TEXT_GAP + textW;
  const startX = (W - totalW) / 2;

  drawFacebookIcon(ctx,  startX + R,                 cy, R);
  drawInstagramIcon(ctx, startX + R * 3 + ICON_GAP,  cy, R);

  ctx.shadowColor   = "rgba(0,0,0,0.85)";
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle     = "#ffffff";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText(name, startX + iconsW + TEXT_GAP, cy + 1);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// "READ CAPTION" PILL (optional, off by default)
// ═══════════════════════════════════════════════════════════════

function drawCaptionPill(ctx, label) {
  const PILL_H   = 72;
  const PAD_X    = 32;
  const cy       = Math.round(H * 0.9335);
  const maxTextW = W * 0.36 - PAD_X * 2;

  ctx.font = "bold 100px English";
  const natW  = ctx.measureText(label).width;
  const size  = Math.min(36, Math.floor((100 * maxTextW) / natW));
  ctx.font    = `bold ${size}px English`;
  const textW = ctx.measureText(label).width;

  const pw = Math.round(textW + PAD_X * 2);
  const px = Math.round((W - pw) / 2);
  const py = cy - PILL_H / 2;

  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.55)";
  ctx.shadowBlur    = 18;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle     = "#ffffff";
  roundRect(ctx, px, py, pw, PILL_H, PILL_H / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font         = `bold ${size}px English`;
  ctx.fillStyle    = "#111111";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, W / 2, cy + 1);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// HEADLINE MODEL
//
//   Every line is centred, with a black drop-shadow. Each line is
//   GOLD or WHITE and has its own size (scale 1.0 = biggest).
//
//   AUTO MODE (default) — newsItem.title (or titleLines of plain strings)
//     The text is split at the FIRST "," or ";" (the symbol stays with
//     the first part):
//
//       GOLD part (up to and including the symbol)
//           first line, and any line containing a digit → scale 1.00 (big)
//           other lines                                  → scale 0.86
//       WHITE part (everything after the symbol)
//           lines                                        → scale 0.66
//           last line (when there are 2+ white lines)    → scale 0.52
//
//     No "," / ";" in the text → the whole headline is gold.
//     Set newsItem.autoSplit = false to make the whole headline gold.
//
//   MANUAL MODE — newsItem.titleLines as objects, one object per line:
//       { text: "600 നാരങ്ങകൾ", yellow: true,  scale: 1.0  }
//       { text: "ഒടുവിൽ മോഷ്ടാവ് പറഞ്ഞു", yellow: false, scale: 0.66 }
//     yellow defaults to true, scale defaults to 1.0 (gold) / 0.66 (white).
//
//   Other options:
//     newsItem.channelName  ""   text next to the icons (default "flash keralam")
//     newsItem.showChannel  bool show that row (default true)
//     newsItem.quoted       bool wrap headline in ' … ' (default false)
//     newsItem.showCaption  bool show the READ CAPTION pill (default false)
//     newsItem.captionLabel ""   pill text
// ═══════════════════════════════════════════════════════════════

const GOLD_BIG   = 1.0;
const GOLD_SMALL = 0.86;
const WHITE_MAIN = 0.66;
const WHITE_LAST = 0.52;

// Splits at the first "," or ";" (also full-width / Arabic variants).
function splitAtFirstBreak(text) {
  const m = /[,;，；،]/.exec(text);
  if (!m) return null;
  const cut  = m.index + 1;
  const head = text.slice(0, cut).trim();
  const tail = text.slice(cut).trim();
  return head ? [head, tail] : null;
}

// Returns segments: { text, yellow, kind: "gold" | "white" | "manual", scale? }
function resolveHeadline(newsItem) {
  let src = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    src = [...newsItem.titleLines];
  } else if (newsItem.title) {
    src = [newsItem.title];
  }
  src = src.filter(Boolean);

  let segs = [];
  const allPlain = src.length > 0 && src.every((s) => typeof s === "string");

  if (allPlain) {
    const full  = src.join(" ").replace(/\s+/g, " ").trim();
    const parts = newsItem.autoSplit !== false ? splitAtFirstBreak(full) : null;
    if (parts) {
      segs.push({ text: parts[0], yellow: true, kind: "gold" });
      if (parts[1]) segs.push({ text: parts[1], yellow: false, kind: "white" });
    } else {
      segs.push({ text: full, yellow: true, kind: "gold" });
    }
  } else {
    segs = src.map((s) => {
      if (typeof s === "string") return { text: s, yellow: true, kind: "manual" };
      const yellow = s.yellow !== false;
      return {
        text:   s.text,
        yellow,
        kind:   "manual",
        scale:  typeof s.scale === "number" ? s.scale : (yellow ? GOLD_BIG : WHITE_MAIN),
      };
    });
  }

  // Legacy keys: extra gold lines
  if (Array.isArray(newsItem.highlightLines)) {
    for (const t of newsItem.highlightLines) {
      if (t) segs.push({ text: t, yellow: true, kind: "manual", scale: GOLD_SMALL });
    }
  }
  if (newsItem.lastLine) {
    segs.push({ text: newsItem.lastLine, yellow: true, kind: "manual", scale: GOLD_SMALL });
  }

  return segs.filter((s) => s.text);
}

// Scale for one line while it is being built
function scaleFor(seg, lineIdx, lineText) {
  if (seg.kind === "manual") return seg.scale;
  if (seg.kind === "gold")   return (lineIdx === 0 || /\d/.test(lineText)) ? GOLD_BIG : GOLD_SMALL;
  return WHITE_MAIN; // "white"
}

// ═══════════════════════════════════════════════════════════════
// VIRAL TITLE THEMES
// Picked automatically from the headline words (or force one with
// newsItem.theme = "alert" | "sports" | "gold", hide badge with badge:false,
// custom badge text with badge:"...").
// ═══════════════════════════════════════════════════════════════
const THEMES = {
  gold:   { light: "#fff06a", dark: "#ffb400", glow: "255,196,0",  badgeBg: ["#ffe033", "#ffb400"], badgeFg: "#1a1200", label: "ലേറ്റസ്റ്റ് ന്യൂസ്" },
  alert:  { light: "#ffe566", dark: "#ff9d00", glow: "255,40,40",  badgeBg: ["#ff3b30", "#b80000"], badgeFg: "#ffffff", label: "ജാഗ്രത" },
  sports: { light: "#f4ff6a", dark: "#7be000", glow: "40,220,90",  badgeBg: ["#2ee06a", "#0a9a3c"], badgeFg: "#04210e", label: "സ്പോർട്സ്" },
};

const ALERT_WORDS  = ["അപകട", "മരണ", "മരിച്ച", "ദുരന്ത", "അറസ്റ്റ്", "കൊല", "തീപിടിത്ത", "ഉരുൾ", "അലർട്ട്", "ജാഗ്രത", "പ്രളയ", "ഭൂചലന", "സ്ഫോടന", "ആത്മഹത്യ", "പിടിയിൽ", "ചുഴലിക്കാറ്റ്"];
const SPORTS_WORDS = ["ക്രിക്കറ്റ്", "ഫുട്ബോൾ", "ഐഎസ്എൽ", "ഒളിമ്പിക്", "ഗോൾ", "ടീം", "ടെസ്റ്റ്", "ഐപിഎൽ", "ലോകകപ്പ്", "ഫൈനൽ", "ബാഡ്മിന്റൺ", "ചാമ്പ്യൻ"];

function detectTheme(newsItem) {
  if (newsItem.theme && THEMES[newsItem.theme]) return THEMES[newsItem.theme];
  const text = [newsItem.title, ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines.map((l) => (typeof l === "string" ? l : l && l.text)) : [])]
    .filter(Boolean).join(" ");
  if (ALERT_WORDS.some((w) => text.includes(w)))  return THEMES.alert;
  if (SPORTS_WORDS.some((w) => text.includes(w))) return THEMES.sports;
  return THEMES.gold;
}

// Pill badge at the very top ("ലേറ്റസ്റ്റ് ന്യൂസ്" / "ജാഗ്രത" / "സ്പോർട്സ്")
function drawTopBadge(ctx, theme, label) {
  const size = 34;
  ctx.save();
  ctx.font = `${size}px ${HEAD_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(label).width + size * 0.14 * 2;
  const bw = tw + 70, bh = 62, bx = (W - bw) / 2, by = 30;

  ctx.shadowColor = `rgba(${theme.glow},0.65)`;
  ctx.shadowBlur  = 26;
  const g = ctx.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, theme.badgeBg[0]);
  g.addColorStop(1, theme.badgeBg[1]);
  ctx.fillStyle = g;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  roundRect(ctx, bx + 2, by + 2, bw - 4, bh - 4, (bh - 4) / 2);
  ctx.stroke();

  ctx.fillStyle = theme.badgeFg;
  fillTextBold(ctx, label, W / 2, by + bh / 2 + 2, size);
  ctx.restore();
}

// Glowing accent bar under the headline
function drawAccentBar(ctx, theme, y) {
  const bw = 360, bh = 8, bx = (W - bw) / 2;
  ctx.save();
  ctx.shadowColor = `rgba(${theme.glow},0.9)`;
  ctx.shadowBlur  = 18;
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0,    "rgba(255,255,255,0)");
  g.addColorStop(0.25, theme.light);
  g.addColorStop(0.75, theme.dark);
  g.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  roundRect(ctx, bx, y, bw, bh, bh / 2);
  ctx.fill();
  ctx.restore();
}

async function drawCodePhoto(ctx, newsItem) {

  // ── 2. News photo — lower half, top edge fades into the black ──
  const IMG_TOP = Math.round(H * 0.51);
  const IMG_H   = H - IMG_TOP;

  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;
    const dx    = (W - dw) / 2;
    const dy    = (IMG_H - dh) / 2;

    const layer = createCanvas(W, IMG_H);
    const lctx  = layer.getContext("2d");
    lctx.drawImage(img, dx, dy, dw, dh);

    // Short fade at the very top so the photo melts into the black
    lctx.globalCompositeOperation = "destination-in";
    const mask = lctx.createLinearGradient(0, 0, 0, IMG_H);
    mask.addColorStop(0,    "rgba(0,0,0,0)");
    mask.addColorStop(0.05, "rgba(0,0,0,0.35)");
    mask.addColorStop(0.11, "rgba(0,0,0,1)");
    mask.addColorStop(1,    "rgba(0,0,0,1)");
    lctx.fillStyle = mask;
    lctx.fillRect(0, 0, W, IMG_H);

    ctx.drawImage(layer, 0, IMG_TOP);

  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }
}

async function drawHeadlineOverlay(ctx, newsItem) {
  // ── 3. Headline ─────────────────────────────────────────────
  const PAD    = 60;
  const TEXT_W = W - PAD * 2;
  const CX     = W / 2;

  const TEXT_TOP = 96;
  const TEXT_BOT = Math.round(H * 0.495);
  const TEXT_H   = TEXT_BOT - TEXT_TOP;

  const segs    = resolveHeadline(newsItem);
  const HEAD_LH = 1.12;

  let headSize  = 96;
  let headLines = [];

  const layout = () => {
    headLines = [];

    for (const seg of segs) {
      const segLines = [];
      const words = seg.text.split(" ").filter(Boolean);
      let cur = "";

      for (const word of words) {
        const test  = cur ? cur + " " + word : word;
        const scale = scaleFor(seg, segLines.length, test);
        ctx.font    = `${Math.round(headSize * scale)}px ${HEAD_FONT}`;

        if (cur && ctx.measureText(test).width > TEXT_W) {
          segLines.push({ text: cur });
          cur = word;
        } else {
          cur = test;
        }
      }
      if (cur) segLines.push({ text: cur });

      // Final scale per line (+ smaller last line for the white block)
      segLines.forEach((ln, i) => {
        let scale = scaleFor(seg, i, ln.text);
        if (seg.kind === "white" && segLines.length >= 2 && i === segLines.length - 1) {
          scale = WHITE_LAST;
        }
        headLines.push({
          text:   ln.text,
          yellow: seg.yellow,
          big:    scale >= GOLD_BIG - 0.001,
          size:   Math.round(headSize * scale),
        });
      });
    }

    return headLines.reduce((a, l) => a + Math.round(l.size * HEAD_LH), 0);
  };

  let totalH = layout();
  while (totalH > TEXT_H && headSize > 34) {
    headSize -= 2;
    totalH = layout();
  }

  let drawY = TEXT_TOP + Math.max(0, Math.round((TEXT_H - totalH) / 2));

  const quoted      = newsItem.quoted === true;
  const lastHeadIdx = headLines.length - 1;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  const theme = detectTheme(newsItem);

  headLines.forEach((line, i) => {
    let text = line.text;
    if (quoted && i === 0)           text = "'" + text;
    if (quoted && i === lastHeadIdx) text = text + "'";

    ctx.font = `${line.size}px ${HEAD_FONT}`;

    // Pass 1 — thick dark outline + drop shadow (makes the text pop off any photo)
    ctx.save();
    ctx.lineJoin     = "round";
    ctx.miterLimit   = 2;
    ctx.lineWidth    = line.size * (MALAYALAM_BOLD_W + 0.085);
    ctx.strokeStyle  = "#000000";
    ctx.shadowColor  = "rgba(0,0,0,0.95)";
    ctx.shadowBlur   = line.big ? 12 : 8;
    ctx.shadowOffsetY = line.big ? 4 : 3;
    ctx.strokeText(text, CX, drawY);
    ctx.restore();

    // Pass 2 — coloured glow behind the gold lines
    if (line.yellow) {
      ctx.save();
      ctx.fillStyle   = `rgba(${theme.glow},0.9)`;
      ctx.shadowColor = `rgba(${theme.glow},${line.big ? 0.55 : 0.4})`;
      ctx.shadowBlur  = line.big ? 22 : 14;
      ctx.fillText(text, CX, drawY);
      ctx.restore();
    }

    // Pass 3 — gradient fill (gold / white) with synthetic bold
    ctx.save();
    if (line.yellow) {
      const yg = ctx.createLinearGradient(0, drawY, 0, drawY + line.size);
      yg.addColorStop(0,    theme.light);
      yg.addColorStop(0.55, theme.light);
      yg.addColorStop(1,    theme.dark);
      ctx.fillStyle = yg;
    } else {
      const wg = ctx.createLinearGradient(0, drawY, 0, drawY + line.size);
      wg.addColorStop(0, "#ffffff");
      wg.addColorStop(1, "#d9d9d9");
      ctx.fillStyle = wg;
    }
    fillTextBold(ctx, text, CX, drawY, line.size);
    ctx.restore();

    drawY += Math.round(line.size * HEAD_LH);
  });

  // Accent bar under the headline + badge on top
  drawAccentBar(ctx, theme, Math.min(drawY + 4, Math.round(H * 0.49)));
  if (newsItem.badge !== false) {
    drawTopBadge(ctx, theme, typeof newsItem.badge === "string" ? newsItem.badge : theme.label);
  }

  // ── 4. Channel row (icons + name) ───────────────────────────
  if (newsItem.showChannel !== false) {
    drawChannelRow(ctx, newsItem.channelName || DEFAULT_CHANNEL, Math.round(H * 0.517));
  }

  // ── 5. Optional READ CAPTION pill (off by default) ──────────
  if (newsItem.showCaption === true) {
    drawCaptionPill(ctx, newsItem.captionLabel || "READ CAPTION");
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
//
// LAYOUT (top → bottom):
//   1. Black background, golden glow at the top
//   2. Headline — gold lines (big / medium) then smaller white lines
//   3. Channel row — [f] [ig] flash keralam
//   4. News photo, lower half, top edge fading into the black
//   5. Ad strip (unchanged pipeline), appended below the poster
// ═══════════════════════════════════════════════════════════════

async function createNewsPoster(newsItem) {

  // ── Ad pipeline (unchanged) ─────────────────────────────────
  const hasAdUrl  = Boolean(newsItem.adBannerUrl);
  const isVideoAd = newsItem.adResourceType === "video";
  let   adImg     = null;
  let   actualAdH = DEFAULT_AD_H;
  let   liveAdVideoUrl = null;

  if (hasAdUrl && !isVideoAd) {
    try {
      console.log("[Ad] Loading image banner:", newsItem.adBannerUrl);
      const jpegBuf = await fetchAsJpegBuffer(newsItem.adBannerUrl);
      adImg         = await loadImage(jpegBuf);
      actualAdH     = computeAdHeight(adImg);
      console.log(`[Ad] Image banner loaded: ${adImg.width}x${adImg.height}px, strip: ${actualAdH}px`);
    } catch (err) {
      console.error("[Ad] Image banner load failed:", err.message);
    }
  }

  if (!adImg && hasAdUrl && isVideoAd) {
    let tmpVidPath = null;
    try {
      console.log("[Ad] Probing video banner dimensions:", newsItem.adBannerUrl);
      tmpVidPath     = path.join(os.tmpdir(), `ad_video_${Date.now()}.mp4`);
      const vidBuf   = await fetchBuffer(newsItem.adBannerUrl);
      fs.writeFileSync(tmpVidPath, vidBuf);

      const frameBuf = await extractVideoFrame(tmpVidPath, 1);
      if (frameBuf) {
        const probeImg = await loadImage(frameBuf);
        actualAdH      = computeAdHeight(probeImg);
        console.log(`[Ad] Video banner probed: ${probeImg.width}x${probeImg.height}px, strip: ${actualAdH}px`);
      } else {
        console.warn("[Ad] Video banner probe returned null — using default height");
      }
      liveAdVideoUrl = newsItem.adBannerUrl;
    } catch (err) {
      console.error("[Ad] Video banner probe failed:", err.message);
      liveAdVideoUrl = newsItem.adBannerUrl;
    } finally {
      if (tmpVidPath) {
        try { fs.unlinkSync(tmpVidPath); } catch { /* ignore */ }
      }
    }
  }

  if (!adImg && !liveAdVideoUrl) {
    console.log("[Ad] Using local video fallback (live composite):", FALLBACK_VIDEO_PATH);
    try {
      const frameBuf = await extractVideoFrame(FALLBACK_VIDEO_PATH, 1);
      if (frameBuf) {
        const probeImg = await loadImage(frameBuf);
        actualAdH      = computeAdHeight(probeImg);
        console.log(`[Ad] Local fallback probed: ${probeImg.width}x${probeImg.height}px, strip: ${actualAdH}px`);
      } else {
        console.warn("[Ad] Local fallback probe returned null — using default height");
        actualAdH = DEFAULT_AD_H;
      }
      liveAdVideoUrl = FALLBACK_VIDEO_PATH;
    } catch (err) {
      console.error("[Ad] Local fallback error:", err.message);
      actualAdH = DEFAULT_AD_H;
    }
  }

  const canvasH = liveAdVideoUrl ? H : H + actualAdH;
  console.log(`[Canvas] poster=${H}px  adStrip=${actualAdH}px  liveVideoAd=${!!liveAdVideoUrl}  canvasH=${canvasH}px`);

  const canvas = createCanvas(W, canvasH);
  const ctx    = canvas.getContext("2d");

  // ── 1-5. Poster body: Gemini first, canvas fallback ─────────
  let ai = null;
  try {
    ai = await geminiPoster.generatePosterImage(newsItem, { width: W, height: H });
  } catch (e) {
    console.warn("[Poster] Gemini step crashed, using canvas:", e.message);
  }

  let usedGemini = false;
  if (ai) {
    try {
      const aiImg = await loadImage(ai.buffer);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(aiImg, 0, 0, W, H);
      usedGemini = true;
      // hybrid: Gemini made the artwork, real Malayalam headline is drawn on top
      // full:   Gemini already drew the headline + channel name
      if (ai.mode === "hybrid") await drawHeadlineOverlay(ctx, newsItem);
    } catch (e) {
      console.warn("[Poster] Could not use Gemini image, using canvas:", e.message);
      usedGemini = false;
    }
  }

  if (!usedGemini) {
    drawBackground(ctx, detectTheme(newsItem));
    await drawCodePhoto(ctx, newsItem);
    await drawHeadlineOverlay(ctx, newsItem);
  }
  console.log(`[Poster] source=${usedGemini ? "gemini-" + ai.mode : "canvas"}`);

  // ── Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── 7. Ad strip ─────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
