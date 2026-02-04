
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictPrice, getPowertrainCluster } from '../src/utils/valuation.js';
import { parseISO, isBefore, isEqual } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_PATH = path.join(__dirname, '../src/data/tesla_data.json');
const OUTPUT_FILE = path.join(__dirname, '../PRESENTATION.md');
const OUTPUT_CSV = path.join(__dirname, '../presentation_results.csv');

// Load Data
const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
const cars = JSON.parse(rawData);

// Sort by Auction Date (Newest First)
cars.sort((a, b) => {
    return new Date(b.auction_end_date) - new Date(a.auction_end_date);
});

// Take Top 20 valid auctions (price > 0) AND Exclude Cancelled/Errors
const testSet = cars.filter(c =>
    Number(c.highest_bid_price) > 0 &&
    (c.status === "closed_seller_accepted" || c.status === "closed_seller_declined")
).slice(0, 20);

// Helper to derive tire option from car data
function deriveTireInput(car) {
    const sets = parseInt(car.tires_total_sets) || 1;
    if (sets === 2) return "8_tires";
    if (car.tires_all_season === "1") return "4_all_season";
    if (car.tires_winter === "1") return "4_winter";
    return "4_summer";
}

const results = [];

console.log(`Processing top 20 recent auctions...`);

for (const targetCar of testSet) {
    const targetDate = parseISO(targetCar.auction_end_date);

    // Prepare Inputs
    const inputs = {
        model: targetCar.model,
        powertrainId: getPowertrainCluster({
            ...targetCar,
            kw: targetCar.powe_kw,
            battery_capacity: targetCar.battery_netto
        }),
        registrationDate: targetCar.first_registration,
        mileage: parseInt(targetCar.mileage),
        isNetPrice: targetCar.taxation === "vat_deductible",
        hasAhk: targetCar.features_trailer_hitch === "t" || targetCar.trailer_hitch_seller === "t",
        isAccidentFree: targetCar.accident_free_cardentity === "t",
        tireOption: deriveTireInput(targetCar),
        isHighland: targetCar.is_highland === "TRUE",
        valuationDate: targetDate
    };

    // Filter Historical Data
    // STRICT NO LEAKAGE: Only use data from BEFORE the target auction date
    // We remove isEqual to avoid same-day leakage if timestamps are missing
    const historicalData = cars.filter(c => {
        if (c.auction_id === targetCar.auction_id) return false;
        const cDate = parseISO(c.auction_end_date);
        return isBefore(cDate, targetDate);
    });

    // Run Prediction
    const prediction = predictPrice(inputs, historicalData);

    if (prediction.neighbors.length === 0) {
        console.log(`[DEBUG] No neighbors for IDs ${targetCar.auction_short_id || targetCar.auction_id} (${targetCar.auction_end_date})`);
        console.log(`  Inputs: Model=${inputs.model}, Variant=${inputs.powertrainId}, Highland=${inputs.isHighland}, Tax=${inputs.isNetPrice ? "VAT" : "Margin"}`);
        console.log(`  Historical Pool Size (Date Filter): ${historicalData.length}`);

        const sameModel = historicalData.filter(h => h.model === inputs.model);
        const sameCluster = sameModel.filter(h => {
            const cKw = h.powe_kw;
            const cBatt = h.battery_netto;
            const cluster = getPowertrainCluster({ ...h, kw: cKw, battery_capacity: cBatt });
            return cluster === inputs.powertrainId;
        });
        const sameHighland = sameCluster.filter(h => (h.is_highland === "TRUE") === inputs.isHighland);
        const sameTax = sameHighland.filter(h => (h.taxation === "vat_deductible") === inputs.isNetPrice);

        console.log(`  Filter Funnel: History(${historicalData.length}) -> Model(${sameModel.length}) -> Cluster(${sameCluster.length}) -> Highland(${sameHighland.length}) -> Tax(${sameTax.length})`);
    }

    const actualPrice = Number(targetCar.highest_bid_price);
    const estimatedValue = prediction.price;
    const delta = estimatedValue > 0 ? actualPrice - estimatedValue : 0;
    const deltaPercent = estimatedValue > 0 ? (delta / estimatedValue) * 100 : 0;

    results.push({
        car: targetCar,
        inputs,
        actualPrice,
        estimatedValue,
        delta,
        deltaPercent,
        neighborCount: prediction.neighbors.length
    });
}

