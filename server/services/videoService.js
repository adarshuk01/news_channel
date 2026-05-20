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

const END_VIDEO_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "end_video.mp4"
);

const AUDIO_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "audio.mp3"
);

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function getImageSize(imgPath) {
  const img = await loadImage(imgPath);
  return {
    width: img.width,
    height: img.height,
  };
}

function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath).ffprobe((err, metadata) => {
      if (err) {
        console.error("❌ ffprobe error:", err);
        return reject(err);
      }
      resolve(metadata?.format?.duration || 0);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// STEP 1 — IMAGE → VIDEO
// ─────────────────────────────────────────────────────────────

function renderImageClip(imgPath, vidPath, outH) {
  return new Promise((resolve, reject) => {
    ffmpeg(imgPath)
      .inputOptions(["-loop 1"])
      .input("anullsrc=channel_layout=stereo:sample_rate=44100")
      .inputOptions(["-f lavfi"])
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
        "-c:a aac",
        "-ar 44100",
        "-ac 2",
        "-shortest",
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
// STEP 2 — NORMALISE END VIDEO
// ─────────────────────────────────────────────────────────────

function normaliseEndVideo(endVidPath, outPath, outH) {
  return new Promise((resolve, reject) => {
    ffmpeg(endVidPath)
      .outputOptions([
        "-c:v libx264",
        "-pix_fmt yuv420p",
        `-vf scale=${OUT_W}:${outH}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${outH}:(ow-iw)/2:(oh-ih)/2`,
        "-r 30",
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
      .on("start", (cmd) => console.log("🎬 normaliseEndVideo:", cmd))
      .on("end", () => {
        console.log("✅ End video normalised");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ End video normalise error:", err);
        reject(err);
      })
      .run();
  });
}

// ─────────────────────────────────────────────────────────────
// STEP 3 — CONCAT VIDEOS
// ─────────────────────────────────────────────────────────────

function concatClips(clip1, clip2, outPath) {
  const listFile = path.join(os.tmpdir(), `concat_${Date.now()}.txt`);

  fs.writeFileSync(
    listFile,
    `file '${clip1.replace(/\\/g, "/")}'\nfile '${clip2.replace(/\\/g, "/")}'\n`
  );

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy", "-movflags +faststart"])
      .output(outPath)
      .on("start", (cmd) => console.log("🎬 concatClips:", cmd))
      .on("end", () => {
        console.log("✅ Videos concatenated");
        try { fs.unlinkSync(listFile); } catch {}
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Concat error:", err);
        try { fs.unlinkSync(listFile); } catch {}
        reject(err);
      })
      .run();
  });
}

// ─────────────────────────────────────────────────────────────
// STEP 4 — MIX AUDIO
// ─────────────────────────────────────────────────────────────

function mixAudio(videoPath, audioPath, outPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .inputOptions(["-stream_loop -1"])
      .outputOptions([
        "-c:v copy",
        "-c:a aac",
        "-ar 44100",
        "-ac 2",
        `-t ${duration}`,
        "-map 0:v",
        "-map 1:a",
        "-shortest",
        "-movflags +faststart",
      ])
      .output(outPath)
      .on("start", (cmd) => console.log("🎬 mixAudio:", cmd))
      .on("end", () => {
        console.log("✅ Audio mixed");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Audio mix error:", err);
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

  if (!fs.existsSync(END_VIDEO_PATH)) {
    throw new Error(`End video not found: ${END_VIDEO_PATH}`);
  }

  const hasAudio = fs.existsSync(AUDIO_PATH);
  console.log(hasAudio ? "🎵 Audio found" : "⚠️ No audio found");

  const { width, height } = await getImageSize(imgPath);
  const rawH = (OUT_W * height) / width;
  const OUT_H = Math.ceil(rawH / 2) * 2;

  console.log(`📐 ${width}x${height} → ${OUT_W}x${OUT_H}`);

  const tmpDir = os.tmpdir();
  const ts = Date.now();

  const tmpImageClip = path.join(tmpDir, `img_${ts}.mp4`);
  const tmpEndClip   = path.join(tmpDir, `end_${ts}.mp4`);
  const tmpConcat    = path.join(tmpDir, `concat_${ts}.mp4`);

  try {
    await renderImageClip(imgPath, tmpImageClip, OUT_H);
    await normaliseEndVideo(END_VIDEO_PATH, tmpEndClip, OUT_H);
    await concatClips(tmpImageClip, tmpEndClip, tmpConcat);

    if (hasAudio) {
      const totalDuration = await getMediaDuration(tmpConcat);
      console.log(`⏱️ Duration: ${totalDuration.toFixed(2)}s`);
      await mixAudio(tmpConcat, AUDIO_PATH, vidPath, totalDuration);
    } else {
      fs.copyFileSync(tmpConcat, vidPath);
    }

    console.log("🎉 Final video created:", vidPath);
    return vidPath;

  } catch (err) {
    console.error("❌ convertImageToVideo ERROR:", err);
    throw err;
  }
}

module.exports = {
  convertImageToVideo,
};