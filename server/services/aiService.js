const openai = require("../config/openai");

const MODEL = "openai/gpt-oss-120b"; // ✅ fast + free on Groq

/**
 * Generate Instagram hashtags
 */
exports.generateHashtags = async (topic) => {
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "You generate Instagram hashtags for news posts.",
        },
        {
          role: "user",
          content: `
Generate 15-20 Instagram hashtags based on this topic.

Rules:
- English hashtags only
- Include:
  • 2 news-related
  • 2 if any specified names
  • 2 topic-specific
  • 2 Kerala/location hashtags
- Avoid spam (#followforfollow etc)
- Output ONLY hashtags in one line

Topic: ${topic}
          `.trim(),
        },
      ],
    });

    return res.choices[0].message.content.trim();

  } catch (err) {
    console.error("❌ Groq hashtag error:", err.message);
    return "#kerala #news #india #breakingnews #malayalam";
  }
};


/**
 * Generate viral Malayalam hookss
 */
exports.generateViralHook = async (text) => {
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.9, // more creative & viral
      messages: [
        {
          role: "system",
          content: `
You are an expert viral Malayalam content creator.
You write hooks that stop scrolling instantly.
Hooks must trigger curiosity, shock, or emotion.
          `.trim(),
        },
        {
          role: "user",
          content: `
Generate EXACTLY 3 viral Malayalam hook lines.

STRICT RULES:
- Each line must be 5–12 words
- Use simple Malayalam (no complex words)
- Highly emotional OR curiosity-driven
- Use power words like:
  "ഞെട്ടി", "വിശ്വസിക്കാനാകില്ല", "സത്യം", "ഇത് കണ്ടോ", "ഇങ്ങനെ സംഭവിച്ചു"
- No emojis
- No hashtags
- No numbering
- No quotes
- Each hook on a new line
- Avoid repeating same pattern

GOAL:
Make people feel "I must watch this now"

NEWS:
${text.slice(0, 1000)}
          `.trim(),
        },
      ],
    });

    return res.choices[0].message.content.trim();

  } catch (err) {
    console.error("❌ Hook error:", err.message);
    return "ഇത് കണ്ടാൽ നിങ്ങൾ ഞെട്ടും";
  }
};