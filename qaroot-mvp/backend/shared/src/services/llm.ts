import axios, { AxiosInstance } from 'axios';

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM Service Client
 * Connects to external LLM service (OpenAI-compatible API)
 * Handles embeddings and chat completions
 */
export class LLMService {
  private client: AxiosInstance;
  private embeddingClient: AxiosInstance;
  private embeddingModel: string;
  private chatModel: string;

  constructor() {
    const baseURL = process.env.EXTERNAL_LLM_URL || 'http://localhost:8080/v1';
    const apiKey = process.env.EXTERNAL_LLM_API_KEY || '';

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: parseInt(process.env.LLM_TIMEOUT || '60000', 10),
    });

    // Separate client for embeddings with shorter timeout
    const embeddingURL = process.env.EMBEDDING_SERVICE_URL || baseURL;
    const embeddingKey = process.env.EMBEDDING_SERVICE_API_KEY || apiKey;

    this.embeddingClient = axios.create({
      baseURL: embeddingURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${embeddingKey}`,
      },
      timeout: parseInt(process.env.EMBEDDING_TIMEOUT || '15000', 10),
    });

    this.embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text-v1.5';
    this.chatModel = process.env.CHAT_MODEL || 'qwen2.5-14b-instruct';
  }

  /**
   * Generate embedding for a text
   * @param text Input text to embed
   * @returns 768-dimensional embedding vector
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      console.log(`[LLM] Generating embedding using: ${this.embeddingClient.defaults.baseURL}/embeddings with model: ${this.embeddingModel}`);
      const response = await this.embeddingClient.post<any>('/embeddings', {
        model: this.embeddingModel,
        input: text,
      });

      console.log(`[LLM] Embedding response structure:`, JSON.stringify(response.data).substring(0, 200));

      // Handle different response formats
      if (response.data.embedding) {
        return response.data.embedding;
      } else if (response.data.data && response.data.data[0]?.embedding) {
        return response.data.data[0].embedding;
      } else if (Array.isArray(response.data)) {
        return response.data;
      } else {
        console.error('[LLM] Unexpected embedding response format:', response.data);
        throw new Error('Unexpected embedding response format');
      }
    } catch (error: any) {
      console.error('Failed to generate embedding:', error.response?.data || error.message);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts Array of texts to embed
   * @returns Array of 768-dimensional embedding vectors
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches of 10 to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      embeddings.push(...batchResults);
    }

    return embeddings;
  }

  /**
   * Generate chat completion
   * @param messages Conversation messages
   * @param options Additional options (temperature, max_tokens, etc.)
   * @returns AI response message
   */
  async chatCompletion(
    messages: ChatMessage[],
    options: {
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
    } = {}
  ): Promise<string> {
    try {
      const response = await this.client.post<ChatCompletionResponse>('/chat/completions', {
        model: this.chatModel,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2048,
        top_p: options.top_p ?? 0.9,
      });

      return response.data.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error('Failed to generate chat completion:', error.response?.data || error.message);
      throw new Error(`Chat completion failed: ${error.message}`);
    }
  }

  /**
   * Cluster questions by generating a summary/representative question
   * @param questions Array of similar questions
   * @returns Representative question and summary
   */
  async summarizeQuestionCluster(questions: string[]): Promise<{
    representative: string;
    summary: string;
  }> {
    const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an AI assistant helping a presenter understand audience questions. Your task is to analyze a cluster of similar questions and provide: 1) A single representative question that captures the common theme, and 2) A brief summary of what the audience is asking about.',
      },
      {
        role: 'user',
        content: `Here are ${questions.length} similar questions from the audience:\n\n${questionList}\n\nPlease provide:\n1. REPRESENTATIVE QUESTION: A single, clear question that represents this cluster\n2. SUMMARY: A 1-2 sentence summary of what the audience wants to know\n\nFormat your response as JSON:\n{\n  "representative": "...",\n  "summary": "..."\n}`,
      },
    ];

    const response = await this.chatCompletion(messages, {
      temperature: 0.3,
      max_tokens: 512,
    });

    try {
      // Try to parse JSON response
      const parsed = JSON.parse(response);
      return {
        representative: parsed.representative || questions[0],
        summary: parsed.summary || 'Multiple similar questions',
      };
    } catch {
      // If JSON parsing fails, use the first question as representative
      return {
        representative: questions[0],
        summary: response.substring(0, 200),
      };
    }
  }

  /**
   * Answer host's query about collected questions
   * @param query Host's question
   * @param context Relevant questions/clusters for context
   * @returns AI response
   */
  async answerHostQuery(query: string, context: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an AI assistant helping a presenter understand audience questions. You analyze questions collected during a presentation and answer the presenter\'s queries about themes, topics, and patterns.',
      },
      {
        role: 'user',
        content: `Context (collected audience questions):\n${context}\n\nPresenter's query: ${query}`,
      },
    ];

    return this.chatCompletion(messages, {
      temperature: 0.5,
      max_tokens: 1024,
    });
  }
}

// Create a new instance each time to avoid caching issues with tsx watch
export function getLLMService(): LLMService {
  return new LLMService();
}
