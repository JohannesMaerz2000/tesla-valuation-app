
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log("🚀 Validating Current Algorithm on New Data...");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    let absoluteErrors = [];
    let validPredictions = 0;

    for (let i = 0; i < teslaData.length; i++) {
        const targetCar = teslaData[i];

        if (!targetCar.highest_bid_price) continue;

        // 1. Determine Cluster ID for Target
        // We simulate the key fields expected by getPowertrainCluster
        const clusterId = getPowertrainCluster({
            ...targetCar,
            kw: targetCar.powe_kw,
            battery_capacity: targetCar.battery_netto
        });

        if (!clusterId || clusterId === 'unknown') continue;

        // 2. Determine Inputs
        let tireOption = "4_summer";
        const sets = parseInt(targetCar.tires_total_sets) || 1;
        if (sets === 2) tireOption = "8_tires";
        else if (targetCar.tires_all_season === "1") tireOption = "4_all_season";
        else if (targetCar.tires_winter === "1") tireOption = "4_winter";

        const inputs = {
            model: targetCar.model,
            powertrainId: clusterId,
            registrationDate: targetCar.first_registration,
            mileage: Number(targetCar.mileage),
            isNetPrice: targetCar.taxation === "vat_deductible",
            hasAhk: targetCar.features_trailer_hitch === "t" || targetCar.trailer_hitch_seller === "t",
            isAccidentFree: targetCar.accident_free_cardentity === "t",
            tireOption: tireOption,
            isHighland: targetCar.is_highland === "TRUE"
        };

        // 3. Database excluding self
        // IMPORTANT: We filter out the exact SAME car (by ID) to simulate "predicting on unseen data"
        // But the predictPrice function doesn't have an 'excludeId' param.
        // It receives `database`. We must pass a filtered database.
        const dbWithoutSelf = teslaData.filter(c => c.auction_id !== targetCar.auction_id);

        // 4. Predict
        const result = predictPrice(inputs, dbWithoutSelf);

        if (result.neighbors.length === 0) continue; // No match found

        const actual = Number(targetCar.highest_bid_price);
        const predicted = result.price;

        // 5. Error
        const diff = Math.abs(predicted - actual);
        const errorPct = (diff / actual) * 100;

        absoluteErrors.push(errorPct);
        validPredictions++;
    }

    // Stats
    absoluteErrors.sort((a, b) => a - b);
    const medianError = absoluteErrors[Math.floor(absoluteErrors.length / 2)];

    // Average
    const sum = absoluteErrors.reduce((a, b) => a + b, 0);
    const avgError = sum / absoluteErrors.length;

    // Percentiles
    const p90 = absoluteErrors[Math.floor(absoluteErrors.length * 0.9)];

    console.log(`\n--- Validation Results ---`);
    console.log(`Evaluated: ${validPredictions} / ${teslaData.length} cars`);
    console.log(`Median Error: ${medianError.toFixed(2)}%`);
    console.log(`Average Error: ${avgError.toFixed(2)}%`);
    console.log(`90th Percentile Error: ${p90.toFixed(2)}%`);

    if (medianError < 5) console.log("✅ Algorithm is performing well (<5%)");
    else console.log("⚠️ Algorithm needs improvement (>5%)");
}

main();
