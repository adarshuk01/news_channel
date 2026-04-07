const OpenAI = require("openai");
require("dotenv").config();

console.log('api key',process.env.GROQ_API_KEY);


const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

module.exports = openai;