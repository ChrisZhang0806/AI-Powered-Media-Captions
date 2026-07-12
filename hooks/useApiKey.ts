import { useState, useCallback } from 'react';
import { validateApiKey } from '../services/apiKeyService';
import { Language, getTranslation } from '../utils/i18n';

export const useApiKey = (uiLanguage: Language) => {
    const t = getTranslation(uiLanguage);
    const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('openai_api_key') || '');
    const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
    const [tempApiKey, setTempApiKey] = useState('');
    const [isValidatingKey, setIsValidatingKey] = useState(false);
    const [hasKeyError, setHasKeyError] = useState(false);
    const keyError = hasKeyError ? t.errorInvalidApiKey : '';

    const openPanel = useCallback(() => {
        setTempApiKey(userApiKey);
        setShowApiKeyPanel(true);
        setHasKeyError(false);
    }, [userApiKey]);

    const closePanel = useCallback(() => {
        setShowApiKeyPanel(false);
        setHasKeyError(false);
    }, []);

    const saveApiKey = useCallback(async (onSuccess?: () => void) => {
        if (!tempApiKey.trim()) {
            setUserApiKey('');
            localStorage.removeItem('openai_api_key');
            setShowApiKeyPanel(false);
            return true;
        }

        setIsValidatingKey(true);
        const isValid = await validateApiKey(tempApiKey);
        setIsValidatingKey(false);

        if (isValid) {
            setUserApiKey(tempApiKey);
            localStorage.setItem('openai_api_key', tempApiKey);
            setShowApiKeyPanel(false);
            onSuccess?.(); // 调用成功回调
            return true;
        } else {
            setHasKeyError(true);
            return false;
        }
    }, [tempApiKey]);

    const removeApiKey = useCallback(() => {
        setUserApiKey('');
        setTempApiKey('');
        localStorage.removeItem('openai_api_key');
        setShowApiKeyPanel(false);
    }, []);

    return {
        userApiKey,
        showApiKeyPanel,
        tempApiKey,
        setTempApiKey,
        isValidatingKey,
        keyError,
        openPanel,
        closePanel,
        saveApiKey,
        removeApiKey,
    };
};
