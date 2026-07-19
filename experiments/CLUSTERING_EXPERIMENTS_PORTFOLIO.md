# Behavior Clustering Experiments — Results Portfolio

**Project:** RYTM wellness coaching (NYUAD Capstone)  
**Focus:** Within-user K-Means day-type clustering + LLM behavior-profile interpretation  
**History cutoff (as-of):** 2026-02-28 (inclusive)  
**Cohort:** 8 participants · 7 with wearable + self-report features · 1 self-report only  

This document summarizes **two related experiments** run on the same cohort and the same four clustering scenarios. Participant identifiers are omitted; participants are labeled only by cohort and anonymous codes.

---

## What we tested

Morning coaching personalization uses **k = 3** within-user clusters. Clusters are always **semantically ordered** after fitting so that:

| Label | Meaning |
|---|---|
| `cluster_0` | Lowest mean overall_score tier |
| `cluster_1` | Middle mean overall_score tier |
| `cluster_2` | Highest mean overall_score tier |

**Important distinction:** overall_score may or may not be an *input* to K-Means. In every scenario it is still used to *order* cluster labels for interpretation.

### Scenarios (identical in both experiments)

| Scenario | Clustering inputs | overall_score role |
|---|---|---|
| **B+D → order by OS** | Activity (B) + check-in (D) | Ordering only |
| **OS only** | overall_score alone | Fit + ordering |
| **OS + sleep** | overall_score + overnight/sleep features | Fit + ordering |
| **Baseline A+B+D** | Sleep/recovery (A) + activity (B) + check-in (D) | Ordering only (production-like) |

### Experiment A — Same-day alignment

Features and overall_score share the same `feature_date` **D** (morning OS with same-date sleep/activity/check-in context).

Interpretation framing: *“On mornings when this participant starts with …”*

### Experiment B — Next-day overall_score alignment

Non-OS features stay on date **D**; overall_score is taken from **D+1** (following morning). Rows without a next-day score are dropped (~1 day fewer per participant on average).

Interpretation framing: *“On days with this feature profile, the next morning’s overall_score tended to be …”*

A dedicated system prompt (`NEXT_DAY_OS`) was used for Experiment B so the LLM uses predictive / lead-lag language rather than same-morning starting-state language.

---

## Cohort (anonymized)

| Code | Cohort | Same-day days | Next-day days (approx.) |
|---|---|---:|---:|
| P1 | Full wearable | 29 | 27 |
| P2 | Full wearable | 23 | 22 |
| P3 | Self-report only | 29 | 28 |
| P4 | Full wearable | 29 | 28 |
| P5 | Full wearable | 29 | 28 |
| P6 | Full wearable | 29 | 27 |
| P7 | Full wearable | 29 | 28 |
| P8 | Full wearable | 29 | 28 |

**Full wearable:** sleep/recovery + activity + check-in + overall_score available.  
**Self-report only:** check-in + overall_score; activity/sleep columns absent (scenario B effectively becomes check-in-only).

---

## Metrics glossary

| Metric | Meaning |
|---|---|
| **Silhouette** | Cluster separation (−1…1; higher is better) |
| **Stability** | Mean subsample label agreement vs primary labels (higher is better) |
| **OS spread** | max(mean OS) − min(mean OS) across the three clusters |
| **Size imbalance** | max(cluster size) / min(cluster size); closer to 1 is more balanced |

Aggregates below are **means across all 8 participants** unless noted.

---

## Experiment A — Same-day results

### All participants

| Scenario | Silhouette mean (min–max) | Stability mean (min–max) | OS spread mean (min–max) | Size imbalance mean |
|---|---|---|---|---|
| B+D → order by OS | 0.308 (0.218–0.678) | 0.530 (0.320–0.853) | 17.0 (5.9–28.9) | 11.43 |
| **OS only** | **0.664** (0.557–0.753) | **0.904** (0.696–1.000) | **49.4** (20.9–68.9) | **2.83** |
| OS + sleep | 0.359 (0.246–0.730) | 0.576 (0.370–0.846) | 33.4 (7.4–68.1) | 10.76 |
| Baseline A+B+D | 0.237 (0.151–0.471) | 0.585 (0.367–0.903) | 18.4 (3.5–50.4) | 7.84 |

### Full wearable only (n = 7)

