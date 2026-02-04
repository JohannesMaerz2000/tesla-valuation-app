import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Data
const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
try {
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const teslaData = JSON.parse(rawData);

    console.log(`Loaded ${teslaData.length} records.`);

    // Function to derive tire option from car (replicated from valuation.js)
    function getTireOption(car) {
        const sets = parseInt(car.tires_total_sets) || 1;
        if (sets === 2) return "8_tires";
        if (car.tires_all_season === "1") return "4_all_season";
        if (car.tires_winter === "1") return "4_winter";
        return "4_summer";
    }

    // Stats
    const results = [];
    const SAMPLE_SIZE = 50; // Test 50 random cars
    const sample = teslaData.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE);

    console.log(`Running validation on ${sample.length} random samples...`);
    console.log("---------------------------------------------------------------------------------");
    console.log(pad("Model", 10) + pad("Variant", 10) + pad("Actual", 12) + pad("Predicted", 12) + pad("Diff", 10) + pad("% Err", 10));

    sample.forEach((car, index) => {
        // Determine Variant ID
        const variantId = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });

        // Skip if variant unknown (shouldn't happen if clustering is good)
        if (!variantId || variantId === "unknown") {
            // console.log(`Skipping car ${car.id}: Unknown variant`);
            return;
        }

        // Construct Input
        const inputs = {
            model: car.model,
            powertrainId: variantId,
            registrationDate: car.first_registration,
            mileage: Number(car.mileage),
            isNetPrice: car.taxation === "vat_deductible",
            hasAhk: car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t",
            isAccidentFree: car.accident_free_cardentity === "t",
            tireOption: getTireOption(car),
            isHighland: car.is_highland === "TRUE"
        };

        // Run Prediction
        const prediction = predictPrice(inputs, teslaData);

        // Analyze
        const actual = Number(car.highest_bid_price);
        const predicted = prediction.price;
        const diff = predicted - actual;

        // Avoid division by zero
        const errorPercent = actual !== 0 ? (diff / actual) * 100 : 0;

        results.push({
            id: car.id,
            actual,
            predicted,
            diff,
            errorPercent
        });

        console.log(
            pad(car.model, 10) +
            pad(variantId, 10) +
            pad(fmt(actual), 12) +
            pad(fmt(predicted), 12) +
            pad(fmt(diff), 10) +
            pad(errorPercent.toFixed(2) + "%", 10)
        );
    });

    // Summary
    if (results.length > 0) {
        const absErrors = results.map(r => Math.abs(r.errorPercent));
        const avgError = absErrors.reduce((a, b) => a + b, 0) / results.length;
        const sortedErrors = [...absErrors].sort((a, b) => a - b);
        const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)];

        console.log("---------------------------------------------------------------------------------");
        console.log(`Processed: ${results.length} cars`);
        console.log(`Average Absolute Error: ${avgError.toFixed(2)}%`);
        console.log(`Median Absolute Error:  ${medianError.toFixed(2)}%`);
        console.log(`(Note: Prediction includes self-match, so error should be low but not always 0 due to 4-neighbor averaging)`);
    } else {
        console.log("No valid results.");
    }

} catch (err) {
    console.error("Error:", err);
}

function pad(str, len) {
    str = String(str);
    return str.padEnd(len);
}

function fmt(num) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(num);
}
