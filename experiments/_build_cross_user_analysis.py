"""Build cross-user clustering variant analysis (temporary helper)."""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Prefer explicit default result + all clustering_variants_result_*.json
def _discover_result_files() -> list[Path]:
    files: list[Path] = []
    default = ROOT / "clustering_variants_result.json"
    if default.exists():
        files.append(default)
    files.extend(sorted(ROOT.glob("clustering_variants_result_*.json")))
    # de-dupe while preserving order
    seen: set[str] = set()
    out: list[Path] = []
    for p in files:
        key = str(p.resolve())
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


FILES = _discover_result_files()

SCENARIO_LABELS = {
    "B_plus_D_then_order_by_OS": "B+D then order by overall_score",
    "overall_score_only": "overall_score only",
    "overall_score_plus_sleep": "overall_score + sleep",
    "baseline_A_B_D_no_OS_in_fit": "Baseline A+B+D (OS for ordering only)",
}


def _cohort_for_user(user_id: str, payload: dict) -> str:
    del user_id  # classification is driven by scenario notes
    for s in payload.get("scenarios") or []:
        if s.get("name") != "B_plus_D_then_order_by_OS":
            continue
        notes = " | ".join(s.get("notes") or [])
        if "B: no columns present" in notes:
            return "self_report_only"
        if "B: PCA" in notes or "B: scaled" in notes:
            return "full_wearable"
    return "mixed_or_unknown"


def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def stats(xs: list[float]) -> dict | None:
    if not xs:
        return None
    return {
        "n": len(xs),
        "mean": mean(xs),
        "min": min(xs),
        "max": max(xs),
        "median": statistics.median(xs),
        "stdev": statistics.stdev(xs) if len(xs) > 1 else 0.0,
    }


def fmt(x: float | None, digits: int = 3) -> str:
    if x is None:
        return "—"
    return f"{x:.{digits}f}"


def _extract_user_behavioral_profiles(user_payload: dict) -> dict:
    """Pull LLM behavioral-profile interpretations for every scenario (current + original)."""
    profiles: dict = {}
    for s in user_payload.get("scenarios") or []:
        name = s.get("name")
        if not name:
            continue
        current = s.get("llm_interpretation") or {}
        original = s.get("llm_interpretation_original") or {}
        profiles[name] = {
            "scenario_label": SCENARIO_LABELS.get(name, name),
            "silhouette": s.get("silhouette"),
            "stability_score": s.get("stability_score"),
            "cluster_sizes": s.get("cluster_sizes"),
            "overall_score_means": s.get("overall_score_means"),
            "current": {
                "profile_version": current.get("profile_version"),
                "summary": current.get("summary") or "",
                "primary_coaching_rule": current.get("primary_coaching_rule") or "",
                "cluster_interpretations": current.get("cluster_interpretations") or {},
                "llm_error": s.get("llm_error"),
            },
            "original": {
                "profile_version": original.get("profile_version"),
                "prompt_variant": original.get("prompt_variant"),
                "summary": original.get("summary") or "",
                "primary_coaching_rule": original.get("primary_coaching_rule") or "",
                "cluster_interpretations": original.get("cluster_interpretations") or {},
                "llm_error": s.get("llm_error_original"),
            },
            # Back-compat flat fields = current prompt (existing analysis readers)
            "profile_version": current.get("profile_version"),
            "summary": current.get("summary") or "",
            "primary_coaching_rule": current.get("primary_coaching_rule") or "",
            "cluster_interpretations": current.get("cluster_interpretations") or {},
            "llm_error": s.get("llm_error"),
        }
    return profiles


def _render_profile_block(lines: list[str], title: str, prof: dict) -> None:
    lines.append(f"**{title}**")
    lines.append("")
    if prof.get("llm_error") and not prof.get("summary"):
        lines.append(f"_LLM error:_ {prof['llm_error']}")
        lines.append("")
        return
    if prof.get("summary"):
        lines.append(f"- **Summary:** {prof['summary']}")
    if prof.get("primary_coaching_rule"):
        lines.append(f"- **Primary coaching rule:** {prof['primary_coaching_rule']}")
    ci = prof.get("cluster_interpretations") or {}
    for ck in ("cluster_0", "cluster_1", "cluster_2"):
        text = ci.get(ck)
        if text:
            lines.append(f"- **{ck}:** {text}")
    lines.append("")


