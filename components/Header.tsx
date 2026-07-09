import React from 'react';
import { Loader2, Check, ExternalLink, Trash2, Languages, ChevronDown, KeyRound, Sparkles } from 'lucide-react';
import { useApiKey } from '../hooks/useApiKey';
import { Language, getTranslation } from '../utils/i18n';

interface HeaderProps {
    apiKeyData: ReturnType<typeof useApiKey>;
    onApiKeySuccess?: () => void;
    uiLanguage: Language;
    setUiLanguage: (l: Language) => void;
}

export const Header: React.FC<HeaderProps> = ({ apiKeyData, onApiKeySuccess, uiLanguage, setUiLanguage }) => {
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
        <header className="app-titlebar sticky top-0 z-40 border-b border-white/70 bg-white/[0.72] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-950/[0.72]">
            <div className="app-titlebar-content max-w-[1440px] mx-auto h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-zinc-950 dark:text-zinc-50" aria-label={t.brand}>
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-sm shadow-zinc-950/20 dark:bg-zinc-50 dark:text-zinc-950">
                            <Sparkles className="h-4 w-4" />
                        </span>
                        <span className="text-sm font-semibold">{t.brand}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                    <div className="relative">
                        <button
                            onClick={() => setShowLangDropdown(!showLangDropdown)}
                            aria-expanded={showLangDropdown}
                            aria-haspopup="menu"
                            className="focus-apple flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200/70 bg-white/60 px-3 text-xs font-medium text-zinc-700 transition-all hover:bg-white active:scale-[0.99] dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                        >
                            <Languages className="w-3.5 h-3.5" />
                            {uiLanguage === 'zh' ? '中文' : 'English'}
                            <ChevronDown className={`w-3 h-3 transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showLangDropdown && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={() => setShowLangDropdown(false)} />
                                <div className="app-popover animate-popover-in absolute right-0 top-full z-[70] mt-2 w-36 origin-top-right overflow-hidden rounded-lg p-1" role="menu">
                                    <button
                                        onClick={() => handleLangSelect('zh')}
                                        className={`focus-apple flex min-h-10 w-full items-center justify-between rounded-md px-3 text-left text-xs transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/10 ${uiLanguage === 'zh' ? 'text-sky-700 font-medium bg-sky-50/80 dark:bg-sky-400/10 dark:text-sky-300' : 'text-zinc-700 dark:text-zinc-200'}`}
                                        role="menuitemradio"
                                        aria-checked={uiLanguage === 'zh'}
                                    >
                                        中文
                                        {uiLanguage === 'zh' && <Check className="w-3 h-3" />}
                                    </button>
                                    <button
                                        onClick={() => handleLangSelect('en')}
                                        className={`focus-apple flex min-h-10 w-full items-center justify-between rounded-md px-3 text-left text-xs transition-colors hover:bg-zinc-950/5 dark:hover:bg-white/10 ${uiLanguage === 'en' ? 'text-sky-700 font-medium bg-sky-50/80 dark:bg-sky-400/10 dark:text-sky-300' : 'text-zinc-700 dark:text-zinc-200'}`}
                                        role="menuitemradio"
                                        aria-checked={uiLanguage === 'en'}
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
                            aria-expanded={showApiKeyPanel}
                            aria-haspopup="dialog"
                            className={`focus-apple flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-all hover:bg-white active:scale-[0.99] dark:hover:bg-white/10 ${userApiKey ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300' : 'border-sky-200/80 bg-sky-50/70 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300'}`}
                        >
                            <KeyRound className="h-3.5 w-3.5" />
                            {t.apiKey}
                        </button>

                        {showApiKeyPanel && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={handleClosePanel} />
                                <div className="app-popover animate-popover-in absolute right-0 top-full z-[70] mt-2 w-80 origin-top-right rounded-lg p-4" role="dialog" aria-modal="true" aria-labelledby="api-key-panel-title">
                                    <h4 id="api-key-panel-title" className="text-sm font-semibold text-zinc-950 mb-3 flex items-center gap-2 dark:text-zinc-50">
                                        <KeyRound className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                                        {t.configApiKey}
                                    </h4>
                                    <p className="text-xs text-zinc-500 mb-3 leading-relaxed dark:text-zinc-400">
                                        {t.apiKeyTip}
                                        <a
                                            href={userApiKey ? "https://platform.openai.com/settings/organization/usage" : "https://platform.openai.com/api-keys"}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sky-700 hover:underline ml-1 inline-flex items-center gap-0.5 dark:text-sky-300"
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
                                            className={`focus-apple w-full min-h-11 rounded-lg border px-3 text-sm outline-none transition-colors ${keyError ? 'border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100' : 'border-zinc-200 bg-white/70 text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50'}`}
                                            autoFocus
                                        />
                                        {keyError && (
                                            <p className="text-xs text-red-600 mt-1 dark:text-red-300">{keyError}</p>
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
                                                    className={`focus-apple flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs transition-colors ${isConfirmingDelete
                                                        ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                                                        : 'border-zinc-200 text-zinc-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-red-400/10'
                                                        }`}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    {isConfirmingDelete ? t.confirmDelete : t.deleteKey}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleClosePanel}
                                                    className="focus-apple min-h-11 flex-1 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-950/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
                                                >
                                                    {t.cancel}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => saveApiKey(onApiKeySuccess)}
                                                disabled={isValidatingKey}
                                                className="focus-apple flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-white"
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
