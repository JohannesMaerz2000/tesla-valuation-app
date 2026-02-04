
import pandas as pd
import numpy as np

# Load the data
file_path = '/Users/johannesmaerz/Documents/MVPs/teslavaluation3/tesla_data_with_highland_flag.csv'
df = pd.read_csv(file_path)

# 1. Powertrain Analysis
print("--- Powertrain Analysis ---")
# Group by model, variant, power, drive_type, battery to identify specs
powertrain_groups = df.groupby(['model', 'powe_kw', 'drive_type', 'battery_netto']).agg(
    count=('highest_bid_price', 'count'),
    avg_price=('highest_bid_price', 'mean'),
    min_price=('highest_bid_price', 'min'),
    max_price=('highest_bid_price', 'max'),
    variants=('variant', lambda x: x.unique().tolist())
).reset_index()

print(powertrain_groups.sort_values(by='count', ascending=False).to_string())

# 2. Winter Tires Analysis
print("\n--- Winter Tires Value Driver Analysis ---")
# Check if tires_winter is 0/1 or similar
print(f"Unique values in tires_winter: {df['tires_winter'].unique()}")

# Simple generic comparison
winter_tires_stats = df.groupby('tires_winter')['highest_bid_price'].describe()
print(winter_tires_stats)

# More detailed comparison controlling for Model and Age (roughly)
df['year'] = pd.to_datetime(df['first_registration']).dt.year
detailed_winter = df.groupby(['model', 'year', 'tires_winter'])['highest_bid_price'].mean().unstack()
print("\nAverage Price with/without Winter Tires by Model and Year:")
print(detailed_winter)


# 3. Correlation Analysis
print("\n--- Correlation with Highest Bid Price ---")
# Select numeric columns
numeric_cols = df.select_dtypes(include=[np.number]).columns
correlations = df[numeric_cols].corr()['highest_bid_price'].sort_values(ascending=False)
print(correlations)

# 4. Highland Analysis
print("\n--- Highland vs Pre-Highland (Model 3) ---")
model3_df = df[df['model'] == 'Model 3']
highland_stats = model3_df.groupby('is_highland')['highest_bid_price'].describe()
print(highland_stats)

