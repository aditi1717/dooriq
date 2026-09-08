import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, MapPin, Globe, Search, Bell, Menu, ArrowRight,
  Home, Info, Store, Gift, Briefcase, Phone, Facebook, Twitter, Instagram
} from 'lucide-react';
import { APP_CONFIG } from '../config/constants';

export default function LaunchHeader() {
  const [isAnnouncementVisible, setIsAnnouncementVisible] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Home');

  // Handle Scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', icon: Home, href: '#home' },
    { name: 'How It Works', icon: Info, href: '#how-it-works' },
    { name: 'User App', icon: Gift, href: 'https://play.google.com/store/apps/details?id=com.dooriq.user', external: true },
    { name: 'Restaurant App', icon: Store, href: 'https://play.google.com/store/apps/details?id=com.dooriq.restaurant', external: true },
    { name: 'Delivery App', icon: Briefcase, href: 'https://play.google.com/store/apps/details?id=com.dooriq.delivery', external: true },
    { name: 'About', icon: Info, href: '#about' },
    { name: 'Contact', icon: Phone, href: '#contact' },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full flex flex-col font-sans">


      {/* Main Navigation */}
      <motion.div
        animate={{
          backgroundColor: isScrolled ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0)',
          backdropFilter: isScrolled ? 'blur(16px)' : 'blur(0px)',
          boxShadow: isScrolled ? '0 4px 30px rgba(0, 0, 0, 0.05)' : 'none',
          paddingTop: isScrolled ? '0.75rem' : '1.25rem',
          paddingBottom: isScrolled ? '0.75rem' : '1.25rem',
          borderBottomColor: isScrolled ? 'rgba(226, 232, 240, 0.5)' : 'rgba(255, 255, 255, 0)'
        }}
        transition={{ duration: 0.3 }}
        className="w-full border-b"
      >
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 md:px-12 lg:px-20 flex items-center justify-between">
          
          {/* LEFT: Logo & Tagline */}
          <div className="flex items-center gap-4">
            <button className={`xl:hidden p-2 -ml-2 rounded-full transition-colors ${isScrolled ? 'text-slate-700 hover:bg-slate-100' : 'text-white hover:bg-white/10'}`} onClick={() => setIsMobileMenuOpen(true)}>
              <Menu className="w-6 h-6" />
            </button>
            <motion.a 
              href="/" 
              className="flex flex-col group cursor-pointer"
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              <div className={`text-2xl sm:text-3xl font-black tracking-tighter flex items-center transition-colors duration-300 ${isScrolled ? 'text-slate-900' : 'text-white'}`}>
                {APP_CONFIG?.NAME || "DOORIQ"}
                <span className="text-[#3B4DFF]">.</span>
              </div>
              <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest hidden sm:block transition-colors duration-300 ${isScrolled ? 'text-slate-500' : 'text-white/80'}`}>
                Food delivery minutes me
              </span>
            </motion.a>
          </div>

          {/* CENTER: Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center gap-1 lg:gap-2">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                target={link.external ? "_blank" : "_self"}
                rel={link.external ? "noopener noreferrer" : undefined}
                onClick={(e) => {
                  if (link.external) return; // let anchor handle it
                  e.preventDefault(); // For smooth scrolling
                  setActiveTab(link.name);
                  document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`relative px-4 py-2 text-sm font-bold transition-colors duration-300 group ${
                  activeTab === link.name ? 'text-[#3B4DFF]' : (isScrolled ? 'text-slate-600 hover:text-slate-900' : 'text-white/90 hover:text-white')
                }`}
              >
                {link.name}
                {/* Active Indicator & Hover Underline */}
                {activeTab === link.name && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3B4DFF] rounded-t-full shadow-[0_0_8px_rgba(59,77,255,0.6)]"
                  />
                )}
                {activeTab !== link.name && (
                  <div className={`absolute bottom-0 left-1/2 right-1/2 h-0.5 rounded-t-full opacity-0 group-hover:opacity-100 group-hover:left-2 group-hover:right-2 transition-all duration-300 ${isScrolled ? 'bg-slate-900/10' : 'bg-white/30'}`} />
                )}
              </a>
            ))}
          </nav>

          {/* RIGHT: Actions & CTA */}
          <div className="flex items-center gap-4 sm:gap-6">
            
            <div className={`hidden lg:flex items-center gap-4 transition-colors duration-300 ${isScrolled ? 'text-slate-600' : 'text-white/90'}`}>
              <button className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${isScrolled ? 'hover:text-[#3B4DFF]' : 'hover:text-white'}`}>
                <MapPin className={`w-4 h-4 ${isScrolled ? 'text-[#3B4DFF]' : 'text-white/90'}`} />
                <span className="truncate max-w-[120px]">Vijay Nagar, Indore</span>
              </button>
              <div className={`w-px h-4 ${isScrolled ? 'bg-slate-200' : 'bg-white/20'}`} />
              <button className={`flex items-center gap-1 text-sm font-semibold transition-colors ${isScrolled ? 'hover:text-[#3B4DFF]' : 'hover:text-white'}`}>
                <Globe className="w-4 h-4" /> EN
              </button>
              <button className={`p-2 rounded-full transition-colors ${isScrolled ? 'hover:bg-slate-100' : 'hover:bg-white/10'}`}>
                <Search className="w-5 h-5" />
              </button>
              <button className={`p-2 rounded-full transition-colors relative ${isScrolled ? 'hover:bg-slate-100' : 'hover:bg-white/10'}`}>
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
              </button>
            </div>

            {/* Primary CTA Button */}
            <motion.button
              onClick={() => window.open("https://play.google.com/store/apps/details?id=com.dooriq.user", "_blank")}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="group flex items-center justify-center gap-2 bg-gradient-to-r from-[#3B4DFF] to-[#2B35B3] hover:from-[#4C5BFF] hover:to-[#3B4DFF] text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-[16px] font-black text-xs sm:text-sm shadow-md transition-all duration-300"
            >
              Download App
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </motion.button>
          </div>

        </div>
      </motion.div>

      {/* Mobile Sidebar Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] xl:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-[85vw] max-w-[400px] bg-white z-[110] shadow-2xl flex flex-col xl:hidden"
            >
              <div className="p-5 flex items-center justify-between border-b border-slate-100">
                <div className="text-2xl font-black text-slate-900 tracking-tighter flex items-center">
                  {APP_CONFIG?.NAME || "DOORIQ"}
                  <span className="text-[#3B4DFF]">.</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                <div className="mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-200">
                  <p className="text-xs font-black text-amber-600 uppercase tracking-widest mb-1">Launch Offer</p>
                  <p className="text-sm font-bold text-slate-900">FREE ORDER UP TO ₹250</p>
                  <p className="text-xs text-slate-600 mt-1">Valid in Vijay Nagar, Indore</p>
                </div>

                {navLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    target={link.external ? "_blank" : "_self"}
                    rel={link.external ? "noopener noreferrer" : undefined}
                    onClick={(e) => {
                      if (link.external) return; // let anchor handle it
                      e.preventDefault();
                      setActiveTab(link.name);
                      setIsMobileMenuOpen(false);
                      document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className={`flex items-center gap-4 w-full p-3 rounded-xl font-bold transition-colors ${
                      activeTab === link.name ? 'bg-[#3B4DFF]/10 text-[#3B4DFF]' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <link.icon className="w-5 h-5" />
                    {link.name}
                  </a>
                ))}
              </div>

              <div className="p-5 border-t border-slate-100 bg-slate-50">
                <button 
                  onClick={() => window.open("https://play.google.com/store/apps/details?id=com.dooriq.user", "_blank")}
                  className="w-full bg-gradient-to-r from-[#3B4DFF] to-[#2B35B3] text-white px-6 py-4 rounded-[16px] font-black text-sm shadow-lg shadow-[#3B4DFF]/30 flex items-center justify-center gap-2 mb-6"
                >
                  Download App
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="flex items-center justify-center gap-6 text-slate-400">
                  <Facebook className="w-5 h-5 hover:text-[#3B4DFF] cursor-pointer transition-colors" />
                  <Twitter className="w-5 h-5 hover:text-[#3B4DFF] cursor-pointer transition-colors" />
                  <Instagram className="w-5 h-5 hover:text-[#3B4DFF] cursor-pointer transition-colors" />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
