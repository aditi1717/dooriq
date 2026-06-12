import { sendResponse } from '../../../../utils/response.js';
import { CoinRedemptionRequest } from '../../user/models/coinRedemptionRequest.model.js';
import { FoodUserWallet } from '../../user/models/userWallet.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import mongoose from 'mongoose';

export async function getCoinRequests(req, res, next) {
    try {
        const { page, limit, skip } = buildPaginationOptions(req.query);
        const filter = {};
        if (req.query.status) filter.status = req.query.status;

        const [docs, total] = await Promise.all([
            CoinRedemptionRequest.find(filter)
                .populate('userId', 'name phone email profileImage')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            CoinRedemptionRequest.countDocuments(filter)
        ]);

        return sendResponse(res, 200, 'Coin redemption requests retrieved', buildPaginatedResult({ docs, total, page, limit }));
    } catch (err) {
        next(err);
    }
}

export async function verifyCoinRequest(req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;
        const { status, adminNote } = req.body;

        if (!['approved', 'rejected'].includes(status)) {
            throw new ValidationError('Status must be approved or rejected');
        }

        const request = await CoinRedemptionRequest.findById(id).session(session);
        if (!request) {
            throw new NotFoundError('Redemption request not found');
        }
        if (request.status !== 'pending') {
            throw new ValidationError('Request is already ' + request.status);
        }

        const wallet = await FoodUserWallet.findOne({ userId: request.userId }).session(session);
        if (!wallet) {
            throw new NotFoundError('User wallet not found');
        }

        request.status = status;
        request.adminNote = adminNote || '';
        request.processedAt = new Date();
        await request.save({ session });

        if (status === 'approved') {
            // Add wallet balance
            wallet.transactions.unshift({
                type: 'addition',
                amount: request.amountToCredit,
                status: 'Completed',
                description: 'Reward coin redemption approved',
                metadata: { source: 'coin_redemption', requestId: request._id }
            });
            wallet.balance = Number(wallet.balance || 0) + request.amountToCredit;
        } else if (status === 'rejected') {
            // Refund coins
            wallet.coinTransactions.push({
                amount: request.coinsRedeemed,
                type: 'refunded',
                description: `Refunded for rejected redemption request: ${adminNote || ''}`
            });
            wallet.coinBalance = Number(wallet.coinBalance || 0) + request.coinsRedeemed;
        }

        await wallet.save({ session });
        await session.commitTransaction();
        session.endSession();

        return sendResponse(res, 200, `Request ${status} successfully`, { request });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        next(err);
    }
}
