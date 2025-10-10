import axios from 'axios';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:5000';
const EXTERNAL_LLM_URL = process.env.EXTERNAL_LLM_URL;
const EXTERNAL_LLM_API_KEY = process.env.EXTERNAL_LLM_API_KEY;
const EXTERNAL_LLM_MODEL = process.env.EXTERNAL_LLM_MODEL || 'llama-3-2-3b';

// Use external LLM if configured, otherwise use llama-stack
const USE_EXTERNAL_LLM = Boolean(EXTERNAL_LLM_URL && EXTERNAL_LLM_API_KEY);

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface QuestionCluster {
  cluster_label?: string;
  representative_question?: string;
  question_count: number;
  questions?: string[];
}

export async function chatWithAI(
  history: ChatMessage[],
  userMessage: string,
  clusters: QuestionCluster[]
): Promise<string> {
  try {
    // Build context from question clusters
    const contextParts: string[] = [
      'You are an AI assistant helping a presenter analyze questions from their audience.',
      'The questions have been grouped into clusters. Here are the clusters:\n',
    ];

    clusters.forEach((cluster, idx) => {
      contextParts.push(
        `Cluster ${idx + 1}: "${cluster.representative_question || cluster.cluster_label || 'Unlabeled'}" (${cluster.question_count} questions)`
      );
      if (cluster.questions && cluster.questions.length > 0) {
        contextParts.push('  Questions:');
        cluster.questions.slice(0, 5).forEach((q) => {
          contextParts.push(`  - ${q}`);
        });
        if (cluster.questions.length > 5) {
          contextParts.push(`  ... and ${cluster.questions.length - 5} more`);
        }
      }
      contextParts.push('');
    });

    contextParts.push(
      '\nHelp the presenter understand these questions, identify main topics, rephrase questions for clarity, or answer specific queries about the audience feedback.'
    );

    const systemMessage = contextParts.join('\n');

    // Build messages array
    const messages = [
      { role: 'system', content: systemMessage },
      ...history.slice(-10), // Last 10 messages for context
      { role: 'user', content: userMessage },
    ];

    // Call LLM inference API
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
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      },
      {
        headers,
        timeout: 60000,
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Llama Stack chat error:', error);
    throw new Error('Failed to get AI response');
  }
}

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
        timeout: 30000,
      }
    );

    return response.data.data[0].embedding;
  } catch (error) {
    console.error('Llama Stack embedding error:', error);
    throw new Error('Failed to generate embedding');
  }
}
