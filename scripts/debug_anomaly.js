
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';
import { parseISO, isBefore, isEqual, differenceInMonths } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '../src/data/tesla_data.json');

const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
const cars = JSON.parse(rawData);

// Target car stats
const targetMileage = 120060;
const targetModel = "Model Y";
const targetDateStr = "2026-02-04";

// Find the car
const targetCar = cars.find(c =>
    c.model === targetModel &&
    parseInt(c.mileage) === targetMileage &&
    c.auction_end_date.startsWith(targetDateStr)
);

if (!targetCar) {
    console.log("Could not find target car in dataset.");
    process.exit(1);
}

console.log("Found Target Car:");
console.log(`ID: ${targetCar.auction_short_id}`);
console.log(`Variant: ${targetCar.variant} (kW: ${targetCar.powe_kw})`);
console.log(`Date: ${targetCar.auction_end_date}`);
console.log(`Mileage: ${targetCar.mileage}`);
console.log(`Bid: ${targetCar.highest_bid_price}`);

// Replicate Prediction Logic
console.log("\n--- Debugging Prediction ---");

const inputs = {
    model: targetCar.model,
    powertrainId: getPowertrainCluster({
        ...targetCar,
        kw: targetCar.powe_kw,
        battery_capacity: targetCar.battery_netto
    }),
    registrationDate: targetCar.first_registration,
    mileage: parseInt(targetCar.mileage),
    isNetPrice: targetCar.taxation === "vat_deductible",
    hasAhk: targetCar.features_trailer_hitch === "t" || targetCar.trailer_hitch_seller === "t",
    isAccidentFree: targetCar.accident_free_cardentity === "t",
    isHighland: targetCar.is_highland === "TRUE"
};

// Filter Historical Data
const targetDate = parseISO(targetCar.auction_end_date);
const historicalData = cars.filter(c => {
    if (c.auction_id === targetCar.auction_id) return false;
    const cDate = parseISO(c.auction_end_date);
    return isBefore(cDate, targetDate) || isEqual(cDate, targetDate);
});

console.log(`Historical Pool Size: ${historicalData.length}`);

// Run Prediction with internal logging (kind of, by inspecting the result)
const prediction = predictPrice(inputs, historicalData);

console.log(`Predicted Price: ${prediction.price}`);

console.log("\n--- Top Neighbors ---");
prediction.neighbors.forEach((n, i) => {
    console.log(`#${i + 1} [${n.auction_short_id}] - ${n.variant}`);
    console.log(`   Price: €${n.price} -> Adj: €${n.adjustedPrice.toFixed(0)}`);
    console.log(`   Score: ${n.score.toFixed(2)} (Weight: ${n.weight.toFixed(4)})`);
    console.log(`   Mileage: ${n.mileage} (Diff: ${n.mileage - inputs.mileage})`);
    console.log(`   Age Diff: ${n.matchDetails.diffAgeMonths} months`);
    console.log(`   Penalties: ${JSON.stringify(n.penalties)}`);
    if (n.mileageAdjMsg) console.log(`   Mileage Adj: ${n.mileageAdjMsg}`);
});
