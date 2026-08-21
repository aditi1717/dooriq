import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, verifyPaymentSignature } from '../../orders/helpers/razorpay.helper.js';

const ensureWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const existing = await FoodUserWallet.findOne({ userId: oid });
    if (existing) return existing;
    return FoodUserWallet.create({ userId: oid, balance: 0, transactions: [] });
};

export const creditReferralReward = async (userId, amountInr, metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }
    const wallet = await ensureWallet(userId);
    wallet.transactions.unshift({
        type: 'addition',
        amount,
        status: 'Completed',
        description: 'Referral reward',
        metadata: { source: 'referral_reward', ...(metadata || {}) }
    });
    wallet.balance = Number(wallet.balance || 0) + amount;
    wallet.referralEarnings = Number(wallet.referralEarnings || 0) + amount;
    await wallet.save();
    return { wallet: await getUserWallet(userId) };
};

export const getUserWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const wallet = await FoodUserWallet.findOne({ userId: oid });
    if (!wallet) {
        return { balance: 0, referralEarnings: 0, transactions: [] };
    }
    // Return newest first (UI expects recent transactions on top)
    const tx = Array.isArray(wallet.transactions) ? [...wallet.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
    return {
        balance: Number(wallet.balance) || 0,
        referralEarnings: Number(wallet.referralEarnings) || 0,
        transactions: tx.map((t) => ({
            id: String(t._id),
            _id: t._id,
            type: t.type,
            amount: Number(t.amount) || 0,
            status: t.status || 'Completed',
            description: t.description || '',
            date: t.createdAt,
            createdAt: t.createdAt,
            metadata: t.metadata || {}
        }))
    };
};

