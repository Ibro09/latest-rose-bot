// models/Premium.js
import mongoose from "mongoose";

const TokenSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mint: { type: String, required: true },
  monthlySubscription: { type: Number, required: true },
  yearlySubscription: { type: Number, required: true },
  oneTimeSubscription: { type: Number, required: true },
});

const PremiumSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },
  tokens: { type: [TokenSchema], default: [] },
});

const Premium = mongoose.models.Premium || mongoose.model("Premium", PremiumSchema);
export default Premium;
