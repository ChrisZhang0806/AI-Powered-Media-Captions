import React from 'react';
import { Loader2, Check, ExternalLink, Trash2, Languages, ChevronDown } from 'lucide-react';
import { useApiKey } from '../hooks/useApiKey';
import { Language, getTranslation } from '../utils/i18n';

interface HeaderProps {
    onReset: () => void;
    apiKeyData: ReturnType<typeof useApiKey>;
    onApiKeySuccess?: () => void;
    uiLanguage: Language;
    setUiLanguage: (l: Language) => void;
}

export const Header: React.FC<HeaderProps> = ({ onReset, apiKeyData, onApiKeySuccess, uiLanguage, setUiLanguage }) => {
    const t = getTranslation(uiLanguage);
    const {
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
    } = apiKeyData;

    const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false);
    const [showLangDropdown, setShowLangDropdown] = React.useState(false);

    const handleClosePanel = () => {
        setIsConfirmingDelete(false);
        closePanel();
    };

    const handleLangSelect = (lang: Language) => {
        setUiLanguage(lang);
        setShowLangDropdown(false);
    };

    return (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onReset}
                        className="text-lg text-slate-900 tracking-tight transition-all hover:scale-[1.02] active:scale-95 hover:opacity-80 flex items-center gap-2"
                    >
                        {t.brand}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <button
                            onClick={() => setShowLangDropdown(!showLangDropdown)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all text-slate-600 hover:bg-slate-50 border border-slate-200 hover:border-slate-300 active:scale-95"
                        >
                            <Languages className="w-3.5 h-3.5" />
                            {uiLanguage === 'zh' ? '中文' : 'English'}
                            <ChevronDown className={`w-3 h-3 transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showLangDropdown && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={() => setShowLangDropdown(false)} />
                                <div className="absolute right-0 top-full mt-2 w-32 bg-white border border-slate-200 rounded-xl shadow-2xl z-[70] py-1 animate-in fade-in zoom-in slide-in-from-top-2 duration-150 origin-top-right overflow-hidden">
                                    <button
                                        onClick={() => handleLangSelect('zh')}
                                        className={`w-full text-left px-4 py-2 text-xs hover:bg-slate-50 flex items-center justify-between ${uiLanguage === 'zh' ? 'text-primary-600 font-medium bg-primary-50/30' : 'text-slate-600'}`}
                                    >
                                        中文
                                        {uiLanguage === 'zh' && <Check className="w-3 h-3" />}
                                    </button>
                                    <button
                                        onClick={() => handleLangSelect('en')}
                                        className={`w-full text-left px-4 py-2 text-xs hover:bg-slate-50 flex items-center justify-between ${uiLanguage === 'en' ? 'text-primary-600 font-medium bg-primary-50/30' : 'text-slate-600'}`}
                                    >
                                        English
                                        {uiLanguage === 'en' && <Check className="w-3 h-3" />}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="relative">
                        <button
                            onClick={showApiKeyPanel ? closePanel : openPanel}
                            className={`flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-medium transition-all ${userApiKey ? 'bg-transparent hover:bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-transparent hover:bg-primary-50 text-primary-700 ring-1 ring-primary-200'} hover:shadow-sm active:scale-95`}
                        >
                            {t.apiKey}
                        </button>

                        {showApiKeyPanel && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={handleClosePanel} />
                                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-[70] p-4 animate-in fade-in zoom-in slide-in-from-top-2 duration-150 origin-top-right">
                                    <h4 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                        {t.configApiKey}
                                    </h4>
                                    <p className="text-[10px] text-slate-500 mb-3 leading-normal">
                                        {t.apiKeyTip}
                                        <a
                                            href={userApiKey ? "https://platform.openai.com/settings/organization/usage" : "https://platform.openai.com/api-keys"}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary-600 hover:underline ml-1 inline-flex items-center gap-0.5"
                                        >
                                            {userApiKey ? t.viewUsage : t.getApiKey}
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </p>
                                    <div className="space-y-3">
                                        <input
                                            type="password"
                                            value={tempApiKey}
                                            onChange={(e) => setTempApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className={`w-full text-xs border rounded-lg focus:ring-primary-500 p-2 bg-slate-50 ${keyError ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                                            autoFocus
                                        />
                                        {keyError && (
                                            <p className="text-[10px] text-red-600 mt-1">{keyError}</p>
                                        )}
                                        <div className="flex gap-2">
                                            {userApiKey ? (
                                                <button
                                                    onClick={() => {
                                                        if (isConfirmingDelete) {
                                                            removeApiKey();
                                                            setIsConfirmingDelete(false);
                                                        } else {
                                                            setIsConfirmingDelete(true);
                                                        }
                                                    }}
                                                    className={`flex-1 px-3 py-1.5 border rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${isConfirmingDelete
                                                        ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                                                        : 'border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50'
                                                        }`}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    {isConfirmingDelete ? t.confirmDelete : t.deleteKey}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleClosePanel}
                                                    className="flex-1 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-slate-50 transition-colors"
                                                >
                                                    {t.cancel}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => saveApiKey(onApiKeySuccess)}
                                                disabled={isValidatingKey}
                                                className="flex-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                                            >
                                                {isValidatingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                                {t.verifyAndConfirm}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};