export const createWalletTopupOrder = async (userId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0');
    }
    if (amount > 50000) {
        throw new ValidationError('Maximum amount is 50,000');
    }

    const amountPaise = Math.round(amount * 100);

    if (!isRazorpayConfigured()) {
        // Dev fallback: return a compatible shape without writing to DB.
        const orderId = `order_dev_${Date.now()}`;
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const receipt = `wallet_topup_${String(userId).slice(-8)}_${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);

    return {
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR'
        }
    };
};

export const verifyWalletTopupPayment = async (userId, payload) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('amount is required');

    const wallet = await ensureWallet(userId);
    const existing = wallet.transactions.find((t) => String(t.razorpayOrderId || '') === orderId);
    if (existing && String(existing.status).toLowerCase() === 'completed') {
        return { wallet: await getUserWallet(userId) };
    }

    // If razorpay not configured (dev), accept and credit wallet.
    const ok = isRazorpayConfigured()
        ? verifyPaymentSignature(orderId, paymentId, signature)
        : true;
    if (!ok) {
        throw new ValidationError('Payment verification failed');
    }

    // Store ONLY after payment is verified.
    wallet.transactions.unshift({
        type: 'addition',
        amount,
        status: 'Completed',
        description: isRazorpayConfigured() ? 'Wallet top-up' : 'Wallet top-up (dev)',
        metadata: { source: 'wallet_topup', mode: isRazorpayConfigured() ? 'razorpay' : 'dev' },
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature
    });

    wallet.balance = Number(wallet.balance || 0) + amount;
    await wallet.save();

    return { wallet: await getUserWallet(userId) };
};

export const deductWalletBalance = async (userId, amountInr, description = 'Order payment', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid deduction amount');
    }

    const wallet = await ensureWallet(userId);
    if (wallet.balance < amount) {
        throw new ValidationError('Insufficient wallet balance');
    }

    const previousBalance = Number(wallet.balance) || 0;
    const previousReferral = Number(wallet.referralEarnings) || 0;
    const referralDeduct = Math.min(previousReferral, amount);

    wallet.transactions.unshift({
        type: 'deduction',
        amount,
        status: 'Completed',
        description,
        metadata: { 
            source: 'order_payment', 
            referralDeduct,
            ...(metadata || {}) 
        }
    });

    wallet.balance = Number((previousBalance - amount).toFixed(2));
    wallet.referralEarnings = Number((previousReferral - referralDeduct).toFixed(2));
    await wallet.save();

    return { wallet: await getUserWallet(userId) };
};

export const refundWalletBalance = async (userId, amountInr, description = 'Order refund', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }

    const wallet = await ensureWallet(userId);
    const referralRefund = Number(metadata?.referralDeduct) || 0;

    wallet.transactions.unshift({
        type: 'refund',
        amount,
        status: 'Completed',
        description,
        metadata: { source: 'order_refund', ...(metadata || {}) }
    });

    wallet.balance = Number((Number(wallet.balance) + amount).toFixed(2));
    if (referralRefund > 0) {
        wallet.referralEarnings = Number((Number(wallet.referralEarnings || 0) + referralRefund).toFixed(2));
    }
    await wallet.save();

    return { wallet: await getUserWallet(userId) };
};

export const awardCoinsForOrder = async (userId, orderId) => {
    try {
        const { FoodBusinessSettings } = await import('../../admin/models/businessSettings.model.js');
        const settings = await FoodBusinessSettings.findOne().lean();
        
        if (!settings?.coinSettings?.isActive) {
            return { awarded: 0, reason: 'coin_system_disabled' };
        }

        const { minCoinsPerOrder, maxCoinsPerOrder, coinExpiryDays } = settings.coinSettings;
        const min = Number(minCoinsPerOrder) || 0;
        const max = Number(maxCoinsPerOrder) || 0;
        const expiryDays = Number(coinExpiryDays) || 0;

        const wallet = await ensureWallet(userId);
        
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);

        let readableOrderId = orderId;
        let awardedCoins = 0;
        try {
            if (mongoose.Types.ObjectId.isValid(orderId)) {
                const { FoodOrder } = await import('../../orders/models/order.model.js');
                const dbOrder = await FoodOrder.findById(orderId).select('order_id coinsEarned').lean();
                if (dbOrder) {
                    readableOrderId = dbOrder.order_id || orderId;
                    awardedCoins = Number(dbOrder.coinsEarned) || 0;
                }
            }
        } catch (err) {
            console.error('Failed to get order details in awardCoinsForOrder:', err);
        }

        // If not already pre-calculated on order creation, calculate random coins
        if (awardedCoins <= 0) {
            awardedCoins = Math.floor(Math.random() * (max - min + 1)) + min;
        }
        
        if (awardedCoins <= 0) {
            return { awarded: 0, reason: 'zero_coins_calculated' };
        }

        wallet.coinTransactions.push({
            amount: awardedCoins,
            type: 'earned',
            expiresAt,
            description: `Earned for order #${readableOrderId}`
        });
        wallet.coinBalance = Number(wallet.coinBalance || 0) + awardedCoins;
        await wallet.save();

        // Ensure coinsEarned is saved to the order in case it was a fallback calculation
        try {
            const { FoodOrder } = await import('../../orders/models/order.model.js');
            await FoodOrder.findByIdAndUpdate(orderId, { coinsEarned: awardedCoins });
        } catch (orderErr) {
            console.error(`Failed to update coinsEarned on order ${orderId}:`, orderErr);
        }

        return { awarded: awardedCoins, balance: wallet.coinBalance };
    } catch (error) {
        // Log but don't fail the order process
        console.error(`Failed to award coins for order ${orderId}:`, error);
        return { awarded: 0, reason: 'error' };
    }
};

