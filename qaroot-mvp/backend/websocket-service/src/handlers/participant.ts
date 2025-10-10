import { Server, Socket } from 'socket.io';
import { getPool } from '@qaroot/shared';

export function handleParticipantEvents(io: Server, socket: Socket) {
  /**
   * Handle participant joining a session
   */
  socket.on('participant:join', async (data: { session_id?: string; session_pin?: string; nickname?: string }, callback) => {
    try {
      const { session_id, session_pin, nickname } = data;

      console.log('[Participant] Join request:', { session_id, session_pin, nickname });
      console.log('[Participant] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

      if (!session_id && !session_pin) {
        return callback?.({ error: 'Session ID or PIN is required' });
      }

      const pool = getPool();

      // Check if session exists (by ID or PIN)
      const sessionResult = session_pin
        ? await pool.query('SELECT * FROM sessions WHERE session_pin = $1', [session_pin])
        : await pool.query('SELECT * FROM sessions WHERE id = $1', [session_id]);

      if (sessionResult.rows.length === 0) {
        return callback?.({ error: 'Session not found' });
      }

      const session = sessionResult.rows[0];
      const actualSessionId = session.id;

      let participant = null;

      // If nickname provided, create participant record
      if (nickname && nickname.trim().length > 0) {
        try {
          const result = await pool.query(
            `INSERT INTO participants (session_id, nickname)
             VALUES ($1, $2)
             ON CONFLICT (session_id, nickname)
             DO UPDATE SET last_seen = NOW(), is_active = true
             RETURNING *`,
            [actualSessionId, nickname.trim()]
          );

          participant = result.rows[0];

          // Update participant count
          await pool.query(
            `UPDATE sessions
             SET participant_count = (
               SELECT COUNT(*) FROM participants
               WHERE session_id = $1 AND is_active = true
             )
             WHERE id = $1`,
            [actualSessionId]
          );
        } catch (error) {
          console.error('Participant creation error:', error);
        }
      }

      // Join session room
      socket.join(`session:${actualSessionId}:participant`);

      // Notify host of new participant
      const countResult = await pool.query(
        'SELECT participant_count FROM sessions WHERE id = $1',
        [actualSessionId]
      );

      io.to(`session:${actualSessionId}:host`).emit('session:update', {
        participant_count: countResult.rows[0].participant_count,
      });

      if (participant) {
        io.to(`session:${actualSessionId}:host`).emit('participant:joined', participant);
      }

      callback?.({ success: true, participant, session });
    } catch (error) {
      console.error('Participant join error:', error);
      callback?.({ error: 'Failed to join session' });
    }
  });

  /**
   * Handle participant leaving
   */
  socket.on('disconnect', async () => {
    // Future: mark participant as inactive
  });
}
