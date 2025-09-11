// models/Premium.js
import mongoose from "mongoose";


const WalletSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },
  privateKey: { type: String, required: true },
  userId: { type: String, required: true, unique: true },
});

const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);
export default Wallet;
