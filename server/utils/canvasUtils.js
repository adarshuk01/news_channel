/**
 * Wrap text into lines that fit within maxWidth.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line    = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) lines.push(line);
  return lines;
}

/**
 * Draw text that auto-shrinks to fit inside a bounding box.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {string} [fontFamily="Malayalam"]
 */
function drawAutoFitText(ctx, text, x, y, maxWidth, maxHeight, fontFamily = "Malayalam") {
  let fontSize = 72;
  let lines    = [];

  while (fontSize > 20) {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    lines    = wrapLines(ctx, text, maxWidth);
    if (lines.length * (fontSize + 10) <= maxHeight) break;
    fontSize -= 2;
  }

  let currentY = y;
  for (const line of lines) {
    ctx.strokeText(line, x, currentY);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, x, currentY);
    currentY += fontSize + 10;
  }
}

/**
 * Draw a rounded rectangle path (does not fill/stroke — caller decides).
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

module.exports = { wrapLines,   drawAutoFitText, roundRect };