# Machine Learning & Algorithm Optimization

## Overview
This project uses a "Hyperparameter Optimization" approach to mathematically tune the weights and parameters of the valuation algorithm. Instead of guessing how much "Age" or "Mileage" matters, we use a script to test thousands of variations against our historical dataset to find the configuration that minimizes prediction error.

## Methodology

### 1. Random Search Optimization
We use a **Random Search** strategy. The script generates thousands of random combinations of algorithm parameters and tests each one.

### 2. Leave-One-Out Cross Validation (LOOCV)
To measure accuracy, we calculate the **Median Absolute Error (%)** for all records. We temporarily remove each car from the dataset (by `auction_id`) and ask the algorithm to predict its price using the remaining data.

**Important**: We use the full dataset for evaluation (not random subsets) to ensure deterministic, reproducible results.

### 3. Relative Age Logic
Initially, we compared cars based on their **Registration Date** difference. However, we realized this created a "blind spot": a car sold 12 months ago was effectively "younger" during that transaction than it is today.

**The Fix**: We now use **Relative Age Logic**.
*   **Age Today**: Months since target car's registration to now.
*   **Age at Sale**: Months between comparable car's registration and its auction date.
*   **Age Penalty**: Applied to the difference between these two "ages".

This allows the algorithm to correctly adjust for the fact that a historical sale of a 1-year-old car is structurally worth more than a 3-year-old car today, even if they share the same birth year.

### 4. Model-Specific Parameters (v5 Breakthrough)
A key discovery: **Model 3 and Model Y depreciate very differently**. Running unified parameters for both models was leaving accuracy on the table. v5 introduces separate age and mileage parameters for each model.

---

## Optimization History

| Run | Date | Median Error | Key Changes |
| :--- | :--- | :--- | :--- |
| Baseline (Manual) | - | ~4.20% | Hand-tuned parameters |
| ML Run 1 | - | 3.55% | Initial optimization |
| ML Run 2 | - | 3.52% | Refined penalties |
| Run 3 (Relative Age) | Feb 4, 2026 | 3.49%* | Relative age logic |
| **v4 (Correct Baseline)** | Feb 4, 2026 | 3.71% | Fixed baseline, full dataset |
| **v5 (Model-Specific)** | Feb 4, 2026 | **3.65%** | Separate Model 3 / Model Y params |
| v7 (Unified Params) | Feb 4, 2026 | 4.37% | Re-run on 792 unified records (Regression) |
| **v8 (Model-Specific)** | Feb 4, 2026 | **3.93%** | Re-introduced model-specific + quadratic age |

*Note: v1-3 used subset samples. v7 uses the full 792-record unified dataset.*

---

## Current Best: v8 (Model-Specific Optimization)

### Key Findings (v8 Update)
We re-ran the optimization specifically looking for **model-specific differences** on the full 792-record dataset. The results confirmed that Model Y and Model 3 depreciate very differently, allowing us to drop the error from 4.37% (v7) to **3.93%**.

| Parameter | v7 (Unified) | v8 (Model-Specific) | Insight |
| :--- | :--- | :--- | :--- |
| **Recency** | 0.26 | **0.40** | Market timing is becoming *more* critical. |
| **Accident Penalty** | 52 | **21** | Market forgiveness? Or previous value was overfitting. |
| **Weight Exponent** | 3.5 | **1.98** | Less aggressive "winner takes all" than v7. |
| **Model Y Depr** | €580/10k | **€990/10k** | **Huge**: Model Y mileage penalty is double Model 3's (€430). |
| **Age Logic**| Linear | **Quadratic** | Cars lose value faster as they get older. |

**Median Error**: 3.93% (Model 3: 4.64%, Model Y: 3.62%).
This confirms that treating the models separately is essential for accuracy.

---

### Previous Best: v5 Model-Specific Parameters (Legacy)

### Results (v5)
| Metric | Production Baseline | v5 Optimized |
| :--- | :--- | :--- |
| **Overall Median Error** | 4.10% | **3.65%** |
| **Model 3 Median Error** | 4.84% | **4.07%** |
| **Model Y Median Error** | 3.33% | **3.25%** |

**Total Improvement: 11% relative reduction in error**

### Key Discovery: Model 3 vs Model Y Depreciation

