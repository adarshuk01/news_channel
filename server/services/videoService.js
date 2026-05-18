const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpeg          = require("fluent-ffmpeg");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");

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

// Path to the end video in the assets folder
const END_VIDEO_PATH = path.join(__dirname, "..", "assets", "end_video.mp4");
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
 * Convert a PNG to a silent MP4 clip, preserving its full height.
 *
 * @param {string} imgPath   Input PNG file path
 * @param {string} vidPath   Output MP4 file path (temp or final)
 * @param {number} outH      Output height (must be even)
 * @returns {Promise<void>}
 */
function renderImageClip(imgPath, vidPath, outH) {
  return new Promise((resolve, reject) => {
    ffmpeg(imgPath)
      .inputOptions(["-loop 1"])
      .input("anullsrc=channel_layout=stereo:sample_rate=44100")  // ✅ silent audio as a second input
      .inputOptions(["-f lavfi"])
      .outputOptions([
        "-c:v libx264",
        "-t 7",
        "-pix_fmt yuv420p",
        `-vf scale=${OUT_W}:${outH}`,
        "-r 25",
        "-preset ultrafast",
        "-crf 28",
        "-threads 1",
        "-x264-params sliced-threads=0:sync-lookahead=0",
        "-movflags +faststart",
        "-c:a aac",
        "-shortest",
      ])
      .output(vidPath)
      .on("start", (cmd) => console.log("🎬 ffmpeg (image clip) started:", cmd))
      .on("end",   ()    => { console.log("✅ Image clip rendered"); resolve(); })
      .on("error", (err) => { console.error("❌ ffmpeg error:", err.message); reject(err); })
      .run();
  });
}

/**
 * Re-encode the end video to match the target resolution and codec settings,
 * ensuring stream compatibility before concatenation.
 *
 * @param {string} endVidPath   Source end video
 * @param {string} outPath      Re-encoded output path
 * @param {number} outH         Target height (must be even)
 * @returns {Promise<void>}
 */
function normaliseEndVideo(endVidPath, outPath, outH) {
  return new Promise((resolve, reject) => {
    ffmpeg(endVidPath)
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        // Scale + pad to exact dimensions in case aspect ratio differs
        `-vf scale=${OUT_W}:${outH}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${outH}:(ow-iw)/2:(oh-ih)/2`,
        "-r 25",
        "-preset ultrafast",
        "-crf 28",
        "-threads 1",
        "-x264-params sliced-threads=0:sync-lookahead=0",
        "-movflags +faststart",
        "-c:a aac",
        "-ar 44100",
        "-ac 2",
      ])
      .output(outPath)
      .on("start", (cmd) => console.log("🎬 ffmpeg (normalise end video) started:", cmd))
      .on("end",   ()    => { console.log("✅ End video normalised"); resolve(); })
      .on("error", (err) => { console.error("❌ ffmpeg error:", err.message); reject(err); })
      .run();
  });
}

/**
 * Concatenate two MP4 files using the concat demuxer.
 * Both clips MUST have identical codec / resolution / frame-rate / sample-rate.
 *
 * @param {string} clip1     First clip path
 * @param {string} clip2     Second clip path
 * @param {string} outPath   Final output path
 * @returns {Promise<void>}
 */
function concatClips(clip1, clip2, outPath) {
  // Write a temporary concat list file
  const listFile = path.join(os.tmpdir(), `concat_list_${Date.now()}.txt`);
  fs.writeFileSync(listFile, `file '${clip1}'\nfile '${clip2}'\n`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions([
        "-c copy",           // stream-copy — no re-encode needed (already normalised)
        "-movflags +faststart",
      ])
      .output(outPath)
      .on("start", (cmd) => console.log("🎬 ffmpeg (concat) started:", cmd))
      .on("end", () => {
        console.log("✅ Videos concatenated");
        fs.unlinkSync(listFile);   // clean up temp list
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ ffmpeg concat error:", err.message);
        fs.unlinkSync(listFile);
        reject(err);
      })
      .run();
  });
}

/**
 * Convert a PNG file to an MP4 video with the end-video appended.
 *
 * @param {string} imgPath  Input PNG file path
 * @param {string} vidPath  Output MP4 file path
 * @returns {Promise<void>}
 */
async function convertImageToVideo(imgPath, vidPath) {
  // ── 1. Validate that the end video exists ──────────────────────────────────
  if (!fs.existsSync(END_VIDEO_PATH)) {
    throw new Error(`End video not found at: ${END_VIDEO_PATH}`);
  }

  // ── 2. Derive output height from the source image ─────────────────────────
  const { width: srcW, height: srcH } = await getImageSize(imgPath);
  const rawH  = OUT_W * srcH / srcW;
  const OUT_H = Math.ceil(rawH / 2) * 2;   // always even for x264

  console.log(`📐 Source: ${srcW}×${srcH}  →  Output: ${OUT_W}×${OUT_H}`);

  // ── 3. Temp file paths ─────────────────────────────────────────────────────
  const tmpDir       = os.tmpdir();
  const tmpImageClip = path.join(tmpDir, `img_clip_${Date.now()}.mp4`);
  const tmpEndClip   = path.join(tmpDir, `end_clip_${Date.now()}.mp4`);

  try {
    // ── 4. Render PNG → 5-second video clip ─────────────────────────────────
    await renderImageClip(imgPath, tmpImageClip, OUT_H);

    // ── 5. Normalise end video to the same spec ──────────────────────────────
    await normaliseEndVideo(END_VIDEO_PATH, tmpEndClip, OUT_H);

    // ── 6. Concatenate both clips into the final output ──────────────────────
    await concatClips(tmpImageClip, tmpEndClip, vidPath);

    console.log(`🎉 Final video saved to: ${vidPath}`);
  } finally {
    // ── 7. Clean up temp files ───────────────────────────────────────────────
    for (const f of [tmpImageClip, tmpEndClip]) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`🗑️  Removed temp file: ${f}`);
      }
    }
  }
}

module.exports = { convertImageToVideo };