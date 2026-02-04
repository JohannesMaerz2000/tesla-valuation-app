
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// v3: Model-Specific Parameters + Refined Search Around Best
// ----------------------------------------------------------------------------
const TRIALS = 1500;

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
// Model-Aware Prediction
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
    const now = referenceDate || new Date();

    // Select model-specific config
    const modelConfig = model === "Model 3" ? config.model3 : config.modelY;
    const sharedConfig = config.shared;

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

        // Recency (shared - market trends affect all models)
        const daysSinceAuction = Math.abs(differenceInDays(now, auctionDate));
        score += daysSinceAuction * sharedConfig.recencyPenalty;

        // Age (MODEL-SPECIFIC)
        const ageTarget = differenceInMonths(now, targetDate);
        const ageComp = differenceInMonths(auctionDate, carRegDate);
        const monthsDiff = Math.abs(ageTarget - ageComp);
        score += monthsDiff * modelConfig.agePenalty;
        score += (monthsDiff ** 2) * modelConfig.ageQuadraticPenalty;

        // Mileage Score (MODEL-SPECIFIC)
        const kmDiff = Math.abs(mileage - car.mileage);
        score += kmDiff * modelConfig.mileageDistancePenalty;

        // Accident Penalty (shared)
        const carIsAccidentFree = car.accident_free_cardentity === "t";
        if (isAccidentFree !== carIsAccidentFree) score += sharedConfig.accidentPenalty;

        // Tire Penalties (shared)
        const carOption = getTireOption(car);
        if (tireOption === "8_tires") {
            if (carOption !== "8_tires") score += sharedConfig.tirePenalty;
        } else {
            if (carOption === "8_tires") {
                score += sharedConfig.tirePenalty;
            } else if (tireOption !== carOption) {
                score += sharedConfig.tireTypePenalty;
            }
        }

        // Status (shared)
        if (car.status !== "closed_seller_accepted") score += sharedConfig.statusPenalty;

        // Price Adjustment
        let price = Number(car.highest_bid_price);
        let adjustment = 0;

        // Hitch (shared)
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) adjustment += sharedConfig.hitchValue;
        else if (!hasAhk && carHasAhk) adjustment -= sharedConfig.hitchValue;

        // Mileage Depreciation (MODEL-SPECIFIC)
        const mileageAdj = (car.mileage - mileage) * modelConfig.mileageDepreciation;
        if (Math.abs(mileageAdj) > 50) adjustment += mileageAdj;

        return {
            price: price + adjustment,
            score
        };
    });

    scored.sort((a, b) => a.score - b.score);
    const neighbors = scored.slice(0, Math.round(sharedConfig.neighborCount));

    if (neighbors.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;

    neighbors.forEach(n => {
        const weight = 1 / Math.pow(n.score + 1, sharedConfig.weightExponent);
        weightedSum += n.price * weight;
        totalWeight += weight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
async function main() {
    console.log("🚀 Optimization v3 - Model-Specific Parameters\n");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${teslaData.length} records.`);

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });

    const model3Set = validationSet.filter(c => c.model === "Model 3");
    const modelYSet = validationSet.filter(c => c.model === "Model Y");
    console.log(`Model 3: ${model3Set.length} records, Model Y: ${modelYSet.length} records\n`);

    function evaluateConfig(config) {
        let absoluteErrors = [];

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

            const refDate = parseISO(car.auction_end_date);
            const predicted = predictPriceWithConfig(inputs, teslaData, config, car.auction_id, refDate);
            const actual = Number(car.highest_bid_price);

            if (actual > 0 && predicted > 0) {
                const diff = Math.abs(predicted - actual);
                const pct = (diff / actual) * 100;
                absoluteErrors.push({ pct: Math.min(pct, 100), model: car.model });
            }
        }

        if (absoluteErrors.length === 0) return { median: 999 };

        const allPcts = absoluteErrors.map(e => e.pct).sort((a, b) => a - b);
        const model3Pcts = absoluteErrors.filter(e => e.model === "Model 3").map(e => e.pct).sort((a, b) => a - b);
        const modelYPcts = absoluteErrors.filter(e => e.model === "Model Y").map(e => e.pct).sort((a, b) => a - b);

        return {
            median: allPcts[Math.floor(allPcts.length / 2)],
            model3Median: model3Pcts.length > 0 ? model3Pcts[Math.floor(model3Pcts.length / 2)] : 0,
            modelYMedian: modelYPcts.length > 0 ? modelYPcts[Math.floor(modelYPcts.length / 2)] : 0,
            count: absoluteErrors.length
        };
    }

    // Best config from v2 as starting point
    const v2BestConfig = {
        shared: {
            recencyPenalty: 0.141,
            accidentPenalty: 36,
            tirePenalty: 12.5,
            tireTypePenalty: 12.3,
            statusPenalty: 56,
            hitchValue: 189,
            weightExponent: 1.37,
            neighborCount: 4
        },
        model3: {
            agePenalty: 11.8,
            ageQuadraticPenalty: 0.08,
            mileageDepreciation: 0.073,
            mileageDistancePenalty: 0.0038
        },
        modelY: {
            agePenalty: 11.8,
            ageQuadraticPenalty: 0.08,
            mileageDepreciation: 0.073,
            mileageDistancePenalty: 0.0038
        }
    };

    console.log("=== Baseline (v2 config, unified) ===");
    const baselineResult = evaluateConfig(v2BestConfig);
    console.log(`Overall Median: ${baselineResult.median.toFixed(3)}%`);
    console.log(`Model 3 Median: ${baselineResult.model3Median.toFixed(3)}%`);
    console.log(`Model Y Median: ${baselineResult.modelYMedian.toFixed(3)}%`);

    console.log(`\n=== Starting Model-Specific Search (${TRIALS} trials) ===\n`);

    let bestConfig = JSON.parse(JSON.stringify(v2BestConfig));
    let bestScore = baselineResult.median;

    const startTime = Date.now();

    for (let i = 0; i < TRIALS; i++) {
        // Generate config with some perturbation around v2 best
        const config = {
            shared: {
                recencyPenalty: r(0.05, 0.25),
                accidentPenalty: r(20, 60),
                tirePenalty: r(5, 25),
                tireTypePenalty: r(3, 20),
                statusPenalty: r(40, 120),
                hitchValue: r(150, 350),
                weightExponent: r(0.8, 2.0),
                neighborCount: rInt(3, 8)
            },
            model3: {
                agePenalty: r(6, 16),
                ageQuadraticPenalty: r(0, 0.2),
                mileageDepreciation: r(0.04, 0.10),
                mileageDistancePenalty: r(0.002, 0.006)
            },
            modelY: {
                agePenalty: r(6, 16),
                ageQuadraticPenalty: r(0, 0.2),
                mileageDepreciation: r(0.04, 0.10),
                mileageDistancePenalty: r(0.002, 0.006)
            }
        };

        const result = evaluateConfig(config);

        if (result.median < bestScore) {
            bestScore = result.median;
            bestConfig = JSON.parse(JSON.stringify(config));
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${i + 1}/${TRIALS}] 🎯 New Best: ${result.median.toFixed(3)}% (M3: ${result.model3Median.toFixed(2)}%, MY: ${result.modelYMedian.toFixed(2)}%) [${elapsed}s]`);
        }

        if (i % 100 === 0 && i > 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            process.stdout.write(`\r[${i}/${TRIALS}] Best: ${bestScore.toFixed(3)}% (${(i / elapsed).toFixed(1)}/sec)    `);
        }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("OPTIMIZATION COMPLETE");
    console.log("=".repeat(60));

    const finalResult = evaluateConfig(bestConfig);
    console.log(`\n📋 FINAL RESULT:`);
    console.log(`Overall Median: ${finalResult.median.toFixed(3)}%`);
    console.log(`Model 3 Median: ${finalResult.model3Median.toFixed(3)}%`);
    console.log(`Model Y Median: ${finalResult.modelYMedian.toFixed(3)}%`);

    console.log(`\n📋 BEST CONFIG:`);
    console.log(JSON.stringify(bestConfig, null, 2));

    const improvement = baselineResult.median - bestScore;
    console.log(`\n✨ Improvement over v2: -${improvement.toFixed(3)}% points`);

    // Compare model-specific parameters
    console.log("\n📊 Model-Specific Insights:");
    console.log(`  Model 3 Age Penalty: ${bestConfig.model3.agePenalty.toFixed(2)} pts/month`);
    console.log(`  Model Y Age Penalty: ${bestConfig.modelY.agePenalty.toFixed(2)} pts/month`);
    console.log(`  Model 3 Mileage Depreciation: €${(bestConfig.model3.mileageDepreciation * 10000).toFixed(0)}/10k km`);
    console.log(`  Model Y Mileage Depreciation: €${(bestConfig.modelY.mileageDepreciation * 10000).toFixed(0)}/10k km`);
}

main();
