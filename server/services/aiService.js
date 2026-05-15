"use strict";

const groq = require("../config/openai");

const MODEL = "llama-3.3-70b-versatile";

exports.generateNewsContent = async (news) => {

  try {

    const completion = await groq.chat.completions.create({

      model: MODEL,
      temperature: 0.9,

      messages: [
        {
          role: "system",
          content: `
You are a professional Malayalam viral news content creator for FLASH KERALAM.

Return ONLY valid JSON, no markdown, no backticks, no extra text.

{
  "viralTitle": "",
  "summary": "",
  "caption": "",
  "hashtags": ""
}
          `.trim(),
        },

        {
          role: "user",
          content: `
Generate Malayalam viral news content for a breaking news poster.

━━━ RULES ━━━

viralTitle:
- Malayalam script only (no English, no numbers written in English digits)
- MAXIMUM 6 words — strictly enforced (poster space is limited)
- Punchy, curiosity-driven, emotional, click-bait style
- No quotes, no emojis, no punctuation marks
- Make it feel urgent and shocking
- Every word must contribute — cut filler words ruthlessly
- Bad example (too long): "കടുത്ത അതൃപ്തി വീടിന് പുറകിലൂടെ രമേശ് ചെന്നിത്തല ഇറങ്ങിപ്പോയി"
- Good example (6 words): "രമേശ് ചെന്നിത്തല രഹസ്യമായി ഇറങ്ങിപ്പോയി"

summary:
- Malayalam
- 80–100 words
- Professional news style, simple readable Malayalam
- No fake information, no markdown

caption:
- Malayalam
- 2 punchy lines for social media
- Ends with a call-to-action

hashtags:
- Exactly 15 hashtags
- English only, single line, space-separated
- # must prefix every tag, no commas
- Kerala + news relevant, no spam

━━━ NEWS ━━━
${news}
          `.trim(),
        },
      ],
    });

    let text = completion.choices[0].message.content;
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(text);

    // ── Safety: hard-truncate viralTitle to 6 words if AI ignores the rule ──
    const rawTitle = parsed.viralTitle || "ഇത് കണ്ടാൽ നിങ്ങൾ ഞെട്ടും";
    const titleWords = rawTitle.trim().split(/\s+/);
    const viralTitle = titleWords.slice(0, 6).join(" ");

    return {
      viralTitle,
      summary:  parsed.summary  || "പ്രധാന വാർത്ത വിവരങ്ങൾ ലഭ്യമല്ല.",
      caption:  parsed.caption  || "",
      hashtags: parsed.hashtags || "#kerala #malayalam #news #keralanews #trending",
    };

  } catch (err) {

    console.error("❌ Groq AI Error:", err.message);

    return {
      viralTitle: "ഞെട്ടിക്കുന്ന വലിയ വാർത്ത",
      summary:    "പ്രധാന വാർത്ത വിവരങ്ങൾ ലഭ്യമല്ല.",
      caption:    "",
      hashtags:   "#kerala #malayalam #news #keralanews #trending",
    };
  }
};