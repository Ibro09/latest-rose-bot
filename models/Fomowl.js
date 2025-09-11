import mongoose from "mongoose";

const BotSchema = new mongoose.Schema({
  botId: {
    type: Number,
    required: true,
  },

  // === Verification settings ===
  tokenAddress: {
    type: String,
    default: null, // ERC20 contract address to check
  },
  minAmount: {
    type: String,
    default: null, // store as string to support BigInt
  },
  groupLink: {
    type: String,
    default: null, // Telegram group to add verified users
  },
});

// export default mongoose.model("createdBots", BotSchema);
const Fomowl = mongoose.models.Fomowl || mongoose.model("Fomowl", BotSchema);
export default Fomowl;