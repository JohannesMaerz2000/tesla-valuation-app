
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// v4: Correct Production Baseline + Full Dataset + Multiple Runs for Stability
// ----------------------------------------------------------------------------
const TRIALS = 2000;

const r = (min, max) => Math.random() * (max - min) + min;
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function getTireOption(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

function predictPriceWithConfig(inputs, database, config, excludedId) {
    const { model, powertrainId, registrationDate, mileage, isNetPrice, hasAhk, isAccidentFree, isHighland, tireOption } = inputs;
    const targetDate = new Date(registrationDate);
    const now = new Date(); // Keep old methodology for fair comparison

    const filtered = database.filter((car) => {
        if (car.auction_id === excludedId) return false;
        if (car.model !== model) return false;
        const cluster = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        if (cluster !== powertrainId) return false;
        if ((car.is_highland === "TRUE") !== isHighland) return false;
        if ((car.taxation === "vat_deductible") !== isNetPrice) return false;
        return true;
    });

    if (filtered.length === 0) return 0;

    const scored = filtered.map((car) => {
        let score = 0;
        const carRegDate = parseISO(car.first_registration);
        const auctionDate = parseISO(car.auction_end_date);

        score += Math.abs(differenceInDays(now, auctionDate)) * config.recencyPenalty;

        const ageTarget = differenceInMonths(now, targetDate);
        const ageComp = differenceInMonths(auctionDate, carRegDate);
        score += Math.abs(ageTarget - ageComp) * config.agePenalty;

        score += Math.abs(mileage - car.mileage) * config.mileageDistancePenalty;

        if (isAccidentFree !== (car.accident_free_cardentity === "t")) score += config.accidentPenalty;

        const carOption = getTireOption(car);
        // Asymmetric tire penalty (matching production valuation.js)
        if (tireOption === "8_tires" && carOption !== "8_tires") {
            score += config.tireUserWants8Penalty;  // User wants 8, comp has 4
        } else if (tireOption !== "8_tires" && carOption === "8_tires") {
            score += config.tireUserWants4Penalty;  // User wants 4, comp has 8
        } else if (tireOption !== "8_tires" && carOption !== "8_tires" && tireOption !== carOption) {
            score += config.tireTypePenalty;
        }

        if (car.status !== "closed_seller_accepted") score += config.statusPenalty;

        let price = Number(car.highest_bid_price);
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) price += config.hitchValue;
        else if (!hasAhk && carHasAhk) price -= config.hitchValue;

        const mileageAdj = (car.mileage - mileage) * config.mileageDepreciation;
        if (Math.abs(mileageAdj) > 50) price += mileageAdj;

        return { price, score };
    });

    scored.sort((a, b) => a.score - b.score);
    const neighbors = scored.slice(0, config.neighborCount);
    if (neighbors.length === 0) return 0;

    let totalWeight = 0, weightedSum = 0;
    neighbors.forEach(n => {
        const weight = 1 / (n.score + 1);
        weightedSum += n.price * weight;
        totalWeight += weight;
    });
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

async function main() {
    console.log("🚀 Optimization v4 - CORRECT Production Baseline + Full Dataset\n");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });
    console.log(`Validation set: ${validationSet.length} records\n`);

    // CORRECT production baseline from valuation.js
    const productionConfig = {
        agePenalty: 7.5,                    // From valuation.js line 125
        recencyPenalty: 0.14,               // From valuation.js line 117
        mileageDepreciation: 0.055,         // From valuation.js line 229
        mileageDistancePenalty: 0.0045,     // From valuation.js line 130
        neighborCount: 6,                   // From valuation.js line 267
        accidentPenalty: 30,                // From valuation.js line 139
        tireUserWants8Penalty: 30,          // From valuation.js line 186 (user wants 8, comp has less)
        tireUserWants4Penalty: 14,          // From valuation.js line 193 (user wants 4, comp has 8)
        tireTypePenalty: 5,                 // From valuation.js line 199
        statusPenalty: 100,                 // From valuation.js line 207
        hitchValue: 250                     // From valuation.js line 219
    };

    function evaluate(config) {
        let errors = [];
        for (const car of validationSet) {
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

            const predicted = predictPriceWithConfig(inputs, teslaData, config, car.auction_id);
            const actual = Number(car.highest_bid_price);

            if (actual > 0 && predicted > 0) {
                const pct = Math.abs(predicted - actual) / actual * 100;
                errors.push(Math.min(pct, 100));
            }
        }

        if (errors.length === 0) return { median: 999 };
        errors.sort((a, b) => a - b);
        return {
            median: errors[Math.floor(errors.length / 2)],
            mean: errors.reduce((a, b) => a + b, 0) / errors.length,
            p90: errors[Math.floor(errors.length * 0.9)],
            count: errors.length
        };
    }

    console.log("=== CORRECT Production Baseline ===");
    const baselineResult = evaluate(productionConfig);
    console.log(`Median Error: ${baselineResult.median.toFixed(3)}%`);
    console.log(`Mean Error: ${baselineResult.mean.toFixed(3)}%`);
    console.log(`90th Percentile: ${baselineResult.p90.toFixed(3)}%`);
    console.log(`Config: ${JSON.stringify(productionConfig, null, 2)}`);

    console.log(`\n=== Starting Optimization (${TRIALS} trials) ===\n`);

    let bestConfig = { ...productionConfig };
    let bestScore = baselineResult.median;
    const startTime = Date.now();

    for (let i = 0; i < TRIALS; i++) {
        const config = {
            agePenalty: r(4, 12),
            recencyPenalty: r(0.05, 0.25),
            mileageDepreciation: r(0.03, 0.09),
            mileageDistancePenalty: r(0.002, 0.007),
            neighborCount: rInt(3, 10),
            accidentPenalty: r(15, 50),
            tireUserWants8Penalty: r(10, 50),
            tireUserWants4Penalty: r(5, 30),
            tireTypePenalty: r(0, 15),
            statusPenalty: r(50, 150),
            hitchValue: r(150, 400)
        };

        const result = evaluate(config);

        if (result.median < bestScore) {
            bestScore = result.median;
            bestConfig = { ...config };
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${i + 1}/${TRIALS}] 🎯 New Best: ${result.median.toFixed(3)}% (was ${baselineResult.median.toFixed(3)}%) [${elapsed}s]`);
        }

        if (i % 200 === 0 && i > 0) {
            process.stdout.write(`\r[${i}/${TRIALS}] Best: ${bestScore.toFixed(3)}%    `);
        }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("OPTIMIZATION COMPLETE");
    console.log("=".repeat(60));

    console.log("\n📋 PRODUCTION BASELINE:");
    console.log(`Median Error: ${baselineResult.median.toFixed(3)}%`);

    const finalResult = evaluate(bestConfig);
    console.log("\n📋 OPTIMIZED:");
    console.log(`Median Error: ${finalResult.median.toFixed(3)}%`);
    console.log(`Mean Error: ${finalResult.mean.toFixed(3)}%`);
    console.log(`90th Percentile: ${finalResult.p90.toFixed(3)}%`);

    const improvement = baselineResult.median - bestScore;
    if (improvement > 0) {
        console.log(`\n✨ Improvement: -${improvement.toFixed(3)}% points (${((improvement / baselineResult.median) * 100).toFixed(1)}% better)`);
    } else {
        console.log(`\n⚠️  No improvement found over production baseline`);
    }

    console.log("\n📋 BEST CONFIG:");
    console.log(JSON.stringify(bestConfig, null, 2));

    // Parameter changes
    console.log("\n📊 Parameter Changes:");
    const params = ['agePenalty', 'recencyPenalty', 'mileageDepreciation', 'mileageDistancePenalty', 'neighborCount', 'accidentPenalty', 'tireUserWants8Penalty', 'tireUserWants4Penalty', 'tireTypePenalty', 'statusPenalty', 'hitchValue'];
    for (const p of params) {
        const old = productionConfig[p];
        const neu = bestConfig[p];
        const diff = neu - old;
        const arrow = diff > 0.001 ? '↑' : diff < -0.001 ? '↓' : '→';
        console.log(`  ${p}: ${typeof old === 'number' ? old.toFixed(4) : old} → ${typeof neu === 'number' ? neu.toFixed(4) : neu} ${arrow}`);
    }
}

main();
