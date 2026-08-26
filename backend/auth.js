/**
 * Authentication core: password verification, OTP sessions, JWT issuing/verifying.
 *
 * Security rules enforced here:
 *  - No default/hardcoded admin password. The server refuses to start without one.
 *  - JWT secret is required and never has a fallback value.
 *  - OTP codes are per-login-session, hashed at rest, single-use, attempt-limited.
 *  - A failed OTP delivery is a hard failure: it never grants access.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('dotenv').config();

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PENDING = 20; // hard cap on concurrent pending logins

// ─── Configuration validation (fail fast, never fall back to a known secret) ───

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const OWNER_PHONE_NUMBER = process.env.OWNER_PHONE_NUMBER;
const ALLOW_LOGIN_WITHOUT_OTP = process.env.ALLOW_LOGIN_WITHOUT_OTP === 'true';

function assertConfigured() {
  const problems = [];

  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    problems.push(
      'JWT_SECRET is missing or shorter than 32 characters. Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }

  if (!ADMIN_PASSWORD_HASH && !ADMIN_PASSWORD) {
    problems.push(
      'No admin password configured. Set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD.\n' +
      '  Generate a hash with: node backend/scripts/hashPassword.js "your-password"'
    );
  }

  if (problems.length > 0) {
    console.error('\n=== FATAL: authentication is not configured ===');
    problems.forEach(p => console.error('- ' + p));
    console.error('=== Server will not start. ===\n');
    process.exit(1);
  }

  if (!ADMIN_PASSWORD_HASH && ADMIN_PASSWORD) {
    console.warn(
      '[AUTH] ADMIN_PASSWORD is set as plain text. Prefer ADMIN_PASSWORD_HASH — ' +
      'run: node backend/scripts/hashPassword.js "your-password"'
    );
  }

  if (!OWNER_PHONE_NUMBER) {
    console.warn(
      '[AUTH] OWNER_PHONE_NUMBER is not set — two-factor OTP is DISABLED and login is password-only.'
    );
  }
}

// ─── Password ───

/** Constant-time-ish password check against either the hash or the plain env value. */
async function verifyPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  if (ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(candidate, ADMIN_PASSWORD_HASH);
  }

  const expected = Buffer.from(ADMIN_PASSWORD, 'utf8');
  const given = Buffer.from(candidate, 'utf8');
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

// ─── Per-account lockout ───
//
// The IP rate limit alone is not enough: an attacker with a pool of addresses
// walks straight past it, and a legitimate office behind one connection gets
// punished for a colleague's typo. This counts failures per username instead.

const ACCOUNT_LOCK_THRESHOLD = 8;
const ACCOUNT_LOCK_WINDOW_MS = 15 * 60 * 1000;

const accountFailures = new Map(); // username -> { failures: number[], lockedUntil }

function accountKey(username) {
  return String(username || '').trim().toLowerCase();
}

/** Returns { locked, retryAfterSeconds } for an account before its password is checked. */
function checkAccountLock(username) {
  const key = accountKey(username);
  const record = accountFailures.get(key);
  if (!record) return { locked: false };

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000) };
  }

  return { locked: false };
}

function recordLoginFailure(username) {
  const key = accountKey(username);
  const cutoff = Date.now() - ACCOUNT_LOCK_WINDOW_MS;

  const record = accountFailures.get(key) || { failures: [], lockedUntil: 0 };
  record.failures = record.failures.filter(t => t > cutoff);
  record.failures.push(Date.now());

  if (record.failures.length >= ACCOUNT_LOCK_THRESHOLD) {
    record.lockedUntil = Date.now() + ACCOUNT_LOCK_WINDOW_MS;
    record.failures = [];
  }

  accountFailures.set(key, record);

  // Bounded so a flood of invented usernames cannot grow this without limit.
  if (accountFailures.size > 500) {
    const oldest = accountFailures.keys().next().value;
    accountFailures.delete(oldest);
  }
}

function clearLoginFailures(username) {
  accountFailures.delete(accountKey(username));
}

// ─── OTP sessions ───

/** otpSessionId -> { codeHash, expiresAt, attempts } */
const pendingLogins = new Map();

function prunePendingLogins() {
  const now = Date.now();
  for (const [id, session] of pendingLogins) {
    if (session.expiresAt <= now) pendingLogins.delete(id);
  }
  // If still over the cap, drop the oldest entries (Map preserves insertion order).
  while (pendingLogins.size >= OTP_MAX_PENDING) {
    const oldest = pendingLogins.keys().next().value;
    pendingLogins.delete(oldest);
  }
}

/**
 * Creates a pending login session and returns { otpSessionId, code }.
 * The plain code is returned once, for delivery only — it is never stored.
 */
function createOtpSession() {
  prunePendingLogins();

  const otpSessionId = crypto.randomBytes(24).toString('hex');
  const code = crypto.randomInt(100000, 1000000).toString();

  pendingLogins.set(otpSessionId, {
    codeHash: bcrypt.hashSync(code, 10),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  });

  return { otpSessionId, code };
}

function discardOtpSession(otpSessionId) {
  pendingLogins.delete(otpSessionId);
}

/**
 * Verifies a submitted code. Returns { ok, error } — never throws.
 * Consumes the session on success, and on running out of attempts.
 */
