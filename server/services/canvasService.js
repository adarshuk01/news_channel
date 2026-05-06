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
  const W=1080, H=1080;
  const canvas=createCanvas(W,H); const ctx=canvas.getContext("2d");
  const GOLD="#F5C518", GOLD_LIGHT="#FFD84D", WHITE="#FFFFFF", DARK_BG="#0D0D0D";
  const PAD=48, TEXT_H=Math.round(H*0.54), IMG_Y=TEXT_H, IMG_H=H-IMG_Y;

  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,"#111111"); bg.addColorStop(0.5,"#0A0A0A"); bg.addColorStop(1,"#050505");
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  const vig=ctx.createRadialGradient(W/2,H/2,W*0.3,W/2,H/2,W*0.85);
  vig.addColorStop(0,"rgba(0,0,0,0)"); vig.addColorStop(1,"rgba(0,0,0,0.55)");
  ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);

  ctx.save(); ctx.beginPath(); ctx.rect(0,IMG_Y,W,IMG_H); ctx.clip();
  try {
    const img=await loadImage(newsItem.image);
    const scale=Math.max(W/img.width,IMG_H/img.height);
    const dw=img.width*scale, dh=img.height*scale;
    const dx=(W-dw)/2, dy=IMG_Y+(IMG_H-dh)/2;
    ctx.drawImage(img,dx,dy,dw,dh);
    const ft=ctx.createLinearGradient(0,IMG_Y,0,IMG_Y+IMG_H*0.45);
    ft.addColorStop(0,"rgba(10,10,10,1)"); ft.addColorStop(0.55,"rgba(10,10,10,0.2)"); ft.addColorStop(1,"rgba(10,10,10,0)");
    ctx.fillStyle=ft; ctx.fillRect(0,IMG_Y,W,IMG_H);
    const fb2=ctx.createLinearGradient(0,H-IMG_H*0.3,0,H);
    fb2.addColorStop(0,"rgba(10,10,10,0)"); fb2.addColorStop(1,"rgba(10,10,10,0.7)");
    ctx.fillStyle=fb2; ctx.fillRect(0,H-IMG_H*0.5,W,IMG_H*0.5);
    ctx.fillStyle="rgba(255,190,0,0.06)"; ctx.fillRect(0,IMG_Y,W,IMG_H);
  } catch {
    const fb=ctx.createLinearGradient(0,IMG_Y,0,H);
    fb.addColorStop(0,"#1a1200"); fb.addColorStop(1,DARK_BG);
    ctx.fillStyle=fb; ctx.fillRect(0,IMG_Y,W,IMG_H);
  }
  ctx.restore();

  const TITLE_TOP=98, TITLE_BOT=TEXT_H-60, TITLE_H=TITLE_BOT-TITLE_TOP, TITLE_W=W-PAD*2;
  let segs=[];
  if (Array.isArray(newsItem.titleLines)&&newsItem.titleLines.length) segs=[...newsItem.titleLines];
  else if (newsItem.title) segs=[newsItem.title];
  if (newsItem.lastLine) segs=[...(Array.isArray(newsItem.titleLines)?newsItem.titleLines:[newsItem.title||""]),newsItem.lastLine];

  let FS=72, lines=[];
