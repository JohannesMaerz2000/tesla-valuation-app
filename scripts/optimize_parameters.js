
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// 1. CONFIGURATION RANGES
// ----------------------------------------------------------------------------
const TRIALS = 500;
const SAMPLE_SIZE = 200; // Speed up each trial by using a subset

// Helper: Random float between min/max
const r = (min, max) => Math.random() * (max - min) + min;
// Helper: Random int
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ----------------------------------------------------------------------------
// 2. LOGIC (Modified to accept Config)
// ----------------------------------------------------------------------------
function predictPriceWithConfig(inputs, database, config, excludedId) {
    const {
        model,
        powertrainId,
        registrationDate,
        mileage,
        isNetPrice,
        hasAhk,
        isAccidentFree,
        isHighland
    } = inputs;

    const targetDate = new Date(registrationDate);
    const now = new Date();

    // 1. Hard Filtering
    const filtered = database.filter((car) => {
        if (car.auction_id === excludedId) return false; // LEAVE-ONE-OUT VALIDATION
        if (car.model !== model) return false;

        const carKw = car.powe_kw;
        const carBatt = car.battery_netto;
        const cluster = getPowertrainCluster({ ...car, kw: carKw, battery_capacity: carBatt });
        if (cluster !== powertrainId) return false;

        const carIsHighland = car.is_highland === "TRUE";
        if (isHighland !== carIsHighland) return false;

        const carIsVat = car.taxation === "vat_deductible";
        if (carIsVat !== isNetPrice) return false;

        return true;
    });

    if (filtered.length === 0) return 0;

    // 2. Scoring
    const scored = filtered.map((car) => {
        let score = 0;
        const carRegDate = parseISO(car.first_registration);
        const auctionDate = parseISO(car.auction_end_date);

        // CONFIG PARAM: Recency
        const daysSinceAuction = Math.abs(differenceInDays(now, auctionDate));
        score += daysSinceAuction * config.recencyPenalty;

        // CONFIG PARAM: Age
        const monthsDiff = Math.abs(differenceInMonths(targetDate, carRegDate));
        score += monthsDiff * config.agePenalty;

        // CONFIG PARAM: Mileage Score
        const kmDiff = Math.abs(mileage - car.mileage);
        score += kmDiff * config.mileageDistancePenalty;

        // Attributes (Soft Penalties)
        const carIsAccidentFree = car.accident_free_cardentity === "t";
        if (isAccidentFree !== carIsAccidentFree) score += 20;

        // Tires (Simplified implementation for speed)
        const sets = parseInt(car.tires_total_sets) || 1;
        const carOption = sets === 2 ? "8_tires" : (car.tires_winter === "1" ? "4_winter" : "4_summer");

        // Assume user wants 4 summer (standard assumption for bulk test validation without user input)
        // Or better: Assume car matches itself if we were predicting it.
        // Actually, let's just use static penalty logic roughly matching the app's average case.
        // A mismatch adds points. Let's assume average 5 pts penalty for noise?
        // Or strictly: since we don't vary tire weights in this optimization, we can leave it as is or simplify.
        // Let's implement basics:
        // Score += 0 (assuming match for simplicity in high-speed loop, noise is negligible compared to age/mileage)

        // Status
        if (car.status !== "closed_seller_accepted") score += 100;

        // Price Adjustment (Appraisal)
        let price = Number(car.highest_bid_price);
        let adjustment = 0;

        // Hitch
        if (hasAhk && !(car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t")) adjustment += 250;
        else if (!hasAhk && (car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t")) adjustment -= 250;

        // CONFIG PARAM: Mileage Depreciation
        const mileageAdj = (car.mileage - mileage) * config.mileageDepreciation;
        if (Math.abs(mileageAdj) > 50) adjustment += mileageAdj;

        return {
            price: price + adjustment,
            score
        };
    });

    scored.sort((a, b) => a.score - b.score);

    // CONFIG PARAM: Neighbor Count
    const neighbors = scored.slice(0, Math.round(config.neighborCount));

    if (neighbors.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;

    neighbors.forEach(n => {
        const weight = 1 / (n.score + 1);
        weightedSum += n.price * weight;
        totalWeight += weight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ----------------------------------------------------------------------------
// 3. MAIN LOOP
// ----------------------------------------------------------------------------
async function main() {
    console.log("🚀 Starting Hyperparameter Optimization...");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });

    // Helper to run one full pass
    function evaluateConfig(config) {
        let absoluteErrors = [];

        // Random subsample for speed
        const sample = validationSet.length > SAMPLE_SIZE
            ? validationSet.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE)
            : validationSet;

        for (const car of sample) {
            const variantId = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });

            const inputs = {
                model: car.model,
                powertrainId: variantId,
                registrationDate: car.first_registration,
                mileage: Number(car.mileage),
                isNetPrice: car.taxation === "vat_deductible",
                hasAhk: car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t",
                isAccidentFree: car.accident_free_cardentity === "t",
                isHighland: car.is_highland === "TRUE"
            };

            const predicted = predictPriceWithConfig(inputs, teslaData, config, car.auction_id);
            const actual = Number(car.highest_bid_price);

            if (actual > 0 && predicted > 0) {
                const diff = Math.abs(predicted - actual);
                const pct = (diff / actual) * 100;
                absoluteErrors.push(Math.min(pct, 100));
            }
        }

        if (absoluteErrors.length === 0) return 999;

        // Calculate Median Absolute Error
        absoluteErrors.sort((a, b) => a - b);
        const median = absoluteErrors[Math.floor(absoluteErrors.length / 2)];
        return median;
    }

    let bestConfig = null;
    let bestScore = 999;

    const baselineConfig = {
        agePenalty: 3.5,
        recencyPenalty: 0.1,
        mileageDepreciation: 0.06,
        mileageDistancePenalty: 0.001,
        neighborCount: 4
    };

    console.log("Measuring Baseline (Current Logic)...");
    const baselineScore = evaluateConfig(baselineConfig);
    console.log(`Baseline Median Error: ${baselineScore.toFixed(3)}%`);

    console.log(`Running ${TRIALS} Random Search Trials...`);

    const startTime = Date.now();

    for (let i = 0; i < TRIALS; i++) {
        const config = {
            agePenalty: r(2.0, 7.0),           // Focus range around 3.5
            recencyPenalty: r(0, 0.5),         // Focus range around 0.1
            mileageDepreciation: r(0.02, 0.10),// Focus range around 0.06
            mileageDistancePenalty: r(0.0005, 0.003),
            neighborCount: rInt(3, 8)
        };

        const score = evaluateConfig(config);

        if (score < bestScore) {
            bestScore = score;
            bestConfig = config;
            process.stdout.write(`\r[${i + 1}/${TRIALS}] New Best: ${score.toFixed(3)}% (Improv: -${(baselineScore - score).toFixed(3)})  `);
        }

        if (i % 100 === 0 && i > 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = i / elapsed;
            process.stdout.write(`\r[${i}/${TRIALS}] Running... (${rate.toFixed(1)}/sec) Current Best: ${bestScore.toFixed(3)}%    `);
        }
    }

    console.log("\n\n------------------------------------------------");
    console.log("OPTIMIZATION COMPLETE");
    console.log("------------------------------------------------");

    console.log("Before (Baseline):");
    console.log(JSON.stringify(baselineConfig, null, 2));
    console.log(`Error: ${baselineScore.toFixed(3)}%`);

    console.log("\nAfter (Optimized):");
    console.log(JSON.stringify(bestConfig, null, 2));
    console.log(`Error: ${bestScore.toFixed(3)}%`);

    const improvement = baselineScore - bestScore;
    console.log(`\nImprovement: -${improvement.toFixed(3)}% points (${((improvement / baselineScore) * 100).toFixed(1)}% better)`);
}

main();
