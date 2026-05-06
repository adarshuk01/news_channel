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

// ─────────────────────────────────────────────────────────
// SHARED HELPERS
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
// DESIGN 1 — Dark Cinematic  (1080×1280)
// Image top 58%, gold-gradient text below, gold accent lines
// ─────────────────────────────────────────────────────────

async function design1(newsItem) {
  const W = 1080, H = 1280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 18) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
  }
  ctx.restore();

  const IMG_H = Math.round(H * 0.58);
  try {
    const img   = await loadImage(newsItem.image);
    const scale = Math.max(W / img.width, IMG_H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const dx = (W - dw) / 2,     dy = (IMG_H - dh) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, IMG_H); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    const fade1 = ctx.createLinearGradient(0, IMG_H * 0.38, 0, IMG_H);
    fade1.addColorStop(0, "rgba(13,15,20,0)"); fade1.addColorStop(0.75, "rgba(13,15,20,0.85)"); fade1.addColorStop(1, "rgba(13,15,20,1)");
    ctx.fillStyle = fade1; ctx.fillRect(0, 0, W, IMG_H);
    const lv = ctx.createLinearGradient(0,0,120,0);
    lv.addColorStop(0,"rgba(0,0,0,0.55)"); lv.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=lv; ctx.fillRect(0,0,120,IMG_H);
    const rv = ctx.createLinearGradient(W-120,0,W,0);
    rv.addColorStop(0,"rgba(0,0,0,0)"); rv.addColorStop(1,"rgba(0,0,0,0.55)");
    ctx.fillStyle=rv; ctx.fillRect(W-120,0,120,IMG_H);
    const tv = ctx.createLinearGradient(0,0,0,180);
    tv.addColorStop(0,"rgba(0,0,0,0.60)"); tv.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=tv; ctx.fillRect(0,0,W,180);
    ctx.restore();
  } catch {
    const fb = ctx.createLinearGradient(0,0,W,IMG_H);
    fb.addColorStop(0,"#1a1d26"); fb.addColorStop(1,"#0d0f14");
    ctx.fillStyle=fb; ctx.fillRect(0,0,W,IMG_H);
  }

  const ag = ctx.createLinearGradient(0,0,W,0);
  ag.addColorStop(0,"rgba(255,180,0,0)"); ag.addColorStop(0.2,"rgba(255,180,0,1)"); ag.addColorStop(0.8,"rgba(255,180,0,1)"); ag.addColorStop(1,"rgba(255,180,0,0)");
  ctx.fillStyle=ag; ctx.fillRect(0,0,W,3);

  ctx.save();
  ctx.font="bold 26px English"; ctx.letterSpacing="4px"; ctx.fillStyle="#ffffff"; ctx.globalAlpha=0.92; ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText("FLASH",48,52); ctx.restore();

  ctx.save();
  ctx.font="bold 26px English"; ctx.letterSpacing="4px";
  const flashW = ctx.measureText("FLASH").width + 34;
  ctx.fillStyle="#ffb400"; ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText("KERALAM", 48+flashW, 52); ctx.restore();

  const now=new Date(), day=String(now.getDate()).padStart(2,"0"),
    month=now.toLocaleDateString("en-IN",{month:"short"}).toUpperCase(),
    year=now.getFullYear();
  ctx.save();
  ctx.font="bold 20px English"; ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.textAlign="right"; ctx.textBaseline="middle";
  ctx.fillText(`${day} ${month} ${year}`, W-48, 52); ctx.restore();

  const tagLabel = newsItem.tag || "BREAKING";
  const TAG_Y = IMG_H - 38;
  ctx.save();
  ctx.font="bold 19px English"; ctx.letterSpacing="3px";
  const tagW = ctx.measureText(tagLabel).width + 22 + 48, tagH=38, tagX=W/2-tagW/2;
  const rg = ctx.createLinearGradient(tagX,TAG_Y-tagH/2,tagX,TAG_Y+tagH/2);
  rg.addColorStop(0,"#ff2d2d"); rg.addColorStop(1,"#cc0000");
  ctx.fillStyle=rg; roundRect(ctx,tagX,TAG_Y-tagH/2,tagW,tagH,tagH/2); ctx.fill();
  ctx.strokeStyle="rgba(255,120,120,0.4)"; ctx.lineWidth=1.5;
  roundRect(ctx,tagX+1,TAG_Y-tagH/2+1,tagW-2,tagH-2,tagH/2-1); ctx.stroke();
  ctx.fillStyle="#ffffff"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(tagLabel, W/2, TAG_Y+1); ctx.restore();

  const DIV_Y = IMG_H+18;
  const dg = ctx.createLinearGradient(54,0,W-54,0);
  dg.addColorStop(0,"rgba(255,180,0,0)"); dg.addColorStop(0.15,"rgba(255,180,0,0.9)"); dg.addColorStop(0.85,"rgba(255,180,0,0.9)"); dg.addColorStop(1,"rgba(255,180,0,0)");
  ctx.fillStyle=dg; ctx.fillRect(54,DIV_Y,W-108,2);

  const PAD=58, TEXT_TOP=IMG_H+44, TEXT_BOT=H-36, TEXT_H=TEXT_BOT-TEXT_TOP, TEXT_W=W-PAD*2;
  let segs=[];
  if (Array.isArray(newsItem.titleLines)&&newsItem.titleLines.length) segs=newsItem.titleLines;
  else if (newsItem.title) segs=[newsItem.title];
  if (newsItem.lastLine) segs=[...(Array.isArray(newsItem.titleLines)?newsItem.titleLines:[newsItem.title||""]),newsItem.lastLine];

  let FS=72, allLines=[];
  while (FS>=38) {
    ctx.font=`bold ${FS}px Malayalam`; ctx.letterSpacing="0px"; allLines=[];
    for (const s of segs) allLines.push(...wrapText(ctx,s,TEXT_W));
    if (allLines.length*Math.round(FS*1.18)<=TEXT_H) break;
    FS-=2;
  }
  const LINE_H=Math.round(FS*1.18), totalH2=allLines.length*LINE_H;
  let drawY=TEXT_TOP+Math.round((TEXT_H-totalH2)/2);
  ctx.textAlign="center"; ctx.textBaseline="top";
  for (let i=0;i<allLines.length;i++) {
    ctx.save(); ctx.font=`bold ${FS}px Malayalam`; ctx.letterSpacing="0px";
    ctx.shadowColor="rgba(0,0,0,0.95)"; ctx.shadowBlur=18; ctx.shadowOffsetX=2; ctx.shadowOffsetY=3;
    const isLast=i===allLines.length-1, isSecondLast=i===allLines.length-2;
    if (isLast) { const g=ctx.createLinearGradient(0,drawY,0,drawY+FS); g.addColorStop(0,"#ffe566"); g.addColorStop(1,"#ffaa00"); ctx.fillStyle=g; }
    else if (isSecondLast&&allLines.length>2) { const g=ctx.createLinearGradient(0,drawY,0,drawY+FS); g.addColorStop(0,"#fff0aa"); g.addColorStop(1,"#ffd040"); ctx.fillStyle=g; }
    else ctx.fillStyle="#f5f5f5";
    ctx.fillText(allLines[i],W/2,drawY); ctx.restore();
    drawY+=LINE_H;
  }

  const FOOT_Y=H-34;
  ctx.save(); ctx.fillStyle="rgba(255,255,255,0.08)"; ctx.fillRect(0,FOOT_Y-1,W,1);
  ctx.font="bold 17px English"; ctx.letterSpacing="2px"; ctx.fillStyle="rgba(255,180,0,0.55)"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("www.flashkeralam.com",W/2,FOOT_Y+17); ctx.restore();
  ctx.textAlign="left"; ctx.textBaseline="alphabetic"; ctx.letterSpacing="0px";
  return canvas.toBuffer("image/png");
}

