import { differenceInMonths, differenceInDays, parseISO } from "date-fns";

export const POWERTRAIN_OPTIONS = {
    "Model 3": [
        { label: "Standard Range / RWD", kw: 208, battery: 60, id: "m3_sr" },
        { label: "Long Range / AWD", kw: 366, battery: 75, id: "m3_lr" }, // Adjusted avg
        { label: "Performance", kw: 393, battery: 79, id: "m3_p" },
    ],
    "Model Y": [
        { label: "Standard Range / RWD", kw: 220, battery: 60, id: "my_sr" },
        { label: "Long Range / AWD", kw: 378, battery: 75, id: "my_lr" },
        { label: "Performance", kw: 393, battery: 75, id: "my_p" },
    ],
};

// Tire types for matching
const TIRE_TYPES = ["Summer", "Winter", "All-Season"];

function getPowertrainCluster(car) {
    // Simple clustering logic based on kW and Battery
    // This is a simplified version of the logic described in context
    const { kw, battery_capacity: batt } = car;

    if (!kw || !batt) return null;

    // Model 3 Clusters
    if (car.model === "Model 3") {
        if (kw < 250 && batt < 65) return "m3_sr";
        if (kw >= 250 && kw < 350 && batt >= 70) return "m3_lr";
        if (kw >= 350 && batt >= 70) return "m3_p";
    }

    // Model Y Clusters
    if (car.model === "Model Y") {
        if (kw < 250 && batt < 65) return "my_sr";
        if (kw >= 300 && kw < 390 && batt >= 70) return "my_lr";
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
        tireCount, // 4 or 8
        tireType, // "Summer", "Winter", etc.
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
        const carRegDate = parseISO(car.first_registration);
        const isHighland = carRegDate.getFullYear() >= 2024 || (carRegDate.getFullYear() === 2023 && carRegDate.getMonth() >= 9);
        const inputIsHighland = targetDate.getFullYear() >= 2024 || (targetDate.getFullYear() === 2023 && targetDate.getMonth() >= 9);

        if (isHighland !== inputIsHighland) return false;

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
        if (hasAhk !== carHasAhk) {
            score += 5;
            penalties.ahk = 5;
        }

        // Tires
        // Qty Mismatch (8 vs 4)
        // Data: tires_total_sets = "1" or "2"
        const sets = parseInt(car.tires_total_sets) || 1;
        const carTireCount = sets * 4;
        // Input tireCount is 4 or 8
        if (tireCount !== carTireCount) {
            score += 15;
            penalties.tireQty = 15;
        }

        // Type Mismatch
        // Data: tires_summer="1", tires_winter="1", tires_all_season="1"
        // If tireCount is 4, we check the type of that set.
        // If tireCount is 8, usually "Summer" + "Winter".
        // Let's assume input `tireType` is the primary set user has/wants.
        // If car has that type, good.
        // Context says: "Tire Status (8 Tires, Summer, Winter, All-Season) as a matching criterion... 5 points Type mismatch"
        // Let's simplify:
        let carType = "Summer"; // Default
        if (car.tires_all_season === "1") carType = "All-Season";
        else if (car.tires_winter === "1" && sets === 1) carType = "Winter";
        // If sets=2, it's usually Summer+Winter, but let's assume "8 Tires" handles the count penalty, and type might likely be Summer primarily.

        if (tireType && carType !== tireType) {
            // Only apply type penalty if counts matched? Or always?
            // Context: "5 points (Type mismatch)".
            score += 5;
            penalties.tireType = 5;
        }

        return {
            ...car,
            score,
            price: car.highest_bid_price, // The mapped price
            penalties,
            matchDetails: {
                recencyPenalty,
                agePenalty,
                mileagePenalty
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
        weightedSum += n.price * weight;
        totalWeight += weight;
        n.weight = weight; // for display
    });

    const predictedPrice = weightedSum / totalWeight;

    return {
        price: predictedPrice,
        neighbors
    };
}
