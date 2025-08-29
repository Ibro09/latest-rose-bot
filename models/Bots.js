import mongoose from "mongoose";
// ...existing code...
const BotSchema = new mongoose.Schema({
  ownerId: {
    type: Number,
    required: true,
  },
  botId: {
    type: Number,
    required: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// module.exports = mongoose.model("createdBots", BotSchema);
export default mongoose.model("createdBots", BotSchema);

