import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    listAddressesController,
    addAddressController,
    updateAddressController,
    deleteAddressController,
    setDefaultAddressController
} from '../controllers/userAddress.controller.js';
import {
    getCurrentUserProfileController,
    updateCurrentUserProfileController,
    uploadCurrentUserProfileImageController,
    deleteCurrentUserAccountController
} from '../controllers/userProfile.controller.js';
import {
    getUserWalletController,
    createWalletTopupOrderController,
    verifyWalletTopupPaymentController
} from '../controllers/userWallet.controller.js';
import {
    getUserReferralDetailsController,
    getUserReferralStatsController
} from '../controllers/userReferral.controller.js';
import {
    createSafetyEmergencyReportController,
    listMySafetyEmergencyReportsController
} from '../controllers/userSafetyEmergency.controller.js';
import {
    createSupportTicketController,
    listMySupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    getCoinsInfoController,
    submitCoinRedemptionController
} from '../controllers/coin.controller.js';
import { uploadGenericImageController } from '../controllers/upload.controller.js';
import {
    getUserCartController,
    replaceUserCartController,
    clearUserCartController
} from '../controllers/userCart.controller.js';
import {
    getFavoritesController,
    addFavoriteRestaurantController,
    removeFavoriteRestaurantController,
    addFavoriteFoodController,
    removeFavoriteFoodController
} from '../controllers/userFavorite.controller.js';
import {
    getPayLaterController,
    repayPayLaterFromWalletController,
    startPayLaterRazorpayController,
    verifyPayLaterRazorpayController
} from '../controllers/userPayLater.controller.js';
import { getCashbackHistoryController } from '../controllers/userCashback.controller.js';
import { getRefundHistoryController } from '../controllers/userRefund.controller.js';

const router = express.Router();

router.get('/profile', getCurrentUserProfileController);
router.patch('/profile', updateCurrentUserProfileController);
router.post('/profile/profile-image', upload.single('file'), uploadCurrentUserProfileImageController);
router.post('/upload-image', upload.single('file'), uploadGenericImageController);
router.delete('/profile', deleteCurrentUserAccountController);

// Wallet (Bearer USER)
router.get('/wallet', getUserWalletController);
router.post('/wallet/topup/order', createWalletTopupOrderController);
router.post('/wallet/topup/verify', verifyWalletTopupPaymentController);

// Reward Coins (Bearer USER)
router.get('/coins', getCoinsInfoController);
router.post('/coins/redeem', submitCoinRedemptionController);

// Referral stats (Bearer USER)
router.get('/referrals/stats', getUserReferralStatsController);
router.get('/referrals/details', getUserReferralDetailsController);

// Safety / Emergency reports (Bearer USER)
router.post('/safety-emergency-reports', createSafetyEmergencyReportController);
router.get('/safety-emergency-reports', listMySafetyEmergencyReportsController);

// Support tickets (Bearer USER)
router.post('/support/ticket', createSupportTicketController);
router.get('/support/my-tickets', listMySupportTicketsController);

router.get('/addresses', listAddressesController);
router.post('/addresses', addAddressController);
router.patch('/addresses/:addressId', updateAddressController);
router.delete('/addresses/:addressId', deleteAddressController);
router.patch('/addresses/:addressId/default', setDefaultAddressController);

// ---- Cart (cross-device continuity; checkout re-prices independently) ----
router.get('/cart', getUserCartController);
router.put('/cart', replaceUserCartController);
router.delete('/cart', clearUserCartController);

// ---- Favorites ----
router.get('/favorites', getFavoritesController);
router.post('/favorites/restaurants/:restaurantId', addFavoriteRestaurantController);
router.delete('/favorites/restaurants/:restaurantId', removeFavoriteRestaurantController);
router.post('/favorites/foods/:foodId', addFavoriteFoodController);
router.delete('/favorites/foods/:foodId', removeFavoriteFoodController);

// ---- Pay Later ----
router.get('/pay-later', getPayLaterController);
router.post('/pay-later/repay/wallet', repayPayLaterFromWalletController);
router.post('/pay-later/repay/razorpay/start', startPayLaterRazorpayController);
router.post('/pay-later/repay/razorpay/verify', verifyPayLaterRazorpayController);

// ---- Cashback & refunds ----
router.get('/cashback', getCashbackHistoryController);
router.get('/refunds', getRefundHistoryController);

export default router;
