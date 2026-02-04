# Tesla Valuation Algorithm - Recent Auctions Test

**Generated on:** 2026-02-04
**Dataset:** 20 Most Recent Valid Auctions (Price > 0) from `tesla_data.json`

**Methodology:** No Data Leakage. For each car, the algorithm only sees historical sales that occurred *on or before* its auction date.

## Algorithm Overview & Functionality

The valuation engine uses a **Weighted Nearest Neighbor (KNN)** approach, comparing the target vehicle against a historical database of sold auctions.

### 1. Hard Filtering (Cohort Selection)
The algorithm first creates a strict comparison pool by filtering for exact matches on:
*   **Model**: Model 3 vs. Model Y.
*   **Variant**: Cars are clustered by kW/Battery into strictly comparable groups (e.g., "Model 3 Long Range" vs "Model Y Performance").
*   **Generation**: "Highland" (Facelift) models are never compared to pre-Highland models.
*   **Taxation**:
    *   **VAT-Deductible (Net Price)** cars are *only* compared to other VAT-deductible cars.
    *   **Margin (Gross Price)** cars are *only* compared to other Margin cars.
    *   *Assumption*: The value to a dealer differs significantly based on VAT recoverability.

### 2. Similarity Scoring (The "Distance" Metric)
We calculate a "Distance Score" for every eligible car in the pool. Lower scores mean a better match.
*   **Recency**: Recent sales are prioritized (Penalty: 0.40 pts per day).
*   **Age**: We compare the *relative age* (age at time of sale).
    *   *Model Y* is assumed to age faster (11.9 pts/month) than *Model 3* (11.2 pts/month).
    *   A quadratic factor adds extra penalty for older cars (Model 3: 0.165, Model Y: 0.073).
*   **Mileage**: Score penalty based on km difference.
*   **Status**: Rejected offers ("closed_seller_declined") incur a massive penalty (148 pts), effectively prioritizing actual sales.
*   **Equipment Mismatches**:
    *   **Accidents**: 21 pt penalty for "Accident Free" mismatch.
    *   **Tires**: Asymmetric penalties (e.g., if the **Target Car** has 8 tires but the **Comparable** only had 4, we apply a significant penalty to avoid using that data point).

### 3. Price Normalization (Appraisal Logic)
Before averaging, we adjust the comparable's price to "normalize" it to the target car's specs:
*   **Trailer Hitch**: +/- €298 adjustment if excluding/including a hitch.
*   **Mileage Depreciation**: We adjust price based on the exact mileage difference.
    *   *Model 3*: ~€0.043 per km (€430 / 10k km).
    *   *Model Y*: ~€0.099 per km (€990 / 10k km) - indicates much steeper depreciation.

### 4. Final Valuation
*   We select the **Top 5** closest matches (lowest scores).
*   We calculate a **Weighted Average** of their normalized prices.
*   Weighting is exponential (`1 / (Score + 1) ^ 1.98`), meaning the very best matches dominate the result.

## Recent Auction Results
| Date | Model | Variant | Year | km | Status | Actual Bid | Valuation | Delta (€) | Delta (%) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Feb 4, 2026 | Model 3 | m3_p | 2021 | 68,848 | Declined ❌ | **€22.700** | €25.114 | €-2.414 | 🟡 -9.61% |
| Feb 4, 2026 | Model 3 | m3_lr | 2020 | 53,005 | Accepted ✅ | **€16.700** | €18.922 | €-2.222 | 🔴 -11.74% |
| Feb 4, 2026 | Model 3 | m3_lr | 2022 | 53,600 | Declined ❌ | **€22.300** | €21.453 | +€847 | 🟢 +3.95% |
| Feb 3, 2026 | Model 3 | m3_sr | 2023 | 48,500 | Declined ❌ | **€11.800** | €24.289 | €-12.489 | 🔴 -51.42% |
| Feb 3, 2026 | Model Y | my_lr | 2023 | 63,000 | Declined ❌ | **€22.600** | €22.337 | +€263 | 🟢 +1.18% |
| Feb 2, 2026 | Model Y | my_p | 2022 | 120,060 | Declined ❌ | **€20.200** | €22.612 | €-2.412 | 🔴 -10.67% |
| Feb 2, 2026 | Model Y | my_lr | 2023 | 84,805 | Accepted ✅ | **€23.800** | €24.228 | €-428 | 🟢 -1.77% |
| Feb 2, 2026 | Model 3 | m3_sr | 2022 | 15,908 | Accepted ✅ | **€25.000** | €25.854 | €-854 | 🟢 -3.30% |
| Feb 2, 2026 | Model Y | my_sr | 2023 | 50,600 | Declined ❌ | **€26.800** | €27.374 | €-574 | 🟢 -2.10% |
| Feb 2, 2026 | Model Y | my_lr | 2023 | 27,000 | Accepted ✅ | **€34.200** | €34.472 | €-272 | 🟢 -0.79% |
| Jan 30, 2026 | Model Y | my_lr | 2024 | 17,300 | Declined ❌ | **€34.500** | €37.495 | €-2.995 | 🟡 -7.99% |
| Jan 30, 2026 | Model Y | my_lr | 2024 | 42,000 | Accepted ✅ | **€36.800** | €36.126 | +€674 | 🟢 +1.87% |
| Jan 30, 2026 | Model 3 | m3_sr | 2022 | 37,500 | Accepted ✅ | **€19.200** | €20.196 | €-996 | 🟢 -4.93% |
| Jan 29, 2026 | Model Y | my_sr | 2023 | 12,200 | Accepted ✅ | **€30.400** | €31.204 | €-804 | 🟢 -2.58% |
| Jan 29, 2026 | Model Y | my_sr | 2023 | 33,330 | Declined ❌ | **€27.700** | €28.971 | €-1.271 | 🟢 -4.39% |
| Jan 29, 2026 | Model Y | my_lr | 2024 | 51,500 | Declined ❌ | **€35.200** | €33.554 | +€1.646 | 🟢 +4.91% |
| Jan 29, 2026 | Model Y | my_p | 2024 | 37,000 | Accepted ✅ | **€35.200** | €37.938 | €-2.738 | 🟡 -7.22% |
| Jan 29, 2026 | Model 3 | m3_sr | 2021 | 64,000 | Declined ❌ | **€18.800** | €20.073 | €-1.273 | 🟡 -6.34% |
| Jan 29, 2026 | Model 3 | m3_lr | 2023 | 42,634 | Declined ❌ | **€19.300** | €23.776 | €-4.476 | 🔴 -18.83% |
| Jan 29, 2026 | Model 3 | m3_p | 2020 | 66,590 | Accepted ✅ | **€23.700** | €24.830 | €-1.130 | 🟢 -4.55% |

## Summary Statistics (Recent 20)
*   **Coverage**: 20/20 (100%)
*   **Median Absolute Error**: 4.91%
*   **Mean Absolute Error**: 8.01%
