"use strict";

const groq = require("../config/openai");

const MODEL = "llama-3.3-70b-versatile";

exports.generateNewsContent = async (news) => {

  try {

    const completion =
      await groq.chat.completions.create({

        model: MODEL,

        temperature: 0.9,

        messages: [

          {
            role: "system",

            content: `
You are a professional Malayalam viral news content creator.

Return ONLY valid JSON.

{
  "viralTitle": "",
  "summary": "",
  "hashtags": ""
}
            `
          },

          {
            role: "user",

            content: `
Generate Malayalam viral news content.

RULES:

viralTitle:
- Malayalam
- Highly engaging
- Curiosity driven
- Emotional
- YouTube/Facebook/Instagram style
- Maximum 8-14 words
- No quotes
- No emojis
- Should make users click instantly

summary:
- Malayalam
- 100-120 words
- Professional Malayalam news style
- Simple readable Malayalam
- No fake information
- No markdown

hashtags:
- 15 hashtags
- English only
- Single line
- Kerala + news related
- No spam hashtags
- No comas  # must be therir in all words

NEWS:
${news}
            `
          }
        ]
      });

    let text =
      completion.choices[0].message.content;

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    return {

      viralTitle:
        parsed.viralTitle ||
        "ഇത് കണ്ടാൽ നിങ്ങൾ ഞെട്ടും",

      summary:
        parsed.summary ||
        "പ്രധാന വാർത്ത വിവരങ്ങൾ ലഭ്യമല്ല.",

      hashtags:
        parsed.hashtags ||
        "#kerala #malayalam #news"
    };

  } catch (err) {

    console.error(
      "❌ Groq AI Error:",
      err.message
    );

    return {

      viralTitle:
        "ഇത് കണ്ടാൽ നിങ്ങൾ ഞെട്ടും",

      summary:
        "പ്രധാന വാർത്ത വിവരങ്ങൾ ലഭ്യമല്ല.",

      hashtags:
        "#kerala #malayalam #news"
    };
  }
};