import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { getPool } from '@qaroot/shared';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/v1/users
 * List all users (admin only)
 */
router.get('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, email, username, full_name, role, institution, created_at, last_login, is_active
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/users
 * Create a new user (admin only)
 */
router.post('/', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, username, password, full_name, role, institution } = req.body;

    if (!email || !username || !password || !role) {
      return res.status(400).json({ error: 'Email, username, password, and role are required' });
    }

    if (!['host', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "host" or "admin"' });
    }

    const pool = getPool();

    // Check if email or username already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, full_name, role, institution, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, email, username, full_name, role, institution, created_at, is_active`,
      [email, username, passwordHash, full_name || null, role, institution || null]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/users/:id
 * Update a user (admin only)
 */
router.put('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { email, username, password, full_name, role, institution, is_active } = req.body;

    if (role && !['host', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "host" or "admin"' });
    }

    const pool = getPool();

    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email or username conflicts with another user
    if (email || username) {
      const conflictCheck = await pool.query(
        'SELECT id FROM users WHERE (email = $1 OR username = $2) AND id != $3',
        [email || '', username || '', id]
      );

      if (conflictCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Email or username already exists' });
      }
    }

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (username !== undefined) {
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (password !== undefined && password !== '') {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${paramCount++}`);
      values.push(passwordHash);
    }
    if (full_name !== undefined) {
      updates.push(`full_name = $${paramCount++}`);
      values.push(full_name || null);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (institution !== undefined) {
      updates.push(`institution = $${paramCount++}`);
      values.push(institution || null);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING id, email, username, full_name, role, institution, created_at, is_active`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/users/:id
 * Delete a user (admin only)
 */
router.delete('/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Prevent deleting yourself
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
