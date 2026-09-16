// Creates an admin account.
//
// The password is read at runtime — from ADMIN_SEED_PASSWORD, or typed at a
// hidden prompt — and is never written into this file, a commit, or shell
// history via an argument. It must not live in the repository: a seed script
// holding a real super-admin password is a credential for anyone who can read
// the repo.
//
// Usage:
//   node scripts/seed-admin.js --email admin@dooriq.com
//   node scripts/seed-admin.js --email ops@dooriq.com --name "Ops" --sub-admin
//
// Hashing: the admin model hashes the password in its pre('save') hook, and
// ONLY there. So this goes through FoodAdmin.create(). An insertOne/updateOne
// would store the password in plaintext — and login would still fail, because
// bcrypt.compare cannot match against an unhashed value.
//
// Idempotent: an existing account is left untouched unless --reset-password is
// passed, so re-running this never silently replaces someone's password.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import readline from 'readline';

import { FoodAdmin } from '../src/core/admin/admin.model.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);

/** Passwords an attacker will try before anything else. */
const COMMON = new Set([
    'admin', 'admin123', 'admin1234', 'admin@123', 'password', 'password123',
    '123456', '12345678', '123456789', 'qwerty', 'dooriq', 'dooriq123', 'letmein',
]);

const weaknessOf = (password, email) => {
    if (password.length < 12) return 'shorter than 12 characters';
    if (COMMON.has(password.toLowerCase())) return 'on every attacker wordlist';
    const local = String(email).split('@')[0].toLowerCase();
    if (local && password.toLowerCase().includes(local)) return 'contains the email name';
    // Length beats variety: a long passphrase is strong without symbols, so the
    // mixed-character rule only applies to passwords short enough to need it.
    if (password.length < 20) {
        const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
        if (classes < 3) return 'needs at least three of: lowercase, uppercase, digit, symbol (or 20+ characters)';
    }
    return null;
};

/** Hidden prompt: the typed password is not echoed to the terminal. */
const promptHidden = (question) =>
    new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl._writeToOutput = (s) => {
            // Echo the prompt itself, then nothing for each keystroke.
            if (s.includes(question)) rl.output.write(s);
        };
        rl.question(question, (answer) => {
            rl.output.write('\n');
            rl.close();
            resolve(answer);
        });
    });

const main = async () => {
    const email = String(arg('email') || '').trim().toLowerCase();
    const name = String(arg('name') || 'Admin').trim();
    const adminType = flag('sub-admin') ? 'sub_admin' : 'super_admin';
    const resetPassword = flag('reset-password');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Pass a valid --email');
    }

    let password = process.env.ADMIN_SEED_PASSWORD;
    if (!password) {
        if (!process.stdin.isTTY) {
            throw new Error('No terminal to prompt on. Set ADMIN_SEED_PASSWORD for this one command.');
        }
        password = await promptHidden(`Password for ${email}: `);
        const confirm = await promptHidden('Confirm password: ');
        if (password !== confirm) throw new Error('Passwords did not match');
    }

    const weakness = weaknessOf(password, email);
    if (weakness && !flag('allow-weak-password')) {
        throw new Error(
            `Refusing: that password is ${weakness}. This creates a ${adminType} on a live ` +
                'platform. Choose a stronger one, or pass --allow-weak-password if you accept the risk.',
        );
    }

    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI / MONGODB_URI missing in Backend/.env');
    await mongoose.connect(mongoUri);

    try {
        const existing = await FoodAdmin.findOne({ email });

        if (existing) {
            if (!resetPassword) {
                console.log(`Exists: ${email} (${existing.adminType}). Nothing changed.`);
                console.log('Pass --reset-password to set a new password on it.');
                return;
            }
            existing.password = password; // hashed by the pre('save') hook
            existing.isActive = true;
            existing.isDeleted = false;
            await existing.save();
            console.log(`Password reset and account re-activated: ${email} (${existing.adminType})`);
            return;
        }

        await FoodAdmin.create({ email, password, name, adminType, role: 'ADMIN', isActive: true });

        // Read back and prove the stored value is a hash that the real login
        // comparison accepts, rather than trusting that the hook ran.
        const created = await FoodAdmin.findOne({ email });
        const hashed = /^\$2[aby]\$\d{2}\$/.test(created.password);
        const loginWorks = await created.comparePassword(password);
        console.log(`Created: ${email} (${adminType})`);
        console.log(`  password stored as bcrypt hash: ${hashed}`);
        console.log(`  login comparison succeeds:      ${loginWorks}`);
        if (!hashed || !loginWorks) process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
