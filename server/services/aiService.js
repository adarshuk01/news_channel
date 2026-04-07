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
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "You create viral Instagram reel hooks.",
        },
        {
          role: "user",
          content: `
Create 3 viral hook lines in Malayalam.

Rules:
- 5–12 words
- Emotional / curiosity tone
- No emojis, no hashtags
- Return only 3 lines

News:
${text.slice(0, 1000)}
          `.trim(),
        },
      ],
    });

    return res.choices[0].message.content.trim();

  } catch (err) {
    console.error("❌ Groq hook error:", err.message);
    return "വാർത്ത കാണാതെ പോകരുത്";
  }
};