import { Router, Response } from 'express';
import QRCode from 'qrcode';
import { getPool, generateSessionPin, CreateSessionRequest } from '@qaroot/shared';
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
router.post('/', authenticate, requireRole('host', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, collection_timer_duration = 60 }: CreateSessionRequest = req.body;

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

    const result = await pool.query(
      `INSERT INTO sessions (host_id, title, description, session_pin, collection_timer_duration, session_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user!.id, title.trim(), description?.trim() || null, pin, collection_timer_duration, 'waiting']
    );

    const session = result.rows[0];

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
           collection_ended_at = NULL,
           actual_start = COALESCE(actual_start, NOW())
       WHERE id = $1 AND host_id = $2
       RETURNING *`,
      [id, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    console.log(`[Start Collection] Session ${id} started at ${result.rows[0].collection_started_at}`);

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
       SET session_status = 'paused',
           collection_ended_at = NOW()
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
    const { description } = req.body;
    const pool = getPool();

    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: 'Question description is required' });
    }

    // Increment iteration and update description
    const result = await pool.query(
      `UPDATE sessions
       SET current_iteration = current_iteration + 1,
           description = $2,
           session_status = 'active',
           collection_started_at = NOW(),
           collection_ended_at = NULL
       WHERE id = $1 AND host_id = $3
       RETURNING *`,
      [id, description.trim(), req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const session = result.rows[0];

    // Save the question text for this iteration
    await pool.query(
      `INSERT INTO iteration_questions (session_id, iteration, question_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, iteration) DO UPDATE SET question_text = $3`,
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

    // Delete related data first (cascading deletes)
    await pool.query('DELETE FROM host_chat_messages WHERE session_id = $1', [id]);
    await pool.query('DELETE FROM questions WHERE session_id = $1', [id]);
    await pool.query('DELETE FROM question_clusters WHERE session_id = $1', [id]);
    await pool.query('DELETE FROM participants WHERE session_id = $1', [id]);

    // Delete the session
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

    const result = await pool.query(
      `SELECT * FROM iteration_questions WHERE session_id = $1 ORDER BY iteration ASC`,
      [id]
    );

    res.json({ iteration_questions: result.rows });
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

export default router;
