import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
// Add IDs
const teslaData = JSON.parse(rawData).map((c, i) => ({ ...c, id: String(i) }));

// Filter for a specific homogeneous cluster to isolate mileage impact
// Model 3 Long Range, 2022, Accident Free, 40k-120k km range
const cluster = teslaData.filter(c => {
    const variant = getPowertrainCluster({ ...c, kw: c.powe_kw, battery_capacity: c.battery_netto });
    const year = c.first_registration.substring(0, 4);
    return c.model === "Model 3" &&
        variant === "m3_lr" &&
        year === "2022" &&
        c.accident_free_cardentity === "t";
});

console.log(`Analyzing Mileage Slope for Model 3 LR (2022, Clean Title). N=${cluster.length}`);

if (cluster.length < 10) {
    console.log("Not enough data.");
    process.exit(0);
}

// Simple Linear Regression: Price = Intercept + Slope * Mileage
const x = cluster.map(c => Number(c.mileage));
const y = cluster.map(c => Number(c.highest_bid_price));

const n = x.length;
const sumX = x.reduce((a, b) => a + b, 0);
const sumY = y.reduce((a, b) => a + b, 0);
const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
const sumXX = x.reduce((a, b) => a + b * b, 0);

const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
const intercept = (sumY - slope * sumX) / n;

console.log(`Slope (EUR per km): ${slope.toFixed(4)}`);
console.log(`Depreciation per 10,000 km: ${(slope * 10000).toFixed(2)} EUR`);
console.log(`Intercept (Zero Mileage Price): ${intercept.toFixed(2)} EUR`);

// Let's try another cluster: Model Y LR 2022
const clusterY = teslaData.filter(c => {
    const variant = getPowertrainCluster({ ...c, kw: c.powe_kw, battery_capacity: c.battery_netto });
    const year = c.first_registration.substring(0, 4);
    return c.model === "Model Y" &&
        variant === "my_lr" &&
        year === "2022" &&
        c.accident_free_cardentity === "t";
});

if (clusterY.length > 10) {
    const x2 = clusterY.map(c => Number(c.mileage));
    const y2 = clusterY.map(c => Number(c.highest_bid_price));
    const n2 = x2.length;
    const sumX2 = x2.reduce((a, b) => a + b, 0);
    const sumY2 = y2.reduce((a, b) => a + b, 0);
    const sumXY2 = x2.reduce((a, b, i) => a + b * y2[i], 0);
    const sumXX2 = x2.reduce((a, b) => a + b * b, 0);

    const slope2 = (n2 * sumXY2 - sumX2 * sumY2) / (n2 * sumXX2 - sumX2 * sumX2);
    console.log(`\nModel Y LR 2022 (N=${clusterY.length})`);
    console.log(`Slope (EUR per km): ${slope2.toFixed(4)}`);
    console.log(`Depreciation per 10,000 km: ${(slope2 * 10000).toFixed(2)} EUR`);
}
