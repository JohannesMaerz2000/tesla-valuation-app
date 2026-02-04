
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/data/tesla_data.json', 'utf8'));

console.log('Total:', data.length);
console.log('No End Date:', data.filter(r => !r.auction_end_date).length);
console.log('No Price:', data.filter(r => !r.highest_bid_price || r.highest_bid_price == 0).length);

// Analyze Price Distribution
const prices = data.map(r => r.highest_bid_price).filter(p => p > 0).sort((a, b) => a - b);
console.log('Valid Prices:', prices.length);
if (prices.length > 0) {
    console.log('Min Price:', prices[0]);
    console.log('Max Price:', prices[prices.length - 1]);
    console.log('Median Price:', prices[Math.floor(prices.length / 2)]);
}
