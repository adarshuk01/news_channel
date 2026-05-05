"use strict";

const axios = require("axios");

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID   = process.env.INSTAGRAM_USER_ID;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ✅ Caption safety
function sanitizeCaption(caption) {
  if (!caption) return "";

  let safe = caption.slice(0, 2000);

  const tags = safe.match(/#[\w]+/g) || [];
  if (tags.length > 25) {
    const trimmed = tags.slice(0, 25).join(" ");
    safe = safe.replace(/#[\w]+/g, "") + "\n\n" + trimmed;
  }

  return safe;
}

async function postReelToInstagram(videoUrl, caption) {
  try {
    console.log("🚀 Starting Instagram Reel upload...");

    const safeCaption = sanitizeCaption(caption);

    // Step 1 — Create container
    const creationRes = await axios.post(
      `https://graph.facebook.com/v18.0/${IG_USER_ID}/media`,
      {
        media_type: "REELS",
        video_url: videoUrl,
        caption: safeCaption,
        share_to_feed: true,
        access_token: ACCESS_TOKEN,
      }
    );

    const creationId = creationRes.data.id;
    console.log("🎬 Instagram container created:", creationId);

    // Step 2 — Poll status
    let isReady = false;
    let attempt = 0;

    while (!isReady && attempt < 20) {
      attempt++;
      await sleep(5000); // ✅ increased

      const statusRes = await axios.get(
        `https://graph.facebook.com/v18.0/${creationId}`,
        {
          params: {
            fields: "status_code",
            access_token: ACCESS_TOKEN,
          },
        }
      );

      const status = statusRes.data.status_code;
      console.log(`⏳ Instagram processing attempt ${attempt}: ${status}`);

      if (status === "FINISHED") {
        isReady = true;
      }

      if (status === "ERROR") {
        throw new Error("Instagram video processing failed");
      }
    }

    if (!isReady) {
      throw new Error("Instagram video not ready after attempts");
    }

    // 🔥 CRITICAL FIX — WAIT BEFORE PUBLISH
    console.log("⏳ Waiting 8 seconds before publishing...");
    await sleep(8000);

    // Step 3 — Publish
    const publishRes = await axios.post(
      `https://graph.facebook.com/v18.0/${IG_USER_ID}/media_publish`,
      {
        creation_id: creationId,
        access_token: ACCESS_TOKEN,
      }
    );

    console.log("✅ Instagram Reel posted:", publishRes.data);
    return publishRes.data;

  } catch (err) {
    console.error(
      "❌ Instagram ERROR:",
      err.response?.data || err.message
    );
    throw err;
  }
}

async function postImageToInstagram(imageUrl, caption) {
  try {
    console.log("🚀 Starting Instagram Image upload...");
    console.log("🖼️ Image URL:", imageUrl);

    const safeCaption = sanitizeCaption(caption); // ← add sanitization

    // Step 1: Create media container
    const containerRes = await axios.post(
      `https://graph.facebook.com/v18.0/${IG_USER_ID}/media`, // ← use v18.0 to match rest of file
      {
        image_url: imageUrl,
        caption: safeCaption,
        access_token: ACCESS_TOKEN,
      }
    );

    const creationId = containerRes.data.id;
    console.log("🖼️ Instagram image container created:", creationId);

    // Step 2: Publish the container
    const publishRes = await axios.post(
      `https://graph.facebook.com/v18.0/${IG_USER_ID}/media_publish`,
      {
        creation_id: creationId,
        access_token: ACCESS_TOKEN,
      }
    );

    console.log("✅ Instagram Image posted:", publishRes.data);
    return publishRes.data;

  } catch (err) {
    console.error(
      "❌ Instagram Image ERROR:",
      err.response?.data || err.message  // ← log full Instagram error
    );
    throw err;
  }
}

module.exports = { postReelToInstagram,postImageToInstagram };