function verifyOtpSession(otpSessionId, code) {
  if (typeof otpSessionId !== 'string' || typeof code !== 'string') {
    return { ok: false, error: 'طلب غير صالح، يرجى إعادة تسجيل الدخول.' };
  }

  const session = pendingLogins.get(otpSessionId);
  if (!session) {
    return { ok: false, error: 'انتهت جلسة التحقق، يرجى إعادة تسجيل الدخول.' };
  }

  if (Date.now() > session.expiresAt) {
    pendingLogins.delete(otpSessionId);
    return { ok: false, error: 'انتهت صلاحية رمز التحقق، يرجى إعادة تسجيل الدخول.' };
  }

  session.attempts += 1;
  if (session.attempts > OTP_MAX_ATTEMPTS) {
    pendingLogins.delete(otpSessionId);
    return { ok: false, error: 'تم تجاوز عدد المحاولات المسموح بها، يرجى إعادة تسجيل الدخول.' };
  }

  if (!bcrypt.compareSync(code, session.codeHash)) {
    const remaining = OTP_MAX_ATTEMPTS - session.attempts;
    return {
      ok: false,
      error: `رمز التحقق غير صحيح. المحاولات المتبقية: ${Math.max(remaining, 0)}`
    };
  }

  pendingLogins.delete(otpSessionId);
  return { ok: true };
}

// ─── JWT ───

/** Issues a token carrying who the user is, so the audit trail can name them. */
function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

/**
 * Accounts whose state was checked recently.
 *
 * A signed token stays valid until it expires, so without this a dismissed
 * employee keeps full access for the rest of the token's life. Each request
 * re-checks the account, cached briefly so it costs one read per user per
 * 30 seconds rather than one per request.
 */
const userStateCache = new Map(); // userId -> { checkedAt, active, role }
const USER_STATE_TTL_MS = 30 * 1000;

function invalidateUserState(userId) {
  if (userId) userStateCache.delete(userId);
  else userStateCache.clear();
}

/** Returns { ok, reason, role } for the account behind a token. */
async function checkUserState(payload) {
  // The environment owner is configuration, not a database row.
  if (payload.sub === 'env-owner') return { ok: true, role: 'admin' };

  const cached = userStateCache.get(payload.sub);
  if (cached && Date.now() - cached.checkedAt < USER_STATE_TTL_MS) {
    return cached.active
      ? { ok: true, role: cached.role }
      : { ok: false, reason: 'DISABLED' };
  }

  const users = require('./users');
  const user = await users.findById(payload.sub);

  if (!user) {
    userStateCache.delete(payload.sub);
    return { ok: false, reason: 'DELETED' };
  }

  userStateCache.set(payload.sub, {
    checkedAt: Date.now(),
    active: user.active !== false,
    role: user.role
  });

  if (user.active === false) return { ok: false, reason: 'DISABLED' };
  return { ok: true, role: user.role };
}

/** Express middleware — rejects any request without a valid admin token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'مطلوب تسجيل الدخول', code: 'NO_TOKEN' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.role) {
      return res.status(403).json({ error: 'صلاحية غير كافية', code: 'FORBIDDEN' });
    }
    // The token is authentic; the account behind it still has to exist and be active.
    checkUserState(payload)
      .then(state => {
        if (!state.ok) {
          return res.status(401).json({
            error: state.reason === 'DELETED'
              ? 'هذا الحساب لم يعد موجوداً'
              : 'تم إيقاف هذا الحساب، راجع المدير',
            code: state.reason
          });
        }

        // The role comes from the account as it is now, not as it was at login,
        // so a demotion takes effect without waiting for the token to expire.
        req.auth = { ...payload, role: state.role };
        return next();
      })
      .catch(err => {
        console.error('[AUTH] Could not verify account state:', err.message);
        return res.status(503).json({ error: 'تعذّر التحقق من الحساب، حاول مجدداً' });
      });
    return;
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' : 'جلسة غير صالحة',
      code: expired ? 'TOKEN_EXPIRED' : 'BAD_TOKEN'
    });
  }
}

/**
 * Guards a route behind a named permission.
 * Roles are resolved server-side from the token, never from the request body.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const users = require('./users');
    const allowed = users.permissionsFor(req.auth?.role)[permission];

    if (!allowed) {
      // Recorded: a staff account probing owner-only routes is worth seeing.
      console.warn(
        `[AUTH] Denied ${req.method} ${req.originalUrl} to ` +
        `${req.auth?.username || 'unknown'} (${req.auth?.role || 'no role'}) — needs ${permission}`
      );
      return res.status(403).json({
        error: 'هذه العملية تتطلب صلاحية المدير',
        code: 'FORBIDDEN'
      });
    }

    return next();
  };
}

/** A short label for the audit trail: "أحمد (ahmed)". */
function actorLabel(req) {
  const auth = req.auth;
  if (!auth) return 'system';
  return auth.name ? `${auth.name} (${auth.username})` : (auth.username || auth.sub || 'unknown');
}

module.exports = {
  assertConfigured,
  requirePermission,
  invalidateUserState,
  checkAccountLock,
  recordLoginFailure,
  clearLoginFailures,
  actorLabel,
  verifyPassword,
  createOtpSession,
  verifyOtpSession,
  discardOtpSession,
  issueToken,
  requireAuth,
  OWNER_PHONE_NUMBER,
  ALLOW_LOGIN_WITHOUT_OTP,
  TOKEN_TTL_SECONDS
};
