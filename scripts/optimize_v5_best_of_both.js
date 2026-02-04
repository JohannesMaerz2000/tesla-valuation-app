
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// v5: Best of Both - All Data + Model-Specific + Non-Linear Age + Weight Exponent
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
    const now = new Date(); // Use ALL data (original methodology)

    // Model-specific config
    const modelConfig = model === "Model 3" ? config.model3 : config.modelY;
    const shared = config.shared;

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

        // Recency (shared)
        score += Math.abs(differenceInDays(now, auctionDate)) * shared.recencyPenalty;

        // Age - MODEL SPECIFIC + NON-LINEAR
        const ageTarget = differenceInMonths(now, targetDate);
        const ageComp = differenceInMonths(auctionDate, carRegDate);
        const monthsDiff = Math.abs(ageTarget - ageComp);
        score += monthsDiff * modelConfig.agePenalty;
        score += (monthsDiff ** 2) * modelConfig.ageQuadratic;  // Non-linear component

        // Mileage - MODEL SPECIFIC
        score += Math.abs(mileage - car.mileage) * modelConfig.mileageDistancePenalty;

        // Accident (shared)
        if (isAccidentFree !== (car.accident_free_cardentity === "t")) score += shared.accidentPenalty;

        // Tires (shared)
        const carOption = getTireOption(car);
        if (tireOption === "8_tires" && carOption !== "8_tires") {
            score += shared.tireUserWants8Penalty;
        } else if (tireOption !== "8_tires" && carOption === "8_tires") {
            score += shared.tireUserWants4Penalty;
        } else if (tireOption !== "8_tires" && carOption !== "8_tires" && tireOption !== carOption) {
            score += shared.tireTypePenalty;
        }

        // Status (shared)
        if (car.status !== "closed_seller_accepted") score += shared.statusPenalty;

        // Price adjustments
        let price = Number(car.highest_bid_price);
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) price += shared.hitchValue;
        else if (!hasAhk && carHasAhk) price -= shared.hitchValue;

        // Mileage depreciation - MODEL SPECIFIC
        const mileageAdj = (car.mileage - mileage) * modelConfig.mileageDepreciation;
        if (Math.abs(mileageAdj) > 50) price += mileageAdj;

        return { price, score };
    });

    scored.sort((a, b) => a.score - b.score);
    const neighbors = scored.slice(0, shared.neighborCount);
    if (neighbors.length === 0) return 0;

    let totalWeight = 0, weightedSum = 0;
    neighbors.forEach(n => {
        // Configurable weight exponent
        const weight = 1 / Math.pow(n.score + 1, shared.weightExponent);
        weightedSum += n.price * weight;
        totalWeight += weight;
    });
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

