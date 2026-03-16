/**
 * seed-users.js
 * Run once after creating the users table:
 *   node seed-users.js
 *
 * Creates four seed accounts:
 *   admin@site.com   / admin123     → super_admin  (all sections)
 *   Bob@site.com     / analyst123   → analyst      (overview, performance)
 *   viewer@site.com  / viewer123    → viewer        (saved reports only)
 */

const bcrypt = require('bcryptjs');
const mysql  = require('mysql');

const db = mysql.createConnection({
  host:     '127.0.0.1',
  user:     'collector_user',
  password: 'Fm53383S!',
  database: 'analytics'
});

db.connect(err => {
  if (err) { console.error('DB error:', err); process.exit(1); }
  console.log('Connected.');
});

function dbQuery(sql, params) {
  return new Promise((res, rej) =>
    db.query(sql, params || [], (err, rows) => err ? rej(err) : res(rows))
  );
}

const SEED_USERS = [
  {
    email:        'admin@site.com',
    display_name: 'Admin',
    password:     'admin123',
    role:         'super_admin',
    sections:     null
  },
  {
    email:        'bob@site.com',
    display_name: 'Bob',
    password:     'analyst123',
    role:         'analyst',
    sections:     'overview,performance'
  },
  {
    email:        'viewer@site.com',
    display_name: 'Viewer',
    password:     'viewer123',
    role:         'viewer',
    sections:     null
  }
];

async function seed() {
  for (const u of SEED_USERS) {
    const hash = await bcryptjs.hash(u.password, 10);
    try {
      await dbQuery(
        `INSERT INTO users (email, display_name, password_hash, role, sections)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name  = VALUES(display_name),
           password_hash = VALUES(password_hash),
           role          = VALUES(role),
           sections      = VALUES(sections)`,
        [u.email, u.display_name, hash, u.role, u.sections]
      );
      console.log(`✓ ${u.email} (${u.role})`);
    } catch (e) {
      console.error(`✗ ${u.email}:`, e.message);
    }
  }
  db.end();
  console.log('\nDone. Users seeded.');
}

seed();