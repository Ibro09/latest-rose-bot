import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
// Load environment variables from .env
dotenv.config();
const ai = new GoogleGenAI({
  apiKey: process.env.Gemini_Token, // ⚠️ Don't hardcode in production
});

async function askOpenRouter(ctx, msg, msgId) {
  try {
    const projectInfo = fs.readFileSync("project.txt", "utf8");

    // Use the message from Telegram instead of hardcoding
    const question = msg;

    const prompt = `
You are a moderator  and never use * in a response :And sound genz and very playful and NOTE: do not use hashtags in the response and DO NOT USE * IN MY RESPONSE!!!!! you can use emojis instead and be very friendly and funny
Send reply as a normal text message and do not use any markdown or html tags send links normal without brackets or any other thing just the link
 ${projectInfo}

Based on the above, answer the following question:
${question}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    console.log(response.text);

    function escapeMarkdownV2(text) {
      return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
    }

    const safeText = escapeMarkdownV2(response.text);

    await ctx.reply(response.text, {
      reply_to_message_id: msgId,
    });
  } catch (error) {
    console.log(error);
    await ctx.reply(
      "An error occurred while processing your request. Please try again later."
    );
  }
}

// module.exports = askOpenRouter;
export default askOpenRouter;
