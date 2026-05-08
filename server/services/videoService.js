const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpeg          = require("fluent-ffmpeg");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ─────────────────────────────────────────────────────────────────────────────
// Output dimensions — scaled down from 1080×1280 to reduce x264 memory usage.
// Vercel / serverless environments have limited memory (~512MB–1GB).
// 720×854 keeps the same 0.844 aspect ratio while cutting memory by ~56%.
// Instagram Reels & YouTube Shorts both accept this resolution.
// ─────────────────────────────────────────────────────────────────────────────
const OUT_W = 720;
const OUT_H = 854;   // 720 × (1280/1080) = 853.3 → rounded to 854 (must be even)

/**
 * Convert a PNG file to a 5-second MP4 suitable for Instagram Reels /
 * YouTube Shorts / Facebook Reels.
 *
 * Key changes vs old version:
 *  - Scale output to 720×854  (was 1080×1280) → ~56% less memory per frame
 *  - preset ultrafast          (was fast)       → lowest encoder RAM use
 *  - crf 28                                     → acceptable quality at lower bitrate
 *  - threads 1                                  → avoids spawning extra threads in serverless
 *  - x264-params sliced-threads=0:sync-lookahead=0 → disables lookahead buffer allocs
 *
 * @param {string} imgPath  Input PNG file path
 * @param {string} vidPath  Output MP4 file path
 * @returns {Promise<void>}
 */
function convertImageToVideo(imgPath, vidPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(imgPath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        "-c:v libx264",
        "-t 5",
        "-pix_fmt yuv420p",
        `-vf scale=${OUT_W}:${OUT_H}`,
        "-r 25",
        "-preset ultrafast",          // lowest memory footprint encoder preset
        "-crf 28",                    // quality level — 23 default, 28 saves memory/size
        "-threads 1",                 // single thread — avoids parallel malloc spikes
        "-x264-params sliced-threads=0:sync-lookahead=0",  // kill lookahead buffer
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