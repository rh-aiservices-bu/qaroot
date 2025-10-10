/**
 * Generate a random 6-character alphanumeric PIN for session joining
 */
export function generateSessionPin(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars like O/0, I/1
  let pin = '';
  for (let i = 0; i < 6; i++) {
    pin += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pin;
}

/**
 * Validate a session PIN format
 */
export function isValidPin(pin: string): boolean {
  return /^[A-Z0-9]{6}$/.test(pin);
}
