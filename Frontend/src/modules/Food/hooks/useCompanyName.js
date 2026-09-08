import { useState, useEffect } from 'react';
import { getCachedSettings } from '@food/utils/businessSettings';

/**
 * Custom hook to get company name from business settings
 * @returns {string} Company name with fallback to "Dooriq"
 */
export const useCompanyName = () => {
  const [companyName, setCompanyName] = useState(() => {
    const cached = getCachedSettings();
    return cached?.companyName || 'Dooriq';
  });

  useEffect(() => {
    const syncCompanyName = () => {
      const updated = getCachedSettings();
      if (updated?.companyName) {
        setCompanyName(updated.companyName);
      }
    };

    syncCompanyName();
    window.addEventListener('businessSettingsUpdated', syncCompanyName);
    return () => window.removeEventListener('businessSettingsUpdated', syncCompanyName);
  }, []);

  return companyName;
};
