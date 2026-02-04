import csv
import json
from collections import defaultdict
from statistics import mean, median

file_path = 'tesla_data_with_highland_flag.csv'

def safe_float(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0

def safe_int(value):
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return 0

rows = []
with open(file_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Filter out invalid prices/bids
        if safe_float(row.get('highest_bid_price')) > 1000:
            rows.append(row)

# --- 1. Powertrain Clustering ---
# Key: Model, kW, Drive, Battery (rounded)
clusters = defaultdict(list)

for row in rows:
    model = row['model']
    kw = safe_int(row['powe_kw'])
    drive = row['drive_type'].lower()
    
    # Normalize battery: 78.1 -> 78, 55.0 -> 55
    bat_raw = safe_float(row['battery_netto'])
    bat = int(round(bat_raw))
    
    # Logic to handle 'clean' clusters
    # We ignore entries with 0 data to keep clusters high quality
    if kw == 0 or bat == 0:
        continue

    # Create a unique key for the powertrain
    key = (model, kw, drive, bat)
    clusters[key].append(row)

print("--- Defined Powertrain Clusters ---")
cluster_data = []
for key, cluster_rows in clusters.items():
    model, kw, drive, bat = key
    prices = [safe_float(r['highest_bid_price']) for r in cluster_rows]
    
    # Identify common marketing names based on these specs for the user
    # This is a heuristic based on Tesla knowledge
    marketing_name = "Unknown"
    if model == 'Model 3':
        if bat < 65:
            marketing_name = "Standard Range / RWD"
        elif drive == 'awd':
            if kw > 350:
                marketing_name = "Performance"
            else:
                marketing_name = "Long Range"
    elif model == 'Model Y':
        if bat < 65:
            marketing_name = "Standard Range / RWD"
        elif drive == 'awd':
            if kw > 380:
                marketing_name = "Performance"
            else:
                marketing_name = "Long Range"

    data = {
        "model": model,
        "kw": kw,
        "drive": drive,
        "battery": bat,
        "count": len(cluster_rows),
        "avg_price": round(mean(prices)),
        "marketing_guess": marketing_name,
        "unique_variants": list(set([r['variant'] for r in cluster_rows]))[:3] # Sample variants
    }
    cluster_data.append(data)

# Sort by Model then Count
cluster_data.sort(key=lambda x: (x['model'], x['count']), reverse=True)

for c in cluster_data:
    if c['count'] > 5: # Only show significant clusters
        print(f"{c['model']} {c['marketing_guess']} | {c['kw']}kW {c['drive']} {c['battery']}kWh | n={c['count']} | Avg: €{c['avg_price']}")


# --- 2. Taxation Analysis ---
# VAT Deductible vs Marginally Taxed
print("\n--- Taxation Impact ---")
tax_stats = defaultdict(list)
for row in rows:
    tax = row.get('taxation', 'unknown')
    price = safe_float(row['highest_bid_price'])
    tax_stats[tax].append(price)

for tax, prices in tax_stats.items():
    print(f"{tax}: Avg €{mean(prices):.0f} (n={len(prices)})")
    
# Control for model to get a "Premium %"
# We compare Model Y LR AWD (vat vs margin) as a benchmark
control_prices = defaultdict(list)
for row in rows:
    if row['model'] == 'Model Y' and row['drive_type'] == 'awd' and safe_int(row['powe_kw']) == 378:
         tax = row.get('taxation')
         if tax in ['vat_deductible', 'marginally_taxed']:
             control_prices[tax].append(safe_float(row['highest_bid_price']))

if control_prices['vat_deductible'] and control_prices['marginally_taxed']:
    vat_avg = mean(control_prices['vat_deductible'])
    margin_avg = mean(control_prices['marginally_taxed'])
    diff_pct = ((vat_avg - margin_avg) / margin_avg) * 100
    print(f"Controlled Comparison (Model Y LR AWD 378kW): VAT cars sell for {diff_pct:.1f}% more than Margin cars.")


# --- 3. Tire Logic Analysis ---
# Categories: Summer Only, Winter Only, Both, All-Season
print("\n--- Tire Configuration Impact ---")
tire_groups = defaultdict(list)

for row in rows:
    s = safe_int(row.get('tires_summer', '0'))
    w = safe_int(row.get('tires_winter', '0'))
    a = safe_int(row.get('tires_all_season', '0'))
    
    label = "Unknown"
    if a == 1:
        label = "All-Season"
    elif s == 1 and w == 1:
        label = "8 Tires (Summer+Winter)"
    elif s == 1 and w == 0:
        label = "Summer Only"
    elif s == 0 and w == 1:
        label = "Winter Only"
    
    price = safe_float(row['highest_bid_price'])
    tire_groups[label].append(price)

for label, prices in tire_groups.items():
    print(f"{label}: Avg €{mean(prices):.0f} (n={len(prices)})")
