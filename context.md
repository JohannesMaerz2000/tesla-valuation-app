# Tesla Valuation Project Context

## Project Overview
This project is a "Valuation Playground" designed to estimate the value of Tesla vehicles (Model 3 & Model Y) based on internal historical auction data. The goal is to create a sophisticated, data-driven algorithm that uses actual market data rather than simple heuristic formulas.

## Key Resources
- **Dataset**: `tesla_data_with_highland_flag.csv` (Converted to `tesla_data.json` for the app).
- **App**: A React + Vite + Tailwind application located in `tesla-valuation-app/`.
- **Algorithm**: Implemented in `src/utils/valuation.js`.

---

## Data Learnings & Insights

### 1. Powertrain Clustering
The raw data contains fragmented `kW` and `kWh` values. We successfully identified distinct clusters to map these to market trims:
*   **Model Y**:
    *   **Standard Range**: 220-255 kW / 60 kWh
    *   **Long Range**: 378 kW / 75 kWh (Avg ~€31k)
    *   **Performance**: 390+ kW / 75 kWh (Avg ~€32.3k)
*   **Model 3**:
    *   **Standard Range**: 208-239 kW / 50-60 kWh (Avg ~€24.6k)
    *   **Long Range**: 324-366 kW / 75 kWh
    *   **Performance**: 377-460+ kW / 75-82 kWh

### 2. The "Highland" Factor
*   The **Model 3 Highland (Facelift 2024+)** is a critical value driver.
*   Pre-Highland Model 3s average ~€22.7k, while Highland models average ~€34.4k.
*   The algorithm *strictly filters* for this attribute to prevent mixing these distinct vehicle generations.

### 3. Tires
*   Counter-intuitively, broader data showed that cars with *only winter tires* sometimes sold for less or similar to summer-only cars, likely due to correlation with age/mileage.
*   **Algorithm Strategy**: Users select "8 Tires", "Summer", "Winter", or "All-Season". We apply a **20 point penalty** for quantity mismatches (8 vs 4) and a **5 point penalty** for type mismatches (e.g. Summer vs Winter).

### 4. Taxation (VAT vs Margin)
*   **Mechanism & Data Findings**:
    *   **Company Sellers (VAT Deductible)**: The database records the **NET Bid** (approx 20-22% lower than Gross). This is because dealers pay the Net amount for these cars (or claim VAT back). The "Value" to the seller is the Net amount (+ VAT flow-through).
    *   **Private Sellers (Margin)**: The database records the **GROSS Bid** (All-in). Dealers pay the full amount and cannot reclaim VAT on the purchase price.
    *   **Data Validation**: Analysis of 2022 models showed Margin cars averaging ~€26.6k and VAT cars ~€21.7k. The ratio (1.22) perfectly matches the VAT vs Net gap.
*   **Conclusion**: We treat taxation as a strict matching criteria.
    *   **Private (Margin) matches Margin**: Result is the **Gross Payout**.
    *   **Company (VAT) matches VAT**: Result is the **Net Payout**.
    *   The algorithm **strictly filters** neighbors. If you select "Company", it *only* looks at other Company cars. We never mix Net and Gross data.

---

## Algorithm Design
We moved away from a "Base Price + Adjustments" formula to a **Weighted Nearest Neighbor (KNN)** approach.

### Core Logic
1.  **Hard Filtering**:
    *   **Model**: Exact match (Model 3 vs Y).
    *   **Powertrain**: Cluster match (kW check) + Battery size check (+/- 2kWh).
    *   **Highland**: Strict separation using the `is_highland` flag. Highland models are never compared with Pre-Highland models.
    *   **Taxation**: Strict matching. ROI/VAT cars are only matched with other VAT-deductible cars (Net Price). Margin cars match Margin cars (Gross Price).

2.  **Distance Metric (Scoring)**: We find the top 4 most similar cars by minimizing a "Distance Score":
    *   **Recency**: **0.1 points per day** since auction. (Lowered from 0.5 to prevent overshadowing physical specs).
    *   **Age**: **3.5 points per month** difference. (Increased to prioritize newer cars).
    *   **Mileage**: **1 point per 1,000 km** difference.
    *   **Attributes (Soft Penalties)**: Mismatches here add points, pushing the car down the list or reducing its weight:
        *   **Accident History**: **20 points** penalty if "Accident Free" status mismatches.
        *   **Trailer Hitch**: **5 points** penalty for mismatch.
        *   **Tires**: **20 points** (Quantity mismatch, e.g. 8 vs 4) or **5 points** (Type mismatch, e.g. Summer vs Winter).

3.  **Prediction**: The final price is a weighted average of the top 4 neighbors, where weight = `1 / (Score + 1)`.

---

## Application Architecture
*   **Frontend**: React (Vite).
*   **Styling**: Tailwind CSS with a custom "Premium Dark Mode" aesthetic.
*   **Transparency**:
    *   The UI explicitly lists the 4 "Comparable Vehicles" used.
    *   **Score Breakdown**: A detailed table shows exactly *why* a car was chosen, listing specific penalties for Tires, Tax, Accident, and Hitch (showing 0 pts/Green Checkmark for matches).
    *   **Visual Cues**: Red penalties for mismatches, Green checkmarks for matches.

---

## Current Status
*   [x] Data cleaned and clustered.
*   [x] Basic React App created.
*   [x] Algorithm implemented with KNN and Recency weighting.
*   [x] **Features Added**: Accident Free, Trailer Hitch, and Granular Age (Month/Year) inputs.
*   [x] **UI Polish**: Full transparency on scoring with visual penalty indicators.
*   [x] "Playground" features active (real-time updates).

## Future Roadmap
*   **Backend Integration**: Move logic to Supabase/Python if data scales.
*   **Damage Analysis**: Parse arbitrary text in `damage_description` for finer penalties (e.g. "scratch" vs "dent").
*   **Equipment parsing**: Parse JSON `feature` columns for "EAP" / "FSD" value.
