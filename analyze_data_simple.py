import csv
from collections import defaultdict
from statistics import mean

file_path = 'tesla_data_with_highland_flag.csv'

def safe_float(value):
    try:
        if not value or value.strip() == '':
            return 0.0
        return float(value)
    except ValueError:
        return 0.0

def safe_int(value):
    try:
        if not value or value.strip() == '':
            return 0
        return int(value)
    except ValueError:
        return 0

print("--- Analysis Report ---")

rows = []
with open(file_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)

total_cars = len(rows)
print(f"Total cars: {total_cars}")

# 1. Powertrain Groups
# Key: (Model, Power KW, Drive Type, Battery Netto)
powertrain_stats = defaultdict(list)

for row in rows:
    key = (
        row['model'], 
        row['powe_kw'], 
        row['drive_type'], 
        row['battery_netto']
    )
    price = safe_float(row['highest_bid_price'])
    # Only count valid prices
    if price > 1000: 
        powertrain_stats[key].append(price)

print("\n--- Powertrain Combinations (Top 10 by volume) ---")
# Sort by count
sorted_powertrains = sorted(powertrain_stats.items(), key=lambda x: len(x[1]), reverse=True)

print(f"{'Model':<10} | {'kW':<5} | {'Drive':<5} | {'Bat':<5} | {'Count':<5} | {'Avg Price':<10} | {'Min':<8} | {'Max':<8}")
print("-" * 80)
for key, prices in sorted_powertrains[:15]:
    model, kw, drive, bat = key
    avg_price = mean(prices)
    print(f"{model:<10} | {kw:<5} | {drive:<5} | {bat:<5} | {len(prices):<5} | {avg_price:<10.1f} | {min(prices):<8.1f} | {max(prices):<8.1f}")


# 2. Winter Tires Analysis
# Simple split
spring_prices = []
winter_prices = []

for row in rows:
    price = safe_float(row['highest_bid_price'])
    if price < 1000: continue
    
    winter = row.get('tires_winter', '0')
    if winter == '1':
        winter_prices.append(price)
    else:
        spring_prices.append(price)

print("\n--- Winter Tires Impact (Raw) ---")
if spring_prices: print(f"No Winter Tires: {len(spring_prices)} cars, Avg: {mean(spring_prices):.1f}")
if winter_prices: print(f"With Winter Tires: {len(winter_prices)} cars, Avg: {mean(winter_prices):.1f}")

# 3. Controlled Winter Tires Analysis (Model 3 & Y separately)
print("\n--- Winter Tires Impact (By Model) ---")
for model_name in ['Model 3', 'Model Y']:
    m_winter = []
    m_no_winter = []
    for row in rows:
        if row['model'] != model_name: continue
        price = safe_float(row['highest_bid_price'])
        if price < 1000: continue
        
        if row.get('tires_winter', '0') == '1':
            m_winter.append(price)
        else:
            m_no_winter.append(price)
            
    print(f"{model_name}:")
    if m_no_winter: print(f"  No Winter: {mean(m_no_winter):.1f} (n={len(m_no_winter)})")
    if m_winter:    print(f"  Winter:    {mean(m_winter):.1f} (n={len(m_winter)})")

# 4. Highland Analysis
print("\n--- Highland Analysis (Model 3 only) ---")
highland_prices = []
pre_highland_prices = []

for row in rows:
    if row['model'] == 'Model 3':
        price = safe_float(row['highest_bid_price'])
        if price < 1000: continue
        
        is_highland = row.get('is_highland', '').upper()
        if is_highland == 'TRUE':
            highland_prices.append(price)
        else:
            pre_highland_prices.append(price)

if pre_highland_prices: print(f"Pre-Highland: {mean(pre_highland_prices):.1f} (n={len(pre_highland_prices)})")
if highland_prices:     print(f"Highland:     {mean(highland_prices):.1f} (n={len(highland_prices)})")
