import express from "express";
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import dotenv from "dotenv";
import User from "./models/User.js";
import Group from "./models/Group.js";
import Wallet from "./models/Wallet.js";
import askOpenRouter from "./testingai.js";
import path from "path";
import axios from "axios";
import BotModel from "./models/Bots.js";
import connectDB from "./models/PremiumDb.js"; // adjust path if needed
import Premium from "./models/Premium.js"; // adjust path if needed
import { ethers } from "ethers";
import Fomowl from "./models/Fomowl.js";

dotenv.config();
const botsFile = "./bots.json";
let bots = fs.existsSync(botsFile) ? JSON.parse(fs.readFileSync(botsFile)) : [];
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// Your Telegram bot code here...

// Connect to MongoDB
connectDB(process.env.MONGODB_URI);

const welcomeMessages = new Map(); // { chatId: welcomeText }
const userSpamMap = new Map(); // { groupId: { userId: [timestamps] } }
const setWelcomeState = new Map(); // chatId -> userId
const setGoodbyeState = new Map(); // chatId -> userId
const newBotToken = new Map(); // userId -> true
const paymentWallets = new Map(); // userId -> walletAddress
const paymentWalletsPrivateKeys = new Map(); // userId -> privateKey
// ======================
// START BOT
// ======================
bot.start(async (ctx) => {
  try {
    if (ctx.chat.type === "private") {
      const tgId = ctx.from.id;
      const fullName = `${ctx.from.first_name || ""} ${
        ctx.from.last_name || ""
      }`.trim();
      const username = ctx.from.username;

      // ✅ Save user to database if not already present
      const existingUser = await User.findOne({ userId: tgId });
      if (!existingUser) {
        await new User({ userId: tgId, username }).save();
        console.log(`🆕 New user saved: ${tgId}`);
      } else {
        console.log(`👤 Returning user: ${tgId}`);
      }

      return ctx.reply(
        `👋 Hey <b>${fullName}</b>!\n` +
          `I’m <b>FOMOwl AI Chatbot</b> – your all in one community assistant.\n\n` +
          `✅ I keep your groups safe (anti-spam & wallet verification)\n` +
          `✅ I keep your chats alive (raids, auto-engagement, activity boosts)\n` +
          `✅ I keep you updated (announcements & alerts)\n\n` +
          `Type <b>/help</b> to explore everything I can do for you.\n\n` +
          `📢 Stay in the loop → Join our <a href="https://t.me/FOMOwlAIbothq">Channel</a> for updates, new features, and tips!`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [
              Markup.button.url(
                "➕ Add me to your chat!",
                "https://t.me/FOMOwlAIbot?startgroup"
              ),
            ],
          ]),
        }
      );
    } else {
      return ctx.reply(
        `❗ Please start a private chat with me to use this command. DM me here: https://t.me/${ctx.botInfo.username}`
      );
    }
  } catch (error) {
    console.log("Error in /start handler:", error);
    return ctx.reply("⚠️ Something went wrong. Please try again later.");
  }
});

// ======================
// SET WLCOME MESSAGE
// ======================
bot.command("setwelcome", async (ctx) => {
  const chatId = ctx.chat.id;
  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }
  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can set the welcome message.");
  }
  setWelcomeState.set(chatId, ctx.from.id);
  return ctx.reply("✍️ Please send the welcome message you want to set.");
});

// ======================
// SET TOGGLE WELCOME MESSAGE
// ======================
bot.command("togglewelcome", async (ctx) => {
  const chatId = ctx.chat.id;

  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command can only be used in groups.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can toggle welcome messages.");
  }

  const input = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!["on", "off"].includes(input)) {
    return ctx.reply("❌ Usage: /togglewelcome on | off");
  }

  const isEnabled = input === "on";

  try {
    const group = await Group.findOne({ groupId: chatId });

    // If toggling ON, but no welcome message is set
    if (
      isEnabled &&
      (!group || !group.welcomeMessage || group.welcomeMessage.trim() === "")
    ) {
      return ctx.reply(
        "⚠️ You need to set a welcome message first using /setwelcome before enabling it."
      );
    }

    await Group.findOneAndUpdate(
      { groupId: chatId },
      {
        $set: {
          isWelcome: isEnabled,
          userId: ctx.from.id,
        },
      },
      { upsert: true, new: true }
    );

    ctx.reply(
      `✅ Welcome messages are now ${
        isEnabled ? "enabled" : "disabled"
      } in this group.`
    );
  } catch (err) {
    console.log("Error toggling welcome message:", err);
    ctx.reply("❌ Failed to update welcome message setting.");
  }
});

// ======================
// REMOVE WELCOME MESSAGE
// ======================
bot.command("removewelcome", async (ctx) => {
  const chatId = ctx.chat.id;

  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command can only be used in groups.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can remove the welcome message.");
  }

  try {
    // Remove from in-memory cache if present
    welcomeMessages.delete(chatId);

    // Update database: set empty string and disable isWelcome
    const result = await Group.findOneAndUpdate(
      { groupId: chatId },
      {
        $set: {
          welcomeMessage: "",
          isWelcome: false,
        },
      },
      { new: true }
    );

    if (!result) {
      return ctx.reply("ℹ️ No welcome message was set for this group.");
    }

    ctx.reply("✅ Welcome message removed successfully.");
  } catch (err) {
    console.log("Error removing welcome message:", err);
    ctx.reply("❌ Failed to remove the welcome message. Please try again.");
  }
});

// ======================
// BAN USER
// ======================
bot.command("ban", async (ctx) => {
  if (
    !ctx.chat ||
    (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")
  ) {
    return ctx.reply("🚫 Use this command in a group.");
  }

  if (!ctx.message.reply_to_message) {
    return ctx.reply("❌ Please reply to the user you want to ban.");
  }

  const userId = ctx.message.reply_to_message.from.id;
  const admins = await ctx.getChatAdministrators();
  const isUserAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  const isBotAdmin = admins.some((admin) => admin.user.id === ctx.botInfo.id);

  if (!isUserAdmin) {
    return ctx.reply("🚫 Only group admins can ban users.");
  }

  if (!isBotAdmin) {
    return ctx.reply("⚠️ I need admin rights to ban members.");
  }

  try {
    await ctx.banChatMember(userId); // Use `banChatMember` instead of deprecated `kickChatMember`
    await ctx.reply("✅ User has been banned.");
  } catch (error) {
    console.log("Ban Error:", error);
    ctx.reply("❌ Failed to ban user. Make sure I have ban permissions.");
  }
});

// ======================
// MUTE USER
// ======================
bot.command("mute", async (ctx) => {
  if (
    !ctx.chat ||
    (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")
  ) {
    return ctx.reply("🚫 Use this command in a group.");
  }

  // Check if the command is a reply to a user message
  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg || !replyMsg.from || replyMsg.from.is_bot) {
    return ctx.reply("❌ Please reply to a real user's message to mute them.");
  }

  const userId = replyMsg.from.id;
  const admins = await ctx.getChatAdministrators();
  const isUserAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  const isBotAdmin = admins.some((admin) => admin.user.id === ctx.botInfo.id);

  if (!isUserAdmin) {
    return ctx.reply("🚫 Only admins can mute users.");
  }

  if (!isBotAdmin) {
    return ctx.reply("⚠️ I need admin rights to mute users.");
  }

  const until = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

  try {
    await ctx.restrictChatMember(userId, {
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
      until_date: until,
    });

    ctx.reply("🔇 User has been muted for 2 hours.");
  } catch (err) {
    console.log("Mute Error:", err);
    ctx.reply("❌ Failed to mute. Check my permissions.");
  }
});

// ======================
// UNMUTE USER
// ======================
bot.command("unmute", async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    return ctx.reply("🚫 The /unmute command can only be used in groups.");
  }

  if (!ctx.message.reply_to_message) {
    return ctx.reply("❌ Please reply to the user you want to unmute.");
  }

  const targetUserId = ctx.message.reply_to_message.from.id;

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can use this command.");
  }

  try {
    await ctx.restrictChatMember(targetUserId, {
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
      until_date: 0, // zero means unrestricted
    });

    ctx.reply(`🔊 User has been unmuted.`);
  } catch (err) {
    console.log(err);
    ctx.reply("❌ Failed to unmute. Make sure I have admin rights.");
  }
});

