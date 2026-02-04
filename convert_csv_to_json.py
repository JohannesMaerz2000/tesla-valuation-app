import csv
import json

csv_path = 'tesla_data_with_highland_flag.csv'
json_path = 'tesla_data.json'

data = []
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Clean numeric fields
        try:
            row['highest_bid_price'] = float(row['highest_bid_price']) if row['highest_bid_price'] else 0
            row['mileage'] = int(row['mileage']) if row['mileage'] else 0
            row['powe_kw'] = int(float(row['powe_kw'])) if row['powe_kw'] else 0
            row['battery_netto'] = int(round(float(row['battery_netto']))) if row['battery_netto'] else 0
        except ValueError:
            continue # Skip bad rows
            
        data.append(row)

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f)
    
print(f"converted {len(data)} rows to {json_path}")
