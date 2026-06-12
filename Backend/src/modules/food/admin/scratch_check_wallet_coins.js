import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

// Load models
import '../../../../src/core/users/user.model.js';
import '../user/models/coinRedemptionRequest.model.js';

async function checkRequestsAPI() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const CoinRedemptionRequest = mongoose.model('CoinRedemptionRequest');
        const docs = await CoinRedemptionRequest.find({})
            .populate('userId', 'name phone email profileImage')
            .sort({ createdAt: -1 })
            .lean();
        console.log('Docs fetched by API simulation:', JSON.stringify(docs, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
checkRequestsAPI();
