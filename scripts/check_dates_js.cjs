
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/data/tesla_data.json', 'utf8'));

const dates = data
    .map(r => r.auction_end_date)
    .filter(d => d)
    .sort();

console.log("Total records:", data.length);
console.log("Earliest auction:", dates[0]);
console.log("Latest auction:", dates[dates.length - 1]);

// Count recent
const cutoff = "2024-11-01";
const recent = dates.filter(d => d >= cutoff).length;
console.log(`Auctions on/after ${cutoff}:`, recent);
