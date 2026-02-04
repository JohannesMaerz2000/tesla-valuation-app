import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const teslaData = JSON.parse(rawData);

function getTireOption(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

// simulate "accepted only" database
const acceptedOnlyDB = teslaData.filter(c => c.status === 'closed_seller_accepted');
console.log(`Accepted Only DB Size: ${acceptedOnlyDB.length}`);

// Test against a random sample of ACCEPTED cars (we want to see if we can value them using only other accepted cars)
const sample = acceptedOnlyDB.slice(0, 50);
let failures = 0;

sample.forEach(car => {
    // Exclude self
    const otherCars = acceptedOnlyDB.filter(c => c.id !== car.id);

    const variantId = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
    if (!variantId || variantId === "unknown") return;

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

    const prediction = predictPrice(inputs, otherCars);
    if (prediction.price === 0) failures++;
});

console.log(`Failed to predict (no neighbors) for ${failures} out of ${sample.length} cars.`);
console.log(`Failure Rate: ${(failures / sample.length) * 100}%`);
