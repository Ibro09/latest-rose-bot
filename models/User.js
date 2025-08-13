// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  joinedAt: { type: Date, default: Date.now },
  premium: { type: Boolean, default: false,required: true },
  // premiumUntil: { type: Date, default: null },
});

module.exports = mongoose.model('LatestRoseBotUser', userSchema);