// ─────────────────────────────────────────────────────────
// DESIGN 2 — Gold on Dark Square  (1080×1080)
// Text top 54%, image bottom 46%, date box top-right corner
// ─────────────────────────────────────────────────────────

async function design2(newsItem) {
  const W = 1080, H = 1280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ════════════════════════════════════════════════════════════════
  // 1. BACKGROUND
  // ════════════════════════════════════════════════════════════════
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);

  // Halftone dot texture
  ctx.save();
  ctx.globalAlpha = 0.018;
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row < H; row += 12) {
    for (let col = 0; col < W; col += 12) {
      ctx.beginPath();
      ctx.arc(col, row, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // 2. IMAGE — top 55%
  // ════════════════════════════════════════════════════════════════
  const IMG_H = Math.round(H * 0.55);

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

    // Warm tone overlay
    ctx.fillStyle = "rgba(20,5,0,0.18)";
    ctx.fillRect(0, 0, W, IMG_H);

    // Bottom fade — subtle, starts late
    const fade = ctx.createLinearGradient(0, IMG_H * 0.6, 0, IMG_H);
    fade.addColorStop(0,   "rgba(10,10,12,0)");
    fade.addColorStop(0.7, "rgba(10,10,12,0.45)");
    fade.addColorStop(1,   "rgba(10,10,12,0.85)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, IMG_H);

    // Top vignette
    const topFade = ctx.createLinearGradient(0, 0, 0, 100);
    topFade.addColorStop(0, "rgba(10,10,12,0.7)");
    topFade.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, W, 100);

    ctx.restore();
  } catch {
    const fallback = ctx.createLinearGradient(0, 0, W, IMG_H);
    fallback.addColorStop(0, "#1c1a20");
    fallback.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, IMG_H);
  }

  // ════════════════════════════════════════════════════════════════
  // 3. TOP HEADER BAR
  // ════════════════════════════════════════════════════════════════
  const headerH = 72;

  ctx.save();
  ctx.fillStyle = "rgba(10,10,12,0.82)";
  ctx.fillRect(0, 0, W, headerH);
  ctx.restore();

  // Left red accent bar
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, 0, 6, headerH);
  ctx.restore();

  // "FLASH" white
  ctx.save();
  ctx.font          = "bold 30px English";
  ctx.letterSpacing = "6px";
  ctx.fillStyle     = "#ffffff";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillText("FLASH", 30, headerH / 2);

  // "KERALAM" red — offset by "FLASH" width + letter-spacing
  const flashW = ctx.measureText("FLASH").width + 42;
  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", 30 + flashW, headerH / 2);
  ctx.restore();

  // Vertical separator
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(W - 200, 14, 1, headerH - 28);
  ctx.restore();

  // Date block
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, "0");
  const month   = now.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();
  const year    = now.getFullYear();
  const weekday = now.toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase();

  ctx.save();
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  ctx.font         = "bold 22px English";
  ctx.fillStyle    = "#ffffff";
  ctx.fillText(`${day} ${month}`, W - 30, headerH / 2 - 10);
  ctx.font      = "bold 14px English";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(`${weekday} · ${year}`, W - 30, headerH / 2 + 12);
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // 4. BREAKING TAG
  // ════════════════════════════════════════════════════════════════
  const tagLabel = (newsItem.tag || "BREAKING NEWS").toUpperCase();
  const TAG_CY   = IMG_H - 52;

  ctx.save();
  ctx.font          = "bold 18px English";
  ctx.letterSpacing = "4px";
  const tagTextW    = ctx.measureText(tagLabel).width + 30;
  const tagW        = tagTextW + 40;
  const tagH        = 40;
  const tagX        = 54;

  ctx.fillStyle = "#e8000d";
  roundRect(ctx, tagX, TAG_CY - tagH / 2, tagW, tagH, 4);
  ctx.fill();

  // Live dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(tagX + 18, TAG_CY, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(tagLabel, tagX + 32, TAG_CY + 1);
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // 5. TEXT ZONE DESIGN ELEMENTS
  // ════════════════════════════════════════════════════════════════
  const TEXT_ZONE_Y = IMG_H - 10;

  // Diagonal red slash — subtle background element
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle   = "#e8000d";
  ctx.beginPath();
  ctx.moveTo(-60, TEXT_ZONE_Y + 80);
  ctx.lineTo(W * 0.72, TEXT_ZONE_Y + 80);
  ctx.lineTo(W * 0.72 + 180, H);
  ctx.lineTo(-60, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Bold red rule
  ctx.save();
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(54, TEXT_ZONE_Y + 28, 64, 4);
  ctx.restore();

  // Thin white line
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(54 + 72, TEXT_ZONE_Y + 29, W - 54 - 72 - 54, 2);
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // 6. MALAYALAM TITLE — red bg + white text on all lines
  // ════════════════════════════════════════════════════════════════
  const PAD      = 54;
  const TEXT_TOP = TEXT_ZONE_Y + 52;
  const TEXT_BOT = H - 70;
  const TEXT_H   = TEXT_BOT - TEXT_TOP;
  const TEXT_W   = W - PAD * 2;

  // --- Resolve segments ---
  let allSegments = [];
  if (Array.isArray(newsItem.titleLines) && newsItem.titleLines.length) {
    allSegments = [...newsItem.titleLines];
  } else if (newsItem.title) {
    allSegments = [newsItem.title];
  }
  if (newsItem.lastLine) {
    allSegments = [
      ...(Array.isArray(newsItem.titleLines) ? newsItem.titleLines : [newsItem.title || ""]),
      newsItem.lastLine
    ];
  }

  // --- Auto-size font ---
  let FONT_SIZE = 78, allLines = [];
  const GAP = 10;

  while (FONT_SIZE >= 40) {
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";
    allLines = [];
    for (const seg of allSegments) allLines.push(...wrapText(ctx, seg, TEXT_W));
    const V_PAD  = Math.round(FONT_SIZE * 0.22);
    const blockH = FONT_SIZE + V_PAD * 2;
    if (allLines.length * (blockH + GAP) - GAP <= TEXT_H) break;
    FONT_SIZE -= 2;
  }

  const V_PAD  = Math.round(FONT_SIZE * 0.22);
  const blockH = FONT_SIZE + V_PAD * 2;
  const totalH = allLines.length * (blockH + GAP) - GAP;
  let drawY    = TEXT_TOP + Math.round((TEXT_H - totalH) / 2);

  ctx.textAlign    = "left";
  ctx.textBaseline = "top";

  // --- Draw each line: red tapered rect + white text ---
  for (let i = 0; i < allLines.length; i++) {
    ctx.save();
    ctx.font          = `bold ${FONT_SIZE}px Malayalam`;
    ctx.letterSpacing = "0px";

    const lineW = ctx.measureText(allLines[i]).width;
    const rectX = PAD - 12;
    const rectY = drawY - V_PAD;
    const rectW = lineW + 24;
    const rectH = blockH;

    // Red tapered rectangle
    ctx.fillStyle = "#e8000d";
    ctx.beginPath();
    ctx.moveTo(rectX, rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW,     rectY + rectH);
    ctx.lineTo(rectX,             rectY + rectH);
    ctx.closePath();
    ctx.fill();

    // Shine on top half
    const shine = ctx.createLinearGradient(0, rectY, 0, rectY + rectH * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.10)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.moveTo(rectX, rectY);
    ctx.lineTo(rectX + rectW + 8, rectY);
    ctx.lineTo(rectX + rectW,     rectY + rectH * 0.5);
    ctx.lineTo(rectX,             rectY + rectH * 0.5);
    ctx.closePath();
    ctx.fill();

    // White text with shadow
    ctx.shadowColor   = "rgba(0,0,0,0.6)";
    ctx.shadowBlur    = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle     = "#ffffff";
    ctx.fillText(allLines[i], PAD, drawY);

    ctx.restore();
    drawY += blockH + GAP;
  }

  // ════════════════════════════════════════════════════════════════
  // 7. BOTTOM FOOTER
  // ════════════════════════════════════════════════════════════════
  const FOOT_H = 68;
  const FOOT_Y = H - FOOT_H;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, FOOT_Y, W, FOOT_H);

  // Red top border
  ctx.fillStyle = "#e8000d";
  ctx.fillRect(0, FOOT_Y, W, 3);

  // Brand
  ctx.font          = "bold 16px English";
  ctx.letterSpacing = "3px";
  ctx.textAlign     = "left";
  ctx.textBaseline  = "middle";
  ctx.fillStyle     = "rgba(255,255,255,0.5)";
  ctx.fillText("FLASH", 28, FOOT_Y + FOOT_H / 2);

  ctx.fillStyle = "#e8000d";
  ctx.fillText("KERALAM", 28 + ctx.measureText("FLASH").width + 22, FOOT_Y + FOOT_H / 2);

  // Website
  ctx.font          = "bold 15px English";
  ctx.letterSpacing = "2px";
  ctx.fillStyle     = "rgba(255,255,255,0.28)";
  ctx.textAlign     = "center";
  ctx.fillText("www.flashkeralam.com", W / 2, FOOT_Y + FOOT_H / 2);

  // Hashtag
  ctx.font          = "bold 14px English";
  ctx.letterSpacing = "1px";
  ctx.fillStyle     = "rgba(255,255,255,0.22)";
  ctx.textAlign     = "right";
  ctx.fillText("#FlashKeralam", W - 28, FOOT_Y + FOOT_H / 2);

  ctx.restore();

  // Reset context state
  ctx.textAlign     = "left";
  ctx.textBaseline  = "alphabetic";
  ctx.letterSpacing = "0px";
  ctx.shadowColor   = "transparent";
  ctx.shadowBlur    = 0;

  return canvas.toBuffer("image/png");
}

