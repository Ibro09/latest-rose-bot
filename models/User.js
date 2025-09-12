// models/User.js
import mongoose from "mongoose";
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now },
  premium: { type: Boolean, default: false, required: true },
  premiumUntil: { type: Date, default: null },
});

// module.exports = mongoose.model('FOMOwlAIbotUser', userSchema);
export default mongoose.model("FOMOwlAIbotUser", userSchema);
