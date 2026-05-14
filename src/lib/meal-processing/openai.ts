// ============================================================
// RYTM v1 – LLM Utility Wrapper for Meal Processing
// ============================================================
// Primary gateway:
//   OpenRouter (OpenAI-compatible API)
//
// Fallback:
//   Direct OpenAI API
//
// Models used:
//   Extraction: GPT-4.1 Nano  (vision-capable, structured extraction)
//   Estimation: GPT-4.1 Mini  (text-only, macro estimation + confidence)
// ============================================================

import OpenAI from 'openai';
import type {
  ExtractionResponse,
  EstimationResponse,
  ExtractedItem,
  TokenUsage,
  ModelPricing,
} from '@/types/meal-processing';

// ---- Constants ----

export const PIPELINE_VERSION = 'v1.1';

export const MODELS = {
  extraction: process.env.MEAL_EXTRACTION_MODEL || 'openai/gpt-4.1-nano',
  estimation: process.env.MEAL_ESTIMATION_MODEL || 'openai/gpt-4.1-mini',
} as const;

/** Pricing per 1 M tokens (USD) — update when OpenAI changes pricing */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'openai/gpt-4.1-nano': { input_per_million: 0.10, output_per_million: 0.40 },
  'openai/gpt-4.1-mini': { input_per_million: 0.40, output_per_million: 1.60 },
  'gpt-4.1-nano': { input_per_million: 0.10, output_per_million: 0.40 },
  'gpt-4.1-mini': { input_per_million: 0.40, output_per_million: 1.60 },
};

// ---- Client singleton ----

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (openRouterApiKey) {
      _client = new OpenAI({
        apiKey: openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
          'X-Title': 'RYTM Meal Processing',
        },
      });
    } else if (openAiApiKey) {
      _client = new OpenAI({ apiKey: openAiApiKey });
    } else {
      throw new Error('Neither OPENROUTER_API_KEY nor OPENAI_API_KEY was found in environment variables');
    }
  }
  return _client;
}

// ---- Cost calculation ----

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.input_per_million;
  const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output_per_million;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ---- Extraction Prompt ----

const EXTRACTION_SYSTEM = `You are a nutrition extraction engine.
Return STRICT JSON only.
No markdown.
No commentary.
If an image is provided, use it as your primary source of information about the meal.
If both image and description are provided, use both together.
If the meal contains likely caffeinated items, preserve that item identity clearly so caffeine can be estimated downstream.`;

export interface ExtractionModelParams {
  description: string | null;
  imageUrl: string | null;
  hasText: boolean;
  hasImage: boolean;
}

function buildExtractionUserPrompt(params: ExtractionModelParams): string {
  return `Extract food items from this meal.

Has_text: ${params.hasText}
Has_image: ${params.hasImage}
Description: ${params.description ?? 'NONE'}

Rules:
- If an image is provided, identify all visible food items from it.
- If a description is provided, use it to supplement or clarify the image.
- If user mentions restaurant, cuisine, or brand, use it.
- Extract portion info if available.
- Infer reasonable defaults only when necessary.
- Limit to maximum 8 items.
- Return confidence about extraction quality.

Output schema:

{
  "items": [
    {
      "name": "string",
      "name_normalized": "lowercase simplified name",
      "portion_text": "string or null",
      "qty": number or null,
      "unit": "string or null",
      "item_confidence": number (0-1)
    }
  ],
  "missing_info": ["string"],
  "overall_certainty": number (0-1)
}`;
}

// ---- Estimation Prompt ----

