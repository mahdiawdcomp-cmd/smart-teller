/**
 * User accounts and roles.
 *
 * The office used to share one password, which meant the audit trail could only
 * ever say "admin" — useless for finding out who made a mistake. Each person now
 * gets their own account, and the audit log records their name.
 *
 * Roles are defined below, one per real job in an office rather than a blunt
 * admin/everyone-else split.
 *
 * Bootstrap: the ADMIN_PASSWORD_HASH from the environment stays valid as the
 * owner account. Without it, deploying this change would lock the owner out of
 * their own system before they could create the first user.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { db } = require('./firebaseAdmin');
const store = require('./store');

/**
 * Roles, from most to least authority.
 *
 * An exchange office is not two kinds of person. The owner does everything; a
 * branch manager runs the day without touching accounts or backups; an
 * accountant reads the money but never moves it; a teller moves money but never
 * sees the profit; and some people should only ever look. Each of those is a
 * real job, so each gets a role instead of being forced into "admin" — which is
 * how offices end up giving everyone full access.
 *
 * "staff" is kept as an alias of "teller" so accounts created before this stay
 * exactly as they were.
 */
const ROLES = ['admin', 'manager', 'accountant', 'teller', 'viewer'];
const ENV_OWNER_ID = 'env-owner';

/** Arabic labels and one-line descriptions, shown wherever a role is picked. */
const ROLE_INFO = {
  admin: {
    label: 'مدير عام',
    description: 'كل الصلاحيات — بما فيها المستخدمين والإعدادات والنسخ الاحتياطي'
  },
  manager: {
    label: 'مدير',
    description: 'يدير الزبائن والعمليات ويشوف التقارير — بلا مستخدمين ولا إعدادات'
  },
  accountant: {
    label: 'محاسب',
    description: 'يشوف التقارير والصندوق والمصاريف — لا يسجّل ولا يعدّل عمليات'
  },
  teller: {
    label: 'صرّاف',
    description: 'يسجّل العمليات ويشوف الزبائن — لا يعدّل ولا يحذف ولا يشوف الأرباح'
  },
  viewer: {
    label: 'مطّلع',
    description: 'قراءة فقط — يشوف الزبائن وأرصدتهم بلا أي تعديل'
  }
};

/** Permissions each role carries. Checked on the server, never trusted from the client. */
const ROLE_PERMISSIONS = {
  admin: {
    canRecordTransactions: true,
    canEditLedger: true,
    canManageCustomers: true,
    canViewReports: true,
    canManageUsers: true,
    canManageBackup: true,
    canManageSettings: true
  },
  manager: {
    canRecordTransactions: true,
    canEditLedger: true,
    canManageCustomers: true,
    canViewReports: true,
    canManageUsers: false,
    canManageBackup: false,
    canManageSettings: false
  },
  accountant: {
    // Reads the money, never moves it — the point of a separate pair of eyes.
    canRecordTransactions: false,
    canEditLedger: false,
    canManageCustomers: false,
    canViewReports: true,
    canManageUsers: false,
    canManageBackup: false,
    canManageSettings: false
  },
  teller: {
    canRecordTransactions: true,
    canEditLedger: false,
    canManageCustomers: false,
    canViewReports: false,
    canManageUsers: false,
    canManageBackup: false,
    canManageSettings: false
  },
  viewer: {
    canRecordTransactions: false,
    canEditLedger: false,
    canManageCustomers: false,
    canViewReports: false,
    canManageUsers: false,
    canManageBackup: false,
    canManageSettings: false
  }
};

// Accounts created before roles expanded carry "staff"; it means teller.
ROLE_PERMISSIONS.staff = ROLE_PERMISSIONS.teller;
ROLE_INFO.staff = ROLE_INFO.teller;

function permissionsFor(role) {
  // An unknown role gets the least authority, never the most.
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer;
}

function roleInfo(role) {
  return ROLE_INFO[role] || { label: role || 'غير معروف', description: '' };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

/** Usernames are case-insensitive and stored lowercase. */
function normalizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

/** Strips the password hash before a user object leaves the server. */
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    permissions: permissionsFor(rest.role),
    roleLabel: roleInfo(rest.role).label
  };
}

// ─── Storage ───

