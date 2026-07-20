"""Constants for Python modules"""

# Domain → Feature Key mapping
DOMAIN_FEATURE_MAP = {
    "stability": [
        "overall_score", "stress_volatility_7d", "sleep_volatility_7d",
        "mood_volatility_7d", "hrv_volatility_7d", "focus_volatility_7d",
        "sleep_duration_streak", "daily_checkin_streak", "water_logging_streak",
        "bedtime_consistency_score", "sleep_start_time_variability_7d",
        "wake_time_variability_7d", "stress_vs_7d", "sleep_vs_7d",
        "focus_vs_7d", "hrv_vs_7d"
    ],
    "recovery": [
        "sleep_duration_hours", "sleep_efficiency", "deep_ratio", "rem_ratio",
        "wake_ratio", "sleep_score", "sleep_restfulness", "hrv_rmssd",
        "hrv_deep_rmssd", "readiness_score", "resting_heart_rate",
        "breathing_rate", "oxygen_variation", "blood_oxygen_avg",
        "skin_temp_relative", "sleep_quality_index", "recovery_index",
        "hrv_vs_7d", "readiness_vs_7d", "sleep_vs_7d", "next_day_hrv_delta",
        "next_day_readiness_delta", "rhr_delta"
    ],
    "sleep": [
        "sleep_duration_hours", "sleep_efficiency", "deep_ratio", "rem_ratio",
        "wake_ratio", "sleep_score", "sleep_restfulness", "sleep_quality_index",
        "bedtime_consistency_score", "sleep_start_time_variability_7d",
        "wake_time_variability_7d", "sleep_duration_streak", "sleep_volatility_7d",
        "sleep_vs_7d", "next_day_sleep_duration_delta", "sleep_efficiency_delta",
        "caffeine_after_2pm_flag"
    ],
    "hydration": [
        "total_water_ml", "caffeine_cups", "energy_drink_ml", "soda_ml",
        "hydration_adequacy_score", "water_delta", "hydration_score_delta",
        "water_logging_streak"
    ],
    "nutrition": [
        "meals_count", "breakfast_logged", "dinner_logged", "last_meal_time",
        "meal_time_variability", "last_meal_time_variability_7d",
        "breakfast_streak", "caffeine_after_2pm_flag"
    ],
    "stress": [
        "stress", "mood", "energy", "focus", "workload", "social_connectedness",
        "emotions_count", "stress_vs_7d", "stress_volatility_7d",
        "next_day_stress_delta", "next_day_mood_delta", "next_day_hrv_delta",
        "hrv_rmssd", "resting_heart_rate", "recovery_index"
    ],
    "focus": [
        "focus", "energy", "stress", "workload", "sleep_duration_hours",
        "sleep_efficiency", "readiness_score", "focus_vs_7d",
        "focus_volatility_7d", "focus_delta",
        "productivity_proxy_todos_completed_ratio"
    ],
    "training": [
        "steps", "total_active_minutes", "very_active_minutes",
        "sedentary_minutes", "distance_total_km", "calories_out",
        "activity_calories", "bmr_calories", "training_load_index",
        "sedentary_burden_score", "steps_vs_7d", "next_day_readiness_delta",
        "hrv_delta", "rhr_delta", "resting_heart_rate", "hrv_rmssd"
    ],
    "productivity": [
        "todos_count", "todos_completed_count", "calendar_events_count",
        "calendar_total_minutes", "high_stakes_keyword_flag", "workload",
        "focus", "energy", "stress", "productivity_proxy_todos_completed_ratio"
    ]
}
