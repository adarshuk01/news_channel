"use strict";

const path = require("path");
const fs   = require("fs");

const aiService     = require("../services/aiService");
const canvasService = require("../services/canvasService");
const videoService  = require("../services/videoService");
const cloudinary    = require("../config/cloudinary");

const { postReelToInstagram } = require("../services/instagramService");
const { postReelToFacebook }  = require("../services/facebookService");
const { uploadShort }         = require("../services/youtubeShorts");

const { TMP, safeDelete } = require("../utils/fileUtils");


// ✅ Keep Malayalam + Numbers
function keepMalayalamAndSpaces(text) {
  if (!text) return "";
  return text
    .replace(/[^\u0D00-\u0D7F0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ Safe YouTube title
function getSafeYouTubeTitle(text) {
  if (!text || !text.trim()) {
    return "Latest News #Shorts";
  }

  return text
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}


// ✅ MAIN CONTROLLER
exports.manualPostNews = async (req, res) => {
  const timestamp   = Date.now();
  const imgFilePath = path.join(TMP, `manual-${timestamp}.png`);
  const vidFilePath = path.join(TMP, `manual-${timestamp}.mp4`);

  try {
    const { title, description, imageUrl } = req.body;
    const uploadedFile = req.file;

    if (!title || !description) {
      return res.status(400).json({
        error: "Title and description are required",
      });
    }

    // ✅ Clean title
    const cleanTitle = keepMalayalamAndSpaces(title);
    const safeTitle = getSafeYouTubeTitle(cleanTitle);

    const finalTitle =
      safeTitle && safeTitle.length >= 3
        ? `${safeTitle} 🔥 #Shorts`
        : "Latest Malayalam News 🔥 #Shorts";

    // ✅ Handle image (BUFFER for Vercel)
    let imageSource;

    if (uploadedFile) {
      const base64 = uploadedFile.buffer.toString("base64");
      imageSource = `data:${uploadedFile.mimetype};base64,${base64}`;
    } else if (imageUrl) {
      imageSource = imageUrl;
    } else {
      return res.status(400).json({
        error: "Provide image file or imageUrl",
      });
    }

    // ✅ Generate hashtags
    const hashtags = await aiService.generateHashtags(
      `${title} ${description}`
    );

    // ✅ Create poster
    const pngBuffer = await canvasService.createNewsPoster({
      title: cleanTitle || title,
      image: imageSource,
    });

    fs.writeFileSync(imgFilePath, pngBuffer);

    // ⚠️ IMPORTANT: This may FAIL on Vercel
    await videoService.convertImageToVideo(imgFilePath, vidFilePath);

    // ✅ Upload to Cloudinary
    const upload = await cloudinary.uploader.upload(vidFilePath, {
      resource_type: "video",
      folder: "manual_posts",
    });

    const finalUrl = upload.secure_url;

    // ✅ Captions
    const instaCaption = `${description}കൂടുതൽ അറിയാൻ ബയോ ലിങ്ക് 👆\n\n${hashtags} #kerala #malayalam #news`;
    const fbCaption    = `${description}കൂടുതൽ അറിയാൻ ബയോ ലിങ്ക് 👆\n\n${hashtags}`;
    const ytCaption    = `${description}\n\n${hashtags} #Shorts`;

    // ✅ Multi-platform posting
    const platforms = [
      {
        name: "Instagram",
        fn: () => postReelToInstagram(finalUrl, instaCaption),
      },
      {
        name: "Facebook",
        fn: () => postReelToFacebook(finalUrl, fbCaption),
      },
      {
        name: "YouTube",
        fn: () => uploadShort(vidFilePath, finalTitle, ytCaption),
      },
    ];

    const results = await Promise.allSettled(
      platforms.map((p) => p.fn())
    );

    // ✅ Cleanup
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    return res.json({
      message: "✅ Manual post completed",
      videoUrl: finalUrl,
      title: finalTitle,
      hashtags,
      results: results.map((r, i) => ({
        platform: platforms[i].name,
        status: r.status,
      })),
    });

  } catch (err) {
    safeDelete(imgFilePath);
    safeDelete(vidFilePath);

    console.error("❌ ERROR:", err.message);

    return res.status(500).json({
      error: "Manual post failed",
      details: err.message,
    });
  }
};