async function listUsers() {
  if (db) {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const data = await store.readLocal();
  return data.users || [];
}

async function findByUsername(username) {
  const target = normalizeUsername(username);
  if (!target) return null;

  const users = await listUsers();
  return users.find(u => normalizeUsername(u.username) === target) || null;
}

async function findById(id) {
  if (id === ENV_OWNER_ID) return envOwner();

  if (db) {
    const doc = await db.collection('users').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  const users = await listUsers();
  return users.find(u => u.id === id) || null;
}

/** The environment-configured owner, which always exists and cannot be deleted. */
function envOwner() {
  return {
    id: ENV_OWNER_ID,
    username: 'owner',
    name: 'المالك',
    role: 'admin',
    active: true,
    isEnvOwner: true
  };
}

async function createUser({ username, name, password, role, phone }) {
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername || cleanUsername.length < 3) {
    throw badRequest('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
  }
  if (!/^[a-z0-9._-]+$/.test(cleanUsername)) {
    throw badRequest('اسم المستخدم يقبل الحروف الإنجليزية والأرقام والنقطة والشرطة فقط');
  }
  if (cleanUsername === 'owner') {
    throw badRequest('اسم المستخدم "owner" محجوز لحساب المالك');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  }
  if (!ROLES.includes(role)) {
    throw badRequest('الصلاحية غير صحيحة');
  }
  if (await findByUsername(cleanUsername)) {
    throw badRequest('اسم المستخدم موجود مسبقاً');
  }

  const user = {
    username: cleanUsername,
    name: (name || cleanUsername).trim(),
    role,
    phone: phone || '',
    active: true,
    passwordHash: bcrypt.hashSync(password, 12),
    createdAt: new Date().toISOString()
  };

  if (db) {
    const ref = await db.collection('users').add(user);
    return publicUser({ id: ref.id, ...user });
  }

  const withId = { id: crypto.randomBytes(8).toString('hex'), ...user };
  await store.mutateLocal(data => {
    if (!Array.isArray(data.users)) data.users = [];
    data.users.push(withId);
  });
  return publicUser(withId);
}

async function updateUser(id, patch) {
  if (id === ENV_OWNER_ID) {
    throw badRequest('حساب المالك يُدار من إعدادات الخادم وليس من هنا');
  }

  const existing = await findById(id);
  if (!existing) throw notFound('المستخدم غير موجود');

  const update = {};

  if (patch.name !== undefined) update.name = String(patch.name).trim();
  if (patch.phone !== undefined) update.phone = String(patch.phone).trim();

  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) throw badRequest('الصلاحية غير صحيحة');
    update.role = patch.role;
  }

  if (patch.active !== undefined) update.active = !!patch.active;

  if (patch.password !== undefined && patch.password !== '') {
    if (String(patch.password).length < 8) {
      throw badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    }
    update.passwordHash = bcrypt.hashSync(String(patch.password), 12);
  }

  if (Object.keys(update).length === 0) throw badRequest('لا توجد تغييرات');

  if (db) {
    await db.collection('users').doc(id).update(update);
    return publicUser({ ...existing, ...update });
  }

  await store.mutateLocal(data => {
    const user = (data.users || []).find(u => u.id === id);
    if (user) Object.assign(user, update);
  });
  return publicUser({ ...existing, ...update });
}

async function deleteUser(id) {
  if (id === ENV_OWNER_ID) {
    throw badRequest('لا يمكن حذف حساب المالك');
  }

  const existing = await findById(id);
  if (!existing) throw notFound('المستخدم غير موجود');

  if (db) {
    await db.collection('users').doc(id).delete();
  } else {
    await store.mutateLocal(data => {
      data.users = (data.users || []).filter(u => u.id !== id);
    });
  }

  return { id };
}

/**
 * Verifies credentials. Returns the user, or null.
 * Falls back to the environment owner when the username is "owner".
 */
async function verifyCredentials(username, password, envPasswordCheck) {
  const cleanUsername = normalizeUsername(username);

  if (cleanUsername === 'owner') {
    const ok = await envPasswordCheck(password);
    return ok ? envOwner() : null;
  }

  const user = await findByUsername(cleanUsername);
  if (!user || !user.active || !user.passwordHash) return null;

  const ok = bcrypt.compareSync(String(password || ''), user.passwordHash);
  return ok ? user : null;
}

module.exports = {
  ROLES,
  ROLE_INFO,
  roleInfo,
  ENV_OWNER_ID,
  permissionsFor,
  publicUser,
  envOwner,
  listUsers,
  findById,
  findByUsername,
  createUser,
  updateUser,
  deleteUser,
  verifyCredentials
};