// ======================
// ADD FILTER
// ======================
bot.command("addfilter", async (ctx) => {
  const chat = ctx.chat;
  const from = ctx.from;

  if (!["group", "supergroup"].includes(chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === from.id);
  if (!isAdmin) return ctx.reply("🚫 Only admins can add filters.");

  const word = ctx.message.text
    .split(" ")
    .slice(1)
    .join(" ")
    .trim()
    .toLowerCase();
  if (!word) return ctx.reply("❌ Usage: /addfilter spamword_or_link");

  let group = await Group.findOne({ groupId: chat.id });
  if (!group) {
    group = new Group({ groupId: chat.id, userId: from.id });
  }

  if (!group.bannedWords.includes(word)) {
    group.bannedWords.push(word);
    await group.save();
    return ctx.reply(`✅ Filter added: \`${word}\``, {
      parse_mode: "Markdown",
    });
  } else {
    return ctx.reply("⚠️ Word is already in the filter list.");
  }
});

// ======================
// HELP
// ======================
bot.command("help", async (ctx) => {
  const helpMessage = `
🤖 *Bot Commands*
/start - Start interacting with the bot
/help - Show this help menu
/setwelcome - Set welcome message
/togglewelcome - Enable/disable welcome message
/removewelcome - Remove welcome message
/setgoodbye - Set goodbye message
/togglegoodbye - Enable/disable goodbye message
/removegoodbye - Remove goodbye message
/ban - 🚫 Ban a user (reply to user)
/mute - 🔇 Mute a user (reply to user)
/unmute - 🔊 Unmute a user (reply to user)
/addfilter - ➕ Add a banned word
/removefilter - ➖ Remove a banned word
/listfilters - 📃 List banned words
/spam - 🛡️ Enable/disable spam protection

💡 *Note:* You can use the AI assistant by mentioning the bot or replying to any bot message.
`;

  ctx.reply(helpMessage, { parse_mode: "Markdown" });
});

// ======================
// REMOVE FILTER
// ======================
bot.command("removefilter", async (ctx) => {
  const chat = ctx.chat;
  const from = ctx.from;

  if (!["group", "supergroup"].includes(chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === from.id);
  if (!isAdmin) return ctx.reply("🚫 Only admins can remove filters.");

  const word = ctx.message.text
    .split(" ")
    .slice(1)
    .join(" ")
    .trim()
    .toLowerCase();
  if (!word) return ctx.reply("❌ Usage: /removefilter spamword_or_link");

  const group = await Group.findOne({ groupId: chat.id });
  if (!group || !group.bannedWords.includes(word)) {
    return ctx.reply("⚠️ That word/link is not in the filter list.");
  }

  group.bannedWords = group.bannedWords.filter((w) => w !== word);
  await group.save();

  ctx.reply(`🗑️ Filter removed: \`${word}\``, { parse_mode: "Markdown" });
});

// ======================
// LIST FILTER
// ======================
bot.command("listfilters", async (ctx) => {
  const chat = ctx.chat;

  if (!["group", "supergroup"].includes(chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }

  const group = await Group.findOne({ groupId: chat.id });
  if (!group || group.bannedWords.length === 0) {
    return ctx.reply("🧾 No filters set for this group.");
  }

  const list = group.bannedWords.map((f, i) => `${i + 1}. \`${f}\``).join("\n");
  ctx.reply(`🚫 Banned words/links:\n${list}`, { parse_mode: "Markdown" });
});

// ======================
// SET GOODBYE MESSAGE
// ======================
bot.command("setgoodbye", async (ctx) => {
  const chatId = ctx.chat.id;

  // Only allow in groups
  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }

  // Check admin
  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can set the goodbye message.");
  }

  setGoodbyeState.set(chatId, ctx.from.id);
  return ctx.reply("✍️ Please send the goodbye message you want to set.");
});

// ======================
// TOGGLE GOODBYE MESSAGE
// ======================
bot.command("togglegoodbye", async (ctx) => {
  const chatId = ctx.chat.id;

  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command can only be used in groups.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can toggle goodbye messages.");
  }

  const input = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!["on", "off"].includes(input)) {
    return ctx.reply("❌ Usage: /togglegoodbye on | off");
  }

  const isEnabled = input === "on";

  try {
    const group = await Group.findOne({ groupId: chatId });

    if (
      isEnabled &&
      (!group || !group.goodbyeMessage || group.goodbyeMessage.trim() === "")
    ) {
      return ctx.reply(
        "⚠️ You need to set a goodbye message first using /setgoodbye before enabling it."
      );
    }

    await Group.findOneAndUpdate(
      { groupId: chatId },
      {
        $set: {
          isGoodbye: isEnabled,
          userId: ctx.from.id,
        },
      },
      { upsert: true, new: true }
    );

    ctx.reply(
      `✅ Goodbye messages are now ${
        isEnabled ? "enabled" : "disabled"
      } in this group.`
    );
  } catch (err) {
    console.log("Error toggling goodbye message:", err);
    ctx.reply("❌ Failed to update goodbye message setting.");
  }
});

// ======================
// REMOVE GOODBYE MESSAGE
// ======================
bot.command("removegoodbye", async (ctx) => {
  const chatId = ctx.chat.id;

  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command can only be used in groups.");
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can remove the goodbye message.");
  }

  try {
    const result = await Group.findOneAndUpdate(
      { groupId: chatId },
      {
        $set: {
          goodbyeMessage: "",
          isGoodbye: false,
        },
      },
      { new: true }
    );

    if (!result) {
      return ctx.reply("ℹ️ No goodbye message was set for this group.");
    }

    ctx.reply("✅ Goodbye message removed successfully.");
  } catch (err) {
    console.log("Error removing goodbye message:", err);
    ctx.reply("❌ Failed to remove the goodbye message. Please try again.");
  }
});