const ESTIMATION_SYSTEM = `You are a nutrition estimation + data-quality judge.

You MUST output STRICT JSON only (no markdown, no extra keys).
You MUST follow the confidence scoring rubric exactly.

You are NOT allowed to give high confidence just because calories/macros look plausible.
Confidence measures how well-constrained the estimate is from the input.

You must also estimate caffeine in mg when relevant.
- Track caffeine_mg per item and in totals.
- Use 0 for clearly non-caffeinated items.
- If an item is likely caffeinated but uncertain, make a conservative estimate and mention the assumption in notes.
- Useful anchors: espresso shot ~64mg, brewed coffee ~95mg per cup, black tea ~40-50mg, green tea ~25-40mg, matcha serving ~60-70mg, cola can ~30-45mg, energy drink can ~80-200mg depending on brand.

CRITICAL OVERRIDE RULE:
- If the user's original meal description contains EXPLICIT nutrition numbers (kcal, protein_g, carbs_g, fat_g, sugar_g) for any item or the total meal, you MUST treat those as GROUND TRUTH.
- DO NOT override, adjust, or re-estimate fields where the user provided explicit numbers.
- Your totals MUST exactly match the sum of user-provided item values, or match user-provided totals exactly.
- Only estimate missing fields (e.g., if user provided kcal + protein but not carbs/fat/sugar, estimate those).
- Set used_user_numbers=true and list which fields came from user vs. estimated.

CONFIDENCE BOOST RULE:
- If explicit kcal is provided for the total meal OR >=60% of items have explicit kcal in the description, confidence MUST be >=85 regardless of image/cache status.
- User-provided numbers are the highest quality data possible.

Definitions:
- "Portion info" means any concrete serving size cue: grams/ml/oz, cups, slices, pieces, bowls, "half", "small/medium/large" paired with a food item, or a clearly quantified package (e.g., "1 protein bar").
- "Generic food" means a broad label with high variance: lasagna, pasta, rice, sandwich, burger, curry, biryani, pizza, salad, stew, ramen, chips, latte, smoothie, "food", "meal", etc.
- "Mixed dish" means multi-ingredient prepared food where portion and recipe strongly affect macros (lasagna, curry, biryani, pizza, burgers, most sandwiches, pasta dishes, salads with dressing, etc.).
- "Image used" means an image was provided AND you actually used it to recognize food/portion; if you cannot use it (unclear), treat as not used.

Hard rule:
If the meal is text-only OR image-only AND has NO portion info AND has NO explicit nutrition numbers, you MUST keep confidence low.
If the description is a single generic food word with no portion (e.g., "Lasagna"), confidence MUST be <= 20.

You MUST produce:
- confidence_score (0–100)
- confidence_reasons (2–4 bullets)
- improvement_tips (2–4 bullets)
- llm_comment (1 short paragraph)
- scoring_breakdown with points added/subtracted exactly per the rubric
- source_of_truth tracking which fields used user numbers vs. estimates`;

export interface EstimationModelParams {
  items: ExtractedItem[];
  description: string | null;  // Original meal description with explicit numbers
  hasText: boolean;
  hasImage: boolean;
  imageUsed: boolean;  // true only if image was successfully sent to extraction AND usable
  cacheCoveragePct: number;  // 0–100
}

function buildEstimationUserPrompt(params: EstimationModelParams): string {
  return `Estimate macros for these food items and judge confidence.

ORIGINAL MEAL DESCRIPTION (may contain explicit nutrition numbers):
${params.description || '(no text description provided)'}

Inputs:
- Has_text: ${params.hasText}
- Has_image: ${params.hasImage}
- Image_used: ${params.imageUsed}  (true only if image was clear enough to identify foods/portions)
- Cache_coverage_pct: ${params.cacheCoveragePct}  (0-100; percent of items found in food_cache)

Extracted items JSON:
${JSON.stringify(params.items, null, 2)}

Task:
1) CHECK the original meal description for EXPLICIT nutrition numbers (kcal, protein_g, carbs_g, fat_g, sugar_g).
2) If explicit numbers are present, use them as GROUND TRUTH — DO NOT override or adjust them.
3) For fields without explicit numbers, estimate them.
4) Produce per-item macro outputs, including caffeine_mg.
5) Sum totals — totals MUST exactly match user-provided values if given.
6) Compute confidence_score using the rubric below.
7) Fill source_of_truth indicating which fields used user numbers vs. estimates.
8) Output strict JSON with the schema provided.

CONFIDENCE RUBRIC (MUST FOLLOW EXACTLY)

Start score = 10.

Bonuses:
+75 if explicit kcal is provided for total meal OR >=60% of items have explicit kcal in description (OVERRIDE ALL CAPS — user numbers are highest quality)
+25 if Image_used == true
+10 if Has_text == true AND text detail is meaningful (>= 6 meaningful tokens; not just 1–3 generic words)
+20 if portion info is present for MOST items (>= 60% of items)
+10 if portion info is present for SOME items (>= 1 item but < 60%)
+10 if Cache_coverage_pct >= 50
+10 if brand/restaurant/prepared-source detail is present (e.g., "NYU dining hall", "Starbucks", "McDonald's", specific restaurant)

Penalties:
-50 if the meal is a SINGLE ITEM and it is GENERIC and there is NO portion info and NO explicit numbers
-25 if Has_image == false AND there is NO portion info and NO explicit numbers
-25 if Has_text == false AND there is NO portion info and NO explicit numbers
-20 if the meal is a MIXED DISH and there is NO portion info and NO explicit numbers
-15 if number of items > 6
-15 if MOST items are missing portion info (>= 60% missing) and NO explicit numbers

Hard caps (MUST APPLY if no explicit numbers):
- If SINGLE GENERIC ITEM with NO portion info and NO explicit numbers: confidence_score MUST be <= 20 (even if other bonuses exist).
- If NO portion info AND NO explicit numbers AND Image_used == false: confidence_score MUST be <= 35.
- If Has_text == false AND Has_image == true but Image_used == false and NO explicit numbers: confidence_score MUST be <= 25.
- If BOTH text and image exist AND portion info present for most items AND image_used true: confidence_score MAY be high (70–95) depending on clarity.
- If explicit kcal/macros provided: confidence MUST be >=85 regardless of other factors.

After scoring, clamp to 0–100.

Now output STRICT JSON in this schema:

{
  "items": [
    {
      "name_normalized": "string",
      "kcal": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "sugar_g": number,
      "caffeine_mg": number,
      "notes": "short optional note about assumptions"
    }
  ],
  "totals": {
    "kcal": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "sugar_g": number,
    "caffeine_mg": number
  },
  "confidence_score": number,
  "confidence_reasons": ["string","string"],
  "improvement_tips": ["string","string"],
  "llm_comment": "string",
  "scoring_breakdown": {
    "start": 10,
    "bonuses": [{"label":"string","points": number}],
    "penalties": [{"label":"string","points": number}],
    "caps_applied": ["string"],
    "final_before_clamp": number,
    "final": number
  },
  "source_of_truth": {
    "used_user_numbers": boolean,
    "user_numbers_fields_used": ["field names that came from user text"],
    "estimated_fields": ["field names that were estimated"],
    "notes": "explanation of what was used vs estimated"
  }
}`;
}

