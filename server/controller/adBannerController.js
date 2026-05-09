"use strict";

const cloudinary = require("../config/cloudinary");
const redis      = require("../config/redis");

// ─── Constants ────────────────────────────────────────────────────────────────
const REDIS_KEY_PREFIX = "ad-banner:";   // ad-banner:0, ad-banner:1, …
const REDIS_COUNT_KEY  = "ad-banner-count";
const REDIS_INDEX_KEY  = "ad-banner-index";

// Recommended minimum dimensions (soft warning only — NOT enforced)
const REC_WIDTH  = 1944;
const REC_HEIGHT = 528;

// ─── Helper: get total count ──────────────────────────────────────────────────
async function getBannerCount() {
  const raw = await redis.get(REDIS_COUNT_KEY);
  return raw ? parseInt(raw, 10) : 0;
}

// ─── POST /api/ad-banner/upload ───────────────────────────────────────────────
// Accepts any image — NO dimension enforcement.
// Uploads directly to Cloudinary ad_banners folder and stores the URL in Redis.
exports.uploadAdBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    const b64     = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${b64}`;

    // ── Upload straight to the real folder — no staging, no dimension gate ───
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder:        "ad_banners",
      overwrite:     false,
    });

    const { width, height, secure_url } = result;

    // Soft log if below recommended size (won't block)
    if (width < REC_WIDTH || height < REC_HEIGHT) {
      console.warn(
        `⚠️  Ad banner is ${width}×${height}px — below recommended ${REC_WIDTH}×${REC_HEIGHT}px. ` +
        "It will still be used but may appear stretched."
      );
    }

    // ── Persist URL in Redis ──────────────────────────────────────────────────
    const count = await getBannerCount();
    const slot  = count;

    await redis.set(`${REDIS_KEY_PREFIX}${slot}`, secure_url);
    await redis.set(REDIS_COUNT_KEY, String(count + 1));

    console.log(`🖼️  Ad banner saved to slot ${slot}: ${secure_url}`);

    return res.json({
      message:    "✅ Ad banner uploaded successfully.",
      slot,
      url:        secure_url,
      dimensions: { width, height },
    });

  } catch (err) {
    console.error("❌ uploadAdBanner error:", err.message);
    return res.status(500).json({ error: "Upload failed.", details: err.message });
  }
};


// ─── GET /api/ad-banner/current ───────────────────────────────────────────────
// Returns the current ad banner URL (for frontend preview / status).
exports.getCurrentAdBanner = async (req, res) => {
  try {
    const count = await getBannerCount();

    if (count === 0) {
      return res.json({ url: null, message: "No ad banners uploaded yet." });
    }

    const rawIdx = await redis.get(REDIS_INDEX_KEY);
    const idx    = rawIdx ? parseInt(rawIdx, 10) % count : 0;
    const url    = await redis.get(`${REDIS_KEY_PREFIX}${idx}`);

    return res.json({ url, slot: idx, total: count });
  } catch (err) {
    console.error("❌ getCurrentAdBanner error:", err.message);
    return res.status(500).json({ error: "Failed to get banner.", details: err.message });
  }
};


// ─── GET /api/ad-banner/list ──────────────────────────────────────────────────
// Returns all stored ad banners.
exports.listAdBanners = async (req, res) => {
  try {
    const count = await getBannerCount();

    if (count === 0) {
      return res.json({ banners: [], total: 0 });
    }

    const banners = [];
    for (let i = 0; i < count; i++) {
      const url = await redis.get(`${REDIS_KEY_PREFIX}${i}`);
      if (url) banners.push({ slot: i, url });
    }

    return res.json({ banners, total: banners.length });
  } catch (err) {
    console.error("❌ listAdBanners error:", err.message);
    return res.status(500).json({ error: "Failed to list banners.", details: err.message });
  }
};


// ─── DELETE /api/ad-banner/:slot ─────────────────────────────────────────────
// Removes a specific banner slot (shifts remaining slots down).
exports.deleteAdBanner = async (req, res) => {
  try {
    const slot  = parseInt(req.params.slot, 10);
    const count = await getBannerCount();

    if (isNaN(slot) || slot < 0 || slot >= count) {
      return res.status(400).json({ error: `Invalid slot. Must be 0–${count - 1}.` });
    }

    // Shift all banners above this slot down by one
    for (let i = slot; i < count - 1; i++) {
      const next = await redis.get(`${REDIS_KEY_PREFIX}${i + 1}`);
      await redis.set(`${REDIS_KEY_PREFIX}${i}`, next);
    }

    // Remove the last slot and decrement count
    await redis.del(`${REDIS_KEY_PREFIX}${count - 1}`);
    await redis.set(REDIS_COUNT_KEY, String(count - 1));

    // Reset index if it would be out-of-range
    const newCount = count - 1;
    if (newCount === 0) {
      await redis.del(REDIS_INDEX_KEY);
    } else {
      const rawIdx = await redis.get(REDIS_INDEX_KEY);
      const idx    = rawIdx ? parseInt(rawIdx, 10) : 0;
      if (idx >= newCount) {
        await redis.set(REDIS_INDEX_KEY, "0");
      }
    }

    return res.json({ message: `✅ Banner slot ${slot} deleted.`, remaining: newCount });
  } catch (err) {
    console.error("❌ deleteAdBanner error:", err.message);
    return res.status(500).json({ error: "Delete failed.", details: err.message });
  }
};


// ─── Shared helper used by postNewsController & manualPostController ──────────
// Returns the next ad banner URL (round-robin) or null if none.
exports.getNextAdBannerUrl = async function () {
  const count = await getBannerCount();

  if (count === 0) {
    console.warn("⚠️  No ad banners in Redis.");
    return null;
  }

  const rawIdx     = await redis.get(REDIS_INDEX_KEY);
  const currentIdx = rawIdx ? parseInt(rawIdx, 10) : 0;
  const safeIdx    = currentIdx % count;
  const nextIdx    = (safeIdx + 1) % count;

  await redis.set(REDIS_INDEX_KEY, String(nextIdx));

  const url = await redis.get(`${REDIS_KEY_PREFIX}${safeIdx}`);
  console.log(`🖼️  Ad Banner [${safeIdx + 1}/${count}]: ${url}`);
  return url || null;
};
