const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpeg          = require("fluent-ffmpeg");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const W = 1080;
const H = 1080;

/**
 * Convert a PNG file to a 5-second MP4.
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
        `-vf scale=${W}:${H}`,
        "-r 25",
        "-preset fast",
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