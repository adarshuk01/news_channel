const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path  = require("path");
const sharp = require("sharp");
const fs    = require("fs");
const os    = require("os");
// This is the Gemini art-director file (file 2 below). Keep the name you already use for it.
const geminiDirector = require("./geminiArtDirector.js");

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
const H            = 1350;          // 4:5 poster
const DEFAULT_AD_H = 180;
const MAX_AD_H     = 320;

// ── Brand defaults (override per item with footerUrl) ────────
const DEFAULT_FOOTER = "flashkeralam.com";

// ── Navy palette ─────────────────────────────────────────────
const NAVY_TOP    = "#0c1a73";
const NAVY_MID    = "#091259";
const NAVY_BOTTOM = "#040833";
const HEAD_EXTRUDE = "#0000";   // blue 3D shadow behind the white headline

// Accent = colour of the sub-headline boxes
const ACCENTS = {
  gold:  { box: "#ffc21a", text: "#111111" },
  red:   { box: "#e5192d", text: "#ffffff" },
  green: { box: "#2ee06a", text: "#04210e" },
};

const ALERT_WORDS  = ["അപകട", "മരണ", "മരിച്ച", "ദുരന്ത", "അറസ്റ്റ്", "കൊല", "തീപിടിത്ത", "ഉരുൾ", "അലർട്ട്", "ജാഗ്രത", "പ്രളയ", "ഭൂചലന", "സ്ഫോടന", "ആത്മഹത്യ", "പിടിയിൽ", "ചുഴലിക്കാറ്റ്"];
const SPORTS_WORDS = ["ക്രിക്കറ്റ്", "ഫുട്ബോൾ", "ഐഎസ്എൽ", "ഒളിമ്പിക്", "ഗോൾ", "ടീം", "ടെസ്റ്റ്", "ഐപിഎൽ", "ലോകകപ്പ്", "ഫൈനൽ", "ബാഡ്മിന്റൺ", "ചാമ്പ്യൻ"];

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
  ctx.strokeStyle = ctx.fillStyle; // stroke matches the current fill
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
// VIDEO FRAME EXTRACTION (unchanged)
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
// POSTER DESIGN  (Reporter-style, navy)
//
//   top    news photo, fading into deep navy
//   below  BIG white headline (AI-written, short), blue 3D shadow
//          + sub-headline in coloured boxes, kept together as one block
//   bottom footer: url, social icons, year
//
// The Gemini art director now WRITES a short headline + sub-headline from
// the story (numbers and facts are validated against your original text).
// If Gemini is unavailable or its text fails validation, a safe local split
// of your original title is used instead.
//
// newsItem fields
//   title / titleLines   story headline text
//   summary              optional context for the AI
//   subtitle             optional: string or array of lines for the boxes.
//                        When given, `title` stays the big headline untouched.
//   image                photo
//   date                 anything `new Date()` understands
//   footerUrl            default "flashkeralam.com"
//   footerYear           default current year
//   showFooter           false to hide
//   accent               "gold" | "red" | "green"  (overrides the AI)
//   quoted               true / false  (overrides the AI)
//   aiDirector           false = skip Gemini completely
//   aiRewrite            false = Gemini may not write text (design hints only)
// ═══════════════════════════════════════════════════════════════

const PHOTO_H = Math.round(H * 0.52);

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0,    NAVY_TOP);
  g.addColorStop(0.45, NAVY_MID);
  g.addColorStop(1,    NAVY_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

async function drawPhoto(ctx, newsItem, focus) {
  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, PHOTO_H / img.height);
    const dw    = img.width  * scale;
    const dh    = img.height * scale;

    // Put the AI focus point slightly above the middle of the visible band
    const fx = focus && Number.isFinite(focus.x) ? focus.x : 0.5;
    const fy = focus && Number.isFinite(focus.y) ? focus.y : 0.5;
    let dx = W / 2 - fx * dw;
    let dy = PHOTO_H * 0.45 - fy * dh;
    dx = Math.min(0, Math.max(W - dw, dx));
    dy = Math.min(0, Math.max(PHOTO_H - dh, dy));

    const layer = createCanvas(W, PHOTO_H);
    const lctx  = layer.getContext("2d");
    lctx.drawImage(img, dx, dy, dw, dh);

    // Blue tint so the photo sits in the navy theme
    lctx.globalCompositeOperation = "source-atop";
    lctx.fillStyle = "rgba(12,24,120,0.30)";
    lctx.fillRect(0, 0, W, PHOTO_H);

    // Fade the bottom into the navy background
    lctx.globalCompositeOperation = "destination-in";
    const mask = lctx.createLinearGradient(0, 0, 0, PHOTO_H);
    mask.addColorStop(0,    "rgba(0,0,0,1)");
    mask.addColorStop(0.50, "rgba(0,0,0,1)");
    mask.addColorStop(0.80, "rgba(0,0,0,0.45)");
    mask.addColorStop(1,    "rgba(0,0,0,0)");
    lctx.fillStyle = mask;
    lctx.fillRect(0, 0, W, PHOTO_H);

    ctx.drawImage(layer, 0, 0);
  } catch (e) {
    console.warn("[Poster] main photo failed:", e.message);
  }
}

