// ─────────────────────────────────────────────
// STUDIO STYLE NEWS POSTER V5
// Dynamic font sizing
// Removed blue left line
// Cleaner premium layout
// ─────────────────────────────────────────────

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
  path.join(__dirname, "../fonts/RIT-tnjoy-extrabold.ttf"),
  "Malayalam"
);

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans-Bold.ttf"),
  "EnglishBold"
);

GlobalFonts.registerFromPath(
  path.join(__dirname, "../fonts/DejaVuSans.ttf"),
  "English"
);

// ─────────────────────────────────────

const W = 1080;
const H = 1350;

// ─────────────────────────────────────
// HELPERS
// ─────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {

  ctx.beginPath();

  ctx.moveTo(x + r, y);

  ctx.lineTo(x + w - r, y);

  ctx.quadraticCurveTo(
    x + w,
    y,
    x + w,
    y + r
  );

  ctx.lineTo(x + w, y + h - r);

  ctx.quadraticCurveTo(
    x + w,
    y + h,
    x + w - r,
    y + h
  );

  ctx.lineTo(x + r, y + h);

  ctx.quadraticCurveTo(
    x,
    y + h,
    x,
    y + h - r
  );

  ctx.lineTo(x, y + r);

  ctx.quadraticCurveTo(
    x,
    y,
    x + r,
    y
  );

  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {

  const words = text.split(" ");

  const lines = [];

  let line = "";

  for (const word of words) {

    const test = line
      ? line + " " + word
      : word;

    if (
      ctx.measureText(test).width >
        maxWidth &&
      line
    ) {

      lines.push(line);

      line = word;

    } else {

      line = test;
    }
  }

  if (line) lines.push(line);

  return lines;
}

// ─────────────────────────────────────
// DATE
// ─────────────────────────────────────

function getTodayDate() {

  return new Date().toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );
}

// ─────────────────────────────────────
// BACKGROUND
// ─────────────────────────────────────

async function drawBackground(
  ctx,
  imagePath
) {

  try {

    const img = await loadImage(
      imagePath
    );

    const imgAspect =
      img.width / img.height;

    const canvasAspect = W / H;

    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (imgAspect > canvasAspect) {

      sw = img.height * canvasAspect;

      sx = (img.width - sw) / 2;

    } else {

      sh = img.width / canvasAspect;

      sy = (img.height - sh) / 2;
    }

    ctx.save();

    ctx.filter =
      "blur(6px) brightness(0.55)";

    ctx.drawImage(
      img,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      W,
      H
    );

    ctx.restore();

    // DARK OVERLAY
    const overlay =
      ctx.createLinearGradient(
        0,
        0,
        0,
        H
      );

    overlay.addColorStop(
      0,
      "rgba(0,0,0,0.12)"
    );

    overlay.addColorStop(
      0.55,
      "rgba(0,0,0,0.25)"
    );

    overlay.addColorStop(
      1,
      "rgba(0,0,0,0.45)"
    );

    ctx.fillStyle = overlay;

    ctx.fillRect(0, 0, W, H);

    return img;

  } catch (err) {

    ctx.fillStyle = "#1a1a1a";

    ctx.fillRect(0, 0, W, H);

    return null;
  }
}

// ─────────────────────────────────────
// LOGO
// ─────────────────────────────────────

function drawLogo(ctx) {

  ctx.textAlign = "center";

  ctx.font =
    "bold 40px EnglishBold";

  ctx.fillStyle = "#FFFFFF";

  ctx.fillText(
    "FLASH KERALAM",
    W / 2,
    105
  );

  ctx.textAlign = "left";
}

// ─────────────────────────────────────
// MAIN CARD
// ─────────────────────────────────────

