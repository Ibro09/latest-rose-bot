// askOpenRouter.js
// const fetch = require('node-fetch'); // Uncomment this if you're on Node < v18
const fs = require("fs");
require("dotenv").config();


const OPENROUTER_API_KEY =process.env.Ai_Token // Replace this
const YOUR_SITE_URL = "https://your-site-url.com"; // Optional
const YOUR_SITE_NAME = "YourSiteName"; // Optional

async function askOpenRouter(ctx, msg) {
  const info = fs.readFileSync("project.txt", "utf8");
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": YOUR_SITE_URL,
        "X-Title": YOUR_SITE_NAME,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "z-ai/glm-4.5-air:free",
        messages: [
          {
            role: "system",
            content: `
You are the official assistant for the Fomowl Web3 project.
You are informative, friendly, and direct. Never use vague or filler phrases like "based on the information provided to me" or "I don’t see specific details". Instead, if a question has no current answer, respond clearly and guide the user to the next best resource (like community channels, docs, or announcements).
If something is unknown, say so confidently and offer where or when the user can find updates. Your goal is to make users feel helped—even if the full answer isn’t available yet.
`,
          },
          {
            role: "user",
            content: info,
          },
          {
            role: "user",
            content: msg,
          },
        ],
      }),
    }
  );

  const data = await response.json();
  console.log("💬 Response:", data.choices[0].message.content);
  await ctx.reply(data.choices[0].message.content, {
    parse_mode: "Markdown",
  });
}

module.exports = askOpenRouter;
