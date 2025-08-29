// index.js
import connectDB from "./models/PremiumDb.js"; // adjust path if needed
import Premium from "./models/Premium.js"; // adjust path if needed

async function run() {
  await connectDB();

  // Example: create a new Premium document
  const newPremium = new Premium({
    address: "0x123abc",
    tokens: [
      {
        name: "USDT",
        mint: "usdt_mint_address",
        monthlySubscription: 10,
        yearlySubscription: 100,
        oneTimeSubscription: 20,
      },
    ],
  });

  await newPremium.save();
  console.log("Premium saved!");

  // Example: query all Premiums
  const premiums = await Premium.find();
  console.log(premiums);
}

run();
