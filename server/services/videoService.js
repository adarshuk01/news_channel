const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

const { loadImage } = require("@napi-rs/canvas");

const path = require("path");
const fs = require("fs");
const os = require("os");

// ─────────────────────────────────────────────────────────────
// SAFE FFMPEG + FFPROBE LOADING
// ─────────────────────────────────────────────────────────────

try {
  const ffmpegPath = ffmpegStatic;
  console.log("✅ ffmpeg path:", ffmpegPath);
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.error("❌ ffmpeg binary missing:", ffmpegPath);
  } else {
    ffmpeg.setFfmpegPath(ffmpegPath);
    process.env.FFMPEG_PATH = ffmpegPath;
    console.log("✅ ffmpeg binary exists");
  }
} catch (err) {
  console.error("❌ Failed to load ffmpeg:", err);
}

try {
  const ffprobePath = ffprobeStatic.path;
  console.log("✅ ffprobe path:", ffprobePath);
  if (!ffprobePath || !fs.existsSync(ffprobePath)) {
    console.error("❌ ffprobe binary missing:", ffprobePath);
  } else {
    ffmpeg.setFfprobePath(ffprobePath);
    process.env.FFPROBE_PATH = ffprobePath;
    console.log("✅ ffprobe binary exists");
  }
} catch (err) {
  console.error("❌ Failed to load ffprobe:", err);
}

// ─────────────────────────────────────────────────────────────
// OUTPUT SETTINGS
// ─────────────────────────────────────────────────────────────

const OUT_W = 720;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function getImageSize(imgPath) {
  const img = await loadImage(imgPath);
  return { width: img.width, height: img.height };
}

// ─────────────────────────────────────────────────────────────
// STEP 1 — IMAGE → VIDEO
// ─────────────────────────────────────────────────────────────

function renderImageClip(imgPath, vidPath, outH) {
  return new Promise((resolve, reject) => {
    ffmpeg(imgPath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        `-vf scale=${OUT_W}:${outH}`,
        "-t 7",
        "-r 30",
        "-preset ultrafast",
        "-crf 28",
        "-threads 1",
        "-x264-params sliced-threads=0:sync-lookahead=0",
        "-movflags +faststart",
        "-an",
      ])
      .output(vidPath)
      .on("start", (cmd) => console.log("🎬 renderImageClip:", cmd))
      .on("end", () => {
        console.log("✅ Image clip created");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Image clip error:", err);
        reject(err);
      })
      .run();
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────────────────────────

async function convertImageToVideo(imgPath, vidPath) {
  console.log("🚀 Starting video generation...");

  if (!fs.existsSync(imgPath)) {
    throw new Error(`Image not found: ${imgPath}`);
  }

  const { width, height } = await getImageSize(imgPath);
  const rawH  = (OUT_W * height) / width;
  const OUT_H = Math.ceil(rawH / 2) * 2;

  console.log(`📐 ${width}x${height} → ${OUT_W}x${OUT_H}`);

  try {
    await renderImageClip(imgPath, vidPath, OUT_H);
    console.log("🎉 Final video created:", vidPath);
    return vidPath;
  } catch (err) {
    console.error("❌ convertImageToVideo ERROR:", err);
    throw err;
  }
}

module.exports = { convertImageToVideo };