import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api, { publicGetOnce } from "@food/api";

const PromotionBannerCarousel = ({ zoneId: propZoneId }) => {
  const [banners, setBanners] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const autoSlideIntervalRef = useRef(null);

  // Fallback to localStorage if prop is not provided
  const zoneId = propZoneId || localStorage.getItem('userZoneId');

  const fetchBanners = useCallback(async () => {
    if (!zoneId) return;
    try {
      setLoading(true);
      const response = await publicGetOnce(`/food/hero-banners/home-promotion/public?zoneId=${zoneId}`);
      if (response.data?.success && response.data?.data?.banners) {
        setBanners(response.data.data.banners);
      }
    } catch (err) {
      // Error handled silently
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    fetchBanners();
  }, [fetchBanners]);

  const startAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) clearInterval(autoSlideIntervalRef.current);
    if (banners.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setCurrentIndex((prev) => (prev + 1) % banners.length);
    }, 5000);
  }, [banners.length]);

  useEffect(() => {
    startAutoSlide();
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        startAutoSlide();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (autoSlideIntervalRef.current) clearInterval(autoSlideIntervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startAutoSlide]);

  const handleNext = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % banners.length);
    startAutoSlide();
  };

  const handlePrev = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length);
    startAutoSlide();
  };

  if (loading) {
    return (
      <div className="px-3.5 py-2">
        <div className="w-full h-32 sm:h-40 md:h-48 rounded-[1.25rem] bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (!banners.length) return null;

  return (
    <div className="px-3.5 py-2 relative group">
      <div className="relative overflow-hidden w-full rounded-[1.25rem] shadow-sm">
        <AnimatePresence mode="wait">
          <motion.div
            key={banners[currentIndex]?._id?.$oid || banners[currentIndex]?._id || currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="w-full h-auto"
          >
            <a 
              href={banners[currentIndex]?.ctaLink || "#"} 
              className="block w-full h-auto"
              onClick={(e) => {
                if (!banners[currentIndex]?.ctaLink) e.preventDefault();
              }}
            >
              <img 
                src={banners[currentIndex]?.imageUrl} 
                alt={banners[currentIndex]?.title || "Promotion"} 
                className="w-full h-auto block"
              />
            </a>
          </motion.div>
        </AnimatePresence>

        {/* Navigation Arrows - Visible on Hover */}
        {banners.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity z-25"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity z-25"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Indicators */}
        {banners.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-25">
            {banners.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? "w-6 bg-white" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PromotionBannerCarousel;