| Scenario | Silhouette mean | Stability mean | OS spread mean | Size imbalance mean |
|---|---:|---:|---:|---:|
| B+D → order by OS | 0.256 | 0.484 | 15.6 | 10.35 |
| **OS only** | **0.654** | **0.912** | **46.8** | **2.86** |
| OS + sleep | 0.306 | 0.537 | 28.4 | 11.92 |
| Baseline A+B+D | 0.203 | 0.600 | 16.4 | 7.81 |

### Self-report only (n = 1)

| Scenario | Silhouette | Stability | OS spread | Size imbalance |
|---|---:|---:|---:|---:|
| B+D → order by OS | 0.678 | 0.853 | 26.8 | 19.00 |
| OS only | 0.730 | 0.846 | 68.1 | 2.67 |
| OS + sleep | 0.730 | 0.846 | 68.1 | 2.67 |
| Baseline A+B+D | 0.471 | 0.478 | 32.1 | 8.00 |

*(For the self-report participant, OS + sleep collapses toward OS-only because sleep columns are absent.)*

### Ranking (same-day, all participants)

1. **OS only** — clearest separation and largest OS contrast  
2. **OS + sleep** — moderate separation; often uneven cluster sizes  
3. **B+D → order by OS** — weaker OS tiers; frequent size imbalance  
4. **Baseline A+B+D** — weakest silhouette / diluted OS contrast (multi-domain PCA)

---

## Experiment B — Next-day overall_score results

### All participants

| Scenario | Silhouette mean (min–max) | Stability mean (min–max) | OS spread mean (min–max) | Size imbalance mean |
|---|---|---|---|---|
| B+D → order by next-day OS | 0.294 (0.141–0.668) | 0.516 (0.272–0.866) | 15.5 (1.9–29.2) | 14.61 |
| **Next-day OS only** | **0.649** (0.565–0.749) | **0.880** (0.681–1.000) | **48.3** (21.5–68.7) | **2.72** |
| Next-day OS + same-date sleep | 0.364 (0.244–0.724) | 0.651 (0.450–0.843) | 32.0 (1.8–70.3) | 7.35 |
| Baseline A+B+D (next-day OS order) | 0.218 (0.118–0.457) | 0.533 (0.201–0.809) | 13.0 (4.7–22.4) | 7.83 |

### Full wearable only (n = 7)

| Scenario | Silhouette mean | Stability mean | OS spread mean | Size imbalance mean |
|---|---:|---:|---:|---:|
| B+D → order by next-day OS | 0.241 | 0.466 | 15.3 | 14.13 |
| **Next-day OS only** | **0.638** | **0.885** | **45.4** | **2.75** |
| Next-day OS + same-date sleep | 0.313 | 0.624 | 26.8 | 8.05 |
| Baseline A+B+D | 0.184 | 0.550 | 12.9 | 7.87 |

### Self-report only (n = 1)

| Scenario | Silhouette | Stability | OS spread | Size imbalance |
|---|---:|---:|---:|---:|
| B+D → order by next-day OS | 0.668 | 0.866 | 16.8 | 18.00 |
| Next-day OS only | 0.724 | 0.843 | 68.3 | 2.50 |
| Next-day OS + same-date sleep | 0.724 | 0.843 | 68.3 | 2.50 |
| Baseline A+B+D | 0.457 | 0.410 | 14.1 | 7.50 |

### Ranking (next-day, all participants)

Same ordering as Experiment A: **OS-only leads**, then OS+sleep, then B+D, then baseline A+B+D.

---

## Side-by-side: same-day vs next-day

Mean silhouette / OS spread across all 8 participants:

| Scenario | Same-day silhouette | Next-day silhouette | Same-day OS spread | Next-day OS spread |
|---|---:|---:|---:|---:|
| B+D → order by OS | 0.308 | 0.294 | 17.0 | 15.5 |
| OS only | 0.664 | 0.649 | 49.4 | 48.3 |
| OS + sleep | 0.359 | 0.364 | 33.4 | 32.0 |
| Baseline A+B+D | 0.237 | 0.218 | 18.4 | 13.0 |

**Takeaway:** Shifting overall_score to **D+1** does not change the scenario ranking. Geometric quality drops slightly (expected with one fewer aligned day and a harder predictive target), but **OS-only remains dominant** on silhouette and OS-tier contrast in both alignments.

---

