import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import fr from './locales/fr.json';
import en from './locales/en.json';

const deviceLang = getLocales()[0]?.languageCode ?? 'fr';

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: deviceLang === 'fr' ? 'fr' : 'en',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

AsyncStorage.getItem('mikrolan_language').then((saved: string | null) => {
  if (saved === 'fr' || saved === 'en') {
    i18n.changeLanguage(saved);
  }
}).catch(() => {});

export default i18n;
