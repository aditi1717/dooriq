import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { initializeFirebaseRealtime } from '../src/config/firebase.js';

let isInitialized = false;

export default async function handler(req, res) {
    if (!isInitialized) {
        try {
            initializeFirebaseRealtime();
            await connectDB();
            isInitialized = true;
        } catch (error) {
            console.error('[Vercel Serverless] Database/Firebase initialization error:', error);
        }
    }
    return app(req, res);
}
