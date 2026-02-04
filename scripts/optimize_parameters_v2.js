
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// 1. CONFIGURATION
// ----------------------------------------------------------------------------
const TRIALS = 1000;
const USE_FULL_DATASET = true; // No sampling - deterministic results

const r = (min, max) => Math.random() * (max - min) + min;
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function getTireOption(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

// ----------------------------------------------------------------------------
// 2. IMPROVED PREDICTION LOGIC
// ----------------------------------------------------------------------------
function predictPriceWithConfig(inputs, database, config, excludedId, referenceDate) {
    const {
        model,
        powertrainId,
        registrationDate,
        mileage,
        isNetPrice,
        hasAhk,
        isAccidentFree,
        isHighland,
        tireOption
    } = inputs;

    const targetDate = new Date(registrationDate);
    // KEY FIX: Use the reference date (auction date of test car) instead of "now"
    const now = referenceDate || new Date();

    // 1. Hard Filtering
    const filtered = database.filter((car) => {
        if (car.auction_id === excludedId) return false;
        if (car.model !== model) return false;

        const carKw = car.powe_kw;
        const carBatt = car.battery_netto;
        const cluster = getPowertrainCluster({ ...car, kw: carKw, battery_capacity: carBatt });
        if (cluster !== powertrainId) return false;

        const carIsHighland = car.is_highland === "TRUE";
        if (isHighland !== carIsHighland) return false;

        const carIsVat = car.taxation === "vat_deductible";
        if (carIsVat !== isNetPrice) return false;

        // NEW: Only consider auctions that happened BEFORE the reference date
        // This prevents using "future" data
        if (referenceDate) {
            const auctionDate = parseISO(car.auction_end_date);
            if (auctionDate > referenceDate) return false;
        }

        return true;
    });

    if (filtered.length === 0) return 0;

    // 2. Scoring
    const scored = filtered.map((car) => {
        let score = 0;
        const carRegDate = parseISO(car.first_registration);
        const auctionDate = parseISO(car.auction_end_date);

        // Recency (Market Trend)
        const daysSinceAuction = Math.abs(differenceInDays(now, auctionDate));
        score += daysSinceAuction * config.recencyPenalty;

        // Age (Relative Age Comparison)
        const ageTarget = differenceInMonths(now, targetDate);
        const ageComp = differenceInMonths(auctionDate, carRegDate);
        const monthsDiff = Math.abs(ageTarget - ageComp);

        // NEW: Optional non-linear age penalty (quadratic component)
        const ageLinear = monthsDiff * config.agePenalty;
        const ageQuadratic = (monthsDiff ** 2) * (config.ageQuadraticPenalty || 0);
        score += ageLinear + ageQuadratic;

        // Mileage Score
        const kmDiff = Math.abs(mileage - car.mileage);
        score += kmDiff * config.mileageDistancePenalty;

        // Accident Penalty
        const carIsAccidentFree = car.accident_free_cardentity === "t";
        if (isAccidentFree !== carIsAccidentFree) score += config.accidentPenalty;

        // Tire Penalties - NOW ASYMMETRIC
        const carOption = getTireOption(car);

        if (tireOption === "8_tires") {
            if (carOption !== "8_tires") {
                // User wants 8, car has 4: user's car is better
                score += config.tireUserHas8Penalty;
            }
        } else {
            if (carOption === "8_tires") {
                // User wants 4, car has 8: comp car is better
                score += config.tireUserHas4Penalty;
            } else {
                // Both are single sets
                if (tireOption !== carOption) {
                    score += config.tireTypePenalty;
                }
            }
        }

        // Status
        if (car.status !== "closed_seller_accepted") score += config.statusPenalty;

        // Price Adjustment (Appraisal)
        let price = Number(car.highest_bid_price);
        let adjustment = 0;

        // Hitch
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) adjustment += config.hitchValue;
        else if (!hasAhk && carHasAhk) adjustment -= config.hitchValue;

        // Mileage Depreciation
        const mileageAdj = (car.mileage - mileage) * config.mileageDepreciation;
        if (Math.abs(mileageAdj) > 50) adjustment += mileageAdj;

        return {
            price: price + adjustment,
            score
        };
    });

    scored.sort((a, b) => a.score - b.score);

    const neighbors = scored.slice(0, Math.round(config.neighborCount));

    if (neighbors.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;

    neighbors.forEach(n => {
        // NEW: Configurable weighting exponent
        const weight = 1 / Math.pow(n.score + 1, config.weightExponent || 1);
        weightedSum += n.price * weight;
        totalWeight += weight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ----------------------------------------------------------------------------
// 3. MAIN LOOP
// ----------------------------------------------------------------------------
async function main() {
    console.log("🚀 Optimization v2 - With 'Now' Bug Fix & Asymmetric Tires\n");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });
    console.log(`Validation set: ${validationSet.length} records (with known powertrain)\n`);

    // Evaluate configuration
    function evaluateConfig(config, useFix = true) {
        let absoluteErrors = [];
        const sample = USE_FULL_DATASET ? validationSet :
            validationSet.sort(() => 0.5 - Math.random()).slice(0, 200);

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
                isHighland: car.is_highland === "TRUE",
                tireOption: getTireOption(car)
            };

            // KEY FIX: Use the car's auction date as "now" for LOOCV
            const refDate = useFix ? parseISO(car.auction_end_date) : null;

            const predicted = predictPriceWithConfig(inputs, teslaData, config, car.auction_id, refDate);
            const actual = Number(car.highest_bid_price);

            if (actual > 0 && predicted > 0) {
                const diff = Math.abs(predicted - actual);
                const pct = (diff / actual) * 100;
                absoluteErrors.push(Math.min(pct, 100));
            }
        }

        if (absoluteErrors.length === 0) return { median: 999, count: 0 };

        absoluteErrors.sort((a, b) => a - b);
        const median = absoluteErrors[Math.floor(absoluteErrors.length / 2)];
        const mean = absoluteErrors.reduce((a, b) => a + b, 0) / absoluteErrors.length;
        const p90 = absoluteErrors[Math.floor(absoluteErrors.length * 0.9)];

        return { median, mean, p90, count: absoluteErrors.length };
    }

    // Current production config (from valuation.js)
    const currentConfig = {
        agePenalty: 7.5,
        ageQuadraticPenalty: 0,
        recencyPenalty: 0.14,
        mileageDepreciation: 0.055,
        mileageDistancePenalty: 0.0045,
        neighborCount: 6,
        accidentPenalty: 30,
        tireUserHas8Penalty: 30,  // Previously tireQuantityPenalty
        tireUserHas4Penalty: 14,  // Was different in valuation.js!
        tireTypePenalty: 5,
        statusPenalty: 100,
        hitchValue: 250,
        weightExponent: 1
    };

    console.log("=== Baseline Evaluation ===");

    // Test with old method (using "now")
    console.log("Testing OLD method (using today's date as reference)...");
    const oldMethodResult = evaluateConfig(currentConfig, false);
    console.log(`  Median Error: ${oldMethodResult.median.toFixed(3)}%`);
    console.log(`  Mean Error: ${oldMethodResult.mean.toFixed(3)}%`);
    console.log(`  90th Percentile: ${oldMethodResult.p90.toFixed(3)}%`);

    // Test with new method (using auction date)
    console.log("\nTesting NEW method (using auction date as reference)...");
    const newMethodResult = evaluateConfig(currentConfig, true);
    console.log(`  Median Error: ${newMethodResult.median.toFixed(3)}%`);
    console.log(`  Mean Error: ${newMethodResult.mean.toFixed(3)}%`);
    console.log(`  90th Percentile: ${newMethodResult.p90.toFixed(3)}%`);

    const fixImpact = oldMethodResult.median - newMethodResult.median;
    console.log(`\n📊 'Now' bug fix impact: ${fixImpact > 0 ? '-' : '+'}${Math.abs(fixImpact).toFixed(3)}% points`);

    console.log(`\n=== Starting Random Search (${TRIALS} trials) ===\n`);

    let bestConfig = { ...currentConfig };
    let bestScore = newMethodResult.median;

    const startTime = Date.now();

    for (let i = 0; i < TRIALS; i++) {
        const config = {
            agePenalty: r(3.0, 12.0),
            ageQuadraticPenalty: r(0, 0.3),        // NEW: Non-linear age
            recencyPenalty: r(0.0, 0.25),
            mileageDepreciation: r(0.03, 0.10),
            mileageDistancePenalty: r(0.001, 0.008),
            neighborCount: rInt(3, 12),
            accidentPenalty: r(15, 70),
            tireUserHas8Penalty: r(10, 50),       // User has 8, comp has 4
            tireUserHas4Penalty: r(5, 35),        // User has 4, comp has 8
            tireTypePenalty: r(0, 15),
            statusPenalty: r(50, 150),
            hitchValue: r(150, 400),
            weightExponent: r(0.5, 2.0)           // NEW: Weighting power
        };

        const result = evaluateConfig(config, true);

        if (result.median < bestScore) {
            bestScore = result.median;
            bestConfig = config;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${i + 1}/${TRIALS}] 🎯 New Best: ${result.median.toFixed(3)}% (elapsed: ${elapsed}s)`);
        }

        if (i % 100 === 0 && i > 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = (i / elapsed).toFixed(1);
            process.stdout.write(`\r[${i}/${TRIALS}] Running... (${rate}/sec) Best: ${bestScore.toFixed(3)}%    `);
        }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("OPTIMIZATION COMPLETE");
    console.log("=".repeat(60));

    console.log("\n📋 BEFORE (Current valuation.js):");
    console.log(JSON.stringify(currentConfig, null, 2));
    console.log(`Median Error (with fix): ${newMethodResult.median.toFixed(3)}%`);

    console.log("\n📋 AFTER (Optimized):");
    console.log(JSON.stringify(bestConfig, null, 2));

    const finalResult = evaluateConfig(bestConfig, true);
    console.log(`Median Error: ${finalResult.median.toFixed(3)}%`);
    console.log(`Mean Error: ${finalResult.mean.toFixed(3)}%`);
    console.log(`90th Percentile: ${finalResult.p90.toFixed(3)}%`);

    const improvement = newMethodResult.median - bestScore;
    console.log(`\n✨ Improvement: -${improvement.toFixed(3)}% points (${((improvement / newMethodResult.median) * 100).toFixed(1)}% relative improvement)`);

    // Print parameter changes summary
    console.log("\n📊 Key Parameter Changes:");
    const changes = [
        ['agePenalty', 'points/month'],
        ['ageQuadraticPenalty', 'points/month² (NEW)'],
        ['recencyPenalty', 'points/day'],
        ['mileageDepreciation', '€/km'],
        ['neighborCount', 'neighbors'],
        ['accidentPenalty', 'points'],
        ['tireUserHas8Penalty', 'points (was tireQuantityPenalty)'],
        ['tireUserHas4Penalty', 'points (NEW - asymmetric)'],
        ['weightExponent', 'power (NEW)'],
    ];

    for (const [key, unit] of changes) {
        const old = currentConfig[key];
        const newVal = bestConfig[key];
        const diff = newVal - old;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        console.log(`  ${key}: ${old.toFixed(3)} → ${newVal.toFixed(3)} ${arrow} (${unit})`);
    }
}

main();
