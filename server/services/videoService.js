const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpeg          = require("fluent-ffmpeg");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ─────────────────────────────────────────────────────────────────────────────
// Output width is fixed at 720px (memory-safe for serverless).
// Output height is derived from the actual PNG dimensions so the full canvas
// is preserved — whether that is:
//   poster only  →  1080 × 1280  →  scaled to  720 × 854
//   poster + ad  →  1080 × 1460  →  scaled to  720 × 975  (975 = 720×1460/1080, rounded to even)
//
// Rule: OUT_H must always be an even number (x264 requirement).
// ─────────────────────────────────────────────────────────────────────────────
const OUT_W = 720;

/**
 * Read the pixel dimensions of a PNG without fully decoding it.
 * @param {string} imgPath
 * @returns {Promise<{ width: number, height: number }>}
 */
async function getImageSize(imgPath) {
  const img = await loadImage(imgPath);
  return { width: img.width, height: img.height };
}

/**
 * Convert a PNG file to an MP4 video, preserving its full height.
 *
 * @param {string} imgPath  Input PNG file path
 * @param {string} vidPath  Output MP4 file path
 * @returns {Promise<void>}
 */
async function convertImageToVideo(imgPath, vidPath) {
  // Derive output height from actual image — rounds to nearest even number
  const { width: srcW, height: srcH } = await getImageSize(imgPath);
  const rawH  = OUT_W * srcH / srcW;
  const OUT_H = Math.ceil(rawH / 2) * 2;   // always even for x264

  console.log(`📐 Source: ${srcW}×${srcH}  →  Output: ${OUT_W}×${OUT_H}`);

  return new Promise((resolve, reject) => {
    ffmpeg(imgPath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        "-c:v libx264",
        "-t 5",
        "-pix_fmt yuv420p",
        `-vf scale=${OUT_W}:${OUT_H}`,
        "-r 25",
        "-preset ultrafast",
        "-crf 28",
        "-threads 1",
        "-x264-params sliced-threads=0:sync-lookahead=0",
        "-movflags +faststart",
      ])
      .output(vidPath)
      .on("start", (cmd) => console.log("🎬 ffmpeg started:", cmd))
      .on("end",   ()    => { console.log("✅ Video conversion complete"); resolve(); })
      .on("error", (err) => { console.error("❌ ffmpeg error:", err.message); reject(err); })
      .run();
  });
}

module.exports = { convertImageToVideo };