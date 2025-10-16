import { Router, Response } from 'express';
import QRCode from 'qrcode';
import { getPool, generateSessionPin, CreateSessionRequest, getLLMService } from '@qaroot/shared';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { publishMessage } from '../services/queue';

const router = Router();

/**
 * GET /api/v1/sessions
 * List all sessions for the current user
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();

    const result = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM questions WHERE session_id = s.id) as question_count
       FROM sessions s
       WHERE s.host_id = $1
       ORDER BY s.created_at DESC`,
      [req.user!.id]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/sessions
 * Create a new session
 */
router.post('/', authenticate, requireRole('facilitator', 'host', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, collection_timer_duration }: CreateSessionRequest = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Session title is required' });
    }

    const pool = getPool();
    let pin = generateSessionPin();
    let attempts = 0;

    // Ensure PIN is unique
    while (attempts < 10) {
      const pinCheck = await pool.query('SELECT id FROM sessions WHERE session_pin = $1', [pin]);
      if (pinCheck.rows.length === 0) break;
      pin = generateSessionPin();
      attempts++;
    }

    const timerDuration = collection_timer_duration || 60; // Default to 60 seconds if not provided

    const result = await pool.query(
      `INSERT INTO sessions (host_id, title, description, session_pin, collection_timer_duration)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user!.id, title.trim(), description?.trim() || null, pin, timerDuration]
    );

    const session = result.rows[0];

    // Store the initial question in iteration_questions table (iteration 1)
    if (description && description.trim().length > 0) {
      await pool.query(
        `INSERT INTO iteration_questions (session_id, iteration, question_text)
         VALUES ($1, 1, $2)`,
        [session.id, description.trim()]
      );
    }

    // Generate QR code for joining
    const joinUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/join/${pin}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl);

    res.status(201).json({
      session,
      qr_code_url: qrCodeDataUrl,
      join_url: joinUrl,
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/:id
 * Get session details
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/sessions/:id/start
 * Start question collection
 */
router.post('/:id/start', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE sessions
       SET session_status = 'active',
           collection_started_at = NOW(),
           actual_start = COALESCE(actual_start, NOW())
       WHERE id = $1 AND host_id = $2
       RETURNING *`,
      [id, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/sessions/:id/end
 * End question collection
 */
router.post('/:id/end', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE sessions
       SET session_status = 'completed',
           ended_at = NOW()
       WHERE id = $1 AND host_id = $2
       RETURNING *`,
      [id, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/sessions/:id/new-question
 * Start a new question iteration (change question and restart collection)
 */
router.post('/:id/new-question', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { description, collection_timer_duration } = req.body;
    const pool = getPool();

    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: 'Question description is required' });
    }

    // Build UPDATE query dynamically based on whether timer duration is provided
    let updateQuery = `UPDATE sessions
       SET description = $2,
           session_status = 'active',
           collection_started_at = NOW(),
           actual_start = COALESCE(actual_start, NOW()),
           current_iteration = current_iteration + 1`;

    const queryParams: any[] = [id, description.trim()];

    // Add timer duration to update if provided
    if (collection_timer_duration !== undefined) {
      updateQuery += `, collection_timer_duration = $${queryParams.length + 1}`;
      queryParams.push(collection_timer_duration);
    }

    updateQuery += `
       WHERE id = $1 AND host_id = $${queryParams.length + 1}
       RETURNING *`;

    queryParams.push(req.user!.id);

    // Increment iteration and update session
    const result = await pool.query(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const session = result.rows[0];

    // Store the new question in iteration_questions table
    await pool.query(
      `INSERT INTO iteration_questions (session_id, iteration, question_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, iteration) DO UPDATE
       SET question_text = EXCLUDED.question_text`,
      [id, session.current_iteration, description.trim()]
    );

    res.json({ session });
  } catch (error) {
    console.error('New question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/sessions/:id
 * Delete a session
 */
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Delete the session (cascading deletes will handle related data)
    const result = await pool.query(
      'DELETE FROM sessions WHERE id = $1 AND host_id = $2 RETURNING id',
      [id, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/sessions/:id/analyze
 * Trigger question analysis
 */
router.post('/:id/analyze', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { iteration } = req.body;
    const pool = getPool();

    // Verify session ownership
    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [id, req.user!.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    // Publish analysis job to queue with optional iteration
    await publishMessage('analyze.questions', {
      session_id: id,
      iteration: iteration || null
    });

    res.status(202).json({ message: 'Analysis started', session_id: id, iteration: iteration || null });
  } catch (error) {
    console.error('Analyze session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/:id/questions
 * Get all questions for a session (with optional clustering)
 */
router.get('/:id/questions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT q.*, p.nickname as participant_nickname
       FROM questions q
       LEFT JOIN participants p ON q.participant_id = p.id
       WHERE q.session_id = $1
       ORDER BY q.submitted_at ASC`,
      [id]
    );

    res.json({ questions: result.rows });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/:id/iteration-questions
 * Get iteration questions for a session
 */
router.get('/:id/iteration-questions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Get iteration questions from the table
    const result = await pool.query(
      `SELECT * FROM iteration_questions WHERE session_id = $1 ORDER BY iteration ASC`,
      [id]
    );

    const iterationQuestions = result.rows;

    // If iteration 1 is missing, use the session description as a fallback
    if (!iterationQuestions.some((iq: any) => iq.iteration === 1)) {
      const sessionResult = await pool.query(
        'SELECT description FROM sessions WHERE id = $1',
        [id]
      );

      if (sessionResult.rows.length > 0 && sessionResult.rows[0].description) {
        iterationQuestions.unshift({
          session_id: id,
          iteration: 1,
          question_text: sessionResult.rows[0].description,
          created_at: new Date()
        });
      }
    }

    res.json({ iteration_questions: iterationQuestions });
  } catch (error) {
    console.error('Get iteration questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/:id/clusters
 * Get question clusters for a session
 */
router.get('/:id/clusters', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const clustersResult = await pool.query(
      'SELECT * FROM question_clusters WHERE session_id = $1 ORDER BY question_count DESC',
      [id]
    );

    const clusters = await Promise.all(
      clustersResult.rows.map(async (cluster) => {
        const questionsResult = await pool.query(
          `SELECT q.*, p.nickname as participant_nickname
           FROM questions q
           LEFT JOIN participants p ON q.participant_id = p.id
           WHERE q.cluster_id = $1
           ORDER BY q.submitted_at ASC`,
          [cluster.id]
        );

        return {
          ...cluster,
          questions: questionsResult.rows,
        };
      })
    );

    res.json({ clusters });
  } catch (error) {
    console.error('Get clusters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/sessions/chat/default-prompt
 * Get the default chat prompt
 */
router.get('/chat/default-prompt', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const defaultPrompt = process.env.DEFAULT_CHAT_PROMPT || '';
    res.json({ prompt: defaultPrompt });
  } catch (error: any) {
    console.error('Get default prompt error:', error);
    res.status(500).json({ error: 'Failed to get default prompt' });
  }
});

/**
 * POST /api/v1/sessions/:id/chat
 * Chat with LLM about session responses
 */
router.post('/:id/chat', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { message, iteration } = req.body;
    const pool = getPool();

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!iteration || iteration < 1) {
      return res.status(400).json({ error: 'Valid iteration number is required' });
    }

    // Verify session ownership
    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [id, req.user!.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const session = sessionResult.rows[0];

    // Get questions for the specific iteration only
    const questionsResult = await pool.query(
      `SELECT q.question_text, q.submitted_at, q.iteration, p.nickname as participant_nickname
       FROM questions q
       LEFT JOIN participants p ON q.participant_id = p.id
       WHERE q.session_id = $1 AND q.iteration = $2
       ORDER BY q.submitted_at ASC`,
      [id, iteration]
    );

    const questions = questionsResult.rows;

    // Get the topic for this iteration
    const iterationQuestionResult = await pool.query(
      `SELECT question_text FROM iteration_questions WHERE session_id = $1 AND iteration = $2`,
      [id, iteration]
    );

    const topicText = iterationQuestionResult.rows[0]?.question_text || 'N/A';

    // Calculate statistics about participants and responses
    const uniqueParticipants = new Set(questions.map(q => q.participant_nickname || 'Anonymous'));
    const participantCounts = new Map<string, number>();
    questions.forEach(q => {
      const participant = q.participant_nickname || 'Anonymous';
      participantCounts.set(participant, (participantCounts.get(participant) || 0) + 1);
    });
    const firstResponder = questions.length > 0 ? (questions[0].participant_nickname || 'Anonymous') : 'N/A';

    // Build context for LLM - only include current iteration
    let context = `Session: ${session.title}\n`;
    context += `Topic: ${topicText}\n\n`;
    context += `Statistics:\n`;
    context += `- Total responses: ${questions.length}\n`;
    context += `- Unique participants: ${uniqueParticipants.size}\n`;
    context += `- First responder: ${firstResponder}\n`;
    context += `- Responses per participant:\n`;
    participantCounts.forEach((count, participant) => {
      context += `  - ${participant}: ${count} response${count > 1 ? 's' : ''}\n`;
    });
    context += `\nResponses:\n`;

    questions.forEach((q, idx) => {
      const timestamp = new Date(q.submitted_at).toLocaleString();
      const participant = q.participant_nickname || 'Anonymous';
      context += `  ${idx + 1}. "${q.question_text}" - ${participant} at ${timestamp}\n`;
    });

    // Call LLM
    const llmService = getLLMService();
    const response = await llmService.chatCompletion([
      {
        role: 'system',
        content: 'You are an AI assistant helping a host understand participant responses for a specific topic in their session. You have access to the responses with timestamps and participant names for this topic only. Provide helpful insights, summaries, and analysis when asked. Be concise and actionable.'
      },
      {
        role: 'user',
        content: `${context}\n\nHost's question: ${message}`
      }
    ], {
      temperature: 0.7,
      max_tokens: 1024
    });

    res.json({
      role: 'assistant',
      content: response
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

export default router;
