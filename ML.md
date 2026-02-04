# Machine Learning & Algorithm Optimization

## Overview
This project uses a "Hyperparameter Optimization" approach to mathematically tune the weights and parameters of the valuation algorithm. Instead of guessing how much "Age" or "Mileage" matters, we use a script to test thousands of variations against our historical dataset to find the configuration that minimizes prediction error.

## Methodology

### 1. Random Search Optimization
We use a **Random Search** strategy. The script generates thousands of random combinations of algorithm parameters and tests each one.

### 2. Leave-One-Out Cross Validation (LOOCV)
To measure accuracy, we calculate the **Median Absolute Error (%)** for all records. We temporarily remove each car from the dataset and ask the algorithm to predict its price using the remaining data.

### 3. Progressive Refinement (Relative Age Breakthrough)
Initially, we compared cars based on their **Registration Date** difference. However, we realized this created a "blind spot": a car sold 12 months ago was effectively "younger" during that transaction than it is today. 

**The Fix**: We now use **Relative Age Logic**. 
*   **Age Today**: Months since target car's registration.
*   **Age at Sale**: Months between comparable car's registration and its auction date.
*   **Age Penalty**: Applied to the difference between these two "ages".

This allows the algorithm to correctly adjust for the fact that a historical sale of a 1-year-old car is structurally worth more than a 3-year-old car today, even if they share the same birth year.

## Current Results (Feb 4, 2026 - Run 3)

The introduction of **Relative Age Logic** and refined feature penalties has led to our most accurate model yet.

| Metric | Baseline (Manual) | Optimized (ML Run 1) | Optimized (ML Run 2) | Optimized (Run 3 - Relative Age) |
| :--- | :--- | :--- | :--- | :--- |
| **Median Error** | ~4.20% | 3.55% | 3.52% | **3.49%** |

### Parameter Changes
The third optimization run successfully decoupled "Market Recency" from "Physical Ageing":

| Parameter | Description | Old Value | New Value | Insight |
| :--- | :--- | :--- | :--- | :--- |
| **Age Penalty** | Points per month of "age" | 6.0 | **7.5** | **Ageing hurts more.** Once decoupled from recency, we see that cars lose value faster as they age physically. |
| **Recency** | Points per day since auction | 0.003 | **0.14** | **Market timing matters.** Prices have actually fluctuated over time more than the simplistic model suggested. |
| **Depreciation** | € adjustment per km | €0.05 | **€0.055** | **Steady.** Depreciation around €550 per 10k km is consistent. |
| **Neighbors** | Num. of comparison cars | 8 | **6** | **Niche Focus.** Using slightly fewer, more precise neighbors yields better results than averaging 8. |
| **Accident** | Penalty points | 25 | **30** | **High Impact.** Accidents are a significant deterrent for buyers. |
| **Tires (8)** | Penalty points (8 tires) | 14 | **31** | **Premium Value.** Buyers value that second set of wheels significantly more than initially thought. |

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
*   **Cohort Separation**: Run separate optimizations for Model 3 vs. Model Y.
*   **Damage Text Analysis**: Use keywords to penalize specific damage descriptions.
