
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceInMonths, differenceInDays, parseISO } from "date-fns";
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getTireOption(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

// Old methodology (your original)
function predictOldMethod(inputs, database, config, excludedId) {
    const { model, powertrainId, registrationDate, mileage, isNetPrice, hasAhk, isAccidentFree, isHighland, tireOption } = inputs;
    const targetDate = new Date(registrationDate);
    const now = new Date(); // USES TODAY

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
        if (tireOption === "8_tires" && carOption !== "8_tires") score += config.tireQuantityPenalty;
        else if (tireOption !== "8_tires" && carOption === "8_tires") score += config.tireQuantityPenalty;
        else if (tireOption !== "8_tires" && carOption !== "8_tires" && tireOption !== carOption) score += config.tireTypePenalty;

        if (car.status !== "closed_seller_accepted") score += 100;

        let price = Number(car.highest_bid_price);
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) price += 250;
        else if (!hasAhk && carHasAhk) price -= 250;
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

// New methodology (uses auction date as reference)
function predictNewMethod(inputs, database, config, excludedId) {
    const { model, powertrainId, registrationDate, mileage, isNetPrice, hasAhk, isAccidentFree, isHighland, tireOption, referenceDate } = inputs;
    const targetDate = new Date(registrationDate);
    const now = referenceDate; // USES AUCTION DATE

    const filtered = database.filter((car) => {
        if (car.auction_id === excludedId) return false;
        if (car.model !== model) return false;
        const cluster = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        if (cluster !== powertrainId) return false;
        if ((car.is_highland === "TRUE") !== isHighland) return false;
        if ((car.taxation === "vat_deductible") !== isNetPrice) return false;
        // Only use data from BEFORE the reference date
        const auctionDate = parseISO(car.auction_end_date);
        if (auctionDate > now) return false;
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
        if (tireOption === "8_tires" && carOption !== "8_tires") score += config.tireQuantityPenalty;
        else if (tireOption !== "8_tires" && carOption === "8_tires") score += config.tireQuantityPenalty;
        else if (tireOption !== "8_tires" && carOption !== "8_tires" && tireOption !== carOption) score += config.tireTypePenalty;

        if (car.status !== "closed_seller_accepted") score += 100;

        let price = Number(car.highest_bid_price);
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        if (hasAhk && !carHasAhk) price += 250;
        else if (!hasAhk && carHasAhk) price -= 250;
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
    console.log("🔬 Comparing Methodologies: Old vs New (Full Dataset)\n");

    const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
    const teslaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const validationSet = teslaData.filter(car => {
        const variant = getPowertrainCluster({ ...car, kw: car.powe_kw, battery_capacity: car.battery_netto });
        return variant && variant !== "unknown";
    });
    console.log(`Testing on ${validationSet.length} records (full dataset)\n`);

    // Current production config from valuation.js
    const currentConfig = {
        agePenalty: 7.5,
        recencyPenalty: 0.14,
        mileageDepreciation: 0.055,
        mileageDistancePenalty: 0.0045,
        neighborCount: 6,
        accidentPenalty: 30,
        tireQuantityPenalty: 30,
        tireTypePenalty: 5
    };

    // Best config from original optimizer run
    const optimizedConfig = {
        agePenalty: 7.934759678559873,
        recencyPenalty: 0.12195174870322063,
        mileageDepreciation: 0.05904145683208169,
        mileageDistancePenalty: 0.0037599329164365912,
        neighborCount: 7,
        accidentPenalty: 13.36995836161693,
        tireQuantityPenalty: 35.35856359525205,
        tireTypePenalty: 0.8323516445301393
    };

    function evaluate(config, useNewMethod) {
        let errors = [];
        let skipped = 0;

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
                tireOption: getTireOption(car),
                referenceDate: parseISO(car.auction_end_date)
            };

            const predicted = useNewMethod
                ? predictNewMethod(inputs, teslaData, config, car.auction_id)
                : predictOldMethod(inputs, teslaData, config, car.auction_id);

            const actual = Number(car.highest_bid_price);

            if (actual > 0 && predicted > 0) {
                const pct = Math.abs(predicted - actual) / actual * 100;
                errors.push(Math.min(pct, 100));
            } else {
                skipped++;
            }
        }

        errors.sort((a, b) => a - b);
        const median = errors[Math.floor(errors.length / 2)];
        const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
        return { median, mean, count: errors.length, skipped };
    }

    console.log("=== Testing Current valuation.js Config ===\n");

    const oldMethodCurrent = evaluate(currentConfig, false);
    console.log(`OLD method (now = today):`);
    console.log(`  Median: ${oldMethodCurrent.median.toFixed(3)}%, Mean: ${oldMethodCurrent.mean.toFixed(3)}%, N=${oldMethodCurrent.count}`);

    const newMethodCurrent = evaluate(currentConfig, true);
    console.log(`NEW method (now = auction date):`);
    console.log(`  Median: ${newMethodCurrent.median.toFixed(3)}%, Mean: ${newMethodCurrent.mean.toFixed(3)}%, N=${newMethodCurrent.count}, Skipped=${newMethodCurrent.skipped}`);

    console.log("\n=== Testing Best Config from Original Optimizer ===\n");

    const oldMethodOpt = evaluate(optimizedConfig, false);
    console.log(`OLD method (now = today):`);
    console.log(`  Median: ${oldMethodOpt.median.toFixed(3)}%, Mean: ${oldMethodOpt.mean.toFixed(3)}%, N=${oldMethodOpt.count}`);

    const newMethodOpt = evaluate(optimizedConfig, true);
    console.log(`NEW method (now = auction date):`);
    console.log(`  Median: ${newMethodOpt.median.toFixed(3)}%, Mean: ${newMethodOpt.mean.toFixed(3)}%, N=${newMethodOpt.count}, Skipped=${newMethodOpt.skipped}`);

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`
The OLD method shows lower error because it "cheats":
- When testing a car auctioned 6 months ago, it asks "what's this worth TODAY?"
- Then compares to the PAST price - but uses FUTURE data to find neighbors
- This is data leakage - it uses information that wasn't available at prediction time

The NEW method is honest:
- Only uses data from BEFORE the auction being tested
- Represents what accuracy you'd actually achieve in production
`);
}

main();