| Parameter | Model 3 | Model Y | Insight |
| :--- | :--- | :--- | :--- |
| **Age Penalty (linear)** | 7.1 pts/month | **17.6 pts/month** | Model Y ages **2.5x faster** |
| **Age Penalty (quadratic)** | +0.13/month² | +0.12/month² | Both accelerate with age |
| **Mileage Depreciation** | €502/10k km | **€781/10k km** | Model Y loses **55% more** per km |
| **Mileage Distance Penalty** | 0.0016/km | 0.0035/km | Model Y more sensitive to km diff |

**Why does Model Y depreciate faster?**
- SUV segment is more competitive (more alternatives)
- Higher Model Y inventory on the market
- Model 3 perceived as more "sporty/timeless"

### Shared Parameters (Both Models)

| Parameter | Old Value | New Value | Change | Insight |
| :--- | :--- | :--- | :--- | :--- |
| **Recency** | 0.14 pts/day | **0.16 pts/day** | +14% | Market timing matters |
| **Accident Penalty** | 30 pts | **24 pts** | -20% | Less impactful than assumed |
| **Tire (User has 8)** | 30 pts | **45 pts** | +50% | Having 8 tires is premium |
| **Tire (User has 4)** | 14 pts | **19 pts** | +36% | Asymmetric penalty works |
| **Tire Type Mismatch** | 5 pts | **15 pts** | +200% | Tire type matters more |
| **Status Penalty** | 100 pts | **67 pts** | -33% | Non-accepted offers useful |
| **Hitch Value** | €250 | **€192** | -23% | Slightly less valuable |
| **Neighbor Count** | 6 | **7** | +1 | Slightly more averaging |
| **Weight Exponent** | 1.0 | **1.71** | +71% | Closest matches dominate |

### Tire Penalty Asymmetry Explained
- **User has 8 tires, comp has 4**: 45 points (big penalty - your car is better)
- **User has 4 tires, comp has 8**: 19 points (smaller penalty - comp is better but still usable)

This asymmetry makes sense: if you have the premium feature (8 tires), comparing to a lesser-equipped car requires a larger adjustment.

### Weight Exponent
The formula `weight = 1 / (score + 1)^exponent` with exponent=1.71 means:
- A perfect match (score=0) has weight 1.0
- A score=10 match has weight 0.018 (vs 0.09 with exponent=1)
- Closest neighbors now dominate the prediction more strongly

---

## Best Configuration (v5)

```javascript
const config = {
  shared: {
    recencyPenalty: 0.159,
    accidentPenalty: 24,
    tireUserWants8Penalty: 45,
    tireUserWants4Penalty: 19,
    tireTypePenalty: 15,
    statusPenalty: 67,
    hitchValue: 192,
    neighborCount: 7,
    weightExponent: 1.71
  },
  model3: {
    agePenalty: 7.1,
    ageQuadratic: 0.131,
    mileageDepreciation: 0.050,
    mileageDistancePenalty: 0.0016
  },
  modelY: {
    agePenalty: 17.6,
    ageQuadratic: 0.115,
    mileageDepreciation: 0.078,
    mileageDistancePenalty: 0.0035
  }
};
```

---

## How to Re-Run Optimization

As you add more data to `src/data/tesla_data.json`, the "best" parameters might change.

### Recommended Script: v5 (Model-Specific)
```bash
node scripts/optimize_v5_best_of_both.js
```
- Runs 2000 trials
- Uses full dataset (deterministic)
- Optimizes Model 3 and Model Y separately
- Includes non-linear age decay and weight exponent

### Other Available Scripts
| Script | Description |
| :--- | :--- |
| `optimize_parameters.js` | Original script (200-sample subset, unified params) |
| `optimize_v4_correct_baseline.js` | Full dataset, unified params, correct baseline |
| `optimize_v5_best_of_both.js` | **Recommended**: Full dataset, model-specific |
| `compare_methodologies.js` | Compares different LOOCV approaches |

---

## Future Improvements to Try
*   **Highland-Specific Parameters**: Model 3 Highland may depreciate differently than pre-Highland.
*   **Damage Text Analysis**: Use keywords to penalize specific damage descriptions.
*   **Seasonal Effects**: Test if prices vary by month/quarter.
*   **Bayesian Optimization**: More efficient than random search for finding optimal parameters.