// ── Text layout helpers ──────────────────────────────────────
function wrapWords(ctx, text, maxW) {
  const words = String(text || "").split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(t).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Largest font size where the headline fits the width and height.
// Tries the AI's line breaks first, then automatic wrapping.
function fitHeadline(ctx, presetLines, text, maxW, maxH) {
  const LH = 1.16;
  const run = (getLines) => {
    for (let size = 130; size >= 40; size -= 2) {
      ctx.font = `${size}px ${HEAD_FONT}`;
      const lines = getLines();
      if (lines.length &&
          lines.every((l) => ctx.measureText(l).width <= maxW) &&
          lines.length * size * LH <= maxH) {
        return { size, lines, lh: Math.round(size * LH) };
      }
    }
    return null;
  };

  const joined = text || (presetLines || []).join(" ");
  let res = presetLines && presetLines.length ? run(() => presetLines) : null;
  if (!res) res = run(() => wrapWords(ctx, joined, maxW));
  if (!res) {
    const size = 40;
    ctx.font = `${size}px ${HEAD_FONT}`;
    res = { size, lines: wrapWords(ctx, joined, maxW), lh: Math.round(size * LH) };
  }
  return res;
}

function fitSub(ctx, presetLines, text, maxW) {
  const joined = text || (presetLines || []).join(" ");
  if (!joined.trim()) return null;

  const padX  = 34;
  const avail = maxW - padX * 2;
  const run = (getLines) => {
    for (let size = 50; size >= 28; size -= 2) {
      ctx.font = `${size}px ${HEAD_FONT}`;
      const lines = getLines();
      if (lines.length && lines.length <= 3 &&
          lines.every((l) => ctx.measureText(l).width <= avail)) {
        return { size, lines, padX, boxH: Math.round(size * 1.5), gap: 10 };
      }
    }
    return null;
  };

  let res = presetLines && presetLines.length ? run(() => presetLines) : null;
  if (!res) res = run(() => wrapWords(ctx, joined, avail));
  if (!res) {
    const size = 28;
    ctx.font = `${size}px ${HEAD_FONT}`;
    res = { size, lines: wrapWords(ctx, joined, avail), padX, boxH: Math.round(size * 1.5), gap: 10 };
  }
  return res;
}

function subBlockHeight(sub) {
  if (!sub) return 0;
  return sub.lines.length * sub.boxH + (sub.lines.length - 1) * sub.gap;
}

// ── Headline: white, blue 3D shadow ──────────────────────────
function drawHeadline(ctx, head, top) {
  const { size, lines, lh } = head;
  let y = top;
  const CX = W / 2;

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  ctx.font         = `${size}px ${HEAD_FONT}`;

  for (const text of lines) {
    // Blue extrusion (soft dark shadow on the first layer)
    for (let i = 11; i >= 1; i--) {
      ctx.save();
      if (i === 11) {
        ctx.shadowColor   = "rgba(0,0,40,0.75)";
        ctx.shadowBlur    = 16;
        ctx.shadowOffsetY = 6;
      }
      ctx.fillStyle = HEAD_EXTRUDE;
      fillTextBold(ctx, text, CX - i * 0.55, y + i * 0.9, size);
      ctx.restore();
    }

    // White face
    ctx.save();
    const wg = ctx.createLinearGradient(0, y, 0, y + size);
    wg.addColorStop(0, "#ffffff");
    wg.addColorStop(1, "#e9ecff");
    ctx.fillStyle = wg;
    fillTextBold(ctx, text, CX, y, size, size * 0.012);
    ctx.restore();

    y += lh;
  }
}

// ── Sub-headline: one box per line ───────────────────────────
function drawSubBoxes(ctx, sub, accent, bottomY) {
  if (!sub) return;
  const total = subBlockHeight(sub);
  let y = bottomY - total;

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.font         = `${sub.size}px ${HEAD_FONT}`;

  for (const text of sub.lines) {
    const bw = Math.min(W - 60, Math.round(ctx.measureText(text).width + sub.padX * 2));
    const bx = Math.round((W - bw) / 2);

    ctx.save();
    ctx.shadowColor   = "rgba(0,0,0,0.35)";
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle     = accent.box;
    roundRect(ctx, bx, y, bw, sub.boxH, 6);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = accent.text;
    ctx.font      = `${sub.size}px ${HEAD_FONT}`;
    fillTextBold(ctx, text, W / 2, y + sub.boxH / 2 + Math.round(sub.size * 0.04), sub.size);
    ctx.restore();

    y += sub.boxH + sub.gap;
  }
}

// ── Footer: url + social icons + year ────────────────────────
function drawFacebookIcon(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle    = "#0b1257";
  ctx.font         = `${Math.round(r * 1.7)}px English`;
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

  ctx.strokeStyle = "#0b1257";
  ctx.lineWidth   = Math.max(1.4, r * 0.14);
  const s = r * 1.15;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#0b1257";
  ctx.beginPath();
  ctx.arc(cx + s * 0.27, cy - s * 0.27, Math.max(1.1, r * 0.07), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFooter(ctx, newsItem, cy) {
  const url  = String(newsItem.footerUrl || DEFAULT_FOOTER);
  const year = String(newsItem.footerYear || new Date().getFullYear());
  const R    = 11;
  const GAP  = 8;
  const SEP  = 18;
  const SIZE = 26;

  ctx.save();
  ctx.font = `${SIZE}px English`;
  const urlW  = ctx.measureText(url).width;
  const yearW = ctx.measureText(year).width;
  const iconsW = R * 4 + GAP;
  const total  = urlW + SEP + iconsW + SEP + yearW;
  let x = (W - total) / 2;

  ctx.fillStyle    = "rgba(255,255,255,0.80)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(url, x, cy);
  x += urlW + SEP;

  drawFacebookIcon(ctx,  x + R,                 cy, R);
  drawInstagramIcon(ctx, x + R * 3 + GAP,       cy, R);
  x += iconsW + SEP;

  ctx.fillStyle    = "rgba(255,255,255,0.80)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.font         = `${SIZE}px English`;
  ctx.fillText(year, x, cy);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// CONTENT RESOLUTION (AI first, safe local split as fallback)
// ═══════════════════════════════════════════════════════════════

function getTitleText(newsItem) {
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    return newsItem.titleLines
      .map((l) => (typeof l === "string" ? l : l && l.text))
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  return String(newsItem.title || "").replace(/\s+/g, " ").trim();
}

// First natural break (, ; : ! ?) that is NOT inside a number like 1,000
// and leaves at least 2 words in the headline part.
function splitAtFirstBreak(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[,;:!?，；،]/.test(ch)) continue;
    if (ch === "," && /\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "")) continue;

    const head = text.slice(0, i + 1).trim();
    const tail = text.slice(i + 1).trim();
    if (head.split(" ").filter(Boolean).length >= 2 && tail) return [head, tail];
  }
  return null;
}

function localSplit(title) {
  const words = title.split(" ").filter(Boolean);

  const parts = splitAtFirstBreak(title);
  if (parts && parts[0].split(" ").filter(Boolean).length <= 9) {
    return { head: parts[0], sub: parts[1] };
  }

  if (words.length < 5) return { head: title, sub: "" };
  const k = Math.min(8, Math.max(3, Math.round(words.length * 0.4)));
  return { head: words.slice(0, k).join(" "), sub: words.slice(k).join(" ") };
}

function detectAccent(title) {
  if (ALERT_WORDS.some((w) => title.includes(w)))  return "red";
  if (SPORTS_WORDS.some((w) => title.includes(w))) return "green";
  return "gold";
}

function resolveContent(newsItem, direction) {
  const title = getTitleText(newsItem);

  let headText = title, headLines = null, subText = "", subLines = null;

  if (direction && direction.headText) {
    headText  = direction.headText;
    headLines = direction.headLines || null;
    subText   = direction.subText || "";
    subLines  = direction.subLines || null;
  } else if (!newsItem.subtitle && !newsItem.subTitleLines) {
    const s = localSplit(title);
    headText = s.head;
    subText  = s.sub;
  }

  // Explicit sub-headline from the caller always wins
  const explicit = newsItem.subtitle || newsItem.subTitleLines;
  if (explicit) {
    if (Array.isArray(explicit)) {
      subLines = explicit.filter(Boolean).map(String);
      subText  = subLines.join(" ");
    } else {
      subLines = null;
      subText  = String(explicit).replace(/\s+/g, " ").trim();
    }
    if (!direction || !direction.headText) { headText = title; headLines = null; }
  }

  // Quote marks ‘ ’
  const alreadyQuoted = /^['"‘“]/.test(headText) || /['"’”]$/.test(headText);
  let quoted = false;
  if (newsItem.quoted === true) quoted = true;
  else if (newsItem.quoted !== false && direction && direction.quote) quoted = true;
  if (alreadyQuoted) quoted = false;

  if (quoted) {
    if (headLines && headLines.length) {
      headLines = headLines.slice();
      headLines[0] = "‘" + headLines[0];
      headLines[headLines.length - 1] = headLines[headLines.length - 1] + "’";
    }
    headText = "‘" + headText + "’";
  }

  // Accent colour
  let accentKey = newsItem.accent;
  if (!ACCENTS[accentKey]) accentKey = direction && ACCENTS[direction.accent] ? direction.accent : null;
  if (!accentKey) accentKey = detectAccent(title);

  return { headText, headLines, subText, subLines, accent: ACCENTS[accentKey] };
}

function drawPosterText(ctx, newsItem, direction) {
  const c = resolveContent(newsItem, direction);

  const FOOTER_Y   = H - 44;
  const SUB_BOTTOM = newsItem.showFooter === false ? H - 50 : FOOTER_Y - 38;
  const ZONE_TOP   = Math.round(H * 0.50);
  const ZONE_H     = SUB_BOTTOM - ZONE_TOP;
  const GAP        = 34;   // space between headline and sub-headline boxes

  // Sub-headline first (it decides how much room the headline has)
  const sub  = fitSub(ctx, c.subLines, c.subText, W - 100);
  const subH = subBlockHeight(sub);
  const gap  = sub ? GAP : 0;

  const headAvail = Math.max(120, ZONE_H - subH - gap);
  const head      = fitHeadline(ctx, c.headLines, c.headText, W - 110, headAvail);
  const headH     = head.lines.length * head.lh;

  // Headline + sub-headline are one block, centred in the zone
  const groupH = headH + gap + subH;
  const startY = ZONE_TOP + Math.max(0, Math.round((ZONE_H - groupH) / 2));

  drawHeadline(ctx, head, startY);
  drawSubBoxes(ctx, sub, c.accent, startY + groupH);
  if (newsItem.showFooter !== false) drawFooter(ctx, newsItem, FOOTER_Y);
}

// ═══════════════════════════════════════════════════════════════
// MAIN POSTER DRAW
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

  // ── AI art direction (never throws; null = default design) ──
  let direction = null;
  try {
    direction = await geminiDirector.getDirection(newsItem, {
      photoRatio: (W / PHOTO_H).toFixed(2),
    });
  } catch (e) {
    console.warn("[Poster] Art director failed, using default design:", e.message);
  }

  // ── Poster body ─────────────────────────────────────────────
  drawBackground(ctx);
  await drawPhoto(ctx, newsItem, direction && direction.focus);
  drawPosterText(ctx, newsItem, direction);
  console.log(`[Poster] ai=${direction ? "yes" : "no"} rewritten=${!!(direction && direction.rewritten)} accent=${(direction && direction.accent) || "auto"}`);

  // ── Reset ────────────────────────────────────────────────
  ctx.textAlign    = "left";
  ctx.textBaseline = "alphabetic";

  // ── Ad strip ────────────────────────────────────────────────
  if (!liveAdVideoUrl) {
    drawAdStrip(ctx, adImg, H, actualAdH);
  }

  const buffer = await canvasToBuffer(canvas, "image/png");
  return { type: "image", buffer, liveAdVideoUrl, adH: actualAdH };
}

module.exports = { createNewsPoster, toNodeBuffer };
