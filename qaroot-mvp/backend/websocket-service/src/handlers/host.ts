import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getPool } from '@qaroot/shared';

interface HostSocket extends Socket {
  userId?: string;
}

// Track active collection timers
const activeTimers = new Map<string, NodeJS.Timeout>();

export function handleHostEvents(io: Server, socket: HostSocket) {
  /**
   * Handle host joining their session room
   */
  socket.on('host:join', async (data: { session_id: string; token: string }, callback) => {
    try {
      const { session_id, token } = data;
      console.log('[Host] Join request:', { session_id, has_token: !!token });

      if (!session_id || !token) {
        return callback?.({ error: 'Session ID and token are required' });
      }

      // Verify JWT token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
        socket.userId = decoded.id;
        console.log('[Host] Token verified for user:', decoded.id);
      } catch (error) {
        console.error('[Host] Token verification failed:', error);
        return callback?.({ error: 'Invalid or expired token' });
      }

      // Join host room for this session
      socket.join(`session:${session_id}:host`);
      console.log('[Host] Joined room:', `session:${session_id}:host`);

      callback?.({ success: true });
    } catch (error) {
      console.error('Host join error:', error);
      callback?.({ error: 'Failed to join session as host' });
    }
  });

  /**
   * Handle collection timer start
   */
  socket.on('collection:start', async (data: { session_id: string }) => {
    const { session_id } = data;
    console.log('[collection:start] Event received for session:', session_id);

    try {
      const pool = getPool();

      // Get session timer duration and description
      const sessionResult = await pool.query(
        'SELECT collection_timer_duration, collection_started_at, description FROM sessions WHERE id = $1',
        [session_id]
      );

      if (sessionResult.rows.length === 0) {
        console.error('Session not found:', session_id);
        return;
      }

      const session = sessionResult.rows[0];
      const timerDuration = session.collection_timer_duration || 60;
      const startedAt = session.collection_started_at;
      const description = session.description;

      console.log(`[collection:start] Session ${session_id}: timer duration = ${timerDuration}s, started_at = ${startedAt}, description = ${description}`);

      // Clear any existing timer for this session
      if (activeTimers.has(session_id)) {
        console.log(`[collection:start] Clearing existing timer for session ${session_id}`);
        clearTimeout(activeTimers.get(session_id)!);
        activeTimers.delete(session_id);
      }

      // Set up auto-end timer
      const timeoutMs = timerDuration * 1000;
      console.log(`[collection:start] Setting timer for ${timeoutMs}ms (${timerDuration}s) for session ${session_id}`);
      const timerId = setTimeout(async () => {
        console.log(`[Auto-timer] Ending collection for session ${session_id}`);

        try {
          // Update session status in database
          await pool.query(
            'UPDATE sessions SET session_status = $1 WHERE id = $2',
            ['paused', session_id]
          );

          // Broadcast to all participants
          io.to(`session:${session_id}:participant`).emit('collection:ended', {
            session_id,
            ended_at: new Date(),
          });

          // Notify host
          io.to(`session:${session_id}:host`).emit('session:update', {
            session_status: 'paused',
          });

          // Clean up timer reference
          activeTimers.delete(session_id);
        } catch (error) {
          console.error('Error auto-ending collection:', error);
        }
      }, timeoutMs);

      activeTimers.set(session_id, timerId);

      // Broadcast to all participants in this session
      io.to(`session:${session_id}:participant`).emit('collection:started', {
        session_id,
        started_at: startedAt || new Date(),
        description,
        timer_duration: timerDuration,
      });
    } catch (error) {
      console.error('Error starting collection timer:', error);
    }
  });

  /**
   * Handle collection timer end
   */
  socket.on('collection:end', async (data: { session_id: string }) => {
    const { session_id } = data;

    // Clear any active timer for this session
    if (activeTimers.has(session_id)) {
      clearTimeout(activeTimers.get(session_id)!);
      activeTimers.delete(session_id);
    }

    // Broadcast to all participants in this session
    io.to(`session:${session_id}:participant`).emit('collection:ended', {
      session_id,
      ended_at: new Date(),
    });
  });

  /**
   * Handle session updates (e.g., topic changes)
   */
  socket.on('session:update', async (data: { session_id: string; description?: string; session_status?: string }) => {
    const { session_id, description, session_status } = data;

    console.log('[Host] Session update:', { session_id, description, session_status });

    // Broadcast session update to all participants
    io.to(`session:${session_id}:participant`).emit('session:update', {
      description,
      session_status,
    });

    // Also broadcast to host room for multi-host scenarios
    io.to(`session:${session_id}:host`).emit('session:update', {
      description,
      session_status,
    });
  });
}