let botId = null;

bot.telegram.getMe().then((botInfo) => {
  botId = botInfo.id;
  console.log("Bot ID:", botId);
});

let botUsername = null;
// Cache bot info once
(async () => {
  const me = await bot.telegram.getMe();
  botUsername = me.username;
  botId = me.id;
})();

// ======================
// SPAM PROTECTION TOGGLE
// ======================
bot.command("spam", async (ctx) => {
  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command can only be used in groups.");
  }
  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can toggle spam protection.");
  }
  const input = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!["on", "off"].includes(input)) {
    return ctx.reply("❌ Usage: /spam on | off");
  }
  const enabled = input === "on";
  await Group.findOneAndUpdate(
    { groupId: ctx.chat.id },
    { $set: { spam: enabled } },
    { upsert: true }
  );
  ctx.reply(
    `🛡️ Spam protection is now ${
      enabled ? "enabled" : "disabled"
    } in this group.`
  );
});
const verifyState = new Map(); // userId -> true

// ======================
// VERIFY COMMAND
// ======================
// Global map to track verify states per user
const verifySetupMap = new Map();

const BOT_OWNER_IDS = [123456789, 987654321, 5821395927]; // replace with Telegram user IDs of owners

bot.command("setverify", async (ctx) => {
  if (!BOT_OWNER_IDS.includes(ctx.from.id)) {
    return ctx.reply("⚠️ You are not an owner of this bot.");
  }

  // ✅ Owner verified
  verifySetupMap.set(ctx.from.id, { stage: "awaitingInput" });
  ctx.reply(
    "✍️ Send settings in format: <tokenAddress> <minAmount> <groupLink>"
  );
});

// USER: start verify
bot.command("verify", async (ctx) => {
  if (ctx.chat.type === "private") {
    verifyState.set(ctx.from.id, true);
    return ctx.reply("🔗 Please send your wallet address.");
  } else {
    return ctx.reply(
      "👋 To verify, please DM me and use /verify there.\n[Click here to DM](https://t.me/FOMOwlAIbot)",
      { parse_mode: "Markdown" }
    );
  }
});
// ======================
// CREATE NEW BOT COMMAND
// ======================
bot.command("createbot", async (ctx) => {
  if (ctx.chat.type === "private") {
    newBotToken.set(ctx.from.id, true);
    const botCount = await BotModel.countDocuments({ ownerId: ctx.from.id });
    console.log(`User ${ctx.from.id} has created ${botCount} bots.`);
    if (botCount >= 1) {
      return ctx.reply(
        "❌ You have reached the limit of bots. Please delete an existing bot before creating a new one."
      );
    }
    return ctx.reply(
      "🤖 To continue, please provide your Bot Token.\n\n" +
        "🔗 You can get this token from @BotFather:\n" +
        "1️⃣ Open the @BotFather chat on Telegram.\n" +
        "2️⃣ Use the command /newbot to create a new bot (or /mybots to manage an existing one).\n" +
        "3️⃣ After setup, BotFather will give you a token that looks like this:\n\n" +
        "`1234567890:ABC-123xyzExampleToken`\n\n" +
        "📩 Now, please copy that token and send it here."
    );
  } else {
    return ctx.reply(
      "👋 To create your own bot, please DM me and use /createBot there.\n[Click here to DM](https://t.me/FOMOwlAIbot)",
      { parse_mode: "Markdown" }
    );
  }
});

// ======================
// LIST BOTS COMMAND
// ======================

// Function to get bots for a user
async function getUserBots(userId) {
  return await BotModel.find({ ownerId: userId });
}

// Function to send bot list with buttons
async function sendBotList(ctx, commandType) {
  const userId = ctx.from.id;
  const userBots = await getUserBots(userId);

  if (userBots.length === 0) {
    return ctx.reply("ℹ️ You have no bots created yet.");
  }

  const buttons = userBots.map((b) => [
    Markup.button.callback(`@${b.username}`, `${commandType}:${b.username}`),
  ]);

  await ctx.reply("📃 Your bots:", Markup.inlineKeyboard(buttons));
}
// /listbots
bot.command("listbots", async (ctx) => {
  if (ctx.chat.type === "private") {
    await sendBotList(ctx, "list");
  }
});

// /editbots
bot.command("editbots", async (ctx) => {
  if (ctx.chat.type === "private") {
    await sendBotList(ctx, "edit");
  }
});

bot.action(/^edit:(.+)$/, async (ctx) => {
  const username = ctx.match[1];
  const userId = ctx.from.id;

  const botInfo = await BotModel.findOne({
    username: username,
    ownerId: userId,
  });

  if (!botInfo) {
    return ctx.answerCbQuery("❌ Bot not found or not yours.");
  }

  // Get @username from Telegram if possible
  let ownerUsername = "🚫";
  try {
    const user = await ctx.telegram.getChat(botInfo.ownerId);
    if (user && user.username) {
      ownerUsername = `@${user.username}`;
    }
  } catch (err) {
    console.error("Error fetching owner username:", err.message);
  }

  // Fetch bot name from its ID
  let botName = "🚫";
  try {
    const botChat = await ctx.telegram.getChat(botId);
    if (botChat) {
      botName = botChat.first_name || botChat.username || "🚫";
    }
  } catch (err) {
    console.error("Error fetching bot name:", err.message);
  }

  // Prepare the bot info text
  const infoMessage =
    `Edit @${botInfo.username} info.\n\n` +
    `Name: ${botName || "🚫"}\n` +
    `UserName: @${botInfo.username || "🚫"}\n` +
    `Owner: ${ownerUsername || "🚫"}\n` +
    `Description: ${botInfo.description || "🚫"}\n`;

  // Create the inline keyboard
  const buttons = [
    [Markup.button.callback("Edit Description", `editDescription:${username}`)],
    [Markup.button.callback("« Back to Bots", `editbots`)],
  ];

  await ctx.editMessageText(infoMessage, {
    reply_markup: { inline_keyboard: buttons },
  });

  await ctx.answerCbQuery();
});

// Add this handler for the "Back to Bots" button
bot.action("editbots", async (ctx) => {
  const userId = ctx.from.id;
  const userBots = await getUserBots(userId);

  if (userBots.length === 0) {
    await ctx.editMessageText("ℹ️ You have no bots created yet.");
    return ctx.answerCbQuery();
  }

  const buttons = userBots.map((b) => [
    Markup.button.callback(`@${b.username}`, `edit:${b.username}`),
  ]);

  await ctx.editMessageText("📃 Your bots:", {
    reply_markup: { inline_keyboard: buttons },
  });
  await ctx.answerCbQuery();
});

// Handle button clicks for both list and edit
bot.action(/^(list|edit):(.+)$/, async (ctx) => {
  const actionType = ctx.match[1]; // "list" or "edit"
  const username = ctx.match[2];
  const userId = ctx.from.id;

  const botInfo = await BotModel.findOne({
    username: username,
    ownerId: userId,
  });

  if (!botInfo) {
    return ctx.answerCbQuery("❌ Bot not found or not yours.");
  }

  let message = `🤖 Bot: @${botInfo.username}\n📜 Description: ${
    botInfo.description || "No description"
  }`;
  if (actionType === "edit") {
    message += "\n✏️ You can edit this bot's details.";
  }

  await ctx.answerCbQuery();
  await ctx.reply(message);
});

