import { differenceInMonths, differenceInDays, parseISO } from "date-fns";

export const POWERTRAIN_OPTIONS = {
    "Model 3": [
        { label: "Standard Range / RWD", kw: 208, kwDisplay: "208-239", battery: 60, id: "m3_sr" },
        { label: "Long Range / RWD", kw: 235, kwDisplay: "235", battery: 75, id: "m3_lr_rwd", onlyHighland: true }, // Highland Special
        { label: "Long Range / AWD", kw: 366, kwDisplay: "324-366", battery: 75, id: "m3_lr" }, // Adjusted avg
        { label: "Performance", kw: 393, kwDisplay: "377-460+", battery: 79, id: "m3_p" },
    ],
    "Model Y": [
        { label: "Standard Range / RWD", kw: 220, kwDisplay: "220-255", battery: 60, id: "my_sr" },
        { label: "Long Range / AWD", kw: 378, kwDisplay: "378", battery: 75, id: "my_lr" },
        { label: "Performance", kw: 393, kwDisplay: "390+", battery: 75, id: "my_p" },
    ],
};

// Tire types for matching
const TIRE_TYPES = ["Summer", "Winter", "All-Season"];

export function getPowertrainCluster(car) {
    // Simple clustering logic based on kW and Battery
    // This is a simplified version of the logic described in context
    const { kw, battery_capacity: batt } = car;

    if (!kw || !batt) return null;

    // Model 3 Clusters
    if (car.model === "Model 3") {
        const isHighland = car.is_highland === "TRUE";

        if (kw < 250 && batt < 65) return "m3_sr";

        // LR Logic
        if (batt >= 70) {
            // Performance (High kW)
            if (kw >= 370) return "m3_p";

            // Long Range AWD (Standard)
            if (kw >= 250) return "m3_lr";

            // Long Range RWD (Highland, ~235kW)
            // It has big battery (>=70) but lower kW (<250)
            if (kw >= 220 && kw < 250) return "m3_lr_rwd";
        }
    }

    // Model Y Clusters
    if (car.model === "Model Y") {
        if (kw < 250 && batt < 65) return "my_sr";
        if (kw >= 250 && kw < 390 && batt >= 70) return "my_lr";
        if (kw >= 390 && batt >= 70) return "my_p";
    }

    return "unknown";
}

// Optimization v8 (Feb 4, 2026) -> 3.93% Median Error
// Based on 2000-trial random search on full 792-record dataset
const VALUATION_CONFIG = {
    shared: {
        recencyPenalty: 0.40,      // Market timing became more critical
        accidentPenalty: 21,       // Reduced from 52 -> 21 (Market is forgiving?)
        tireUserWants8Penalty: 32, // Mismatch when user wants 8 tires
        tireUserWants4Penalty: 17, // Mismatch when user wants 4 tires
        tireTypePenalty: 18,       // Wrong tire type
        statusPenalty: 148,        // Significant penalty for rejected offers
        hitchValue: 298,           // Value of a trailer hitch
        neighborCount: 5,          // Lower count -> Focus on very top matches
        weightExponent: 1.98       // Flatter weighting than v7 (1.98 vs 3.5)
    },
    model3: {
        agePenalty: 11.2,          // Linear Age Penalty
        ageQuadratic: 0.165,       // Quadratic Age Penalty (Ages faster as it gets older)
        mileageDepreciation: 0.043,// €430 per 10k km
        mileageDistancePenalty: 0.0036 // Score penalty per km difference
    },
    modelY: {
        agePenalty: 11.9,          // Linear Age Penalty
        ageQuadratic: 0.073,       // Quadratic Age Penalty
        mileageDepreciation: 0.099,// €990 per 10k km (Huge depreciation!)
        mileageDistancePenalty: 0.0038 // Score penalty per km difference
    }
};

