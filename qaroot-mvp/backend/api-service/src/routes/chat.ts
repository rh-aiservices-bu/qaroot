import { Router, Response } from 'express';
import { getPool, getLLMService } from '@qaroot/shared';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /api/v1/sessions/:id/chat
 * Send a message to the AI chat agent
 */
router.post('/:id/chat', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id: session_id } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const pool = getPool();

    // Verify session ownership
    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [session_id, req.user!.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    // Store user message
    await pool.query(
      'INSERT INTO host_chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
      [session_id, 'user', message]
    );

    // Get chat history
    const historyResult = await pool.query(
      'SELECT role, content FROM host_chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [session_id]
    );

    // Get all questions and clusters for context
    const questionsResult = await pool.query(
      `SELECT
        q.id, q.question_text, q.cluster_id,
        c.representative_question, c.summary
       FROM questions q
       LEFT JOIN question_clusters c ON q.cluster_id = c.id
       WHERE q.session_id = $1
       ORDER BY c.question_count DESC NULLS LAST, q.submitted_at ASC`,
      [session_id]
    );

    const questions = questionsResult.rows;

    // Build context string
    const sessionData = sessionResult.rows[0];
    let context = `Session: "${sessionData.title}"\n`;
    context += `Total questions: ${questions.length}\n\n`;

    // Group by cluster
    const clustersMap = new Map<string | null, any[]>();
    for (const q of questions) {
      const clusterId = q.cluster_id || null;
      if (!clustersMap.has(clusterId)) {
        clustersMap.set(clusterId, []);
      }
      clustersMap.get(clusterId)!.push(q);
    }

    // Add clustered questions to context
    let clusterNum = 1;
    for (const [clusterId, clusterQuestions] of clustersMap.entries()) {
      if (clusterId) {
        const first = clusterQuestions[0];
        context += `\nCluster ${clusterNum} (${clusterQuestions.length} questions):\n`;
        context += `Representative: "${first.representative_question}"\n`;
        context += `Summary: ${first.summary}\n`;
        clusterNum++;
      }
    }

    // Get AI response using LLM service
    const llmService = getLLMService();
    const aiResponse = await llmService.answerHostQuery(message, context);

    // Store AI response
    await pool.query(
      'INSERT INTO host_chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
      [session_id, 'assistant', aiResponse]
    );

    res.json({
      role: 'assistant',
      content: aiResponse,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/:id/chat
 * Get chat history for a session
 */
router.get('/:id/chat', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id: session_id } = req.params;
    const pool = getPool();

    // Verify session ownership
    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [session_id, req.user!.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const result = await pool.query(
      'SELECT * FROM host_chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [session_id]
    );

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
