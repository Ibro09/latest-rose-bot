const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
require("dotenv").config();
const connectDB = require("./db");
const User = require("./models/User");
const Group = require("./models/Group"); // adjust path as needed
const askOpenRouter = require("./testingai.js"); // adjust path as needed
// Access env variables
let botUsername = "latestrosebot"; // without @;
const botsFile = "./bots.json";


// Your Telegram bot code here...

// Connect to MongoDB
connectDB(process.env.MONGODB_URI);

const welcomeMessages = new Map(); // { chatId: welcomeText }
const userSpamMap = new Map(); // { groupId: { userId: [timestamps] } }
const setWelcomeState = new Map(); // chatId -> userId
const setGoodbyeState = new Map(); // chatId -> userId
const newBotToken = new Map(); // userId -> true

// ======================
// START BOT
// ======================
userBot.start(async (ctx) => {
  try {
    if (ctx.chat.type === "private") {
      const tgId = ctx.from.id;
      const name = ctx.from.first_name || "there";

      // ✅ Save user to database if not already present
      const existingUser = await User.findOne({ userId: tgId });
      if (!existingUser) {
        await new User({ userId: tgId }).save();
        console.log(`🆕 New user saved: ${tgId}`);
      } else {
        console.log(`👤 Returning user: ${tgId}`);
      }
      const names = ctx.from.first_name || "there";

      return ctx.reply(
        `Hey <b>${name}</b>! My name is <b>${ctx.botInfo.first_name}</b> – I'm here to help you manage your groups! Use /help to find out how to use me to my full potential.\n\n` +
          `Join my <a href="https://t.me/your_news_channel">news channel</a> to get information on all the latest updates.\n\n`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [
              Markup.button.url(
                "➕ Add me to your chat!",
                `https://t.me/${username}?startgroup`
              ),
            ],
          ]),
        }
      );
    } else {
      return ctx.reply(
        "❗ Please start a private chat with me to use this command. DM me here: https://t.me/latestrosebot"
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
userBot.command("setwelcome", async (ctx) => {
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
userBot.command("togglewelcome", async (ctx) => {
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
userBot.command("removewelcome", async (ctx) => {
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
userBot.command("ban", async (ctx) => {
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
userBot.command("mute", async (ctx) => {
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
userBot.command("unmute", async (ctx) => {
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
userBot.command("addfilter", async (ctx) => {
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
userBot.command("help", async (ctx) => {
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
userBot.command("removefilter", async (ctx) => {
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
userBot.command("listfilters", async (ctx) => {
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
userBot.command("setgoodbye", async (ctx) => {
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
userBot.command("togglegoodbye", async (ctx) => {
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
userBot.command("removegoodbye", async (ctx) => {
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

userBot.telegram.getMe().then((botInfo) => {
  botId = botInfo.id;
  console.log("Bot ID:", botId);
});
// Cache bot info once
(async () => {
  const me = await userBot.telegram.getMe();
  botUsername = me.username;
  botId = me.id;
})();

// ======================
// SPAM PROTECTION TOGGLE
// ======================
userBot.command("spam", async (ctx) => {
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

// ======================
// VERIFY COMMAND
// ======================
const verifyState = new Map(); // userId -> true

userBot.command("verify", async (ctx) => {
  if (ctx.chat.type === "private") {
    verifyState.set(ctx.from.id, true);
    return ctx.reply("🔗 Please send your wallet address.");
  } else {
    return ctx.reply(
      "👋 To verify, please DM me and use /verify there.\n[Click here to DM](https://t.me/latestrosebot)",
      { parse_mode: "Markdown" }
    );
  }
});

userBot.command("createBot", async (ctx) => {
  if (ctx.chat.type === "private") {
    newBotToken.set(ctx.from.id, true);
    return ctx.reply("🔗 Please send your Bot Token from Bot father.");
  } else {
    return ctx.reply(
      "👋 To create your own bot, please DM me and use /createBot there.\n[Click here to DM](https://t.me/latestrosebot)",
      { parse_mode: "Markdown" }
    );
  }
});

async function runWhenMentioned(ctx, msgId) {
  askOpenRouter(ctx, ctx.message.text, msgId);
}

// ======================
// USER THAT LEFT
// ======================
userBot.on("left_chat_member", async (ctx) => {
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
userBot.on("new_chat_members", async (ctx) => {
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
userBot.on("my_chat_member", async (ctx) => {
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

    try {
      await ctx.telegram.sendMessage(
        userId,
        `Thanks for adding me to *${chat.title}*! 🎉\n\nUse /help in the group or DM me here for full instructions.`,
        { parse_mode: "Markdown" }
      );
    } catch {
      console.warn(
        "❌ Couldn't DM user – they probably haven't started the userBot."
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


// ======================
// MESSAGE
// ======================
userBot.on("message", async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;

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
      const me = await testuserBot.telegram.getMe();

      // Save bot
      bots.push({
        ownerId: ctx.from.id,
        username: me.username,
        token,
      });
      fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));

      ctx.reply(
        `✅ Bot created successfully!\nName: ${me.first_name}\nUsername: @${me.username}`
      );

      // Start the bot immediately
      startUserBot(token);
    } catch (err) {
      console.error(err);
      ctx.reply("❌ Could not connect to userBot. Check your token.");
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
});
