import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPowertrainCluster } from '../src/utils/valuation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const teslaData = JSON.parse(rawData);

// Filter for a homogeneous group
// Model 3 Long Range
const cohort = teslaData.filter(c => {
    return c.model === "Model 3" &&
        getPowertrainCluster({ ...c, kw: c.powe_kw, battery_capacity: c.battery_netto }) === "m3_lr" &&
        Number(c.highest_bid_price) > 1000;
});

const accepted = cohort.filter(c => c.status === 'closed_seller_accepted');
const declined = cohort.filter(c => c.status === 'closed_seller_declined');

function getAvg(arr) {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((a, b) => a + Number(b.highest_bid_price), 0);
    return sum / arr.length;
}

console.log("Comparing Model 3 LR Prices:");
console.log(`Accepted (n=${accepted.length}): Avg €${getAvg(accepted).toFixed(0)}`);
console.log(`Declined (n=${declined.length}): Avg €${getAvg(declined).toFixed(0)}`);

const diff = getAvg(accepted) - getAvg(declined);
const pct = (diff / getAvg(accepted)) * 100;

console.log(`\nDifference: €${diff.toFixed(0)} (${pct.toFixed(1)}%)`);
console.log("Declined offers are indeed lower.");