// Generate Markdown
let mdContent = `# Tesla Valuation Algorithm - Recent Auctions Test

**Generated on:** ${new Date().toISOString().split('T')[0]}
**Dataset:** 20 Most Recent Valid Auctions (Price > 0) from \`tesla_data.json\`

**Methodology:** No Data Leakage. For each car, the algorithm only sees historical sales that occurred *on or before* its auction date.

## Algorithm Overview & Functionality

The valuation engine uses a **Weighted Nearest Neighbor (KNN)** approach, comparing the target vehicle against a historical database of sold auctions.

### 1. Hard Filtering (Cohort Selection)
The algorithm first creates a strict comparison pool by filtering for exact matches on:
*   **Model**: Model 3 vs. Model Y.
*   **Variant**: Cars are clustered by kW/Battery into strictly comparable groups (e.g., "Model 3 Long Range" vs "Model Y Performance").
*   **Generation**: "Highland" (Facelift) models are never compared to pre-Highland models.
*   **Taxation**:
    *   **VAT-Deductible (Net Price)** cars are *only* compared to other VAT-deductible cars.
    *   **Margin (Gross Price)** cars are *only* compared to other Margin cars.
    *   *Assumption*: The value to a dealer differs significantly based on VAT recoverability.

### 2. Similarity Scoring (The "Distance" Metric)
We calculate a "Distance Score" for every eligible car in the pool. Lower scores mean a better match.
*   **Recency**: Recent sales are prioritized (Penalty: 0.40 pts per day).
*   **Age**: We compare the *relative age* (age at time of sale).
    *   *Model Y* is assumed to age faster (11.9 pts/month) than *Model 3* (11.2 pts/month).
    *   A quadratic factor adds extra penalty for older cars (Model 3: 0.165, Model Y: 0.073).
*   **Mileage**: Score penalty based on km difference.
*   **Status**: Rejected offers ("closed_seller_declined") incur a massive penalty (148 pts), effectively prioritizing actual sales.
*   **Equipment Mismatches**:
    *   **Accidents**: 21 pt penalty for "Accident Free" mismatch.
    *   **Tires**: Asymmetric penalties (e.g., if the **Target Car** has 8 tires but the **Comparable** only had 4, we apply a significant penalty to avoid using that data point).

### 3. Price Normalization (Appraisal Logic)
Before averaging, we adjust the comparable's price to "normalize" it to the target car's specs:
*   **Trailer Hitch**: +/- €298 adjustment if excluding/including a hitch.
*   **Mileage Depreciation**: We adjust price based on the exact mileage difference.
    *   *Model 3*: ~€0.043 per km (€430 / 10k km).
    *   *Model Y*: ~€0.099 per km (€990 / 10k km) - indicates much steeper depreciation.

### 4. Final Valuation
*   We select the **Top 5** closest matches (lowest scores).
*   We calculate a **Weighted Average** of their normalized prices.
*   Weighting is exponential (\`1 / (Score + 1) ^ 1.98\`), meaning the very best matches dominate the result.

## Recent Auction Results
| Date | Model | Variant | Year | km | Status | Actual Bid | Valuation | Delta (€) | Delta (%) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
`;

// CSV Header
let csvContent = "Date,Model,Variant,Year,Mileage,Status,ActualBid,Valuation,Delta,DeltaPercent,Inputs,NeighborsFound\n";

results.forEach(r => {
    // Format Date: "Feb 6, 2026"
    const d = parseISO(r.car.auction_end_date);
    const dateStr = d.toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
    const year = r.car.first_registration.substring(0, 4);
    const variantShort = r.inputs.powertrainId;

    // Format Status
    let statusIcon = "";
    let statusText = r.car.status.replace("closed_", "").replace(/_/g, " "); // fallback
    if (r.car.status === "closed_seller_accepted") { statusText = "Accepted"; statusIcon = "✅"; }
    if (r.car.status === "closed_seller_declined") { statusText = "Declined"; statusIcon = "❌"; }
    if (r.car.status.includes("open")) { statusText = "Pending"; statusIcon = "⏳"; }

    const statusDisplay = `${statusText} ${statusIcon}`;

    // Formatting currency
    const fmt = (num) => `€${Math.round(num).toLocaleString('de-DE')}`;
    const deltaSign = r.delta > 0 ? "+" : "";

    let deltaColor = "⚪️";
    if (r.estimatedValue > 0) {
        if (Math.abs(r.deltaPercent) < 5) deltaColor = "🟢";
        else if (Math.abs(r.deltaPercent) < 10) deltaColor = "🟡";
        else deltaColor = "🔴";
    }

    const valuationDisplay = r.estimatedValue > 0 ? fmt(r.estimatedValue) : "N/A (Insufficient Data)";
    const deltaDisplay = r.estimatedValue > 0 ? `${deltaSign}${fmt(r.delta)}` : "-";
    const percentDisplay = r.estimatedValue > 0 ? `${deltaColor} ${deltaSign}${r.deltaPercent.toFixed(2)}%` : "-";

    const row = `| ${dateStr} | ${r.inputs.model} | ${variantShort} | ${year} | ${r.inputs.mileage.toLocaleString()} | ${statusDisplay} | **${fmt(r.actualPrice)}** | ${valuationDisplay} | ${deltaDisplay} | ${percentDisplay} |`;

    mdContent += row + "\n";

    // CSV
    const csvRow = [
        dateStr,
        r.inputs.model,
        variantShort,
        year,
        r.inputs.mileage,
        statusText,
        r.actualPrice,
        r.estimatedValue.toFixed(2),
        r.delta.toFixed(2),
        r.deltaPercent.toFixed(2),
        `"${JSON.stringify(r.inputs).replace(/"/g, '""')}"`,
        r.neighborCount
    ].join(",");
    csvContent += csvRow + "\n";
});

// Stats
const validResults = results.filter(r => r.estimatedValue > 0);
const errors = validResults.map(r => Math.abs(r.deltaPercent));
const medianError = errors.length > 0 ? errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)] : 0;
const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
const coverage = (validResults.length / results.length) * 100;

mdContent += `
## Summary Statistics (Recent 20)
*   **Coverage**: ${validResults.length}/${results.length} (${coverage.toFixed(0)}%)
*   **Median Absolute Error**: ${medianError.toFixed(2)}%
*   **Mean Absolute Error**: ${meanError.toFixed(2)}%
`;

fs.writeFileSync(OUTPUT_FILE, mdContent);
fs.writeFileSync(OUTPUT_CSV, csvContent);

console.log(`Done. Results saved to ${OUTPUT_FILE} and ${OUTPUT_CSV}`);
console.log(`Median Error of this batch: ${medianError.toFixed(2)}%`);