async function main() {
    console.log("🚀 Optimization v5 - Best of Both Worlds\n");
    console.log("   ✓ Uses ALL data (original methodology)");
    console.log("   ✓ Model-specific parameters (Model 3 vs Y)");
    console.log("   ✓ Non-linear age decay");
    console.log("   ✓ Configurable weight exponent\n");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });

    const model3Count = validationSet.filter(c => c.model === "Model 3").length;
    const modelYCount = validationSet.filter(c => c.model === "Model Y").length;
    console.log(`Validation: ${validationSet.length} total (Model 3: ${model3Count}, Model Y: ${modelYCount})\n`);

    // Current production as baseline (converted to new structure)
    const productionConfig = {
        shared: {
            recencyPenalty: 0.26,
            accidentPenalty: 52,
            tireUserWants8Penalty: 34,
            tireUserWants4Penalty: 34,
            tireTypePenalty: 1,
            statusPenalty: 100,
            hitchValue: 250,
            neighborCount: 9,
            weightExponent: 3.5
        },
        model3: {
            agePenalty: 6.4,
            ageQuadratic: 0,
            mileageDepreciation: 0.058,
            mileageDistancePenalty: 0.0012
        },
        modelY: {
            agePenalty: 6.4,
            ageQuadratic: 0,
            mileageDepreciation: 0.058,
            mileageDistancePenalty: 0.0012
        }
    };

    function evaluate(config) {
        let errors = [];
        let m3Errors = [], myErrors = [];

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
                const cappedPct = Math.min(pct, 100);
                errors.push(cappedPct);
                if (car.model === "Model 3") m3Errors.push(cappedPct);
                else myErrors.push(cappedPct);
            }
        }

        if (errors.length === 0) return { median: 999 };
        errors.sort((a, b) => a - b);
        m3Errors.sort((a, b) => a - b);
        myErrors.sort((a, b) => a - b);

        return {
            median: errors[Math.floor(errors.length / 2)],
            mean: errors.reduce((a, b) => a + b, 0) / errors.length,
            m3Median: m3Errors.length > 0 ? m3Errors[Math.floor(m3Errors.length / 2)] : 0,
            myMedian: myErrors.length > 0 ? myErrors[Math.floor(myErrors.length / 2)] : 0,
            count: errors.length
        };
    }

    console.log("=== Production Baseline (Unified Params) ===");
    const baselineResult = evaluate(productionConfig);
    console.log(`Overall Median: ${baselineResult.median.toFixed(3)}%`);
    console.log(`Model 3 Median: ${baselineResult.m3Median.toFixed(3)}%`);
    console.log(`Model Y Median: ${baselineResult.myMedian.toFixed(3)}%`);

    // Also test v4 best config for comparison
    const v4Config = {
        shared: {
            recencyPenalty: 0.092,
            accidentPenalty: 18,
            tireUserWants8Penalty: 22,
            tireUserWants4Penalty: 25,
            tireTypePenalty: 11,
            statusPenalty: 81,
            hitchValue: 257,
            neighborCount: 8,
            weightExponent: 1.0
        },
        model3: {
            agePenalty: 11.6,
            ageQuadratic: 0,
            mileageDepreciation: 0.054,
            mileageDistancePenalty: 0.0028
        },
        modelY: {
            agePenalty: 11.6,
            ageQuadratic: 0,
            mileageDepreciation: 0.054,
            mileageDistancePenalty: 0.0028
        }
    };

    console.log("\n=== v4 Optimized (Unified Params) ===");
    const v4Result = evaluate(v4Config);
    console.log(`Overall Median: ${v4Result.median.toFixed(3)}%`);

    console.log(`\n=== Starting v5 Search (${TRIALS} trials) ===\n`);

    let bestConfig = JSON.parse(JSON.stringify(productionConfig));
    let bestScore = baselineResult.median;
    const startTime = Date.now();

    for (let i = 0; i < TRIALS; i++) {
        const config = {
            shared: {
                recencyPenalty: r(0.1, 0.4),
                accidentPenalty: r(20, 80),
                tireUserWants8Penalty: r(20, 60),
                tireUserWants4Penalty: r(15, 50),
                tireTypePenalty: r(1, 20),
                statusPenalty: r(50, 150),
                hitchValue: r(150, 350),
                neighborCount: rInt(5, 12),
                weightExponent: r(1.5, 5.0)
            },
            model3: {
                agePenalty: r(4, 15),
                ageQuadratic: r(0, 0.2),
                mileageDepreciation: r(0.03, 0.08),
                mileageDistancePenalty: r(0.0005, 0.004)
            },
            modelY: {
                agePenalty: r(8, 20),
                ageQuadratic: r(0, 0.2),
                mileageDepreciation: r(0.04, 0.10),
                mileageDistancePenalty: r(0.0005, 0.005)
            }
        };

        const result = evaluate(config);

        if (result.median < bestScore) {
            bestScore = result.median;
            bestConfig = JSON.parse(JSON.stringify(config));
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${i + 1}/${TRIALS}] 🎯 New Best: ${result.median.toFixed(3)}% (M3: ${result.m3Median.toFixed(2)}%, MY: ${result.myMedian.toFixed(2)}%) [${elapsed}s]`);
            console.log(JSON.stringify(config, null, 2));
        }

        if (i % 200 === 0 && i > 0) {
            process.stdout.write(`\r[${i}/${TRIALS}] Best: ${bestScore.toFixed(3)}%    `);
        }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("OPTIMIZATION COMPLETE");
    console.log("=".repeat(60));

    const finalResult = evaluate(bestConfig);

    console.log("\n📊 COMPARISON:");
    console.log(`  Production baseline:  ${baselineResult.median.toFixed(3)}%`);
    console.log(`  v4 (unified params):  ${v4Result.median.toFixed(3)}%`);
    console.log(`  v5 (model-specific):  ${finalResult.median.toFixed(3)}%`);

    const improvement = baselineResult.median - bestScore;
    console.log(`\n✨ Total improvement: -${improvement.toFixed(3)}% points (${((improvement / baselineResult.median) * 100).toFixed(1)}% better)`);

    console.log("\n📋 BEST CONFIG:");
    console.log(JSON.stringify(bestConfig, null, 2));

    console.log("\n📊 Model-Specific Insights:");
    console.log(`  Model 3 Age Penalty: ${bestConfig.model3.agePenalty.toFixed(2)} + ${bestConfig.model3.ageQuadratic.toFixed(4)}*months²`);
    console.log(`  Model Y Age Penalty: ${bestConfig.modelY.agePenalty.toFixed(2)} + ${bestConfig.modelY.ageQuadratic.toFixed(4)}*months²`);
    console.log(`  Model 3 Mileage: €${(bestConfig.model3.mileageDepreciation * 10000).toFixed(0)}/10k km`);
    console.log(`  Model Y Mileage: €${(bestConfig.modelY.mileageDepreciation * 10000).toFixed(0)}/10k km`);
    console.log(`  Weight Exponent: ${bestConfig.shared.weightExponent.toFixed(2)}`);
}

main();
