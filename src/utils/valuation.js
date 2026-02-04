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
    } = inputs;

    const targetDate = new Date(registrationDate);
    const now = new Date();

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

        return true;
    });

    // 2. Scoring (Distance Metric)
    const scored = filtered.map((car) => {
        let score = 0;
        const penalties = {};

        const carRegDate = parseISO(car.first_registration);
        const auctionDate = parseISO(car.auction_end_date);

        // Recency: 0.1 per day since auction
        const daysSinceAuction = Math.abs(differenceInDays(now, auctionDate));
        const recencyPenalty = daysSinceAuction * 0.1;
        score += recencyPenalty;

        // Age: 3.5 per month difference
        const monthsDiff = Math.abs(differenceInMonths(targetDate, carRegDate));
        const agePenalty = monthsDiff * 3.5;
        score += agePenalty;

        // Mileage: 1 per 1000km diff -> 0.001 per km
        const kmDiff = Math.abs(mileage - car.mileage);
        const mileagePenalty = kmDiff * 0.001;
        score += mileagePenalty;

        // Attributes (Soft Penalties)

        // Accident History
        // Data: accident_free_cardentity = "t" or "f"
        const carIsAccidentFree = car.accident_free_cardentity === "t";
        if (isAccidentFree !== carIsAccidentFree) {
            score += 20;
            penalties.accident = 20;
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

        // Logic:
        // if tireOption is 8_tires:
        //    if carOption is 8_tires -> match (0)
        //    else -> mismatch amount (20)
        // else (user wants 4 tires):
        //    if carOption is 8_tires -> mismatch amount (20)
        //    else (both 4 tires):
        //       if type match -> 0
        //       else -> mismatch type (5)

        // Helper map for display
        const displayMap = {
            "8_tires": "8 Tires",
            "4_summer": "Summer",
            "4_winter": "Winter",
            "4_all_season": "All-Season"
        };

        let tireMatchLabel = displayMap[carOption]; // Default to showing what the car has

        if (tireOption === "8_tires") {
            if (carOption !== "8_tires") {
                score += 20;
                penalties.tire = 20;
                tireMatchLabel = `Mismatch: Requested 8 Tires vs Car has ${displayMap[carOption]}`;
            }
        } else {
            // User wants single set (4 tires)
            if (carOption === "8_tires") {
                score += 20;
                penalties.tire = 20;
                tireMatchLabel = `Mismatch: Requested 4 Tires vs Car has 8 Tires`;
            } else {
                // Both are single sets. Check type.
                if (tireOption !== carOption) {
                    score += 5;
                    penalties.tire = 5;
                    tireMatchLabel = `Mismatch: ${displayMap[tireOption]} vs ${displayMap[carOption]}`;
                }
            }
        }

        // Status Penalty
        if (car.status !== "closed_seller_accepted") {
            score += 100;
            penalties.status = 100;
        }

        // Price Adjustment Logic (Appraisal Method)
        let price = Number(car.highest_bid_price);
        let adjustment = 0;
        let hitchAdjMsg = null;
        let mileageAdjMsg = null;

        // 1. Trailer Hitch
        if (hasAhk && !carHasAhk) {
            adjustment += 250;
            hitchAdjMsg = "+€250 (Missing Hitch)";
        } else if (!hasAhk && carHasAhk) {
            adjustment -= 250;
            hitchAdjMsg = "-€250 (Has Hitch)";
        }

        // 2. Mileage Adjustment (Depreciation)
        const mileageDiff = car.mileage - mileage;
        const mileageAdj = mileageDiff * 0.06;

        if (Math.abs(mileageAdj) > 50) {
            adjustment += mileageAdj;
            const sign = mileageAdj > 0 ? "+" : "-";
            // e.g. "+€3000"
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
                diffMonths: differenceInMonths(carRegDate, targetDate) // Positive: Car is newer
            }
        };
    });
    // 3. Prediction
    // Top 4 neighbors
    scored.sort((a, b) => a.score - b.score);
    const neighbors = scored.slice(0, 4);

    if (neighbors.length === 0) return { price: 0, neighbors: [] };

    let totalWeight = 0;
    let weightedSum = 0;

    neighbors.forEach(n => {
        const weight = 1 / (n.score + 1);
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
