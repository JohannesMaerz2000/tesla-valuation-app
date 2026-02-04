# Handover: Valuation Algorithm Refinement

## 1. Summary of Changes
We have significantly refined the valuation algorithm based on rigorous backtesting against the provided dataset. The core focus was to improve accuracy for "outlier" vehicles (low/high mileage) and ensure we prioritize verified sales.

## 2. Key Algorithm Improvements (`src/utils/valuation.js`)

### A. Mileage Price Adjustment (Depreciation)
*   **Problem**: Matching a 10k km car with a 100k km car (even if they are the best available options) resulted in severe undervaluation.
*   **Solution**: We implemented a **Hard Price Adjustment** derived from a linear regression of your data.
*   **Logic**: `AdjustedPrice = NeighborPrice + (NeighborMileage - InputMileage) * 0.06`.
*   **Impact**: Depreciation is calculated at **€0.06 per km** (approx. **€600 per 10,000 km**). This allows the algorithm to match a high-mileage car but mathematically "restore" its value to match the low-mileage target.

### B. Status Prioritization (Seller Accepted)
*   **Problem**: The dataset contains many `declined` or `active` offers which average ~4.6% lower than actual sales.
*   **Solution**: We added a **Soft Filter / Heavy Penalty**.
*   **Logic**: If a comparable car's status is NOT `closed_seller_accepted`, we add **+100 Points** to its penalty score.
*   **Impact**: The algorithm now aggressively hunts for *any* accepted sold car first. It will only fall back to declined/active offers if no sold cars exist in the valid cluster.

### C. UI Separation (`src/App.jsx`)
*   **Change**: We separated the display of "Price Adjustments".
*   **Result**: 
    *   **Mileage Row**: Shows the depreciation adjustment (e.g., `+€2.400`).
    *   **Trailer Hitch Row**: Shows the specific hitch adjustment (e.g., `+€250 (Missing Hitch)`).
    *   This prevents different adjustments from being lumped together, providing clarity to the user.

## 3. Testing & Validation Scripts
We created several scripts to validate these hypotheses. You can run them to verify data patterns:
*   `npm run test:algo` (or `node scripts/test_algorithm.js`): Runs a random sample test.
*   `node scripts/analyze_failures.js`: Performs a "Leave-One-Out" test to find the worst predictions (outliers).
*   `node scripts/analyze_mileage_slope.js`: Calculates the €/km depreciation rate for specific cohorts.
*   `node scripts/compare_status_prices.js`: proves that declined offers are ~5% lower than accepted ones.

## 4. Next Steps for New Chat
When starting a new chat to test the algorithm:
1.  **Reference the Context**: The `context.md` file has been updated with the latest logic.
2.  **Focus on Edge Cases**: Test with very low mileage (10k) and very high mileage (150k) to see the new price adjustments in action.
3.  **Verify Status**: Check if the "Comparables" list is prioritizing sold cars (you shouldn't see declined offers unless necessary).

**Current Best Estimate Error Rate**: ~4.5% (Median) with the new improvements.