export function predictPrice(inputs, database) {
    const {
        model,
        powertrainId, // e.g. "m3_lr"
        registrationDate, // Date object or string
        mileage,
        isNetPrice, // true for VAT (Company), false for Margin (Private)
        hasAhk, // boolean
        isAccidentFree, // boolean
        tireOption, // "8_tires", "4_summer", etc.
        valuationDate = new Date(), // Default to now, but allow override for backtesting
    } = inputs;

    const targetDate = new Date(registrationDate);
    const now = new Date(valuationDate);

    // Select Model Config
    const modelConfig = (model === "Model 3") ? VALUATION_CONFIG.model3 : VALUATION_CONFIG.modelY;
    const shared = VALUATION_CONFIG.shared;

    // 1. Hard Filtering
    const filtered = database.filter((car) => {
        // Model Match
        if (car.model !== model) return false;

        // Powertrain Match (using cluster logic)
        // Map JSON fields: powe_kw, battery_netto
        const carKw = car.powe_kw;
        const carBatt = car.battery_netto;

        // Quick cluster check inline or update helper
        // update helper call:
        const cluster = getPowertrainCluster({ ...car, kw: carKw, battery_capacity: carBatt });
        if (cluster !== powertrainId) return false;

        // Highland Logic (Facelift 2024+)
        // Data: is_highland = "TRUE" or "FALSE"
        const carIsHighland = car.is_highland === "TRUE";

        // If the user selected Highland, we only show Highland cars.
        // If they didn't, we only show pre-Highland cars.
        // This is a strict separation as requested.
        if (inputs.isHighland !== carIsHighland) return false;

        // Taxation Match
        // Data: taxation = "vat_deductible" or "marginally_taxed"
        // Input: isNetPrice = true (Company/VAT) / false (Private/Margin)
        // We want: if isNetPrice (Company), we only look at vat_deductible cars.
        // If !isNetPrice (Private), we only look at marginally_taxed cars.
        const carIsVat = car.taxation === "vat_deductible";
        if (carIsVat !== isNetPrice) return false;

        // Price Validation
        // We must exclude cars with 0 or invalid price, otherwise they drag the average down to 0.
        if (!car.highest_bid_price || Number(car.highest_bid_price) <= 0) return false;

        return true;
    });

    // 2. Scoring (Distance Metric)
    const scored = filtered.map((car) => {
        let score = 0;
        const penalties = {};

        const carRegDate = parseISO(car.first_registration);
        const auctionDate = parseISO(car.auction_end_date);

        // Recency (Market Trend)
        const daysSinceAuction = Math.abs(differenceInDays(now, auctionDate));
        const recencyPenalty = daysSinceAuction * shared.recencyPenalty;
        score += recencyPenalty;

        // Age (Relative Age) with Quadratic Term
        // We compare the age of the target car today vs the age of the comparable at its sale.
        const ageTarget = Math.abs(differenceInMonths(now, targetDate));
        const ageComp = Math.abs(differenceInMonths(auctionDate, carRegDate));
        const monthsDiff = Math.abs(ageTarget - ageComp);

        let agePenalty = monthsDiff * modelConfig.agePenalty;
        agePenalty += (monthsDiff * monthsDiff) * modelConfig.ageQuadratic; // Non-linear
        score += agePenalty;

        // Mileage Sensitivity
        const kmDiff = Math.abs(mileage - car.mileage);
        const mileagePenalty = kmDiff * modelConfig.mileageDistancePenalty;
        score += mileagePenalty;

        // Attributes (Soft Penalties)

        // Accident History
        // Data: accident_free_cardentity = "t" or "f"
        const carIsAccidentFree = car.accident_free_cardentity === "t";
        if (isAccidentFree !== carIsAccidentFree) {
            score += shared.accidentPenalty;
            penalties.accident = shared.accidentPenalty;
        }

        // Trailer Hitch (AHK)
        // Data: features_trailer_hitch = "t" OR trailer_hitch_seller = "t"
        const carHasAhk = car.features_trailer_hitch === "t" || car.trailer_hitch_seller === "t";
        // Penalty removed in favor of price adjustment (Appraisal Method)

        // Tires
        // Data: tires_total_sets ("1" or "2"), tires_summer ("1"), tires_winter ("1"), tires_all_season ("1")
        const sets = parseInt(car.tires_total_sets) || 1;
        let carOption = "4_summer"; // Default

        if (sets === 2) {
            carOption = "8_tires"; // We assume 8 tires works for Summer/Winter combos
        } else {
            // It is 4 tires. Check type.
            // Some cars have multiple flags, but usually 1 set implies one primary type.
            if (car.tires_all_season === "1") carOption = "4_all_season";
            else if (car.tires_winter === "1") carOption = "4_winter";
            else carOption = "4_summer";
        }

        // Display Helper
        const displayMap = {
            "8_tires": "8 Tires",
            "4_summer": "Summer",
            "4_winter": "Winter",
            "4_all_season": "All-Season"
        };
        let tireMatchLabel = displayMap[carOption];

        // Tire Logic
        if (tireOption === "8_tires") {
            if (carOption !== "8_tires") {
                score += shared.tireUserWants8Penalty;
                penalties.tire = shared.tireUserWants8Penalty;
                tireMatchLabel = `Mismatch: Requested 8 Tires vs Car has ${displayMap[carOption]}`;
            }
        } else {
            // User wants single set (4 tires)
            if (carOption === "8_tires") {
                score += shared.tireUserWants4Penalty;
                penalties.tire = shared.tireUserWants4Penalty;
                tireMatchLabel = `Mismatch: Requested 4 Tires vs Car has 8 Tires`;
            } else {
                // Both are single sets. Check type.
                if (tireOption !== carOption) {
                    score += shared.tireTypePenalty;
                    penalties.tire = shared.tireTypePenalty;
                    tireMatchLabel = `Mismatch: ${displayMap[tireOption]} vs ${displayMap[carOption]}`;
                }
            }
        }

        // Status Penalty
        if (car.status !== "closed_seller_accepted") {
            score += shared.statusPenalty;
            penalties.status = shared.statusPenalty;
        }

        // Price Adjustment Logic (Appraisal Method)
        let price = Number(car.highest_bid_price);
        let adjustment = 0;
        let hitchAdjMsg = null;
        let mileageAdjMsg = null;

        // 1. Trailer Hitch
        if (hasAhk && !carHasAhk) {
            adjustment += shared.hitchValue;
            hitchAdjMsg = `+€${shared.hitchValue} (Missing Hitch)`;
        } else if (!hasAhk && carHasAhk) {
            adjustment -= shared.hitchValue;
            hitchAdjMsg = `-€${shared.hitchValue} (Has Hitch)`;
        }

        // 2. Mileage Adjustment (Depreciation)
        // Model Specific Rate
        const mileageAdj = (car.mileage - mileage) * modelConfig.mileageDepreciation;

        if (Math.abs(mileageAdj) > 50) {
            adjustment += mileageAdj;
            const sign = mileageAdj > 0 ? "+" : "-";
            mileageAdjMsg = `${sign}€${Math.abs(mileageAdj).toFixed(0)}`;
        }

        // Combined for header convenience (shows if ANY adjustment exists)
        let adjustmentReason = [hitchAdjMsg, mileageAdjMsg].filter(Boolean).join(", ");

        const adjustedPrice = price + adjustment;

        return {
            ...car,
            score,
            price, // Original price
            adjustedPrice, // Price used for calculation
            adjustmentReason,
            hitchAdjMsg,
            mileageAdjMsg,
            penalties,
            matchDetails: {
                tireMatchLabel,
                recencyPenalty,
                agePenalty,
                mileagePenalty,
                diffMileage: car.mileage - mileage, // Positive: Car has more miles
                diffAgeMonths: ageTarget - ageComp, // Positive: Comparable was older at sale than target is now
                ageTarget,
                ageComp
            }
        };
    });
    // 3. Prediction & Outlier Removal (Consensus Filter)
    scored.sort((a, b) => a.score - b.score);

    // Dynamic Outlier Logic:
    // Instead of taking the top N blindly, we look at a larger pool (e.g., 3x N).
    // We calculate the MEDIAN price of this pool to establish "Market Consensus".
    // We reject any car that deviates significantly (>20-25%) from this consensus.
    // This handles "lowball rejected bids" or "salvage titles" dynamically.

    const poolSize = shared.neighborCount * 3; // Look at top 15-20 cars
    const candidates = scored.slice(0, poolSize);

    if (candidates.length >= 3) {
        // Calculate Median Adjusted Price of the candidate pool
        // We use adjustedPrice (normalized for mileage/hitch) for fair comparison
        const prices = candidates.map(c => c.adjustedPrice).sort((a, b) => a - b);
        const medianPrice = prices[Math.floor(prices.length / 2)];

        // Filter outliers
        const outlierThreshold = 0.25; // 25% deviation allowed
        const validCandidates = candidates.filter(c => {
            const deviation = Math.abs(c.adjustedPrice - medianPrice) / medianPrice;
            const isOutlier = deviation > outlierThreshold;

            if (isOutlier) {
                // Mark as outlier for debugging/UI if needed (though we exclude them from calc)
                c.isOutlier = true;
                c.outlierReason = `Deviated ${(deviation * 100).toFixed(1)}% from median (€${medianPrice.toFixed(0)})`;
                return false;
            }
            return true;
        });

        // If we filtered too aggressively and have few cars left, currently we just use what we have.
        // But if we have at least 'neighborCount' survivors, we use them.
        // If validCandidates is empty (rare), we might fall back to original candidates to avoid 0 price.
        if (validCandidates.length > 0) {
            // Re-slice to get the original desired count from the CLEANED list
            // Note: validCandidates are still sorted by score implicitly? 
            // - No, we sorted 'candidates' by score initially, but the filter preserves order in JS.
            // So validCandidates[0] is still the best scoring non-outlier.

            // We overwrite the generic 'neighbors' array selection with our cleaned list
            // However, we need to assign it to a variable we use below.
            // Let's modify the flow to use a let variable or just direct slice.

            var neighbors = validCandidates.slice(0, shared.neighborCount);
        } else {
            // Fallback: If EVERYTHING is an outlier (cluster is crazy), use closest matches
            var neighbors = candidates.slice(0, shared.neighborCount);
        }
    } else {
        // Not enough data for stats, just use top N
        var neighbors = scored.slice(0, shared.neighborCount);
    }

    if (neighbors.length === 0) return { price: 0, neighbors: [] };

    let totalWeight = 0;
    let weightedSum = 0;

    neighbors.forEach(n => {
        const weight = 1 / Math.pow((n.score + 1), shared.weightExponent);
        weightedSum += n.adjustedPrice * weight; // Use Adjusted Price
        totalWeight += weight;
        n.weight = weight; // for display
    });

    // Add influence percentage
    neighbors.forEach(n => {
        n.influence = totalWeight > 0 ? (n.weight / totalWeight) : 0;
    });

    const predictedPrice = weightedSum / totalWeight;

    return {
        price: predictedPrice,
        neighbors
    };
}
