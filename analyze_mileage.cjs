
const fs = require('fs');
const path = require('path');

const dataPath = path.join(process.cwd(), 'src/data/tesla_data.json');
const rawData = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(rawData);

function analyzeModel(modelName, items) {
    console.log(`\n--- Analysis for ${modelName} ---`);

    // Filter valid data
    const points = items.filter(item =>
        item.highest_bid_price > 5000 &&
        item.mileage > 1000 &&
        !item.is_highland // Exclude Highland as it's too new/different price point
    ).map(item => ({
        price: item.highest_bid_price,
        mileage: item.mileage,
        logPrice: Math.log(item.highest_bid_price)
    }));

    if (points.length < 10) {
        console.log("Not enough data points.");
        return;
    }

    // Linear Regression on Price vs Mileage (Linear Decay)
    // y = mx + b
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = points.length;

    points.forEach(p => {
        sumX += p.mileage;
        sumY += p.price;
        sumXY += p.mileage * p.price;
        sumXX += p.mileage * p.mileage;
    });

    const slopeLinear = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const interceptLinear = (sumY - slopeLinear * sumX) / n;

    console.log(`Linear Regression: Price = ${slopeLinear.toFixed(4)} * Mileage + ${interceptLinear.toFixed(0)}`);
    console.log(`-> Linear Loss per 1,000 km: €${(slopeLinear * 1000).toFixed(2)}`);

    // Log-Linear Regression (Percentage Decay)
    // ln(y) = mx + b
    let sumLogY = 0, sumXLogY = 0;
    points.forEach(p => {
        sumLogY += p.logPrice;
        sumXLogY += p.mileage * p.logPrice;
    });

    const slopeLog = (n * sumXLogY - sumX * sumLogY) / (n * sumXX - sumX * sumX);
    // const interceptLog = (sumLogY - slopeLog * sumX) / n;

    const percentPer1000km = (1 - Math.exp(slopeLog * 1000)) * 100;

    console.log(`Log-Linear Regression (Exponential Decay)`);
    console.log(`-> Coefficient (slope of ln(price)): ${slopeLog.toExponential(4)}`);
    console.log(`-> Percentage Loss per 1,000 km: ${percentPer1000km.toFixed(3)}%`);

    return {
        linearSlope: slopeLinear,
        percentDecay: percentPer1000km
    };
}

const model3Items = data.filter(d => d.model === 'Model 3');
const modelYItems = data.filter(d => d.model === 'Model Y');

analyzeModel('Model 3', model3Items);
analyzeModel('Model Y', modelYItems);