const GAP2=0;
while (FS>=36) {
  ctx.font=`bold ${FS}px Malayalam`; ctx.letterSpacing="0px"; lines=[];
  for (const s of segs) lines.push(...wrapText(ctx,s,TITLE_W));
  if (lines.length*(FS*1.18)+(lines.length-1)*GAP2<=TITLE_H) break;
  FS-=2;
}
  const LH2=FS*0.9, totalTH=lines.length*LH2+(lines.length-1)*GAP2;
  let drawY=TITLE_TOP+Math.round((TITLE_H-totalTH)/2);
  const lastSpec=!!newsItem.lastLine;
  for (let i=0;i<lines.length;i++) {
  ctx.save();
  const isLast=i===lines.length-1&&lastSpec, isFirst=i===0, fSz=isFirst?FS+2:FS;
  ctx.font=`bold ${fSz}px Malayalam`; ctx.letterSpacing="0px"; ctx.textAlign="center"; ctx.textBaseline="top";
  if (isLast) { ctx.shadowColor="rgba(255,210,0,0.8)"; ctx.shadowBlur=30; ctx.fillStyle=GOLD_LIGHT; }
  else { ctx.shadowColor="rgba(0,0,0,0.95)"; ctx.shadowBlur=18; ctx.shadowOffsetX=2; ctx.shadowOffsetY=3; ctx.fillStyle=GOLD; }
  ctx.scale(1, 0.78);               // ← squish vertically
  ctx.fillText(lines[i], W/2, drawY / 0.78);  // ← divide Y by same value
  ctx.restore();
  drawY+=LH2+GAP2;
}

  const BRAND_Y=TEXT_H-48;
  ctx.save();
  const brandLabel=(newsItem.brand||newsItem.source||"FLASH KERALAM").toUpperCase();
  ctx.font="bold 15px English"; ctx.letterSpacing="3px";
  const bTW=ctx.measureText(brandLabel).width+3*15, bW=bTW+64, bH=36, bX=(W-bW)/2;
  ctx.fillStyle="rgba(255,255,255,0.10)"; roundRect(ctx,bX,BRAND_Y-bH/2,bW,bH,bH/2); ctx.fill();
  ctx.strokeStyle="rgba(255,255,255,0.22)"; ctx.lineWidth=1.5; roundRect(ctx,bX,BRAND_Y-bH/2,bW,bH,bH/2); ctx.stroke();
  const iR=9; let iX=bX+20;
  ctx.fillStyle="#1877F2"; ctx.beginPath(); ctx.arc(iX,BRAND_Y,iR,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font="bold 13px English"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("f",iX,BRAND_Y+1);
  iX+=24;
  const ig=ctx.createLinearGradient(iX-iR,BRAND_Y-iR,iX+iR,BRAND_Y+iR);
  ig.addColorStop(0,"#f09433"); ig.addColorStop(0.25,"#e6683c"); ig.addColorStop(0.5,"#dc2743"); ig.addColorStop(0.75,"#cc2366"); ig.addColorStop(1,"#bc1888");
  ctx.fillStyle=ig; ctx.beginPath(); ctx.arc(iX,BRAND_Y,iR,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=WHITE; ctx.lineWidth=1.5; ctx.beginPath(); roundRect(ctx,iX-5.5,BRAND_Y-5.5,11,11,3); ctx.stroke();
  ctx.beginPath(); ctx.arc(iX,BRAND_Y,3,0,Math.PI*2); ctx.stroke();
  ctx.font="bold 15px English"; ctx.letterSpacing="3px"; ctx.fillStyle="rgba(255,255,255,0.85)"; ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(brandLabel,iX+18,BRAND_Y+1); ctx.restore();

  { const wm=newsItem.watermark||newsItem.brand||"FLASH KERALAM";
    ctx.save(); ctx.font="bold 18px English"; ctx.letterSpacing="2px"; ctx.fillStyle="rgba(255,255,255,0.28)"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(wm,W/2,IMG_Y+IMG_H*0.28); ctx.restore(); }

  { const nd=newsItem.date?new Date(newsItem.date):new Date();
    const dS=String(nd.getDate()).padStart(2,"0"), mS=nd.toLocaleDateString("en-IN",{month:"short"}).toUpperCase(), yS=String(nd.getFullYear());
    const BW=148,BH=72,BX=W-PAD-148,BY=16,BR=8;
    ctx.save();
    ctx.fillStyle="rgba(10,8,4,0.82)"; roundRect(ctx,BX,BY,BW,BH,BR); ctx.fill();
    ctx.strokeStyle=GOLD; ctx.lineWidth=2.5; roundRect(ctx,BX,BY,BW,BH,BR); ctx.stroke();
    ctx.font="bold 48px English"; ctx.letterSpacing="0px"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle=WHITE;
    ctx.fillText(dS,BX+46,BY+BH/2+2);
    ctx.fillStyle=GOLD; ctx.fillRect(BX+82,BY+12,2,BH-24);
    const RCX=BX+82+(BW-(82))/2+4;
    ctx.font="bold 20px English"; ctx.letterSpacing="2px"; ctx.fillStyle=GOLD; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(mS,RCX,BY+BH/2-12);
    ctx.font="bold 17px English"; ctx.letterSpacing="1px"; ctx.fillStyle="rgba(255,255,255,0.78)"; ctx.fillText(yS,RCX,BY+BH/2+13);
    ctx.restore(); }

  const FH=52, FY=H-FH;
  ctx.save(); ctx.fillStyle="rgba(0,0,0,0.72)"; ctx.fillRect(0,FY,W,FH);
  ctx.fillStyle=GOLD; ctx.fillRect(0,FY,W,3);
  const fCY=FY+FH/2; ctx.textBaseline="middle";
  ctx.font="bold 15px English"; ctx.letterSpacing="4px"; ctx.fillStyle="rgba(255,255,255,0.6)"; ctx.textAlign="left";
  ctx.fillText((newsItem.brand||"FLASH KERALAM").toUpperCase(),PAD,fCY);
  if (newsItem.website) { ctx.font="bold 13px English"; ctx.letterSpacing="1px"; ctx.fillStyle="rgba(255,255,255,0.28)"; ctx.textAlign="center"; ctx.fillText(newsItem.website,W/2,fCY); }
  const htag=newsItem.hashtag||("#"+(newsItem.brand||"FLASHKERALAM").replace(/\s+/g,""));
  ctx.font="bold 14px English"; ctx.letterSpacing="1px"; ctx.fillStyle="rgba(245,197,24,0.75)"; ctx.textAlign="right"; ctx.fillText(htag,W-PAD,fCY);
  ctx.restore();
  ctx.textAlign="left"; ctx.textBaseline="alphabetic"; ctx.letterSpacing="0px"; ctx.shadowColor="transparent"; ctx.shadowBlur=0;
  return canvas.toBuffer("image/png");
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

const DESIGNS = [design1,design3];

async function createNewsPoster(newsItem) {
  const idx = Math.floor(Math.random() * DESIGNS.length);
  return DESIGNS[idx](newsItem);
}

module.exports = { createNewsPoster };
