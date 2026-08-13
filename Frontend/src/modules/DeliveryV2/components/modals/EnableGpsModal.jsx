import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigation, X } from 'lucide-react';

/**
 * EnableGpsModal - Clean modal with top-right cross icon to close.
 */
export const EnableGpsModal = ({
  isOpen,
  onClose,
  errorMessage = '',
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-sm bg-white dark:bg-[#181818] rounded-2xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 text-center relative"
        >
          {/* Close Cross Icon */}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3.5 top-3.5 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Icon */}
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/40 flex items-center justify-center mb-3">
            <Navigation className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>

          {/* Title & Message */}
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Enable Location / GPS
          </h3>
          
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
            Please turn on GPS and grant location permission to receive nearby delivery orders.
          </p>

          {errorMessage && (
            <p className="text-[11px] text-red-500 font-medium mt-3 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-xl border border-red-100 dark:border-red-900/30">
              {errorMessage}
            </p>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