export const getCoinsInfo = async (userId) => {
    const wallet = await ensureWallet(userId);
    
    // Calculate total valid coins using FIFO deduction logic
    const now = new Date();
    const transactions = (wallet.coinTransactions || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalRefunded = transactions
        .filter((tx) => tx.type === "refunded")
        .reduce((sum, tx) => sum + (tx.amount || 0), 0);

    let totalDeductions = Math.max(0,
        transactions
            .filter((tx) => tx.type === "redeemed" || tx.type === "expired")
            .reduce((sum, tx) => sum + (tx.amount || 0), 0)
        - totalRefunded
    );

    const earnedTx = transactions
        .filter((tx) => tx.type === "earned")
        .map((tx) => ({
            amount: tx.amount,
            expiresAt: tx.expiresAt,
            createdAt: tx.createdAt
        }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const tx of earnedTx) {
        let remaining = tx.amount;
        if (totalDeductions > 0) {
            const deduct = Math.min(totalDeductions, remaining);
            remaining -= deduct;
            totalDeductions -= deduct;
        }
        tx.amount = remaining;
    }

    const actualBalance = earnedTx
        .filter((tx) => tx.expiresAt > now)
        .reduce((sum, tx) => sum + tx.amount, 0);
    
    if (wallet.coinBalance !== actualBalance) {
        wallet.coinBalance = actualBalance;
        await wallet.save();
    }

    const { FoodBusinessSettings } = await import('../../admin/models/businessSettings.model.js');
    const settings = await FoodBusinessSettings.findOne().lean();

    // Fetch redemption requests for this user
    let redemptionRequests = [];
    try {
        const { CoinRedemptionRequest } = await import('../models/coinRedemptionRequest.model.js');
        redemptionRequests = await CoinRedemptionRequest.find({ userId: wallet.userId }).sort({ createdAt: -1 }).lean();
    } catch (err) {
        console.error('Failed to fetch redemption requests:', err);
    }

    // Dynamic resolution of MongoDB object ID to human readable order ID in transaction descriptions
    const orderIdsToResolve = [];
    const txList = transactions.map(t => {
        const doc = t.toObject ? t.toObject() : t;
        const match = doc.description?.match(/#([0-9a-fA-F]{24})/);
        if (match) {
            orderIdsToResolve.push(match[1]);
        }
        return {
            ...doc,
            id: String(doc._id)
        };
    });

    let orderMap = {};
    if (orderIdsToResolve.length > 0) {
        try {
            const { FoodOrder } = await import('../../orders/models/order.model.js');
            const orders = await FoodOrder.find({ _id: { $in: orderIdsToResolve } }).select('order_id').lean();
            orderMap = orders.reduce((acc, order) => {
                acc[String(order._id)] = order.order_id;
                return acc;
            }, {});
        } catch (err) {
            console.error('Failed to resolve order IDs in getCoinsInfo:', err);
        }
    }

    const mappedTransactions = txList.map(tx => {
        if (tx.description) {
            const match = tx.description.match(/#([0-9a-fA-F]{24})/);
            if (match && orderMap[match[1]]) {
                tx.description = tx.description.replace(match[1], orderMap[match[1]]);
            }
        }
        return tx;
    });
    
    return {
        balance: actualBalance,
        transactions: mappedTransactions,
        redemptionRequests,
        settings: settings?.coinSettings || {}
    };
};

export const submitCoinRedemption = async (userId, coinsToRedeem, screenshotUrl) => {
    const { FoodBusinessSettings } = await import('../../admin/models/businessSettings.model.js');
    const settings = await FoodBusinessSettings.findOne().lean();
    
    if (!settings?.coinSettings?.isActive) {
        throw new ValidationError('Coin system is currently disabled');
    }

    const wallet = await ensureWallet(userId);
    const coins = Number(coinsToRedeem);
    
    if (!Number.isFinite(coins) || coins <= 0) {
        throw new ValidationError('Invalid coins amount');
    }
    
    if (wallet.coinBalance < coins) {
        throw new ValidationError('Insufficient coin balance');
    }

    const amountToCredit = coins * (settings.coinSettings.coinToWalletValue || 10);

    // Deduct coins immediately (if rejected later, admin will refund)
    wallet.coinBalance -= coins;
    wallet.coinTransactions.unshift({
        amount: coins,
        type: 'redeemed',
        description: 'Redeemed for wallet balance'
    });
    
    await wallet.save();

    const { CoinRedemptionRequest } = await import('../models/coinRedemptionRequest.model.js');
    const request = await CoinRedemptionRequest.create({
        userId: wallet.userId,
        coinsRedeemed: coins,
        amountToCredit,
        screenshotUrl
    });

    return { request, walletBalance: wallet.coinBalance };
};