// ---- API call helpers ----

export interface LLMCallResult<T> {
  data: T;
  usage: TokenUsage;
}

/**
 * Call extraction model (gpt-4.1-nano) with optional vision input.
 *
 * Uses the OpenAI Responses API so we can pass image_url as a
 * vision input alongside the text prompt.
 *
 * Fallback: if the image causes an error, retries once without it.
 */
export async function callExtractionModel(
  params: ExtractionModelParams,
): Promise<LLMCallResult<ExtractionResponse>> {
  const client = getClient();
  const model = MODELS.extraction;

  const promptText = buildExtractionUserPrompt(params);

  // Build user content parts
  const userContent: Array<Record<string, string>> = [
    { type: 'input_text', text: promptText },
  ];

  // Add image if signed URL available
  if (params.imageUrl) {
    userContent.push({ type: 'input_image', image_url: params.imageUrl });
  }

  const input = [
    {
      role: 'system' as const,
      content: [{ type: 'input_text', text: EXTRACTION_SYSTEM }],
    },
    {
      role: 'user' as const,
      content: userContent,
    },
  ];

  try {
    const data = await executeExtractionCall(client, model, input);
    return data;
  } catch (err: unknown) {
    // If image was included and call failed, retry without image
    if (params.imageUrl) {
      console.warn(
        `[extraction] Vision call failed, retrying text-only: ${err instanceof Error ? err.message : err}`,
      );
      const textOnlyContent = [{ type: 'input_text', text: promptText }];
      const textOnlyInput = [
        {
          role: 'system' as const,
          content: [{ type: 'input_text', text: EXTRACTION_SYSTEM }],
        },
        {
          role: 'user' as const,
          content: textOnlyContent,
        },
      ];
      return executeExtractionCall(client, model, textOnlyInput);
    }
    throw err;
  }
}

/** Internal: execute a single extraction call via Responses API */
async function executeExtractionCall(
  client: OpenAI,
  model: string,
  input: Array<{ role: string; content: Array<Record<string, string>> }>,
): Promise<LLMCallResult<ExtractionResponse>> {
  const response = await (client as any).responses.create({
    model,
    input,
    temperature: 0.2,
    text: { format: { type: 'json_object' } },
  });

  const raw: string | undefined = response.output_text;
  if (!raw) throw new Error('Extraction model returned empty response');

  let data: ExtractionResponse;
  try {
    data = JSON.parse(raw);
  } catch {
    // One retry on JSON parse failure — same call
    const retry = await (client as any).responses.create({
      model,
      input,
      temperature: 0.2,
      text: { format: { type: 'json_object' } },
    });
    const retryRaw: string | undefined = retry.output_text;
    if (!retryRaw) throw new Error('Extraction model retry returned empty response');
    data = JSON.parse(retryRaw);
  }

  return {
    data,
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Call estimation model (gpt-4.1-mini) to estimate macros and confidence.
 * Text-only — no image is sent to this model.
 */
export async function callEstimationModel(
  params: EstimationModelParams,
): Promise<LLMCallResult<EstimationResponse>> {
  const client = getClient();
  const model = MODELS.estimation;

  const response = await (client as any).responses.create({
    model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: ESTIMATION_SYSTEM }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: buildEstimationUserPrompt(params) }],
      },
    ],
    temperature: 0.3,
    text: { format: { type: 'json_object' } },
  });

  const raw: string | undefined = response.output_text;
  if (!raw) throw new Error('Estimation model returned empty response');

  const data: EstimationResponse = JSON.parse(raw);

  return {
    data,
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
    },
  };
}
