// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  joinedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LatestRoseBotUser', userSchema);
