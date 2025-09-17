// models/User.js
import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  groupId: { type: Number, required: true, unique: true },
  userId: { type: Number, required: true },
  bannedWords: { type: [String], default: [] },
  isWelcome: { type: Boolean, default: false },
  welcomeMessage: { type: String, default: "" },
  isGoodbye: { type: Boolean, default: true },
  goodbyeMessage: { type: String, default: "" },
  spam: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  welcomePhotoId: { type: String, default: null },
  welcomeButtons: { type: Array, default: [] },
  goodbyePhotoId: { type: String, default: null },
});

// module.exports = mongoose.model("BotGroups", groupSchema);

export default mongoose.model("BotGroups", groupSchema);