def _build_by_scenario(users: list[dict], scenario_names: list[str]) -> dict:
    by_scenario: dict = {}
    for name in scenario_names:
        rows = []
        for u in users:
            s = next(x for x in u["scenarios"] if x["name"] == name)
            sizes = [s["cluster_sizes"][f"cluster_{i}"] for i in range(3)]
            os_means_raw = [
                s["overall_score_means"].get(f"cluster_{i}") for i in range(3)
            ]
            os_means = [float(x) for x in os_means_raw if x is not None]
            gaps = s["adjacent_mean_gaps"]
            gap01 = gaps.get("cluster_0_to_cluster_1")
            gap12 = gaps.get("cluster_1_to_cluster_2")
            total_gap = (float(gap01) if gap01 is not None else 0.0) + (
                float(gap12) if gap12 is not None else 0.0
            )
            min_size = min(sizes)
            max_size = max(sizes)
            imbalance = (max_size / min_size) if min_size else None
            llm = s.get("llm_interpretation") or {}
            rows.append(
                {
                    "user_id": u["user_id"],
                    "user_short": u["user_id"][:8],
                    "cohort": u.get("_cohort", "unknown"),
                    "days_used": s["days_used"],
                    "n_input_columns": s["n_input_columns"],
                    "silhouette": s["silhouette"],
                    "stability_score": s["stability_score"],
                    "cluster_sizes": sizes,
                    "overall_score_means": os_means_raw,
                    "gap_01": gap01,
                    "gap_12": gap12,
                    "total_adjacent_gap": total_gap,
                    "min_cluster_size": min_size,
                    "max_cluster_size": max_size,
                    "size_imbalance_ratio": imbalance,
                    "os_spread": (max(os_means) - min(os_means)) if os_means else None,
                    "llm_summary": (llm.get("summary") or "")[:280],
                    "llm_primary_coaching_rule": llm.get("primary_coaching_rule"),
                }
            )
        by_scenario[name] = {
            "label": SCENARIO_LABELS.get(name, name),
            "description": next(
                x["description"] for x in users[0]["scenarios"] if x["name"] == name
            ),
            "per_user": rows,
            "aggregate": {
                "silhouette": stats([r["silhouette"] for r in rows]),
                "stability_score": stats([r["stability_score"] for r in rows]),
                "n_input_columns": stats([float(r["n_input_columns"]) for r in rows]),
                "gap_01": stats(
                    [float(r["gap_01"]) for r in rows if r["gap_01"] is not None]
                ),
                "gap_12": stats(
                    [float(r["gap_12"]) for r in rows if r["gap_12"] is not None]
                ),
                "total_adjacent_gap": stats([r["total_adjacent_gap"] for r in rows]),
                "os_spread": stats(
                    [r["os_spread"] for r in rows if r["os_spread"] is not None]
                ),
                "min_cluster_size": stats([float(r["min_cluster_size"]) for r in rows]),
                "size_imbalance_ratio": stats(
                    [
                        r["size_imbalance_ratio"]
                        for r in rows
                        if r["size_imbalance_ratio"] is not None
                    ]
                ),
            },
        }
    return by_scenario


def _agg_table_rows(by_scenario: dict, scenario_names: list[str]) -> list[str]:
    lines: list[str] = []
    lines.append(
        "| Scenario | Silhouette mean (min–max) | Stability mean (min–max) | "
        "OS spread mean (min–max) | Total OS gap mean | Size imbalance mean |"
    )
    lines.append("|---|---|---|---|---|---|")
    for name in scenario_names:
        a = by_scenario[name]["aggregate"]
        label = by_scenario[name]["label"]
        sil = a["silhouette"]
        stab = a["stability_score"]
        osp = a["os_spread"]
        gap = a["total_adjacent_gap"]
        imb = a["size_imbalance_ratio"]
        lines.append(
            f"| {label} | {fmt(sil['mean'])} ({fmt(sil['min'])}–{fmt(sil['max'])}) | "
            f"{fmt(stab['mean'])} ({fmt(stab['min'])}–{fmt(stab['max'])}) | "
            f"{fmt(osp['mean'], 1)} ({fmt(osp['min'], 1)}–{fmt(osp['max'], 1)}) | "
            f"{fmt(gap['mean'], 1)} | {fmt(imb['mean'], 2)} |"
        )
    return lines