async function drawMainCard(
  ctx,
  img,
  title
) {

  const cardW = 900;

  const x = (W - cardW) / 2;

  const y = 150;

  // IMAGE
  const imageX = x + 24;

  const imageY = y + 24;

  const imageW = cardW - 48;

  const imageH = 640;

  // TITLE AREA
  const contentY =
    imageY + imageH + 60;

  const maxWidth = 760;

  // DYNAMIC FONT SIZE
  let fontSize = 78;

  let lines = [];

  while (fontSize >= 48) {

    ctx.font =
      `bold ${fontSize}px Malayalam`;

    lines = wrapText(
      ctx,
      title,
      maxWidth
    );

    // auto-adjust based on line count
    if (lines.length <= 4) break;

    fontSize -= 3;
  }

  const lineHeight =
    fontSize * 1.16;

  const titleHeight =
    lines.length * lineHeight;

  // DYNAMIC CARD HEIGHT
  const cardH =
    imageH +
    titleHeight +
    220;

  // SHADOW
  ctx.save();

  ctx.shadowColor =
    "rgba(0,0,0,0.35)";

  ctx.shadowBlur = 50;

  ctx.shadowOffsetY = 18;

  ctx.fillStyle = "#FFFFFF";

  roundRect(
    ctx,
    x,
    y,
    cardW,
    cardH,
    0
  );

  ctx.fill();

  ctx.restore();

  // CARD BG
  ctx.fillStyle = "#F8F8F8";

  roundRect(
    ctx,
    x,
    y,
    cardW,
    cardH,
    0
  );

  ctx.fill();

  // IMAGE
  if (img) {

    const imgAspect =
      img.width / img.height;

    const frameAspect =
      imageW / imageH;

    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (imgAspect > frameAspect) {

      sw =
        img.height * frameAspect;

      sx = (img.width - sw) / 2;

    } else {

      sh =
        img.width / frameAspect;

      sy =
        (img.height - sh) / 2;
    }

    ctx.drawImage(
      img,
      sx,
      sy,
      sw,
      sh,
      imageX,
      imageY,
      imageW,
      imageH
    );
  }

  // BREAKING NEWS TAG
  ctx.fillStyle = "#2D3FAE";

  roundRect(
    ctx,
    imageX,
    imageY + imageH - 54,
    220,
    54,
    0
  );

  ctx.fill();

  ctx.font =
    "italic 28px English";

  ctx.fillStyle = "#FFFFFF";

  ctx.fillText(
    "Breaking News",
    imageX + 20,
    imageY + imageH - 18
  );

  // TITLE
  ctx.fillStyle = "#101010";

  ctx.textBaseline = "top";

  ctx.textAlign = "left";

  let ty = contentY;

  for (const line of lines) {

    ctx.font =
      `bold ${fontSize}px Malayalam`;

    ctx.fillText(
      line,
      x + 70,
      ty
    );

    ty += lineHeight;
  }

  // DATE
  ctx.font = "28px English";

  ctx.fillStyle = "#243DB8";

  ctx.fillText(
    `(${getTodayDate()})`,
    x + 70,
    ty + 35
  );

  return {
    cardBottom: y + cardH,
  };
}

// ─────────────────────────────────────
// FOOTER
// ─────────────────────────────────────

function drawFooter(
  ctx,
  cardBottom
) {

  const footerY = Math.min(
    cardBottom + 80,
    H - 80
  );

  // GLASS STRIP
  ctx.fillStyle =
    "rgba(255,255,255,0.07)";

  ctx.fillRect(
    0,
    footerY - 55,
    W,
    110
  );

  ctx.font = "30px English";

  ctx.fillStyle =
    "rgba(255,255,255,0.92)";

  ctx.fillText(
    "Read More  ➜",
    110,
    footerY + 10
  );

  ctx.textAlign = "right";

  ctx.fillText(
    "Source : www.flashkeralam.com",
    W - 110,
    footerY + 10
  );

  ctx.textAlign = "left";
}

// ─────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────

async function createNewsPoster(
  newsItem
) {

  const canvas = createCanvas(
    W,
    H
  );

  const ctx =
    canvas.getContext("2d");

  // BACKGROUND
  const img =
    await drawBackground(
      ctx,
      newsItem.image
    );

  // LOGO
  drawLogo(ctx);

  // MAIN CARD
  const result =
    await drawMainCard(
      ctx,
      img,
      newsItem.title ||
        "ഇവിടെ വാർത്താ തലക്കെട്ട് വരും"
    );

  // FOOTER
  drawFooter(
    ctx,
    result.cardBottom
  );

  return canvas.toBuffer(
    "image/png"
  );
}

module.exports = {
  createNewsPoster,
};