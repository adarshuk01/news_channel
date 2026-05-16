// ─────────────────────────────────────────────────────────────
// FLASH KERALAM — PREMIUM RED NEWS POSTER
// ATTRACTIVE BREAKING NEWS STYLE
// ─────────────────────────────────────────────────────────────

const {
  createCanvas,
  GlobalFonts,
  loadImage,
} = require("@napi-rs/canvas");

const path = require("path");

// ─────────────────────────────────────
// FONT REGISTRATION
// ─────────────────────────────────────

GlobalFonts.registerFromPath(
  path.join(
    __dirname,
    "../fonts/AnekMalayalam-Bold.ttf"
  ),
  "Malayalam"
);

GlobalFonts.registerFromPath(
  path.join(
    __dirname,
    "../fonts/DejaVuSans-Bold.ttf"
  ),
  "English"
);

// ─────────────────────────────────────

const W = 1080;
const H = 1280;
const AD_H = 180;

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

function wrapText(ctx, text, maxWidth) {

  const words = text.split(" ");

  const lines = [];

  let cur = "";

  for (const word of words) {

    const test = cur
      ? cur + " " + word
      : word;

    if (
      ctx.measureText(test).width >
        maxWidth &&
      cur
    ) {

      lines.push(cur);

      cur = word;

    } else {

      cur = test;
    }
  }

  if (cur) lines.push(cur);

  return lines;
}

function roundRect(
  ctx,
  x,
  y,
  w,
  h,
  r
) {

  ctx.beginPath();

  ctx.moveTo(x + r, y);

  ctx.arcTo(
    x + w,
    y,
    x + w,
    y + h,
    r
  );

  ctx.arcTo(
    x + w,
    y + h,
    x,
    y + h,
    r
  );

  ctx.arcTo(
    x,
    y + h,
    x,
    y,
    r
  );

  ctx.arcTo(
    x,
    y,
    x + w,
    y,
    r
  );

  ctx.closePath();
}

// ═════════════════════════════════════════════════════════════
// DRAW POSTER
// ═════════════════════════════════════════════════════════════