// ── Helper: wrapText ─────────────────────────────────────────────────────────
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

// ── Helper: roundRect — uniform radius or per-corner [tl, tr, br, bl] ───────
function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === "number") r = [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + r[0], y);
  ctx.lineTo(x + w - r[1], y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r[1]);
  ctx.lineTo(x + w, y + h - r[2]);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
  ctx.lineTo(x + r[3], y + h);
  ctx.quadraticCurveTo(x,     y + h, x,     y + h - r[3]);
  ctx.lineTo(x, y + r[0]);
  ctx.quadraticCurveTo(x,     y,     x + r[0], y);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────
// DESIGN 3 — Red Banner  (1080×1280)
// Image top 52%, red header bar, red-block text per line
// ─────────────────────────────────────────────────────────

async function design3(newsItem) {
  const W=1080, H=1280;
  const canvas=createCanvas(W,H); const ctx=canvas.getContext("2d");

  ctx.fillStyle="#0a0a0c"; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.globalAlpha=0.018; ctx.fillStyle="#ffffff";
  for (let r=0;r<H;r+=12) for (let c=0;c<W;c+=12) { ctx.beginPath(); ctx.arc(c,r,1.2,0,Math.PI*2); ctx.fill(); }
  ctx.restore();

  const IMG_H=Math.round(H*0.52);
  try {
    const img=await loadImage(newsItem.image);
    const scale=Math.max(W/img.width,IMG_H/img.height);
    const dw=img.width*scale, dh=img.height*scale, dx=(W-dw)/2, dy=(IMG_H-dh)/2;
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,IMG_H); ctx.clip();
    ctx.drawImage(img,dx,dy,dw,dh);
    ctx.fillStyle="rgba(20,5,0,0.18)"; ctx.fillRect(0,0,W,IMG_H);
    const fd=ctx.createLinearGradient(0,IMG_H*0.3,0,IMG_H);
    fd.addColorStop(0,"rgba(10,10,12,0)"); fd.addColorStop(0.6,"rgba(10,10,12,0.75)"); fd.addColorStop(1,"rgba(10,10,12,1)");
    ctx.fillStyle=fd; ctx.fillRect(0,0,W,IMG_H);
    const lf=ctx.createLinearGradient(0,0,80,0); lf.addColorStop(0,"rgba(10,10,12,0.8)"); lf.addColorStop(1,"rgba(10,10,12,0)");
    ctx.fillStyle=lf; ctx.fillRect(0,0,80,IMG_H);
    const rf=ctx.createLinearGradient(W-80,0,W,0); rf.addColorStop(0,"rgba(10,10,12,0)"); rf.addColorStop(1,"rgba(10,10,12,0.8)");
    ctx.fillStyle=rf; ctx.fillRect(W-80,0,80,IMG_H);
    const tf=ctx.createLinearGradient(0,0,0,100); tf.addColorStop(0,"rgba(10,10,12,0.7)"); tf.addColorStop(1,"rgba(10,10,12,0)");
    ctx.fillStyle=tf; ctx.fillRect(0,0,W,100);
    ctx.restore();
  } catch {
    const fb=ctx.createLinearGradient(0,0,W,IMG_H); fb.addColorStop(0,"#1c1a20"); fb.addColorStop(1,"#0a0a0c");
    ctx.fillStyle=fb; ctx.fillRect(0,0,W,IMG_H);
  }

  const headerH=72;
  ctx.save(); ctx.fillStyle="rgba(10,10,12,0.85)"; ctx.fillRect(0,0,W,headerH); ctx.restore();
  ctx.save(); ctx.fillStyle="#e8000d"; ctx.fillRect(0,0,6,headerH); ctx.restore();

  const tl=(newsItem.tag||"BREAKING NEWS").toUpperCase(), tCY=headerH/2, tX=24, tH3=40;
  ctx.save(); ctx.font="bold 17px English"; ctx.letterSpacing="3px";
  const tW=ctx.measureText(tl).width+52;
  ctx.fillStyle="#e8000d"; roundRect(ctx,tX,tCY-tH3/2,tW,tH3,5); ctx.fill();
  ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.arc(tX+18,tCY,5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#ffffff"; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(tl,tX+32,tCY+1); ctx.restore();

  ctx.save(); ctx.fillStyle="rgba(255,255,255,0.12)"; ctx.fillRect(W-230,14,1,headerH-28);
  ctx.font="bold 26px English"; ctx.letterSpacing="5px"; ctx.textBaseline="middle"; ctx.textAlign="right";
  ctx.fillStyle="#e8000d"; ctx.fillText("KERALAM",W-22,headerH/2);
  const kW=ctx.measureText("KERALAM").width; ctx.fillStyle="#ffffff"; ctx.fillText("FLASH ",W-22-kW,headerH/2); ctx.restore();

  const PAD=54, RULE_Y=IMG_H+24;
  ctx.save(); ctx.fillStyle="#e8000d"; ctx.fillRect(PAD,RULE_Y,64,5); ctx.restore();
  ctx.save(); ctx.fillStyle="rgba(255,255,255,0.12)"; ctx.fillRect(PAD+72,RULE_Y+1.5,W-PAD-72-PAD,2); ctx.restore();

  const now2=new Date(), d2=String(now2.getDate()).padStart(2,"0"),
    m2=now2.toLocaleDateString("en-IN",{month:"short"}).toUpperCase(),
    y2=now2.getFullYear(), wd=now2.toLocaleDateString("en-IN",{weekday:"long"}).toUpperCase();
  const DATE_Y=RULE_Y+22;
  ctx.save(); ctx.textAlign="left"; ctx.textBaseline="top";
  ctx.font="bold 22px English"; ctx.letterSpacing="2px"; ctx.fillStyle="#ffffff"; ctx.fillText(`${d2} ${m2} ${y2}`,PAD,DATE_Y);
  const dmW=ctx.measureText(`${d2} ${m2} ${y2}`).width+14;
  ctx.font="bold 16px English"; ctx.fillStyle="rgba(255,255,255,0.38)"; ctx.fillText("·",PAD+dmW,DATE_Y+3); ctx.fillText(wd,PAD+dmW+18,DATE_Y+3); ctx.restore();

  const TEXT_TOP2=DATE_Y+48, TEXT_BOT2=H-148, TEXT_H2=TEXT_BOT2-TEXT_TOP2, TEXT_W2=W-PAD*2;
  let segs=[];
  if (Array.isArray(newsItem.titleLines)&&newsItem.titleLines.length) segs=newsItem.titleLines;
  else if (newsItem.title) segs=[newsItem.title];
  if (newsItem.lastLine) segs=[...(Array.isArray(newsItem.titleLines)?newsItem.titleLines:[newsItem.title||""]),newsItem.lastLine];

  let FS2=82, aL=[], GAP3=10;
  while (FS2>=40) {
    ctx.font=`bold ${FS2}px Malayalam`; ctx.letterSpacing="0px"; aL=[];
    for (const s of segs) aL.push(...wrapText(ctx,s,TEXT_W2));
    const vp=Math.round(FS2*0.22), bH3=FS2+vp*2;
    if (aL.length*(bH3+GAP3)-GAP3<=TEXT_H2) break;
    FS2-=2;
  }
  const VP=Math.round(FS2*0.22), BH3=FS2+VP*2, totH3=aL.length*(BH3+GAP3)-GAP3;
  let dY=TEXT_TOP2+Math.round((TEXT_H2-totH3)/2);
  ctx.textAlign="left"; ctx.textBaseline="top";
  for (let i=0;i<aL.length;i++) {
    ctx.save(); ctx.font=`bold ${FS2}px Malayalam`; ctx.letterSpacing="0px";
    const lW=ctx.measureText(aL[i]).width, rX=PAD-12, rY=dY-VP, rW=lW+24, rH=BH3;
    ctx.fillStyle="#e8000d"; ctx.beginPath();
    ctx.moveTo(rX,rY); ctx.lineTo(rX+rW+8,rY); ctx.lineTo(rX+rW,rY+rH); ctx.lineTo(rX,rY+rH); ctx.closePath(); ctx.fill();
    const sh=ctx.createLinearGradient(0,rY,0,rY+rH*0.5);
    sh.addColorStop(0,"rgba(255,255,255,0.10)"); sh.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle=sh; ctx.beginPath();
    ctx.moveTo(rX,rY); ctx.lineTo(rX+rW+8,rY); ctx.lineTo(rX+rW,rY+rH*0.5); ctx.lineTo(rX,rY+rH*0.5); ctx.closePath(); ctx.fill();
    ctx.shadowColor="rgba(0,0,0,0.6)"; ctx.shadowBlur=4; ctx.shadowOffsetX=1; ctx.shadowOffsetY=2; ctx.fillStyle="#ffffff";
    ctx.fillText(aL[i],PAD,dY); ctx.restore();
    dY+=BH3+GAP3;
  }

  if (newsItem.source) {
    const sL=("● "+newsItem.source).toUpperCase(), SY=H-138, sH=42;
    ctx.save(); ctx.font="bold 16px English"; ctx.letterSpacing="3px";
    const sW=ctx.measureText(sL).width+36;
    ctx.fillStyle="rgba(255,255,255,0.09)"; roundRect(ctx,PAD-12,SY-sH/2,sW,sH,6); ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,0.18)"; ctx.lineWidth=1.5; roundRect(ctx,PAD-12,SY-sH/2,sW,sH,6); ctx.stroke();
    ctx.fillStyle="rgba(255,255,255,0.75)"; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(sL,PAD+6,SY+1); ctx.restore();
  }

  const FH2=72, FY2=H-FH2;
  ctx.save(); ctx.fillStyle="rgba(255,255,255,0.04)"; ctx.fillRect(0,FY2,W,FH2);
  ctx.fillStyle="#e8000d"; ctx.fillRect(0,FY2,W,3);
  ctx.textBaseline="middle";
  ctx.font="bold 18px English"; ctx.letterSpacing="4px"; ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.textAlign="left"; ctx.fillText("FLASH",28,FY2+FH2/2);
  const fw2=ctx.measureText("FLASH").width; ctx.fillStyle="#e8000d"; ctx.fillText("KERALAM",28+fw2+12,FY2+FH2/2);
  ctx.font="bold 15px English"; ctx.letterSpacing="2px"; ctx.fillStyle="rgba(255,255,255,0.30)"; ctx.textAlign="center"; ctx.fillText("www.flashkeralam.com",W/2,FY2+FH2/2);
  ctx.font="bold 14px English"; ctx.letterSpacing="1px"; ctx.fillStyle="rgba(255,255,255,0.22)"; ctx.textAlign="right"; ctx.fillText("#FlashKeralam",W-28,FY2+FH2/2);
  ctx.restore();
  ctx.textAlign="left"; ctx.textBaseline="alphabetic"; ctx.letterSpacing="0px";
  return canvas.toBuffer("image/png");
}

// ─────────────────────────────────────────────────────────
// MAIN EXPORT — picks one of the 3 designs at random
// ─────────────────────────────────────────────────────────

const DESIGNS = [design1,design2];

async function createNewsPoster(newsItem) {
  const idx = Math.floor(Math.random() * DESIGNS.length);
  return DESIGNS[idx](newsItem);
}

module.exports = { createNewsPoster };