## Example behavior profiles (anonymized)

Profiles below are LLM outputs from the primary prompt used in each experiment. Numbers are cluster statistics for that participant; language is coaching interpretation, not medical advice.

### Example W — Full wearable participant (same-day · OS only)

- **Metrics:** silhouette 0.67 · stability 0.97 · sizes 4 / 15 / 10 · mean OS 31.0 / 61.4 / 73.3  
- **Summary:** Distinct morning self-report tiers with co-occurring sleep, mood, stress, and social patterns.  
- **Primary coaching rule:** On low overall_score mornings, prioritize recovery and stress management to improve the day’s starting state.  
- **cluster_0:** Low morning OS (~31) with shorter overnight sleep (~5.7h), higher stress (~48), lower mood (~28).  
- **cluster_1:** Mid OS (~61) with more balanced sleep/mood/stress and stronger social connectedness.  
- **cluster_2:** High OS (~73) with stronger energy; still watch stress to avoid burnout.

### Example W — Same participant (next-day · OS only · next-day prompt)

- **Metrics:** silhouette 0.66 · stability 0.91 · sizes 3 / 14 / 10 · mean next-day OS 30.0 / 61.4 / 73.3  
- **Summary:** Day-type patterns that help anticipate the **following** morning’s overall_score from prior-day context.  
- **Primary coaching rule:** Use yesterday’s sleep duration and social connectedness to anticipate today’s OS tier.  
- **cluster_0:** Next-morning OS tended to be low (~30) after shorter sleep, lower efficiency, higher sedentary time.  
- **cluster_1 / cluster_2:** Mid/high next-morning OS after more balanced sleep and engagement patterns.

### Example S — Self-report-only participant (same-day · OS only)

- **Metrics:** silhouette 0.73 · stability 0.85 · sizes 6 / 7 / 16 · mean OS 9.3 / 32.1 / 77.4  
- **Summary:** Wide morning OS separation even without wearables; check-in features still differentiate day-types.  
- **Primary coaching rule:** On very low OS mornings, build energizing, manageable routines to restore focus.  
- **Note:** Without sleep/activity columns, multi-feature baselines cannot invent wearable signal; OS-only remains the cleanest partition.

---

## Design implications for the coach

1. **If the product goal is crisp OS tiers** (hard / mid / strong mornings), clustering on **overall_score alone** is geometrically strongest and most stable in both alignments.  
2. **Production-like A+B+D** is richer as a multi-signal day portrait but **dilutes OS separation** — useful for narrative coaching context, weaker as a pure OS-tier engine.  
3. **B+D (activity + check-in)** often yields imbalanced sizes; OS ordering still labels clusters, but separation of mean OS is modest.  
4. **Next-day alignment** is the right framing when the coach should use *yesterday’s* pattern to anticipate *today’s* morning score. It needs an interpreter prompt that speaks in predictive language (as in Experiment B).  
5. **Self-report-only users** still get usable OS tiers; wearable-dependent scenarios degrade gracefully rather than inventing missing domains.

---

## Method notes (brief)

- **Algorithm:** K-Means, k = 3, fixed random seed / n_init aligned with production clustering helpers  
- **Preprocessing:** Standard scaling; category completeness (A/B/D) rather than per-feature miss flags  
- **Quality signals reported:** silhouette, subsample stability, OS means/gaps, size balance (experiments did not hard-block on production quality gates)  
- **LLM:** Behavior Profile Interpreter agent; Experiment A used production feature-timing prompt variants; Experiment B used a dedicated next-day OS system prompt plus a production-prompt A/B for comparison  

---

## Limitations

- Small cohort (n = 8); one self-report-only participant  
- ~one-month window ending 2026-02-28  
- OS-only maximizes OS-tier metrics by construction; it is not a claim that other features are irrelevant for coaching quality  
- LLM text is illustrative interpretation of cluster statistics, not validated clinical guidance  
- Next-day setup drops the last day (and any gaps) where D+1 OS is missing  

---

## Bottom line

Across both same-day and next-day alignments, **overall_score-only clustering** produced the strongest and most stable OS-tier partitions. Multi-feature baselines remain valuable for richer coaching narrative but do not outperform OS-only on silhouette or OS spread. Next-day alignment preserves the same ranking and supports a predictive coaching story when paired with an interpreter prompt written for lead-lag timing.
