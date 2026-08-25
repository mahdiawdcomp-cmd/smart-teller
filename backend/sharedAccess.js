/**
 * Hardening for public "shared statement" links.
 *
 * A shared link is a bearer secret sitting in a customer's WhatsApp history, so it is
 * treated as low-trust: the phone check must be exact, guessing is rate-limited per
 * token, links expire, and every attempt is recorded on the customer document.
 */

const SHARE_DEFAULT_DAYS = 30;
const SHARE_MAX_DAYS = 365;

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_MAX = 5; // failed attempts per token per window
const ACCESS_LOG_MAX = 20; // entries kept per customer

/** token -> { failures: number[], lockedUntil: number } */
const attemptsByToken = new Map();

function pruneAttempts() {
  const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
  for (const [token, record] of attemptsByToken) {
    record.failures = record.failures.filter(t => t > cutoff);
    if (record.failures.length === 0 && (!record.lockedUntil || record.lockedUntil < Date.now())) {
      attemptsByToken.delete(token);
    }
  }
}

/** Returns { blocked, retryAfterSeconds } for a token before an attempt is made. */
function checkRateLimit(token) {
  pruneAttempts();

  const record = attemptsByToken.get(token);
  if (!record) return { blocked: false };

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000)
    };
  }

  return { blocked: false };
}

function recordFailure(token) {
  const record = attemptsByToken.get(token) || { failures: [], lockedUntil: 0 };
  record.failures.push(Date.now());

  if (record.failures.length >= ATTEMPT_MAX) {
    record.lockedUntil = Date.now() + ATTEMPT_WINDOW_MS;
    record.failures = [];
  }

  attemptsByToken.set(token, record);
}

function clearFailures(token) {
  attemptsByToken.delete(token);
}

/**
 * Extracts the last 10 significant digits of an Iraqi phone number.
 * Returns null when the input does not carry a full local number.
 *
 * "07701234567" and "+9647701234567" both normalize to "7701234567".
 */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;

  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Strip the Iraq country code so local and international forms compare equal.
  if (digits.startsWith('00964')) digits = digits.slice(5);
  else if (digits.startsWith('964')) digits = digits.slice(3);

  // Local numbers are written with a leading 0 (07xx...) — drop it.
  if (digits.startsWith('0')) digits = digits.slice(1);

  // An Iraqi mobile number without country code or leading zero is 10 digits.
  if (digits.length < 10) return null;

  return digits.slice(-10);
}

/**
 * Strict equality on the normalized number. Unlike an endsWith check, a short
 * or partial input can never match.
 */
function phoneMatches(storedPhone, givenPhone) {
  const stored = normalizePhone(storedPhone);
  const given = normalizePhone(givenPhone);
  if (!stored || !given) return false;
  return stored === given;
}

/** Resolves the requested lifetime (in days) into an ISO expiry timestamp. */
function buildExpiry(days) {
  const requested = Number(days);
  const safeDays =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), SHARE_MAX_DAYS)
      : SHARE_DEFAULT_DAYS;

  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return false; // links created before expiry existed stay valid
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

/** Client IP, trimmed — used only for the access log shown to the shop owner. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    req.socket?.remoteAddress ||
    'unknown';
  return ip.slice(0, 45);
}

/** Appends an attempt to the customer's access log, keeping only the newest entries. */
function appendAccessLog(existingLog, entry) {
  const log = Array.isArray(existingLog) ? existingLog : [];
  return [entry, ...log].slice(0, ACCESS_LOG_MAX);
}

module.exports = {
  checkRateLimit,
  recordFailure,
  clearFailures,
  normalizePhone,
  phoneMatches,
  buildExpiry,
  isExpired,
  clientIp,
  appendAccessLog,
  SHARE_DEFAULT_DAYS,
  SHARE_MAX_DAYS
};
