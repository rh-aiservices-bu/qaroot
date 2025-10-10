import { Server, Socket } from 'socket.io';
import { getPool, SubmitQuestionRequest } from '@qaroot/shared';
import { createRedisClient } from '../services/redis';

const SUBMISSION_COOLDOWN = 5000; // 5 seconds between submissions

export function handleQuestionEvents(io: Server, socket: Socket) {
  const redis = createRedisClient();

  /**
   * Handle question submission
   */
  socket.on('question:submit', async (data: SubmitQuestionRequest, callback) => {
    try {
      const { session_id, question_text, participant_id } = data;

      // Validate inputs
      if (!session_id || !question_text) {
        return callback?.({ error: 'Session ID and question text are required' });
      }

      if (question_text.length > 500) {
        return callback?.({ error: 'Question text must be 500 characters or less' });
      }

      const pool = getPool();

      // Check if session is active
      const sessionResult = await pool.query(
        `SELECT session_status, collection_started_at, collection_ended_at, collection_timer_duration, current_iteration
         FROM sessions WHERE id = $1`,
        [session_id]
      );

      if (sessionResult.rows.length === 0) {
        return callback?.({ error: 'Session not found' });
      }

      const session = sessionResult.rows[0];

      // Check if collection is active
      if (session.session_status !== 'active') {
        return callback?.({ error: 'Question collection is not active' });
      }

      if (session.collection_ended_at) {
        return callback?.({ error: 'Question collection has ended' });
      }

      // Check cooldown (rate limiting per socket)
      const cooldownKey = `cooldown:${socket.id}`;
      const lastSubmission = await redis.get(cooldownKey);

      if (lastSubmission) {
        const elapsed = Date.now() - parseInt(lastSubmission, 10);
        if (elapsed < SUBMISSION_COOLDOWN) {
          return callback?.({
            error: `Please wait ${Math.ceil((SUBMISSION_COOLDOWN - elapsed) / 1000)} seconds before submitting another question`
          });
        }
      }

      // Insert question with current iteration
      const result = await pool.query(
        `INSERT INTO questions (session_id, participant_id, question_text, iteration)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [session_id, participant_id || null, question_text.trim(), session.current_iteration]
      );

      const question = result.rows[0];

      // Update session question count
      await pool.query(
        'UPDATE sessions SET question_count = question_count + 1 WHERE id = $1',
        [session_id]
      );

      // Set cooldown
      await redis.setex(cooldownKey, SUBMISSION_COOLDOWN / 1000, Date.now().toString());

      // Broadcast new question to host
      io.to(`session:${session_id}:host`).emit('question:new', question);

      // Update participant count broadcast
      const countResult = await pool.query(
        'SELECT question_count, participant_count FROM sessions WHERE id = $1',
        [session_id]
      );

      io.to(`session:${session_id}:host`).emit('session:update', {
        question_count: countResult.rows[0].question_count,
        participant_count: countResult.rows[0].participant_count,
      });

      callback?.({ success: true, question });
    } catch (error) {
      console.error('Question submit error:', error);
      callback?.({ error: 'Failed to submit question' });
    }
  });
}
