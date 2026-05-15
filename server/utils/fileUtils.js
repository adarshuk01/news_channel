const fs   = require("fs");
const path = require("path");

/** Temp directory — /tmp on Vercel, ../temp locally */
const TMP = process.env.VERCEL
  ? "/tmp"
  : path.join(__dirname, "../temp");

if (!fs.existsSync(TMP)) {
  fs.mkdirSync(TMP, { recursive: true });
}

/** Silently delete one or more file paths */
function safeDelete(...filePaths) {
  for (const fp of filePaths) {
    try {
      if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {
      console.warn(`⚠️ Could not delete ${fp}:`, e.message);
    }
  }
}

/** Strip query-string from an image URL */
function cleanImageUrl(url) {
  if (!url) return "";

  // ASIANET FORMAT
  // Example:
  // https://static.asianetnews.com/images/w-1280,h-720,format-jpg,...
  if (url.includes("asianetnews.com/images/")) {
    return url.replace(/w-\d+,h-\d+/g, "w-500,h-300");
  }

  // MANORAMA FORMAT
  // Example:
  // ?w=315&h=164
  if (url.includes("manoramaonline.com")) {
    try {
      const parsed = new URL(url);

      parsed.searchParams.set("w", "500");
      parsed.searchParams.set("h", "300");

      return parsed.toString();
    } catch (err) {
      return url;
    }
  }

  return url;
}

module.exports = {
  TMP,
  safeDelete,
  cleanImageUrl,
};

