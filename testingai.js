const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");
const dotenv = require("dotenv");

// Load environment variables from .env
dotenv.config();
const ai = new GoogleGenAI({
  apiKey:process.env.Gemini_Token, // ⚠️ Don't hardcode in production
});

async function askOpenRouter(ctx, msg, msgId) {
  try {
    const projectInfo = fs.readFileSync("project.txt", "utf8");

    // Use the message from Telegram instead of hardcoding
    const question = msg ;

    const prompt = `
You are amoderator of a group to help assist with questions:And sound genz
${projectInfo}

Based on the above, answer the following question:
${question}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents:prompt,
    });

    console.log(response.text);
   


function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

const safeText = escapeMarkdown(response.text);

await ctx.reply(safeText, {
  parse_mode: "MarkdownV2", // safer than old Markdown
  reply_to_message_id: msgId,
});

  } catch (error) {
    console.error(error);
    await ctx.reply(
      "An error occurred while processing your request. Please try again later."
    );
  }
}

module.exports = askOpenRouter;
