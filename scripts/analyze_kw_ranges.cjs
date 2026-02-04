const fs = require('fs');
const path = require('path');


const csvPath = path.join(__dirname, '..', 'tesla_data_with_highland_flag.csv');

function getPowertrainCluster(model, kw, batt) {
    if (!kw || !batt) return null;

    // Model 3 Clusters
    if (model === "Model 3") {
        if (kw < 250 && batt < 65) return "m3_sr";
        if (kw >= 250 && kw < 350 && batt >= 70) return "m3_lr";
        if (kw >= 350 && batt >= 70) return "m3_p";
    }

    // Model Y Clusters
    if (model === "Model Y") {
        if (kw < 250 && batt < 65) return "my_sr";
        if (kw >= 300 && kw < 390 && batt >= 70) return "my_lr";
        if (kw >= 390 && batt >= 70) return "my_p";
    }

    return "unknown";
}

try {
    const data = fs.readFileSync(csvPath, 'utf8');
    const lines = data.split('\n');
    const headers = lines[0].split(',');

    // Simple CSV parser that handles quotes essentially enough for this task
    // Or just simple split if no commas in values... wait, "Model 3" etc are fine.
    // The description field has commas, so simple split won't work perfectly.
    // I'll use a regex to match CSV lines.

    const clusters = {
        "m3_sr": [],
        "m3_lr": [],
        "m3_p": [],
        "my_sr": [],
        "my_lr": [],
        "my_p": []
    };

    // Helper to determine cluster from variant string
    function getClusterFromVariant(model, variant) {
        const v = variant.toLowerCase();
        let trim = "";
        if (v.includes("standard") || v.includes("basis")) trim = "sr";
        else if (v.includes("long range")) trim = "lr";
        else if (v.includes("performance")) trim = "p";
        else return null;

        if (model === "Model 3") return `m3_${trim}`;
        if (model === "Model Y") return `my_${trim}`;
        return null;
    }

    // Helper to parse CSV line
    function parseCSVLine(str) {
        const result = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (c === '"') {
                inQuote = !inQuote;
            } else if (c === ',' && !inQuote) {
                result.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        result.push(cur);
        return result;
    }

    const modelIdx = headers.indexOf('model');
    const variantIdx = headers.indexOf('variant');
    const kwIdx = headers.indexOf('powe_kw');

    console.log(`Indices: Model=${modelIdx}, Variant=${variantIdx}, KW=${kwIdx}`);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCSVLine(line);
        if (cols.length < headers.length) continue;

        const model = cols[modelIdx];
        const variant = cols[variantIdx];
        const kw = parseFloat(cols[kwIdx]);

        if (isNaN(kw)) continue;

        const cluster = getClusterFromVariant(model, variant);
        if (cluster && clusters[cluster]) {
            clusters[cluster].push(kw);
        }
    }

    for (const [key, kws] of Object.entries(clusters)) {
        if (kws.length === 0) {
            console.log(`${key}: No data`);
            continue;
        }
        const min = Math.min(...kws);
        const max = Math.max(...kws);
        const uni = [...new Set(kws)].sort((a, b) => a - b);
        console.log(`${key}: Min ${min} - Max ${max} (Unique: ${uni.join(', ')})`);
    }

} catch (e) {
    console.error(e);
}