async function drawPoster(
  ctx,
  newsItem
) {

  // ─────────────────────────────────
  // RED BACKGROUND
  // ─────────────────────────────────

  const bg =
    ctx.createLinearGradient(
      0,
      0,
      0,
      H
    );

  bg.addColorStop(0, "#ff2a2a");
  bg.addColorStop(0.25, "#e60000");
  bg.addColorStop(0.55, "#c40000");
  bg.addColorStop(1, "#7a0000");

  ctx.fillStyle = bg;

  ctx.fillRect(0, 0, W, H);

  // texture

  ctx.save();

  ctx.globalAlpha = 0.035;

  ctx.strokeStyle = "#ffffff";

  ctx.lineWidth = 1;

  for (
    let i = -H;
    i < W + H;
    i += 18
  ) {

    ctx.beginPath();

    ctx.moveTo(i, 0);

    ctx.lineTo(i + H, H);

    ctx.stroke();
  }

  ctx.restore();

  // ─────────────────────────────────
  // IMAGE
  // ─────────────────────────────────

  const IMG_H =
    Math.round(H * 0.58);

  try {

    const img =
      await loadImage(
        newsItem.image
      );

    const scale = Math.max(
      W / img.width,
      IMG_H / img.height
    );

    const dw =
      img.width * scale;

    const dh =
      img.height * scale;

    const dx =
      (W - dw) / 2;

    const dy =
      (IMG_H - dh) / 2;

    ctx.save();

    ctx.beginPath();

    ctx.rect(
      0,
      0,
      W,
      IMG_H
    );

    ctx.clip();

    ctx.drawImage(
      img,
      dx,
      dy,
      dw,
      dh
    );

    // subtle fade

    const fade1 =
      ctx.createLinearGradient(
        0,
        IMG_H * 0.6,
        0,
        IMG_H
      );

    fade1.addColorStop(
      0,
      "rgba(0,0,0,0)"
    );

    fade1.addColorStop(
      1,
      "rgba(0,0,0,0.45)"
    );

    ctx.fillStyle = fade1;

    ctx.fillRect(
      0,
      0,
      W,
      IMG_H
    );

    ctx.restore();

  } catch {

    ctx.fillStyle = "#900000";

    ctx.fillRect(
      0,
      0,
      W,
      IMG_H
    );
  }

  // ─────────────────────────────────
  // TOP BAR
  // ─────────────────────────────────

  const accentGrad =
    ctx.createLinearGradient(
      0,
      0,
      W,
      0
    );

  accentGrad.addColorStop(
    0,
    "rgba(255,180,0,0)"
  );

  accentGrad.addColorStop(
    0.2,
    "rgba(255,180,0,1)"
  );

  accentGrad.addColorStop(
    0.8,
    "rgba(255,180,0,1)"
  );

  accentGrad.addColorStop(
    1,
    "rgba(255,180,0,0)"
  );

  ctx.fillStyle = accentGrad;

  ctx.fillRect(0, 0, W, 4);

  // LOGO

  ctx.save();

  ctx.font =
    "bold 26px English";

  ctx.fillStyle =
    "#ffffff";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    "FLASH",
    48,
    52
  );

  const flashMW =
    ctx.measureText(
      "FLASH"
    ).width + 30;

  const goldGrad =
    ctx.createLinearGradient(
      0,
      0,
      0,
      50
    );

  goldGrad.addColorStop(
    0,
    "#ffe566"
  );

  goldGrad.addColorStop(
    1,
    "#ffaa00"
  );

  ctx.fillStyle = goldGrad;

  ctx.fillText(
    "KERALAM",
    48 + flashMW,
    52
  );

  ctx.restore();

  // DATE

  const now = new Date();

  const day = String(
    now.getDate()
  ).padStart(2, "0");

  const month = now
    .toLocaleDateString(
      "en-IN",
      {
        month: "short"
      }
    )
    .toUpperCase();

  const year =
    now.getFullYear();

  ctx.save();

  ctx.font =
    "bold 20px English";

  ctx.fillStyle =
    "rgba(255,255,255,0.75)";

  ctx.textAlign =
    "right";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    `${day} ${month} ${year}`,
    W - 48,
    52
  );

  ctx.restore();

  // ─────────────────────────────────
  // PREMIUM BREAKING NEWS TAG
  // ─────────────────────────────────

  const tagLabel =
    newsItem.tag ||
    "BREAKING NEWS";

  const tagW = 420;
  const tagH = 72;

  const tagX =
    (W - tagW) / 2;

  const tagY =
    IMG_H - 36;

  // glow

  ctx.save();

  ctx.shadowColor =
    "rgba(0,0,0,0.40)";

  ctx.shadowBlur = 30;

  ctx.shadowOffsetY = 10;

  const tagGrad =
    ctx.createLinearGradient(
      0,
      tagY,
      0,
      tagY + tagH
    );

  tagGrad.addColorStop(
    0,
    "#4c63ff"
  );

  tagGrad.addColorStop(
    0.45,
    "#3148d8"
  );

  tagGrad.addColorStop(
    1,
    "#1e2d8f"
  );

  ctx.fillStyle = tagGrad;

  roundRect(
    ctx,
    tagX,
    tagY,
    tagW,
    tagH,
    10
  );

  ctx.fill();

  ctx.restore();

  // gloss

  const gloss =
    ctx.createLinearGradient(
      0,
      tagY,
      0,
      tagY + tagH
    );

  gloss.addColorStop(
    0,
    "rgba(255,255,255,0.25)"
  );

  gloss.addColorStop(
    0.4,
    "rgba(255,255,255,0.08)"
  );

  gloss.addColorStop(
    1,
    "rgba(255,255,255,0)"
  );

  ctx.fillStyle = gloss;

  roundRect(
    ctx,
    tagX,
    tagY,
    tagW,
    tagH,
    10
  );

  ctx.fill();

  // border

  ctx.strokeStyle =
    "rgba(255,255,255,0.22)";

  ctx.lineWidth = 2;

  roundRect(
    ctx,
    tagX,
    tagY,
    tagW,
    tagH,
    10
  );

  ctx.stroke();

  // shine

  ctx.fillStyle =
    "rgba(255,255,255,0.12)";

  roundRect(
    ctx,
    tagX + 8,
    tagY + 8,
    tagW - 16,
    16,
    8
  );

  ctx.fill();

  // text

  ctx.save();

  ctx.font =
    "italic bold 38px English";

  ctx.fillStyle =
    "#ffffff";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.shadowColor =
    "rgba(0,0,0,0.35)";

  ctx.shadowBlur = 12;

  ctx.fillText(
    tagLabel,
    W / 2,
    tagY + tagH / 2 + 1
  );

  ctx.restore();

  // ─────────────────────────────────
  // TITLE
  // ─────────────────────────────────

  const PAD = 58;

  const TEXT_TOP =
    IMG_H + 56;

  const TEXT_BOT =
    H - 36;

  const TEXT_H =
    TEXT_BOT - TEXT_TOP;

  const TEXT_W =
    W - PAD * 2;

  const CX = W / 2;

  let allSegments = [];

  if (
    Array.isArray(
      newsItem.titleLines
    ) &&
    newsItem.titleLines.length
  ) {

    allSegments =
      newsItem.titleLines;

  } else if (
    newsItem.title
  ) {

    allSegments = [
      newsItem.title
    ];
  }

  if (
    newsItem.lastLine
  ) {

    allSegments = [
      ...(Array.isArray(
        newsItem.titleLines
      )
        ? newsItem.titleLines
        : [
            newsItem.title ||
              ""
          ]),
      newsItem.lastLine
    ];
  }

  let FONT_SIZE = 72;

  let allLines = [];

  while (
    FONT_SIZE >= 38
  ) {

    ctx.font =
      `bold ${FONT_SIZE}px Malayalam`;

    allLines = [];

    for (const seg of allSegments) {

      allLines.push(
        ...wrapText(
          ctx,
          seg,
          TEXT_W
        )
      );
    }

    const LINE_H =
      Math.round(
        FONT_SIZE * 1.18
      );

    if (
      allLines.length *
        LINE_H <=
      TEXT_H
    ) break;

    FONT_SIZE -= 2;
  }

  const LINE_H =
    Math.round(
      FONT_SIZE * 1.18
    );

  const totalH =
    allLines.length *
    LINE_H;

  let drawY =
    TEXT_TOP +
    Math.round(
      (TEXT_H - totalH) /
        2
    );

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "top";

  for (
    let i = 0;
    i < allLines.length;
    i++
  ) {

    ctx.save();

    ctx.font =
      `bold ${FONT_SIZE}px Malayalam`;

    ctx.shadowColor =
      "rgba(0,0,0,0.95)";

    ctx.shadowBlur = 18;

    ctx.shadowOffsetX = 2;

    ctx.shadowOffsetY = 3;

    const isLast =
      i ===
      allLines.length - 1;

    const isSecondLast =
      i ===
      allLines.length - 2;

    if (isLast) {

      const g =
        ctx.createLinearGradient(
          0,
          drawY,
          0,
          drawY +
            FONT_SIZE
        );

      g.addColorStop(
        0,
        "#ffe566"
      );

      g.addColorStop(
        1,
        "#ffaa00"
      );

      ctx.fillStyle = g;

    } else if (
      isSecondLast &&
      allLines.length > 2
    ) {

      const g =
        ctx.createLinearGradient(
          0,
          drawY,
          0,
          drawY +
            FONT_SIZE
        );

      g.addColorStop(
        0,
        "#fff0aa"
      );

      g.addColorStop(
        1,
        "#ffd040"
      );

      ctx.fillStyle = g;

    } else {

      ctx.fillStyle =
        "#ffffff";
    }

    ctx.fillText(
      allLines[i],
      CX,
      drawY
    );

    ctx.restore();

    drawY += LINE_H;
  }

  // ─────────────────────────────────
  // FOOTER
  // ─────────────────────────────────

  const FOOT_Y =
    H - 34;

  ctx.save();

  ctx.fillStyle =
    "rgba(255,255,255,0.10)";

  ctx.fillRect(
    0,
    FOOT_Y - 1,
    W,
    1
  );

  ctx.font =
    "bold 17px English";

  ctx.fillStyle =
    "rgba(255,220,120,0.75)";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    "www.flashkeralam.com",
    W / 2,
    FOOT_Y + 17
  );

  ctx.restore();
}