// Track users editing bot descriptions
const editDescriptionState = new Map(); // userId -> botUsername

// Handle "Edit Description" button
bot.action(/^editDescription:(.+)$/, async (ctx) => {
  const username = ctx.match[1];
  const userId = ctx.from.id;

  // Set state
  editDescriptionState.set(userId, username);

  await ctx.editMessageText(
    "✏️ Please send the new description as a message or upload a .txt file.",
    {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("« Back to Bots", "editbots")],
        ],
      },
    }
  );
  await ctx.answerCbQuery();
});

// Helper to get premium data
async function getPremiumData() {
  const premiums = await Premium.find();
  return premiums[0]; // assuming only one document
}

async function getOrCreateWallet(userId) {
  // ✅ Check if wallet exists
  let userWallet = await Wallet.findOne({ userId });
  if (userWallet) return userWallet;

  // ✅ If not, create new
  const wallet = ethers.Wallet.createRandom();

  // Ensure private key always has 0x prefix
  const privateKey = wallet.privateKey.startsWith("0x")
    ? wallet.privateKey
    : "0x" + wallet.privateKey;

  userWallet = new Wallet({
    userId,
    address: wallet.address,
    privateKey,
  });

  await userWallet.save();
  return userWallet;
}

bot.command("premium", async (ctx) => {
  try {
    const userId = ctx.from.id;

    // Fetch user data
    let user = await User.findOne({ userId });

    if (!user) {
      // Create user record if not exists
      user = await User.create({
        userId,
        username: ctx.from.username || ctx.from.first_name,
      });
    }

    // Check if user is already premium
    if (user.premium && user.premiumUntil && user.premiumUntil > new Date()) {
      return ctx.reply(
        `🌟 You already have Premium access until ${user.premiumUntil.toDateString()}`
      );
    }

    // Otherwise show payment options
    const premium = await getPremiumData();
    const keyboard = premium.tokens.map((token) => [
      Markup.button.callback(token.name, `pay_${token.name.toLowerCase()}`),
    ]);

    return ctx.reply(
      "💎 Choose a payment option:\n\n⚠️ NOTE: All payments are in BASE blockchain.",
      Markup.inlineKeyboard(keyboard)
    );
  } catch (err) {
    console.error("Premium command error:", err);
    return ctx.reply("⚠️ Failed to load premium options. Try again later.");
  }
});

// Handle token selection
bot.action(/pay_(.+)/, async (ctx) => {
  const premium = await getPremiumData();
  const method = ctx.match[1].toUpperCase();
  const token = premium.tokens.find((t) => t.name.toUpperCase() === method);

  if (!token) {
    return ctx.answerCbQuery("Token not found");
  }

  // Calculate discount if yearly is cheaper
  let discountText = "";
  if (token.monthlySubscription && token.yearlySubscription) {
    const monthlyCostYearly = token.yearlySubscription / 12;
    const discount =
      ((token.monthlySubscription - monthlyCostYearly) /
        token.monthlySubscription) *
      100;

    if (discount > 0) {
      discountText = ` (${discount.toFixed(1)}% off)`;
    }
  }

  ctx.editMessageText(
    `Payment Method: ${method}\nChoose a plan:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `Monthly - ${token.monthlySubscription}`,
          `plan_${method}_monthly`
        ),
      ],
      [
        Markup.button.callback(
          `Yearly - ${token.yearlySubscription}${discountText}`,
          `plan_${method}_yearly`
        ),
      ],
      [
        Markup.button.callback(
          `One-Time - ${token.oneTimeSubscription}`,
          `plan_${method}_one`
        ),
      ],
    ])
  );
});

const paymentState = new Map(); // userId -> { method, type }

// === PLAN SELECTION ===
bot.action(/plan_(.+)_(.+)/, async (ctx) => {
  const [method, type] = ctx.match.slice(1);
  const premium = await getPremiumData();
  const token = premium.tokens.find(
    (t) => t.name.toUpperCase() === method.toUpperCase()
  );
  if (!token) return ctx.answerCbQuery("Token not found");

  // ✅ Get wallet from DB (create if not exists)
  const userWallet = await getOrCreateWallet(ctx.from.id);

  // ✅ Ensure private key always has 0x prefix
  let privateKey = userWallet.privateKey;
  if (!privateKey.startsWith("0x")) {
    privateKey = "0x" + privateKey;
  }

  paymentWallets.set(ctx.from.id, userWallet.address);
  paymentWalletsPrivateKeys.set(ctx.from.id, privateKey);

  let price;
  switch (type) {
    case "monthly":
      price = token.monthlySubscription;
      break;
    case "yearly":
      price = token.yearlySubscription;
      break;
    case "one":
      price = token.oneTimeSubscription;
      break;
    default:
      price = "N/A";
  }

  ctx.answerCbQuery();
  ctx.reply(
    `You selected *${type.toUpperCase()}* plan using *${method.toUpperCase()}*.\nPrice: *${price}*\n\n` +
      `Please send *${price} ${method.toUpperCase()}* to this wallet address (Click to copy):\n\`${
        userWallet.address
      }\`\n\n` +
      `NOTE: THIS IS A BASE WALLET ADDRESS. MAKE PAYMENT ON BASE.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "I have made payment",
              callback_data: `confirm_payment_${method}_${type}`,
            },
          ],
        ],
      },
    }
  );
});

// === PAYMENT CONFIRMATION ===
bot.action(/confirm_payment_(.+)_(.+)/, async (ctx) => {
  const [method, type] = ctx.match.slice(1);
  const userId = ctx.from.id;

  // Fetch premium data and token info
  const premium = await getPremiumData();
  const token = premium.tokens.find(
    (t) => t.name.toUpperCase() === method.toUpperCase()
  );

  if (!token) return ctx.answerCbQuery("Token not found");

  let price;
  switch (type) {
    case "monthly":
      price = token.monthlySubscription;
      break;
    case "yearly":
      price = token.yearlySubscription;
      break;
    case "one":
      price = token.oneTimeSubscription;
      break;
    default:
      return ctx.reply("❌ Invalid plan type");
  }

  paymentState.set(userId, { method, type });
  ctx.answerCbQuery();

  const walletAddress = paymentWallets.get(userId);
  let PRIVATE_KEY = paymentWalletsPrivateKeys.get(userId);

  if (!walletAddress || !PRIVATE_KEY) {
    return ctx.reply("❌ Wallet not found for this user. Try again.");
  }

  // ✅ Ensure private key always has 0x prefix
  if (!PRIVATE_KEY.startsWith("0x")) {
    PRIVATE_KEY = "0x" + PRIVATE_KEY;
  }

  const BASE_RPC = "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];

  async function checkAndSendToken(
    tokenAddress,
    recipient,
    price,
    type,
    userId
  ) {
    try {
      if (!ethers.isAddress(tokenAddress))
        throw new Error("❌ Invalid token address");
      if (!ethers.isAddress(recipient))
        throw new Error("❌ Invalid recipient address");

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const [balance, decimals] = await Promise.all([
        token.balanceOf(wallet.address),
        token.decimals(),
      ]);

      const formattedBalance = Number(ethers.formatUnits(balance, decimals));
      const requiredAmount = ethers.parseUnits(price.toString(), decimals);

      console.log(`💰 Wallet Balance: ${formattedBalance}`);
      console.log(`📌 Required Amount: ${price}`);

      // ✅ Check exact match
      if (balance === requiredAmount) {
        console.log("✅ Exact payment received, forwarding...");

        const tx = await token.transfer(recipient, requiredAmount);
        console.log(`Sending... TX hash: ${tx.hash}`);
        await tx.wait();

        console.log("✅ Transfer complete!");

        // === Update user subscription ===
        const update = { premium: true };
        if (type === "monthly") {
          update.premiumUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        } else if (type === "yearly") {
          update.premiumUntil = new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000
          ); // 1 year
        } else if (type === "one") {
          update.premiumUntil = null; // lifetime premium
        }

        await User.findOneAndUpdate(
          { userId: userId }, // use your schema’s field
          update,
          { new: true }
        );

        console.log(`✅ User ${userId} upgraded to premium (${type})`);
        return true;
      } else {
        console.log("❌ Payment not detected or incorrect amount");
        return false;
      }
    } catch (error) {
      console.log("Error checking/sending token:", error.message);
      return false;
    }
  }

  // Run the check
  (async () => {
    const collectionWallet = premium.address; // your main wallet to collect funds
    const tokenContract = token.mint; // token contract (e.g. USDC on Base)

    const success = await checkAndSendToken(
      tokenContract,
      collectionWallet,
      price,
      type,
      userId
    );

    if (success) {
      ctx.reply(
        `✅ Payment confirmed! Your *${type.toUpperCase()}* subscription is active.`,
        { parse_mode: "Markdown" }
      );
    } else {
      ctx.reply(
        `❌ Payment not detected or incorrect amount. Please send *${price} ${method.toUpperCase()}* to:\n\`${walletAddress}\``,
        { parse_mode: "Markdown" }
      );
    }
  })();
});

