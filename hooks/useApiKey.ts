import { useState, useCallback } from 'react';
import { validateApiKey } from '../services/openaiService';

export const useApiKey = () => {
    const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('openai_api_key') || '');
    const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
    const [tempApiKey, setTempApiKey] = useState('');
    const [isValidatingKey, setIsValidatingKey] = useState(false);
    const [keyError, setKeyError] = useState<string>('');

    const openPanel = useCallback(() => {
        setTempApiKey(userApiKey);
        setShowApiKeyPanel(true);
        setKeyError('');
    }, [userApiKey]);

    const closePanel = useCallback(() => {
        setShowApiKeyPanel(false);
        setKeyError('');
    }, []);

    const saveApiKey = useCallback(async () => {
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
            return true;
        } else {
            setKeyError('API Key 验证失败，请检查是否输入正确。');
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
