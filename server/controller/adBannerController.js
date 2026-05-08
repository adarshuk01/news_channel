"use strict";

const cloudinary = require("../config/cloudinary");
const redis      = require("../config/redis");

// ─── Constants ────────────────────────────────────────────────────────────────
const REDIS_KEY_PREFIX = "ad-banner:";          // ad-banner:0, ad-banner:1, …
const REDIS_COUNT_KEY  = "ad-banner-count";     // total banners stored
const REDIS_INDEX_KEY  = "ad-banner-index";     // round-robin pointer

// Minimum dimensions required (matches the reference banner image)
const MIN_WIDTH  = 1944;
const MIN_HEIGHT = 528;

// ─── Helper: get total count ──────────────────────────────────────────────────
async function getBannerCount() {
  const raw = await redis.get(REDIS_COUNT_KEY);
  return raw ? parseInt(raw, 10) : 0;
}

// ─── POST /api/ad-banner/upload ───────────────────────────────────────────────
// Accepts a multipart image, validates dimensions, uploads to Cloudinary,
// stores the secure_url in Redis.
exports.uploadAdBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    // ── Dimension check via Cloudinary eager transformation ──────────────────
    // Upload first to a temp public_id so we can inspect dimensions.
    // We use the image's buffer (memory storage).
    const b64   = req.file.buffer.toString("base64");
    const dataUri = `data:${req.file.mimetype};base64,${b64}`;

    // Upload to a staging folder first to read dimensions
    const probe = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder:        "ad_banners_staging",
    });

    const { width, height, secure_url, public_id } = probe;

    if (width < MIN_WIDTH || height < MIN_HEIGHT) {
      // Delete the staging upload immediately
      await cloudinary.uploader.destroy(public_id, { resource_type: "image" });

      return res.status(400).json({
        error: `Image too small. Minimum dimensions: ${MIN_WIDTH}×${MIN_HEIGHT}px. ` +
               `Uploaded image is ${width}×${height}px.`,
        required: { width: MIN_WIDTH, height: MIN_HEIGHT },
        uploaded: { width, height },
      });
    }

    // ── Move to the real folder ───────────────────────────────────────────────
    const final = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder:        "ad_banners",
      overwrite:     false,
    });

    // Delete staging copy
    await cloudinary.uploader.destroy(public_id, { resource_type: "image" });

    // ── Persist URL in Redis ──────────────────────────────────────────────────
    const count = await getBannerCount();
    const slot  = count; // append at end

    await redis.set(`${REDIS_KEY_PREFIX}${slot}`, final.secure_url);
    await redis.set(REDIS_COUNT_KEY, String(count + 1));

    console.log(`🖼️  Ad banner saved to slot ${slot}: ${final.secure_url}`);

    return res.json({
      message:    "✅ Ad banner uploaded successfully.",
      slot,
      url:        final.secure_url,
      dimensions: { width: final.width, height: final.height },
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