bot.command("aaa", async (ctx) => {
  await connectDB();

  const premiums = await Premium.find();
  console.log(premiums[0].tokens[0].name);
  await ctx.reply(premiums[0]);
});

// /deletebot command
bot.command("deletebot", async (ctx) => {
  if (ctx.chat.type !== "private") {
    return ctx.reply("❌ Please use this command in a private chat.");
  }

  const userBots = await BotModel.find({ ownerId: ctx.from.id });
  if (userBots.length === 0) {
    return ctx.reply("ℹ️ You have no bots to delete.");
  }

  // Show a list of bots to delete
  const buttons = userBots.map((b) => [
    Markup.button.callback(`Delete @${b.username}`, `deletebot:${b.username}`),
  ]);

  await ctx.reply("Select a bot to delete:", Markup.inlineKeyboard(buttons));
});

// Handle bot deletion
bot.action(/^deletebot:(.+)$/, async (ctx) => {
  const username = ctx.match[1];
  const userId = ctx.from.id;

  const botInfo = await BotModel.findOneAndDelete({
    username: username,
    ownerId: userId,
  });

  if (!botInfo) {
    return ctx.answerCbQuery("❌ Bot not found or not yours.");
  }

  await ctx.editMessageText(`✅ Bot @${username} has been deleted.`);
  await ctx.answerCbQuery();
});

async function runWhenMentioned(ctx, msgId) {
  askOpenRouter(ctx, ctx.message.text, msgId);
}

// ======================
// USER THAT LEFT
// ======================
bot.on("left_chat_member", async (ctx) => {
  const chatId = ctx.chat.id;
  const leftUser = ctx.message.left_chat_member;
  console.log(leftUser);

  try {
    const group = await Group.findOne({ groupId: chatId });

    if (
      group &&
      group.isGoodbye &&
      (group.goodbyeMessage?.trim() || group.goodbyePhotoId)
    ) {
      const name = leftUser.first_name || "";
      const username = leftUser.username ? `@${leftUser.username}` : name;
      const by = ctx.from.username
        ? `@${ctx.from.username}`
        : ctx.from.first_name || "Someone";

      const message = group.goodbyeMessage
        .replace(/{name}/g, name)
        .replace(/{username}/g, username)
        .replace(/{by}/g, by);

      if (group.goodbyePhotoId) {
        await ctx.replyWithPhoto(group.goodbyePhotoId, {
          caption: message,
        });
      } else {
        await ctx.reply(message);
      }
    }
  } catch (err) {
    console.log("Error sending goodbye message:", err);
  }
});

// ======================
// NEW USER
// ======================
bot.on("new_chat_members", async (ctx) => {
  const chatId = ctx.chat.id;
  const newMembers = ctx.message.new_chat_members;

  console.log(
    "📥 New members joined:",
    newMembers.map((u) => ({
      id: u.id,
      name: u.first_name,
      username: u.username,
    }))
  );

  try {
    const group = await Group.findOne({ groupId: chatId });

    console.log("🛠 Group settings:", {
      isWelcome: group?.isWelcome,
      welcomeMessage: group?.welcomeMessage,
    });

    if (!group || !group.isWelcome) return;

    for (const user of newMembers) {
      let welcomeText = group.welcomeMessage || "";
      welcomeText = welcomeText.replace(/{name}/g, user.first_name);
      welcomeText = welcomeText.replace(
        /{username}/g,
        user.username ? `@${user.username}` : user.first_name
      );

      if (group.welcomePhotoId) {
        await ctx.replyWithPhoto(group.welcomePhotoId, {
          caption: welcomeText,
        });
      } else {
        await ctx.reply(welcomeText);
      }
    }
  } catch (err) {
    console.log("❌ Error in welcome handler:", err.message);
  }
});

