import csv
from datetime import datetime

dates = []
with open('tesla_data_with_highland_flag.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            ds = row['auction_end_date']
            # Format is like: 2026-01-14 10:00:00+00
            # or 2025-04-28 ...
            if ds:
                dt = datetime.fromisoformat(ds.replace('Z', '+00:00'))
                dates.append(dt)
        except:
            pass

if dates:
    print(f"Min Date: {min(dates)}")
    print(f"Max Date: {max(dates)}")
    dates.sort()
    print("Recent distinct dates:", [d.strftime('%Y-%m-%d') for d in dates[-10:]])
