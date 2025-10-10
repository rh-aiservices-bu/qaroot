import axios from 'axios';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:5000';
const EXTERNAL_LLM_URL = process.env.EXTERNAL_LLM_URL;
const EXTERNAL_LLM_API_KEY = process.env.EXTERNAL_LLM_API_KEY;
const EXTERNAL_LLM_MODEL = process.env.EXTERNAL_LLM_MODEL || 'llama-3-2-3b';
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '60000', 10);

// Use external LLM if configured, otherwise use llama-stack
const USE_EXTERNAL_LLM = Boolean(EXTERNAL_LLM_URL && EXTERNAL_LLM_API_KEY);

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const apiUrl = USE_EXTERNAL_LLM ? EXTERNAL_LLM_URL : LLAMA_STACK_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (USE_EXTERNAL_LLM && EXTERNAL_LLM_API_KEY) {
      headers['Authorization'] = `Bearer ${EXTERNAL_LLM_API_KEY}`;
    }

    const response = await axios.post(
      `${apiUrl}/v1/embeddings`,
      {
        input: text,
        model: 'nomic-embed-text-v1.5',
      },
      {
        headers,
        timeout: LLM_TIMEOUT,
      }
    );

    return response.data.data[0].embedding;
  } catch (error) {
    console.error('Embedding generation error:', error);
    throw new Error('Failed to generate embedding');
  }
}

export async function rephraseQuestion(questions: string[]): Promise<string> {
  try {
    const prompt = `You are helping a presenter analyze audience questions. The following questions are similar and grouped together:

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Rephrase these questions into a single, clear, representative question that captures the main intent. Return only the rephrased question without any explanation.`;

    const apiUrl = USE_EXTERNAL_LLM ? EXTERNAL_LLM_URL : LLAMA_STACK_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (USE_EXTERNAL_LLM && EXTERNAL_LLM_API_KEY) {
      headers['Authorization'] = `Bearer ${EXTERNAL_LLM_API_KEY}`;
    }

    const response = await axios.post(
      `${apiUrl}/v1/chat/completions`,
      {
        model: USE_EXTERNAL_LLM ? EXTERNAL_LLM_MODEL : 'qwen2.5-14b-instruct',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 256,
      },
      {
        headers,
        timeout: LLM_TIMEOUT,
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Question rephrasing error:', error);
    throw new Error('Failed to rephrase question');
  }
}

export async function generateClusterLabel(questions: string[]): Promise<string> {
  try {
    const prompt = `You are helping a presenter analyze audience questions. The following questions are grouped together:

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Generate a short, concise topic label (2-5 words) that describes what these questions are about. Return only the label without any explanation.`;

    const apiUrl = USE_EXTERNAL_LLM ? EXTERNAL_LLM_URL : LLAMA_STACK_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (USE_EXTERNAL_LLM && EXTERNAL_LLM_API_KEY) {
      headers['Authorization'] = `Bearer ${EXTERNAL_LLM_API_KEY}`;
    }

    const response = await axios.post(
      `${apiUrl}/v1/chat/completions`,
      {
        model: USE_EXTERNAL_LLM ? EXTERNAL_LLM_MODEL : 'qwen2.5-14b-instruct',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 32,
      },
      {
        headers,
        timeout: LLM_TIMEOUT,
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Cluster label generation error:', error);
    return 'Unlabeled Topic';
  }
}
