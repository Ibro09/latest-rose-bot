const { Telegraf, Markup } = require("telegraf");

require("dotenv").config();
const connectDB = require("./db");
const User = require("./models/User");
const Group = require("./models/Group"); // adjust path as needed
const askOpenRouter = require("./ai.js"); // adjust path as needed
// Access env variables
const bot = new Telegraf(process.env.BOT_TOKEN);
const botUsername = "latestrosebot"; // without @;

// Connect to MongoDB
connectDB(process.env.MONGODB_URI);

const welcomeMessages = new Map(); // { chatId: welcomeText }

bot.start(async (ctx) => {
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

      return ctx.reply(
        `Hey ${name}! My name is ${ctx.botInfo.first_name} – I'm here to help you manage your groups! Use /help to find out how to use me to my full potential.\n\n` +
          `Join my [news channel](https://t.me/your_news_channel) to get information on all the latest updates.\n\n` +
          `Check /privacy to view the privacy policy, and interact with your data.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.url(
                "➕ Add me to your chat!",
                "https://t.me/latestrosebot?startgroup"
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
    console.error("Error in /start handler:", error);
    return ctx.reply("⚠️ Something went wrong. Please try again later.");
  }
});

bot.command("setwelcome", async (ctx) => {
  const chatId = ctx.chat.id;

  // Only allow in groups
  if (!["group", "supergroup"].includes(ctx.chat.type)) {
    return ctx.reply("❌ This command is for groups only.");
  }

  // Check if sender is admin
  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from.id);
  if (!isAdmin) {
    return ctx.reply("🚫 Only admins can set the welcome message.");
  }

  // Extract message text
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) {
    return ctx.reply("❌ Usage: /setwelcome Welcome to the group, {name}!");
  }

  try {
    await Group.findOneAndUpdate(
      { groupId: chatId },
      {
        $set: {
          welcomeMessage: text,
          isWelcome: true, // Ensure welcome is enabled
          userId: ctx.from.id,
        },
      },
      { upsert: true, new: true }
    );

    ctx.reply("✅ Welcome message has been saved and enabled!");
  } catch (err) {
    console.error("Error saving welcome message:", err);
    ctx.reply("❌ Failed to save welcome message. Please try again.");
  }
});

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
    console.error("Error toggling welcome message:", err);
    ctx.reply("❌ Failed to update welcome message setting.");
  }
});

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
    console.error("Error removing welcome message:", err);
    ctx.reply("❌ Failed to remove the welcome message. Please try again.");
  }
});

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
    console.error("Ban Error:", error);
    ctx.reply("❌ Failed to ban user. Make sure I have ban permissions.");
  }
});

bot.command("mute", async (ctx) => {
  if (
    !ctx.chat ||
    (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")
  ) {
    return ctx.reply("🚫 Use this command in a group.");
  }

  if (!ctx.message.reply_to_message) {
    return ctx.reply("❌ Please reply to the user you want to mute.");
  }

  const userId = ctx.message.reply_to_message.from.id;
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
    console.error("Mute Error:", err);
    ctx.reply("❌ Failed to mute. Check my permissions.");
  }
});

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
    console.error(err);
    ctx.reply("❌ Failed to unmute. Make sure I have admin rights.");
  }
});

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
let botId = null;

bot.telegram.getMe().then((botInfo) => {
  botId = botInfo.id;
  console.log("Bot ID:", botId);
});
// Message handler
bot.on("message", async (ctx) => {
  const chatId = ctx.chat.id;
  const msg = ctx.message;
  const group = await Group.findOne({ groupId: chatId });
  if (!group || !group.bannedWords.length || !msg.text) return;

  const text = msg.text.toLowerCase();

  for (const word of group.bannedWords) {
    if (text.includes(word)) {
      try {
        await ctx.deleteMessage();
        console.log(`Deleted message with banned word: ${word}`);
      } catch (err) {
        console.error("❌ Failed to delete message:", err.message);
      }
      break;
    }
  }
  // 👋 User Left or Was Removed
  if (msg.left_chat_member) {
    const leftUser = msg.left_chat_member;
    const byUser = msg.from;

    console.log("👤 User who left:", leftUser);
    console.log("🔧 Action done by:", byUser);

    const isKicked = leftUser.id !== byUser.id;

    const leftName = `${leftUser.first_name || ""} ${
      leftUser.last_name || ""
    }`.trim();
    const byName = `${byUser.first_name || ""} ${
      byUser.last_name || ""
    }`.trim();

    try {
      const group = await Group.findOne({ groupId: chatId });

      if (!group || !group.isGoodbye || !group.goodbyeMessage) return;

      const message = group.goodbyeMessage
        .replace("{name}", leftName)
        .replace("{username}", leftUser.username || leftUser.first_name);

      await ctx.reply(message);
    } catch (err) {
      console.error("⚠️ Error sending goodbye message:", err.message);
    }
  }
  if (msg.new_chat_members && msg.new_chat_members.length > 0) {
    const newMembers = ctx.message.new_chat_members;

    console.log("📥 New members joined:", msg.new_chat_members);
    try {
      const group = await Group.findOne({ groupId: chatId });

      console.log("🛠 Group settings:", {
        isWelcome: group?.isWelcome,
        welcomeMessage: group?.welcomeMessage,
      });

      if (!group || !group.isWelcome || !group.welcomeMessage) {
        console.log("⚠️ Welcome message disabled or not set.");
        return;
      }

      newMembers.forEach((user) => {
        const welcomeText = group.welcomeMessage
          .replace("{name}", user.first_name)
          .replace("{username}", `@${user.username}` || user.first_name);

        ctx.reply(welcomeText);
      });
    } catch (err) {
      console.error("❌ Error in welcome handler:", err.message);
    }
  }
   const messageText = ctx.message.text;

  // Check if the bot was mentioned in the message
  const entities = ctx.message.entities || [];
  const isBotMentioned = entities.some((entity) => {
    return (
      entity.type === "mention" &&
      messageText.slice(entity.offset + 1, entity.offset + entity.length) === botUsername
    );
  });

  if (isBotMentioned) {
    // Run your function here
    await ctx.reply("You mentioned me?");
    runWhenMentioned(ctx);
  }
   const replyMsg = ctx.message.reply_to_message;

  // Check if the message is a reply
  if (replyMsg && replyMsg.from && replyMsg.from.id === botId) {
    await ctx.reply("You replied to me!");
    runWhenMentioned(ctx);
  }
});


async function runWhenMentioned(ctx) {
  console.log("Bot was tagged in:", ctx.message.text);
  askOpenRouter(ctx, ctx.message.text)
}

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

    if (!group || !group.isWelcome || !group.welcomeMessage) {
      console.log("⚠️ Welcome message disabled or not set.");
      return;
    }

    newMembers.forEach((user) => {
      const welcomeText = group.welcomeMessage
        .replace("{name}", user.first_name)
        .replace("{username}", user.username || user.first_name);

      ctx.reply(welcomeText);
    });
  } catch (err) {
    console.error("❌ Error in welcome handler:", err.message);
  }
});

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
      console.error("❌ Failed to send welcome message in group:", err);
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
      console.error("❌ Failed to save group to DB:", err);
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
      console.error("❌ Failed to remove group from DB:", err);
    }
  }
});



// Optional /help
bot.help((ctx) => {
  ctx.reply(
    "Available commands:\n/start - Start the bot\n/help - Show this message"
  );
});

// Start polling
bot.launch();
console.log("Bot is running...");
