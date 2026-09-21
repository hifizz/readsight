import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';

export const RELATA_MODEL_ID = process.env.RELATA_AI_MODEL ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
export const ANALYSIS_PROMPT_VERSION = 'source-analysis-v1';
export const INSIGHT_PROMPT_VERSION = 'project-insight-v1';
export const CONVERSATION_PROMPT_VERSION = 'contextual-conversation-v1';

const apiKey = process.env.OPENROUTER_API_KEY;
export const relataModel: LanguageModel | null = apiKey
  ? createOpenAICompatible({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      headers: { 'HTTP-Referer': 'https://relata.app', 'X-Title': 'Relata' },
    })(RELATA_MODEL_ID)
  : null;

const analysisOutputSchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  entities: z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
  contentType: z.string().nullable().default(null),
  intentInterpretations: z.array(z.object({
    meaning: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })).default([]),
});

const insightOutputSchema = z.object({
  whyItMatters: z.string().min(1),
  implications: z.array(z.string()).default([]),
});

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return schema.parse(JSON.parse(candidate));
}

async function jsonGeneration<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
  if (!relataModel) throw new Error('model_not_configured');
  const result = await generateText({ model: relataModel, system, prompt, temperature: 0.2 });
  return parseJson(result.text, schema);
}

export async function generateSourceAnalysis(input: {
  title: string;
  url: string;
  pageText?: string;
  memo: string | null;
}) {
  return jsonGeneration(
    'You are Relata. Analyze saved sources faithfully. Return JSON only and never invent facts absent from the input.',
    JSON.stringify({
      task: 'Return summary, keyPoints, topics, entities, contentType, and intentInterpretations.',
      outputShape: { summary: 'string', keyPoints: ['string'], topics: ['string'], entities: [{ name: 'string', type: 'string' }], contentType: 'string|null', intentInterpretations: [{ meaning: 'string', confidence: 0.8, arguments: {} }] },
      source: input,
    }),
    analysisOutputSchema,
  );
}

export async function generateProjectInsight(input: {
  project: { name: string; description: string | null };
  source: { title: string; url: string };
  analysis: { summary: string; keyPoints: unknown };
}) {
  return jsonGeneration(
    'You are Relata. Explain relevance to the named project using only supplied context. Return JSON only.',
    JSON.stringify({ task: 'Return whyItMatters and implications.', outputShape: { whyItMatters: 'string', implications: ['string'] }, ...input }),
    insightOutputSchema,
  );
}

export async function generateConversationReply(systemContext: unknown, history: unknown[]): Promise<string> {
  if (!relataModel) throw new Error('model_not_configured');
  const result = await generateText({
    model: relataModel,
    system: `You are Relata, a concise research companion. Ground answers in the supplied saved context. Context: ${JSON.stringify(systemContext)}`,
    prompt: JSON.stringify({ conversation: history, instruction: 'Answer the latest user message.' }),
    temperature: 0.3,
  });
  return result.text.trim();
}