def main() -> None:
    if not FILES:
        raise SystemExit("No clustering_variants_result*.json files found")

    users = [json.loads(p.read_text(encoding="utf-8")) for p in FILES]
    for i, u in enumerate(users):
        u["_cohort"] = _cohort_for_user(u["user_id"], u)
        u["_source_file"] = FILES[i].name

    scenario_names = [s["name"] for s in users[0]["scenarios"]]
    by_scenario = _build_by_scenario(users, scenario_names)

    full_users = [u for u in users if u["_cohort"] == "full_wearable"]
    self_users = [u for u in users if u["_cohort"] == "self_report_only"]
    by_scenario_full = (
        _build_by_scenario(full_users, scenario_names) if full_users else {}
    )
    by_scenario_self = (
        _build_by_scenario(self_users, scenario_names) if self_users else {}
    )

    ari_by_pair: dict[str, list[float]] = defaultdict(list)
    for u in users:
        for k, v in (u.get("pairwise_ari") or {}).items():
            ari_by_pair[k].append(float(v))
    ari_agg = {k: stats(v) for k, v in sorted(ari_by_pair.items())}

    def rank(metric: str, higher_better: bool = True, block: dict | None = None):
        src = block or by_scenario
        scored = [
            (name, src[name]["aggregate"][metric]["mean"]) for name in scenario_names
        ]
        scored.sort(key=lambda x: x[1], reverse=higher_better)
        return [{"scenario": n, "mean": m} for n, m in scored]

    behavioral_profiles_by_user = []
    for u in users:
        behavioral_profiles_by_user.append(
            {
                "user_id": u["user_id"],
                "user_short": u["user_id"][:8],
                "cohort": u["_cohort"],
                "days_used": u["days_used"],
                "data_window_start": u["data_window_start"],
                "data_window_end": u["data_window_end"],
                "source_file": u["_source_file"],
                "profiles_by_scenario": _extract_user_behavioral_profiles(u),
            }
        )

    payload = {
        "title": "Clustering variants — cross-user impact analysis",
        "notes": [
            "Includes all successful experiment JSONs under experiments/.",
            "full_wearable = activity/sleep present; self_report_only = check-in + overall "
            "(new users were backfilled from daily_overall/daily_checkins).",
            "Category completeness scores (not per-feature miss flags) were used in this rerun.",
            "behavioral_profiles_by_user = LLM interpretations (summary, cluster_0/1/2, "
            "primary_coaching_rule) per scenario; includes current + original prompt variants.",
        ],
        "users_included": [
            {
                "user_id": u["user_id"],
                "cohort": u["_cohort"],
                "days_used": u["days_used"],
                "data_window_start": u["data_window_start"],
                "data_window_end": u["data_window_end"],
                "as_of": u["as_of"],
                "source_file": u["_source_file"],
            }
            for u in users
        ],
        "behavioral_profiles_by_user": behavioral_profiles_by_user,
        "n_users": len(users),
        "n_full_wearable": len(full_users),
        "n_self_report_only": len(self_users),
        "as_of": users[0]["as_of"],
        "metric_definitions": {
            "silhouette": "Cluster separation quality (−1..1; higher better).",
            "stability_score": "Subsample label agreement (higher better).",
            "os_spread": "max(mean OS) − min(mean OS) across the 3 clusters.",
            "total_adjacent_gap": "gap(c0→c1) + gap(c1→c2) on mean overall_score.",
            "size_imbalance_ratio": "max(cluster size) / min(cluster size); closer to 1 is more balanced.",
            "pairwise_ari": "Adjusted Rand Index between scenario labelings (1 = identical partitions).",
        },
        "scenarios": by_scenario,
        "scenarios_full_wearable": by_scenario_full,
        "scenarios_self_report_only": by_scenario_self,
        "pairwise_ari_aggregate": ari_agg,
        "rankings": {
            "by_mean_silhouette_desc": rank("silhouette", True),
            "by_mean_stability_desc": rank("stability_score", True),
            "by_mean_os_spread_desc": rank("os_spread", True),
            "by_mean_total_adjacent_gap_desc": rank("total_adjacent_gap", True),
            "by_mean_size_imbalance_asc": rank("size_imbalance_ratio", False),
        },
        "rankings_full_wearable": {
            "by_mean_silhouette_desc": rank("silhouette", True, by_scenario_full)
            if by_scenario_full
            else [],
            "by_mean_os_spread_desc": rank("os_spread", True, by_scenario_full)
            if by_scenario_full
            else [],
        },
    }

    json_out = ROOT / "clustering_variants_cross_user_analysis.json"
    json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    # Markdown report
    lines: list[str] = []
    lines.append("# Clustering variants — cross-user impact analysis")
    lines.append("")
    lines.append(
        f"Joined analysis of **{len(users)} users** after re-run with category completeness "
        f"scores. Cohorts: **{len(full_users)} full wearable**, **{len(self_users)} "
        f"self-report only** (check-in + overall; activity/sleep absent)."
    )
    lines.append("")
    lines.append("## Cohort")
    lines.append("")
    lines.append("| User (short) | Cohort | Days | Window | Source file |")
    lines.append("|---|---|---:|---|---|")
    for u in payload["users_included"]:
        lines.append(
            f"| `{u['user_id'][:8]}` | {u['cohort']} | {u['days_used']} | "
            f"{u['data_window_start']} → {u['data_window_end']} | `{u['source_file']}` |"
        )
    lines.append("")
    lines.append(f"As-of date: **{payload['as_of']}** (inclusive).")
    lines.append("")

    lines.append("## Behavioral profiles by user")
    lines.append("")
    lines.append(
        "LLM-generated behavior profiles from this experiment (one per clustering scenario). "
        "`cluster_0` = hardest/lowest morning overall_score tier; `cluster_2` = strongest. "
        "Each scenario shows **Current prompt** (feature-timing / quality evidence) and "
        "**Original prompt** (first production interpreter wording)."
    )
    lines.append("")
    for entry in behavioral_profiles_by_user:
        lines.append(
            f"### `{entry['user_short']}` · {entry['cohort']} · "
            f"{entry['days_used']} days ({entry['data_window_start']} → {entry['data_window_end']})"
        )
        lines.append("")
        lines.append(f"Source: `{entry['source_file']}`")
        lines.append("")
        for scenario_name in scenario_names:
            prof = (entry.get("profiles_by_scenario") or {}).get(scenario_name) or {}
            label = prof.get("scenario_label") or SCENARIO_LABELS.get(
                scenario_name, scenario_name
            )
            lines.append(f"#### {label}")
            lines.append("")
            sil = prof.get("silhouette")
            stab = prof.get("stability_score")
            sizes = prof.get("cluster_sizes") or {}
            size_txt = "/".join(
                str(sizes.get(f"cluster_{i}", "—")) for i in range(3)
            )
            os_means = prof.get("overall_score_means") or {}
            os_txt = "/".join(
                (
                    f"{os_means[f'cluster_{i}']:.1f}"
                    if os_means.get(f"cluster_{i}") is not None
                    else "—"
                )
                for i in range(3)
            )
            lines.append(
                f"- Metrics: silhouette `{fmt(sil)}` · "
                f"stability `{fmt(stab)}` · "
                f"sizes `{size_txt}` · mean OS `{os_txt}`"
            )
            lines.append("")
            _render_profile_block(
                lines,
                "Current prompt",
                prof.get("current")
                or {
                    "summary": prof.get("summary"),
                    "primary_coaching_rule": prof.get("primary_coaching_rule"),
                    "cluster_interpretations": prof.get("cluster_interpretations"),
                    "llm_error": prof.get("llm_error"),
                },
            )
            original = prof.get("original") or {}
            if original.get("summary") or original.get("llm_error"):
                _render_profile_block(lines, "Original prompt", original)
            else:
                lines.append(
                    "_Original prompt interpretation not present yet "
                    "(run `experiments/rerun_llm_with_original_prompt.py`)._"
                )
                lines.append("")

    lines.append("## How to read the metrics")
    lines.append("")
    for k, v in payload["metric_definitions"].items():
        lines.append(f"- **{k}**: {v}")
    lines.append("")
    lines.append(
        f"Aggregates below are across all **{len(users)}** users unless a cohort subsection "
        "says otherwise: **mean / min / max / median / stdev**."
    )
    lines.append("")

    lines.append("## Scenario comparison (all users)")
    lines.append("")
    lines.extend(_agg_table_rows(by_scenario, scenario_names))
    lines.append("")

    if by_scenario_full:
        lines.append("## Scenario comparison (full wearable only)")
        lines.append("")
        lines.extend(_agg_table_rows(by_scenario_full, scenario_names))
        lines.append("")

    if by_scenario_self:
        lines.append("## Scenario comparison (self-report only)")
        lines.append("")
        lines.extend(_agg_table_rows(by_scenario_self, scenario_names))
        lines.append("")

    lines.append("## Detailed aggregates by scenario (all users)")
    lines.append("")
    for name in scenario_names:
        block = by_scenario[name]
        a = block["aggregate"]
        lines.append(f"### {block['label']}")
        lines.append("")
        lines.append(f"_{block['description']}_")
        lines.append("")
        lines.append("| Metric | Mean | Min | Max | Median | Stdev |")
        lines.append("|---|---:|---:|---:|---:|---:|")
        for metric in [
            "silhouette",
            "stability_score",
            "os_spread",
            "gap_01",
            "gap_12",
            "total_adjacent_gap",
            "min_cluster_size",
            "size_imbalance_ratio",
            "n_input_columns",
        ]:
            s = a[metric]
            lines.append(
                f"| {metric} | {fmt(s['mean'])} | {fmt(s['min'])} | {fmt(s['max'])} | "
                f"{fmt(s['median'])} | {fmt(s['stdev'])} |"
            )
        lines.append("")
        lines.append("Per-user detail:")
        lines.append("")
        lines.append(
            "| User | Cohort | Days | Cols | Silhouette | Stability | Sizes | Mean OS (c0/c1/c2) | Gaps |"
        )
        lines.append("|---|---|---:|---:|---:|---:|---|---|---|")
        for r in block["per_user"]:
            sizes = "/".join(str(x) for x in r["cluster_sizes"])
            os_m = "/".join(
                f"{x:.1f}" if x is not None else "—" for x in r["overall_score_means"]
            )
            g01 = f"{r['gap_01']:.1f}" if r["gap_01"] is not None else "—"
            g12 = f"{r['gap_12']:.1f}" if r["gap_12"] is not None else "—"
            gaps = f"{g01} / {g12}"
            lines.append(
                f"| `{r['user_short']}` | {r['cohort']} | {r['days_used']} | {r['n_input_columns']} | "
                f"{r['silhouette']:.3f} | {r['stability_score']:.3f} | {sizes} | {os_m} | {gaps} |"
            )
        lines.append("")

    lines.append("## Pairwise label agreement (ARI) across users")
    lines.append("")
    lines.append(
        f"Adjusted Rand Index between scenario partitions, aggregated over all {len(users)} users."
    )
    lines.append("")
    lines.append("| Pair | Mean ARI | Min | Max | Median | Stdev |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for pair, s in ari_agg.items():
        short = pair.replace("__vs__", " vs ")
        lines.append(
            f"| {short} | {fmt(s['mean'])} | {fmt(s['min'])} | {fmt(s['max'])} | "
            f"{fmt(s['median'])} | {fmt(s['stdev'])} |"
        )
    lines.append("")

    lines.append("## Rankings (by mean across all users)")
    lines.append("")
    for title, key in [
        ("Best separation (silhouette ↑)", "by_mean_silhouette_desc"),
        ("Most stable (stability ↑)", "by_mean_stability_desc"),
        ("Largest OS contrast (os_spread ↑)", "by_mean_os_spread_desc"),
        ("Largest adjacent OS gaps ↑", "by_mean_total_adjacent_gap_desc"),
        ("Most balanced sizes (imbalance ↓)", "by_mean_size_imbalance_asc"),
    ]:
        lines.append(f"### {title}")
        lines.append("")
        for i, row in enumerate(payload["rankings"][key], 1):
            label = SCENARIO_LABELS.get(row["scenario"], row["scenario"])
            lines.append(f"{i}. **{label}** — mean `{fmt(row['mean'])}`")
        lines.append("")

    # Impact synthesis
    sil_rank = payload["rankings"]["by_mean_silhouette_desc"]
    stab_rank = payload["rankings"]["by_mean_stability_desc"]
    spread_rank = payload["rankings"]["by_mean_os_spread_desc"]
    imb_rank = payload["rankings"]["by_mean_size_imbalance_asc"]

    best_sil = SCENARIO_LABELS[sil_rank[0]["scenario"]]
    best_stab = SCENARIO_LABELS[stab_rank[0]["scenario"]]
    best_spread = SCENARIO_LABELS[spread_rank[0]["scenario"]]
    best_balance = SCENARIO_LABELS[imb_rank[0]["scenario"]]

    lines.append("## Overall impact synthesis")
    lines.append("")
    lines.append(
        f"- **Clearest geometric separation:** `{best_sil}` "
        f"(mean silhouette {fmt(sil_rank[0]['mean'])})."
    )
    lines.append(
        f"- **Most reproducible labels:** `{best_stab}` "
        f"(mean stability {fmt(stab_rank[0]['mean'])})."
    )
    lines.append(
        f"- **Strongest overall_score contrast between clusters:** `{best_spread}` "
        f"(mean OS spread {fmt(spread_rank[0]['mean'], 1)})."
    )
    lines.append(
        f"- **Most balanced cluster sizes:** `{best_balance}` "
        f"(mean imbalance {fmt(imb_rank[0]['mean'], 2)})."
    )
    lines.append("")

    os_only = by_scenario["overall_score_only"]["aggregate"]
    baseline = by_scenario["baseline_A_B_D_no_OS_in_fit"]["aggregate"]
    bpd = by_scenario["B_plus_D_then_order_by_OS"]["aggregate"]
    oss = by_scenario["overall_score_plus_sleep"]["aggregate"]

    lines.append("### Method-by-method takeaways")
    lines.append("")
    lines.append(
        f"1. **overall_score only** — Highest mean silhouette "
        f"({fmt(os_only['silhouette']['mean'])}) and largest OS contrast "
        f"({fmt(os_only['os_spread']['mean'], 1)}). Trades multi-signal richness for "
        f"clean OS-driven partitions; size imbalance is moderate "
        f"(mean {fmt(os_only['size_imbalance_ratio']['mean'], 2)})."
    )
    lines.append(
        f"2. **overall_score + sleep** — Separation "
        f"(silhouette mean {fmt(oss['silhouette']['mean'])}) with stability "
        f"({fmt(oss['stability_score']['mean'])}). OS spread "
        f"({fmt(oss['os_spread']['mean'], 1)} vs OS-only {fmt(os_only['os_spread']['mean'], 1)}). "
        f"On self-report-only users this collapses toward OS-only because sleep columns are absent."
    )
    lines.append(
        f"3. **B+D then order by OS** — Weaker separation "
        f"(silhouette mean {fmt(bpd['silhouette']['mean'])}) and often high size imbalance "
        f"(mean {fmt(bpd['size_imbalance_ratio']['mean'], 2)}). On self-report users this is "
        f"effectively check-in-only (activity B skipped)."
    )
    lines.append(
        f"4. **Baseline A+B+D** — Production-like feature set; silhouette "
        f"({fmt(baseline['silhouette']['mean'])}) and OS spread "
        f"({fmt(baseline['os_spread']['mean'], 1)}). Multi-domain PCA dilutes pure OS "
        f"separation while keeping reasonable stability ({fmt(baseline['stability_score']['mean'])})."
    )
    lines.append("")
    lines.append(
        f"**Bottom line across these {len(users)} users:** clustering on **overall_score alone** "
        "still gives the strongest morning-state tiers by OS. Self-report-only users (no "
        "wearables) confirm the same OS-only advantage; multi-feature baselines cannot invent "
        "activity/sleep signal that is not present."
    )
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(
        f"Machine-readable twin: `{json_out.name}`. "
        "Regenerate with `python experiments/_build_cross_user_analysis.py`."
    )

    md_out = ROOT / "clustering_variants_cross_user_analysis.md"
    md_out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {md_out}")
    print(f"Wrote {json_out}")
    print(f"Users: {len(users)} (full_wearable={len(full_users)}, self_report={len(self_users)})")


if __name__ == "__main__":
    main()