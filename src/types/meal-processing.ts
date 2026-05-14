// ============================================================
// RYTM v1 – Meal Processing Type Definitions
// ============================================================

// ---- Database row types ----

export interface MealProcessingRun {
  id: string;
  meal_id: string;
  user_id: string;
  pipeline_version: string;
  status: 'queued' | 'processing' | 'success' | 'failed';
  model: string | null;
  input_modes: string[] | null;
  confidence_score: number | null;
  confidence_reasons: string[] | null;
  llm_comment: string | null;
  improvement_tips: string[] | null;
  totals: MealTotals | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface MealItemV1 {
  id: string;
  run_id: string;
  name_raw: string | null;
  name_normalized: string | null;
  portion_text: string | null;
  qty: number | null;
  unit: string | null;
  item_confidence: number | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  caffeine_mg: number | null;
  source: string | null;
  created_at: string;
}

export interface FoodCacheV1 {
  name_normalized: string;
  macros_basis: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  caffeine_mg: number | null;
  serving_notes: string | null;
  source: string | null;
  updated_at: string;
}

// ---- LLM response schemas ----

export interface ExtractedItem {
  name: string;
  name_normalized: string;
  portion_text: string | null;
  qty: number | null;
  unit: string | null;
  item_confidence: number;
}

export interface ExtractionResponse {
  items: ExtractedItem[];
  missing_info: string[];
  overall_certainty: number;
}

export interface EstimatedItem {
  name_normalized: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  caffeine_mg: number;
  notes?: string;
}

export interface MealTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  caffeine_mg: number;
}

export interface ScoringBreakdown {
  start: number;
  bonuses: Array<{ label: string; points: number }>;
  penalties: Array<{ label: string; points: number }>;
  caps_applied: string[];
  final_before_clamp: number;
  final: number;
}

export interface SourceOfTruth {
  used_user_numbers: boolean;
  user_numbers_fields_used: string[];
  estimated_fields: string[];
  notes: string;
}

export interface EstimationResponse {
  items: EstimatedItem[];
  totals: MealTotals;
  confidence_score: number;
  confidence_reasons: string[];
  improvement_tips: string[];
  llm_comment: string;
  scoring_breakdown?: ScoringBreakdown;
  source_of_truth?: SourceOfTruth;
}

// ---- Processing result ----

export interface ProcessMealResult {
  success: boolean;
  run_id: string | null;
  skipped: boolean;
  error?: string;
}

// ---- Cost calculation ----

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
}

// ---- Weekly aggregation ----

export interface WeeklyMealSummary {
  total_kcal: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  total_sugar: number;
  total_caffeine_mg: number;
  meals_processed: number;
  avg_confidence: number;
  high_conf_meals: number;
}