// ═════════════════════════════════════════════════════════════
// AD STRIP
// ═════════════════════════════════════════════════════════════

async function drawAdStrip(
  ctx,
  bannerUrl
) {

  const yOffset = H;

  if (bannerUrl) {

    try {

      const adImg =
        await loadImage(
          bannerUrl
        );

      const scale =
        W / adImg.width;

      const drawH =
        Math.min(
          adImg.height *
            scale,
          AD_H
        );

      const drawY =
        yOffset +
        (AD_H - drawH) /
          2;

      ctx.drawImage(
        adImg,
        0,
        drawY,
        W,
        drawH
      );

      return;

    } catch (e) {

      console.warn(
        "Ad banner load failed:",
        e.message
      );
    }
  }

  ctx.fillStyle =
    "#000000";

  ctx.fillRect(
    0,
    yOffset,
    W,
    AD_H
  );

  ctx.fillStyle =
    "rgba(255,255,255,0.08)";

  ctx.fillRect(
    0,
    yOffset,
    W,
    1
  );

  ctx.font =
    "bold 52px English";

  ctx.fillStyle =
    "rgba(255,255,255,0.15)";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    "YOUR AD HERE",
    W / 2,
    yOffset + AD_H / 2
  );
}

// ═════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═════════════════════════════════════════════════════════════

async function createNewsPoster(
  newsItem
) {

  const hasAd =
    !!newsItem.adBannerUrl;

  const totalH =
    hasAd
      ? H + AD_H
      : H;

  const canvas =
    createCanvas(
      W,
      totalH
    );

  const ctx =
    canvas.getContext("2d");

  await drawPoster(
    ctx,
    newsItem
  );

  if (hasAd) {

    await drawAdStrip(
      ctx,
      newsItem.adBannerUrl
    );
  }

  return canvas.toBuffer(
    "image/png"
  );
}

module.exports = {
  createNewsPoster
};