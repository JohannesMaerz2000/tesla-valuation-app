import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const teslaData = JSON.parse(rawData).map((c, i) => ({ ...c, id: String(i) }));

function getTireOption(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

// Prepare dataset
const validData = teslaData.map(car => {
    const variantId = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
    return { ...car, variantId, tireOption: getTireOption(car) };
}).filter(c => c.variantId && c.variantId !== "unknown");

console.log(`Analyzing ${validData.length} cars with Leave-One-Out validation...`);

const allResults = [];

validData.forEach((car, index) => {
    const otherCars = teslaData.filter(c => c.id !== car.id);

    const inputs = {
        model: car.model,
        powertrainId: car.variantId,
        registrationDate: car.first_registration,
        mileage: Number(car.mileage),
        isNetPrice: car.taxation === "vat_deductible",
        hasAhk: car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t",
        isAccidentFree: car.accident_free_cardentity === "t",
        tireOption: car.tireOption,
        isHighland: car.is_highland === "TRUE"
    };

    const prediction = predictPrice(inputs, otherCars);

    if (prediction.price === 0) return;

    const actual = Number(car.highest_bid_price);

    if (!actual || actual < 1000) return; // Skip invalid data

    const diff = prediction.price - actual;
    const errorPercent = (diff / actual) * 100;

    if (isNaN(errorPercent)) return;

    allResults.push({
        car,
        prediction,
        errorPercent,
        actual
    });
});

console.log(`Valid Pairs: ${allResults.length}`);

if (allResults.length === 0) {
    console.log("No valid predictions found.");
    process.exit(0);
}

// Stats
const absErrors = allResults.map(r => Math.abs(r.errorPercent));
const avgError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
const sortedErrors = [...absErrors].sort((a, b) => a - b);
const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

console.log(`Average Error: ${avgError.toFixed(2)}%`);
console.log(`Median Error:  ${medianError.toFixed(2)}%`);

// Find worst
const badPredictions = allResults.filter(r => Math.abs(r.errorPercent) > 10);
badPredictions.sort((a, b) => Math.abs(b.errorPercent) - Math.abs(a.errorPercent));

console.log(`Found ${badPredictions.length} cars with error > 10%`);
console.log("---------------------------------------------------");

badPredictions.slice(0, 5).forEach((item, idx) => {
    const { car, prediction, errorPercent, actual } = item;
    console.log(`\n#${idx + 1} Worst Match: Error ${errorPercent.toFixed(1)}%`);
    console.log(`Target: ${car.model} ${car.variantId} | ${car.mileage}km | ${car.first_registration} | Actual: €${actual}`);
    console.log(`Predicted: €${prediction.price.toFixed(0)}`);
    console.log(`Condition Text: "${car.damage_description || 'N/A'}"`);
    console.log(`AccidentFree: ${car.accident_free_cardentity}`);

    console.log(`Neighbors:`);
    prediction.neighbors.forEach(n => {
        console.log(`   - €${n.price} (Adj: €${n.adjustedPrice}) | Score: ${n.score.toFixed(1)} | ${n.mileage}km | ${n.first_registration} | Condition: "${n.damage_description || 'N/A'}" | Acc: ${n.accident_free_cardentity}`);
    });
});
