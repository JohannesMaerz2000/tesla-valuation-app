import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const teslaData = JSON.parse(rawData);

const counts = {};
teslaData.forEach(car => {
    counts[car.status] = (counts[car.status] || 0) + 1;
});

console.log("Total Cars:", teslaData.length);
console.log("Status Breakdown:");
console.table(counts);

const accepted = counts['closed_seller_accepted'] || 0;
const retainedPct = (accepted / teslaData.length) * 100;

console.log(`\nIf we filter for ONLY 'closed_seller_accepted':`);
console.log(`We retain ${accepted} cars.`);
console.log(`We lose ${teslaData.length - accepted} cars (${(100 - retainedPct).toFixed(1)}%).`);