// ======================
// UPDATED CHAT MEMBER
// ======================
bot.on("my_chat_member", async (ctx) => {
  const oldStatus = ctx.update.my_chat_member.old_chat_member.status;
  const newStatus = ctx.update.my_chat_member.new_chat_member.status;
  const chat = ctx.chat;

  // Bot was added to a group
  if (
    ["left", "kicked"].includes(oldStatus) &&
    ["member", "administrator"].includes(newStatus)
  ) {
    const addedBy = ctx.update.my_chat_member.from;
    const userId = addedBy.id;
    const username = addedBy.username;
    const fullName = `${addedBy.first_name || ""} ${
      addedBy.last_name || ""
    }`.trim();

    console.log(
      `✅ Bot added to ${chat.title} by ${fullName} (@${username}) [${userId}]`
    );
    const groupCount = await Group.countDocuments({});
    console.log(`Bot is now in ${groupCount} groups.`);
    if (groupCount >= 6) {
      // Leave the group
      console.log(
        `❌ Bot cannot join more than 5 groups. Leaving ${chat.title} [${chat.id}]`
      );
      try {
        await ctx.telegram.sendMessage(
          chat.id,
          "🚫 Sorry, this bot can only be in 5 groups at a time. Please remove it from another group first."
        );
        await ctx.leaveChat();
      } catch (err) {
        console.log("❌ Failed to send group limit message:", err);
      }
      return;
    }
    try {
      await ctx.telegram.sendMessage(
        userId,
        `Thanks for adding me to *${chat.title}*! 🎉\n\nUse /help in the group or DM me here for full instructions.`,
        { parse_mode: "Markdown" }
      );
    } catch {
      console.warn(
        "❌ Couldn't DM user – they probably haven't started the bot."
      );
    }

    try {
      await ctx.telegram.sendMessage(
        chat.id,
        `👋 Hello everyone!\nI'm *${ctx.botInfo.first_name}*, here to help manage this group.\n\nUse /help to see what I can do.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.log("❌ Failed to send welcome message in group:", err);
    }

    // Save to DB
    try {
      await Group.findOneAndUpdate(
        { groupId: chat.id },
        { groupId: chat.id, userId, joinedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`📦 Group "${chat.title}" saved to DB.`);
    } catch (err) {
      console.log("❌ Failed to save group to DB:", err);
    }

    // Bot was removed from a group
  } else if (
    ["member", "administrator"].includes(oldStatus) &&
    ["left", "kicked"].includes(newStatus)
  ) {
    console.log(`🚪 Bot removed from ${chat.title} [${chat.id}]`);

    try {
      await Group.deleteOne({ groupId: chat.id });
      console.log(`🗑️ Group "${chat.title}" removed from DB.`);
    } catch (err) {
      console.log("❌ Failed to remove group from DB:", err);
    }
  }
});

// Listen for documents
bot.on("document", async (ctx) => {
  console.log("📄 Document received:", ctx.message.document);

  try {
    const fileId = ctx.message.document.file_id;

    // Get file path from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Download file content
    const response = await axios.get(fileLink.href, {
      responseType: "arraybuffer",
    });

    // Convert to text (assuming UTF-8 encoding)
    const fileText = response.data.toString("utf8");

    // Send back the text
    await ctx.reply("📄 File Content:\n\n" + fileText);

    // Optional: save to disk
    fs.writeFileSync("uploaded_code.js", fileText, "utf8");
    console.log("File saved as uploaded_code.js");
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Failed to read file.");
  }
});

// ======================
// MESSAGE
// ======================
bot.on("message", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const username = editDescriptionState.get(userId);

  // =====================================================
  // 🔧 HANDLE /setverify RESPONSE
  // =====================================================
  const state = verifySetupMap.get(ctx.from.id);

  if (state?.stage === "awaitingInput") {
    const [tokenAddress, minAmount, groupLink] = ctx.message.text
      .trim()
      .split(/\s+/);

    if (!tokenAddress || !minAmount || !groupLink) {
      return ctx.reply(
        "❌ Invalid format. Use: `<tokenAddress> <minAmount> <grouplink>`"
      );
    }

    try {
      console.log(ctx.botInfo.id);

      const botData = await Fomowl.findOneAndUpdate(
        { botId: ctx.botInfo.id },
        { tokenAddress, minAmount, groupLink: groupLink.toString() },
        { new: true, upsert: true } // no upsert
      );
      console.log(botData);

      // Clear the state after saving
      verifySetupMap.delete(ctx.from.id);

      return ctx.reply(
        `✅ Verify settings updated:\n\n` +
          `• Token: \`${botData.tokenAddress}\`\n` +
          `• Min Amount: ${botData.minAmount}\n` +
          `• Group Link: \`${botData.groupLink}\``,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Error saving verify setup:", err);
      return ctx.reply("⚠️ Failed to save settings.");
    }
  }
  // =====================================================
  // 🔗 WALLET VERIFICATION HANDLER
  // =====================================================
  if (
    ctx.chat.type === "private" &&
    verifyState.get(userId) &&
    !ctx.message.text.startsWith("/")
  ) {
    const wallet = ctx.message.text.trim();
    verifyState.delete(userId);

    await ctx.reply(`✅ Wallet address received: \`${wallet}\``, {
      parse_mode: "Markdown",
    });

    try {
      // 🔑 Load bot config from DB
      const botData = await Fomowl.findOne({ botId: ctx.botInfo.id });
      console.log(botData);
      if (
        !botData?.tokenAddress ||
        !botData?.minAmount ||
        !botData?.groupLink
      ) {
        return ctx.reply("⚠️ Verification settings not configured yet.");
      }

      const web3 = new Web3("https://mainnet.infura.io/v3/YOUR_INFURA_KEY");

      // ERC20 balance check
      const token = new web3.eth.Contract(ERC20_ABI, botData.tokenAddress);
      const balance = await token.methods.balanceOf(wallet).call();
      const decimals = await token.methods.decimals().call();

      // Normalize to human-readable amount
      const humanBalance = Number(balance) / 10 ** Number(decimals);

      if (humanBalance >= Number(botData.minAmount)) {
        // Create invite link dynamically
        const invite = await userBot.telegram.createChatInviteLink(
          botData.groupId,
          {
            name: `Invite for ${ctx.from.username || ctx.from.first_name}`,
            creates_join_request: false,
          }
        );

        return ctx.reply(
          `🎉 Verified! You hold at least ${botData.minAmount} tokens.\n\n👉 Join the group: ${invite.invite_link}`
        );
      } else {
        return ctx.reply(
          `❌ You need at least ${botData.minAmount} tokens to verify.\n` +
            `Your balance: ${humanBalance}`
        );
      }
    } catch (err) {
      console.error("Verify error:", err);
      return ctx.reply("⚠️ Error checking balance. Try again later.");
    }
  }

  // Only proceed if user is in edit mode
  if (username) {
    let newDescription = null;

    // If user sent a .txt file
    if (
      ctx.message.document &&
      ctx.message.document.mime_type === "text/plain"
    ) {
      const fileId = ctx.message.document.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await axios.get(fileLink.href);
      newDescription = response.data.toString("utf8");
    }
    // If user sent text
    else if (ctx.message.text) {
      newDescription = ctx.message.text;
    }

    if (newDescription !== null) {
      await BotModel.findOneAndUpdate(
        { username, ownerId: userId },
        { $set: { description: newDescription } }
      );
      editDescriptionState.delete(userId);
      await ctx.reply("✅ Description updated!");
    } else {
      await ctx.reply("❌ Please send a text message or a .txt file.");
    }
    return;
  }
  if (
    ctx.chat.type === "private" &&
    verifyState.get(ctx.from.id) &&
    ctx.message.text &&
    !ctx.message.text.startsWith("/")
  ) {
    const wallet = ctx.message.text.trim();
    verifyState.delete(ctx.from.id);
    // You can add wallet validation here if needed
    console.log(wallet);

    await ctx.reply(`✅ Wallet address received: \`${wallet}\``, {
      parse_mode: "Markdown",
    });
    // Optionally, save to DB or notify admin here
  } else if (
    ctx.chat.type === "private" &&
    newBotToken.get(ctx.from.id) &&
    ctx.message.text &&
    !ctx.message.text.startsWith("/")
  ) {
    const token = ctx.message.text.trim();
    newBotToken.delete(ctx.from.id); // remove from "waiting" state
    verifyState.delete(ctx.from.id);

    try {
      // Validate token by getting bot info
      const testBot = new Telegraf(token);
      const me = await testBot.telegram.getMe();
      if (!token) {
        return;
      }
      // Save bot to MongoDB, including botId
      await BotModel.create({
        ownerId: ctx.from.id,
        username: me.username,
        token,
        botId: me.id, // <-- Save botId here
      });

      ctx.reply(
        `✅ Bot created successfully!\nName: ${me.first_name}\nUsername: @${me.username}`
      );

      // Start the bot immediately
      startUserBot(token, me.username, "", me.id); // Pass botId to startUserBot
    } catch (err) {
      console.error(err);
      ctx.reply("❌ Could not connect to bot. Check your token.");
    }
  } // ===== TRANSACTION HASH HANDLER =====
  if (
    ctx.chat.type === "private" &&
    paymentState.has(userId) &&
    ctx.message.text &&
    !ctx.message.text.startsWith("/")
  ) {
    const { method, type } = paymentState.get(userId);
    const txHash = ctx.message.text.trim();
    paymentState.delete(userId);

    await ctx.reply(`⏳ Verifying your payment on the blockchain...`, {
      parse_mode: "Markdown",
    });

    try {
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      const ERC20_ABI = [
        "event Transfer(address indexed from, address indexed to, uint256 value)",
      ];

      // Fetch your premium document
      const premium = await getPremiumData();

      // Find the token matching the payment method
      const token = premium.tokens.find(
        (t) => t.name.toUpperCase() === method.toUpperCase()
      );

      if (!token) {
        return ctx.reply("❌ Token not found in premium data.");
      }

      const tokenAddress = token.mint; // Use the token's mint address
      const receiver = premium.address; // Your receiving wallet

      // Get the required amount for the selected plan
      let requiredAmount;
      switch (type) {
        case "monthly":
          requiredAmount = token.monthlySubscription;
          break;
        case "yearly":
          requiredAmount = token.yearlySubscription;
          break;
        case "one":
          requiredAmount = token.oneTimeSubscription;
          break;
        default:
          requiredAmount = null;
      }

      // Helper to get token decimals
      async function getTokenDecimals(tokenAddress) {
        const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];
        const contract = new ethers.Contract(
          tokenAddress,
          ERC20_DECIMALS_ABI,
          provider
        );
        return await contract.decimals();
      }

      // Helper to get and verify the transaction
      async function getTokenTxAmount(
        txHash,
        tokenAddress,
        receiver,
        requiredAmount
      ) {
        const iface = new ethers.Interface(ERC20_ABI);
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt)
          return { success: false, message: "Transaction not found" };

        // Get token decimals for proper amount comparison
        const decimals = await getTokenDecimals(tokenAddress);

        for (let log of receipt.logs) {
          if (log.address.toLowerCase() === tokenAddress.toLowerCase()) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed.args.to.toLowerCase() === receiver.toLowerCase()) {
                // Compare amounts (convert requiredAmount to token units)
                const sentAmount = parsed.args.value;
                const requiredAmountWei = ethers.parseUnits(
                  requiredAmount.toString(),
                  decimals
                );

                if (sentAmount >= requiredAmountWei) {
                  return {
                    success: true,
                    from: parsed.args.from,
                    to: parsed.args.to,
                    amount: sentAmount.toString(),
                    decimals,
                  };
                } else {
                  return {
                    success: false,
                    message: `Amount sent (${ethers.formatUnits(
                      sentAmount,
                      decimals
                    )}) is less than required (${requiredAmount})`,
                  };
                }
              }
            } catch {}
          }
        }
        return { success: false, message: "No matching transfer found" };
      }

      const result = await getTokenTxAmount(
        txHash,
        tokenAddress,
        receiver,
        requiredAmount
      );

      if (result.success) {
        await ctx.reply(
          `✅ *Transfer Verified!*\n\n` +
            `👤 *From:* ${result.from}\n` +
            `📥 *To:* ${result.to}\n` +
            `💰 *Amount:* ${ethers.formatUnits(
              result.amount,
              result.decimals
            )}`,
          { parse_mode: "Markdown" }
        );
        // Here you can mark the user as premium, etc.
      } else {
        await ctx.reply(`❌ Could not verify payment: ${result.message}`);
      }
    } catch (error) {
      console.error(error);
      return ctx.reply("❌ Error processing transaction.");
    }
  }

  // Handle welcome message setup (text or photo)
  if (setWelcomeState.get(chatId) === userId) {
    if (ctx.message.photo) {
      // User sent a photo
      const photoArray = ctx.message.photo;
      const fileId = photoArray[photoArray.length - 1].file_id; // largest size
      const caption = ctx.message.caption || "";

      await Group.findOneAndUpdate(
        { groupId: chatId },
        {
          $set: {
            welcomeMessage: caption,
            welcomePhotoId: fileId,
            isWelcome: true,
            userId: userId,
          },
        },
        { upsert: true, new: true }
      );
      setWelcomeState.delete(chatId);
      return ctx.reply(
        "✅ Welcome image and caption have been saved and enabled!"
      );
    } else if (ctx.message.text) {
      // User sent text only
      await Group.findOneAndUpdate(
        { groupId: chatId },
        {
          $set: {
            welcomeMessage: ctx.message.text,
            welcomePhotoId: null,
            isWelcome: true,
            userId: userId,
          },
        },
        { upsert: true, new: true }
      );
      setWelcomeState.delete(chatId);
      return ctx.reply("✅ Welcome message has been saved and enabled!");
    }
  }

  // Handle goodbye message setup (text or photo)
  if (setGoodbyeState.get(chatId) === userId) {
    if (ctx.message.photo) {
      const photoArray = ctx.message.photo;
      const fileId = photoArray[photoArray.length - 1].file_id; // largest size
      const caption = ctx.message.caption || "";

      await Group.findOneAndUpdate(
        { groupId: chatId },
        {
          $set: {
            goodbyeMessage: caption,
            goodbyePhotoId: fileId,
            isGoodbye: true,
            userId: userId,
          },
        },
        { upsert: true, new: true }
      );
      setGoodbyeState.delete(chatId);
      return ctx.reply(
        "✅ Goodbye image and caption have been saved and enabled!"
      );
    } else if (ctx.message.text) {
      await Group.findOneAndUpdate(
        { groupId: chatId },
        {
          $set: {
            goodbyeMessage: ctx.message.text,
            goodbyePhotoId: null,
            isGoodbye: true,
            userId: userId,
          },
        },
        { upsert: true, new: true }
      );
      setGoodbyeState.delete(chatId);
      return ctx.reply("✅ Goodbye message has been saved and enabled!");
    }
  }

  // =====================================================
  // 1️⃣ BANNED WORDS CHECK
  // =====================================================
  if (ctx.message.text) {
    try {
      const group = await Group.findOne({ groupId: chatId });

      if (group?.bannedWords?.length) {
        const text = ctx.message.text.toLowerCase();

        for (const word of group.bannedWords) {
          if (text.includes(word.toLowerCase())) {
            try {
              await ctx.deleteMessage();
              console.log(`🛑 Deleted message with banned word: ${word}`);
            } catch (err) {
              console.log("❌ Failed to delete message:", err.message);
            }
            break;
          }
        }
      }
    } catch (err) {
      console.log("⚠️ Error in banned words check:", err.message);
    }
  }

  // =====================================================
  // 2️⃣ GOODBYE MESSAGE
  // =====================================================
  if (ctx.message.left_chat_member) {
    const leftUser = ctx.message.left_chat_member;
    const byUser = ctx.message.from || {};
    const isKicked = leftUser.id !== byUser.id;

    const leftName =
      `${leftUser.first_name || ""} ${leftUser.last_name || ""}`.trim() ||
      "Someone";
    const byName =
      `${byUser.first_name || ""} ${byUser.last_name || ""}`.trim() ||
      "an admin";

    try {
      const group = await Group.findOne({ groupId: chatId });

      if (
        group?.isGoodbye &&
        (group.goodbyeMessage?.trim() || group.goodbyePhotoId)
      ) {
        let message = group.goodbyeMessage || "";
        message = message.replace(/{name}/g, leftName);
        message = message.replace(
          /{username}/g,
          leftUser.username ? `@${leftUser.username}` : leftName
        );
        message = message.replace(/{by}/g, isKicked ? byName : leftName);

        if (group.goodbyePhotoId) {
          await ctx.replyWithPhoto(group.goodbyePhotoId, {
            caption: message,
          });
        } else {
          await ctx.reply(message);
        }
      } else {
        console.log("⚠️ Goodbye message disabled or not set.");
      }
    } catch (err) {
      console.log("⚠️ Error sending goodbye message:", err.message);
    }
  }

  // =====================================================
  // 3️⃣ WELCOME MESSAGE
  // =====================================================
  if (ctx.message.new_chat_members?.length > 0) {
    const newMembers = ctx.message.new_chat_members;

    try {
      const group = await Group.findOne({ groupId: chatId });

      if (
        group?.isWelcome &&
        (group.welcomeMessage?.trim() || group.welcomePhotoId)
      ) {
        for (const user of newMembers) {
          let welcomeText = group.welcomeMessage || "";
          welcomeText = welcomeText.replace(/{name}/g, user.first_name);
          welcomeText = welcomeText.replace(
            /{username}/g,
            user.username ? `@${user.username}` : user.first_name
          );

          if (group.welcomePhotoId) {
            await ctx.replyWithPhoto(group.welcomePhotoId, {
              caption: welcomeText,
            });
          } else {
            await ctx.reply(welcomeText);
          }
        }
      } else {
        console.log("⚠️ Welcome message disabled or not set.");
      }
    } catch (err) {
      console.log("❌ Error in welcome handler:", err.message);
    }
  }

  // =====================================================
  // 4️⃣ BOT MENTION DETECTION
  // =====================================================
  const messageText = ctx.message.text || "";
  const entities = ctx.message.entities || [];

  let isBotMentioned = false;

  // Quick text match
  if (
    botUsername &&
    messageText.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
  ) {
    isBotMentioned = true;
  }

  // Entity-based check
  for (const entity of entities) {
    const entityText = messageText
      .slice(entity.offset, entity.offset + entity.length)
      .toLowerCase();

    if (
      entity.type === "mention" &&
      entityText === `@${botUsername.toLowerCase()}`
    ) {
      isBotMentioned = true;
    }
    if (
      entity.type === "bot_command" &&
      entityText.includes(`@${botUsername.toLowerCase()}`)
    ) {
      isBotMentioned = true;
    }
    if (entity.type === "text_mention" && entity.user.id === botId) {
      isBotMentioned = true;
    }
  }

  if (isBotMentioned) {
    runWhenMentioned(ctx, ctx.message.message_id);
  }

  // =====================================================
  // 5️⃣ REPLY TO BOT DETECTION
  // =====================================================
  const replyMsg = ctx.message.reply_to_message;
  if (replyMsg && replyMsg.from && replyMsg.from.id === botId) {
    runWhenMentioned(ctx, ctx.message.message_id);
  }

  // =====================================================
  // 6️⃣ SPAM DETECTION & MUTE
  // =====================================================
  if (
    ["group", "supergroup"].includes(ctx.chat.type) &&
    ctx.from &&
    !ctx.from.is_bot
  ) {
    try {
      const group = await Group.findOne({ groupId: chatId });
      if (group?.spam) {
        const userId = ctx.from.id;
        const now = Date.now();
        if (!userSpamMap.has(chatId)) userSpamMap.set(chatId, {});
        const groupMap = userSpamMap.get(chatId);
        if (!groupMap[userId]) groupMap[userId] = [];
        // Keep only timestamps within the last 60 seconds
        groupMap[userId] = groupMap[userId].filter((t) => now - t < 60 * 1000);
        groupMap[userId].push(now);

        if (groupMap[userId].length >= 10) {
          // Mute user for 1 minute
          try {
            await ctx.restrictChatMember(userId, {
              permissions: {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
              },
              until_date: Math.floor(now / 1000) + 60,
            });
            ctx.reply(
              `🤖 User [${ctx.from.first_name}](tg://user?id=${userId}) has been muted for 1 minute for spamming.`,
              { parse_mode: "Markdown" }
            );
          } catch (err) {
            console.log("Failed to mute spammer:", err);
          }
          groupMap[userId] = []; // Reset count after mute
        }
      }
    } catch (err) {
      console.log("Spam check error:", err);
    }
  }

  if (ctx.message.migrate_to_chat_id) {
    const oldId = ctx.message.chat.id; // old group ID
    const newId = ctx.message.migrate_to_chat_id; // new supergroup ID
    await Group.updateOne(
      { groupId: oldId.toString() },
      { groupId: newId.toString() }
    );
  }
});

setInterval(async () => {
  const now = new Date();
  await User.updateMany(
    { premium: true, premiumUntil: { $lt: now } },
    { $set: { premium: false, premiumUntil: null } }
  );
  console.log(now);
  console.log("Checked and updated expired premium users.");
}, 60 * 60 * 1000); // Every hour

// Function to start user bots
async function startUserBot(token, username, description, botId) {
  const { default: botLogic } = await import("./createdBots.js");
  const userBot = new Telegraf(token);

  botLogic(userBot, username, description, botId); // Pass botId to createdBots.js
  userBot.launch();
}

// Function to start user bots
async function startAllUserBots() {
  const allBots = await BotModel.find({});
  allBots.forEach((bot) => {
    startUserBot(bot.token, bot.username, bot.description, bot.botId); // Pass botId
  });
}

startAllUserBots();

// Start polling
bot.launch();
console.log("Bot is running...");
