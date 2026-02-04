# Machine Learning & Algorithm Optimization

## Overview
This project uses a "Hyperparameter Optimization" approach to mathematically tune the weights and parameters of the valuation algorithm. Instead of guessing how much "Age" or "Mileage" matters, we use a script to test thousands of variations against our historical dataset to find the configuration that minimizes prediction error.

## Methodology

### 1. Random Search Optimization
We use a **Random Search** strategy. The script generates thousands of random combinations of algorithm parameters (within reasonable bounds) and tests each one.
*   **Why Random Search?** It is often more efficient than Grid Search for hyperparameter tuning, as it explores the solution space more effectively when some parameters matter much more than others.

### 2. Leave-One-Out Cross Validation (LOOCV)
To measure accuracy, we cannot simply test the algorithm on the cars it already knows (that would be cheating).
*   **The Process**: For every car in the database (N=646), we temporarily **remove** it from the dataset, train the algorithm on the remaining N-1 cars, and ask it to predict the price of the removed car.
*   **The Metric**: We calculate the **Median Absolute Error (%)** across all 600+ predictions. We use Median instead of Average to avoid skewing results by a few extreme outliers (e.g. cars with massive hail damage).

## Current Results (Feb 4, 2026)

We ran 500 trials on the `tesla_data.json` dataset.

| Metric | Baseline (Manual) | Optimized (ML) | Improvement |
| :--- | :--- | :--- | :--- |
| **Median Error** | ~4.20% | **3.55%** | **-15.3%** (Relative) |

### Parameter Changes
The optimization revealed that the market behaves differently than our initial intuition:

| Parameter | Description | Old Value | New Value | Insight |
| :--- | :--- | :--- | :--- | :--- |
| **Age Penalty** | Points per month old | 3.5 | **4.3** | **Age matters more.** The market heavily discounts older cars, even if mileage is low. |
| **Recency** | Points per day since auction | 0.1 | **0.022** | **Recency matters less.** Market prices are relatively sticky. A sold price from 3 months ago is still very relevant. |
| **Depreciation** | € adjustment per km | €0.06 | **€0.07** | **High mileage hits harder.** The depreciation curve is slightly steeper than linear regression initially suggested. |
| **Neighbors** | Num. of comparison cars | 4 | **8** | **Safety in numbers.** using a larger pool helps average out "noise" (e.g., specific damage or options). |

## How to Re-Run Optimization
As you add more data to `src/data/tesla_data.json`, the "best" parameters might change. You can re-run the optimization at any time.

1.  **Open Terminal**
2.  **Run the Script**:
    ```bash
    node scripts/optimize_parameters.js
    ```
3.  **Wait**: The script will run for 1-2 minutes (for ~500 trials).
4.  **Update**: It will output the new best JSON configuration. You can then manually update the constants in `src/utils/valuation.js`.

## Future Improvements to Try
*   **Weighted Features**: Currently, features like "Accident Free" have a fixed 20-point penalty. We could include these in the specific ML optimization to see if the market penalizes accidents by 20 points or 50 points.
*   **Tire Logic**: Include tire mismatch penalties in the optimization.
*   **Cohort Separation**: Run separate optimizations for Model 3 vs. Model Y to see if they depreciate at different rates.
