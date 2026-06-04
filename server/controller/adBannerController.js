"use strict";

const cloudinary = require("../config/cloudinary");
const redis      = require("../config/redis");

// ─── Constants ────────────────────────────────────────────────────────────────
const REDIS_KEY_PREFIX = "ad-banner:";
const REDIS_COUNT_KEY  = "ad-banner-count";
const REDIS_INDEX_KEY  = "ad-banner-index";

// ─── Helper: detect real mimetype from buffer magic bytes ─────────────────────
// multer memoryStorage passes the browser-reported Content-Type, which is based
// on file extension — NOT the actual file content. A JPEG file named .png will
// be reported as "image/png". If we pass that wrong mimetype to Cloudinary, it
// re-encodes the file as PNG, which can produce corrupt or unloadable output.
// This function reads the first 4 magic bytes to get the TRUE format.
function detectMimeType(buffer) {
  const b = buffer;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "image/webp";
  // Default to JPEG if unrecognised
  return "image/jpeg";
}

// ─── Helper: get total count ──────────────────────────────────────────────────
async function getBannerCount() {
  const raw = await redis.get(REDIS_COUNT_KEY);
  return raw ? parseInt(raw, 10) : 0;
}

// ─── POST /api/ad-banner/upload ───────────────────────────────────────────────
exports.uploadAdBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    // Detect real format from magic bytes — ignore browser-reported mimetype
    const realMime = detectMimeType(req.file.buffer);
    const b64      = req.file.buffer.toString("base64");
    const dataUri  = `data:${realMime};base64,${b64}`;

    console.log(`[Ad Upload] Browser mime: ${req.file.mimetype} | Detected mime: ${realMime}`);

    const final = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder:        "ad_banners",
      overwrite:     false,
    });

    const { width, height, secure_url } = final;

    const count = await getBannerCount();
    const slot  = count;

    await redis.set(`${REDIS_KEY_PREFIX}${slot}`, secure_url);
    await redis.set(REDIS_COUNT_KEY, String(count + 1));

    console.log(`🖼️  Ad banner saved to slot ${slot}: ${secure_url} (${width}x${height})`);

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
exports.deleteAdBanner = async (req, res) => {
  try {
    const slot  = parseInt(req.params.slot, 10);
    const count = await getBannerCount();

    if (isNaN(slot) || slot < 0 || slot >= count) {
      return res.status(400).json({ error: `Invalid slot. Must be 0–${count - 1}.` });
    }

    for (let i = slot; i < count - 1; i++) {
      const next = await redis.get(`${REDIS_KEY_PREFIX}${i + 1}`);
      await redis.set(`${REDIS_KEY_PREFIX}${i}`, next);
    }

    await redis.del(`${REDIS_KEY_PREFIX}${count - 1}`);
    await redis.set(REDIS_COUNT_KEY, String(count - 1));

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


// ─── Shared helper: round-robin URL for poster generation ────────────────────
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