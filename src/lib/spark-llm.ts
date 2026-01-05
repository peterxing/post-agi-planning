const normalizeContentArray = (content: unknown): string | null => {
  if (!Array.isArray(content)) return null;

  const combined = content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof (part as any).text === 'string') return (part as any).text;
      if (part && typeof (part as any).content === 'string') return (part as any).content;
      return '';
    })
    .join('')
    .trim();

  return combined || null;
};

const normalizeSparkOutput = (raw: unknown): string | null => {
  if (typeof raw === 'string') return raw.trim();
  if (!raw || typeof raw !== 'object') return null;

  const output =
    (raw as any).output ||
    (raw as any).text ||
    (raw as any).content ||
    (raw as any).message?.content ||
    (raw as any).choices?.[0]?.message?.content;

  if (typeof output === 'string') return output.trim();

  const normalizedFromArray = normalizeContentArray(output);
  if (normalizedFromArray) return normalizedFromArray;

  const messageContent = (raw as any).message?.content;
  const normalizedFromMessageArray = normalizeContentArray(messageContent);
  if (normalizedFromMessageArray) return normalizedFromMessageArray;

  return null;
};

export async function generateSparkText(prompt: string, model = 'gpt-4o'): Promise<string | null> {
  const spark = (window as any)?.spark;

  if (!spark) return null;

  // Prefer new actions-based API when available
  const actionsLlm = spark.actions?.generateText;
  if (typeof actionsLlm === 'function') {
    try {
      const response = await actionsLlm({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const normalized = normalizeSparkOutput(response);
      if (normalized) return normalized;
    } catch (error) {
      console.error('Spark actions.generateText failed', error);
    }
  }

  const legacyLlm = spark.llm;
  if (typeof legacyLlm === 'function') {
    try {
      const legacyResponse = await legacyLlm(prompt, model);
      const normalized = normalizeSparkOutput(legacyResponse);
      if (normalized) return normalized;
    } catch (error) {
      console.error('Spark legacy llm failed', error);
    }
  }

  return null;
}
