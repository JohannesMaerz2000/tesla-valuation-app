# Tesla Valuation Project Context

## Project Overview
This project is a "Valuation Playground" designed to estimate the value of Tesla vehicles (Model 3 & Model Y) based on internal historical auction data. The goal is to create a sophisticated, data-driven algorithm that uses actual market data rather than simple heuristic formulas.

## Key Resources
- **Dataset**: `tesla_data_with_highland_flag.csv` (Converted to `tesla_data.json` for the app).
- **App**: A React + Vite + Tailwind application located in `tesla-valuation-app/`.
- **Algorithm**: Implemented in `src/utils/valuation.js`.
- **Optimization Scripts**: Located in `scripts/` - see `ML.md` for details.

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
*   **Algorithm Strategy**: Users select "8 Tires", "Summer", "Winter", or "All-Season".
*   **Asymmetric Penalties** (discovered via ML optimization):
    *   User has 8 tires, comp has 4: **45 points** (big mismatch - user's car is better)
    *   User has 4 tires, comp has 8: **19 points** (smaller penalty)
    *   Type mismatch (e.g. Summer vs Winter): **15 points**

### 4. Taxation (VAT vs Margin)
*   **Mechanism & Data Findings**:
    *   **Company Sellers (VAT Deductible)**: The database records the **NET Bid** (approx 20-22% lower than Gross). This is because dealers pay the Net amount for these cars (or claim VAT back). The "Value" to the seller is the Net amount (+ VAT flow-through).
    *   **Private Sellers (Margin)**: The database records the **GROSS Bid** (All-in). Dealers pay the full amount and cannot reclaim VAT on the purchase price.
    *   **Data Validation**: Analysis of 2022 models showed Margin cars averaging ~€26.6k and VAT cars ~€21.7k. The ratio (1.22) perfectly matches the VAT vs Net gap.
*   **Conclusion**: We treat taxation as a strict matching criteria.
    *   **Private (Margin) matches Margin**: Result is the **Gross Payout**.
    *   **Company (VAT) matches VAT**: Result is the **Net Payout**.
    *   The algorithm **strictly filters** neighbors. If you select "Company", it *only* looks at other Company cars. We never mix Net and Gross data.

### 5. Model-Specific Depreciation (ML Discovery)
A key finding from v5 optimization: **Model 3 and Model Y depreciate very differently**.

| Factor | Model 3 | Model Y | Insight |
| :--- | :--- | :--- | :--- |
| **Age Sensitivity** | 7.1 pts/month | 17.6 pts/month | Model Y ages **2.5x faster** |
| **Mileage Depreciation** | €502/10k km | €781/10k km | Model Y loses **55% more** per km |

**Possible Reasons:**
- SUV segment is more competitive (more alternatives)
- Higher Model Y inventory on the market
- Model 3 perceived as more "sporty/timeless"

---

## Algorithm Design
We use a **Weighted Nearest Neighbor (KNN)** approach with **model-specific parameters**.

### Core Logic
1.  **Hard Filtering**:
    *   **Model**: Exact match (Model 3 vs Y).
    *   **Powertrain**: Cluster match (kW check) + Battery size check (+/- 2kWh).
    *   **Highland**: Strict separation using the `is_highland` flag. Highland models are never compared with Pre-Highland models.
    *   **Taxation**: Strict matching. ROI/VAT cars are only matched with other VAT-deductible cars (Net Price). Margin cars match Margin cars (Gross Price).

2.  **Distance Metric (Scoring)**: We find the most similar cars by minimizing a "Distance Score":

    **Shared Parameters (Both Models):**
    *   **Recency**: **0.16 points per day** since auction. Recent sales are more relevant.
    *   **Status**: **67 points** penalty if offer was NOT accepted by seller. Prioritizes actual sales.
    *   **Accident History**: **24 points** penalty if "Accident Free" status mismatches.
    *   **Tires**: Asymmetric penalties (see Section 3 above).

    **Model-Specific Parameters:**
    | Parameter | Model 3 | Model Y |
    | :--- | :--- | :--- |
    | Age (linear) | 7.1 pts/month | 17.6 pts/month |
    | Age (quadratic) | +0.13 pts/month² | +0.12 pts/month² |
    | Mileage Distance | 0.0016 pts/km | 0.0035 pts/km |

    *Note: Age uses **Relative Age Logic** - comparing the target car's age today vs the comparable's age at its auction date.*

3.  **Price Adjustments (Appraisal Logic)**:
    *   **Trailer Hitch**:
        *   **Missing Hitch**: If user wants a hitch but comparable has none -> **+€192** added to comparable's price.
        *   **Extra Hitch**: If user has no hitch but comparable has one -> **-€192** subtracted from comparable's price.
    *   **Mileage (Depreciation)**: Model-specific rates:
        *   **Model 3**: **€0.050 per km** (€502 per 10k km)
        *   **Model Y**: **€0.078 per km** (€781 per 10k km)
        *   *Example*: If comparable has +10,000km more than your Model Y, we ADD €781 to its price.

4.  **Prediction**: The final price is a weighted average of the top **7 neighbors**, where:
    ```
    weight = 1 / (Score + 1)^1.71
    ```
    The exponent of 1.71 means closest matches have significantly more influence than distant ones.

---

## Current Accuracy
*   **Overall Median Error**: **3.65%** (on 609-record validation set)
*   **Model 3 Median Error**: 4.07%
*   **Model Y Median Error**: 3.25%

See `ML.md` for full optimization history and methodology.

---

## Application Architecture
*   **Frontend**: React (Vite).
*   **Styling**: Tailwind CSS with a custom "Premium Dark Mode" aesthetic.
*   **Transparency**:
    *   **Impact %**: We explicitly show the relational influence (percentage) of each comparable car on the final valuation.
    *   **Price Adjustments**: Adjusted prices are shown in yellow with the original price crossed out (e.g. ~~€30.000~~ **€30.192**).
    *   **Score Breakdown**: A detailed table shows specific penalties. Mismatched attributes like Trailer Hitch show their financial adjustment value.
    *   **Visual Cues**: Red penalties for score mismatches, Yellow text for price adjustments, Green checkmarks for matches.

---

## Current Status
*   [x] Data cleaned and clustered.
*   [x] Basic React App created.
*   [x] Algorithm implemented with KNN and Recency weighting.
*   [x] **Features Added**: Accident Free, Trailer Hitch, and Granular Age (Month/Year) inputs.
*   [x] **UI Polish**: Full transparency on scoring with visual penalty indicators.
*   [x] "Playground" features active (real-time updates).
*   [x] **ML Optimization**: v5 with model-specific parameters achieving 3.65% median error.
*   [ ] **Pending**: Update `valuation.js` with v5 optimized parameters.

## Future Roadmap
*   **Backend Integration**: Move logic to Supabase/Python if data scales.
*   **Damage Analysis**: Parse arbitrary text in `damage_description` for finer penalties (e.g. "scratch" vs "dent").
*   **Equipment parsing**: Parse JSON `feature` columns for "EAP" / "FSD" value.
*   **Highland-Specific Parameters**: Model 3 Highland may depreciate differently than pre-Highland.
