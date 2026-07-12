import React from 'react';
import { createPortal } from 'react-dom';
import { useApiKey } from '../hooks/useApiKey';
import { Language, getTranslation } from '../utils/i18n';
import { MaterialIcon } from './MaterialIcon';

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
    const languageOptions: Array<{ value: Language; label: string; shortLabel: string }> = [
        { value: 'zh', label: '简体中文', shortLabel: '简体中文' },
        { value: 'zh-TW', label: '繁體中文', shortLabel: '繁體中文' },
        { value: 'en', label: 'English', shortLabel: 'English' }
    ];
    const activeLanguage = languageOptions.find((option) => option.value === uiLanguage) || languageOptions[0];

    const handleClosePanel = React.useCallback(() => {
        setIsConfirmingDelete(false);
        closePanel();
    }, [closePanel]);

    const handleOpenPanel = () => {
        setShowLangDropdown(false);
        setIsConfirmingDelete(false);
        openPanel();
    };

    const handleLangSelect = (lang: Language) => {
        setUiLanguage(lang);
        setShowLangDropdown(false);
    };

    React.useEffect(() => {
        if (!showApiKeyPanel) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClosePanel();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleClosePanel, showApiKeyPanel]);

    return (
        <>
            <header className="app-titlebar sticky top-0 z-40 bg-background/95 backdrop-blur-xl">
                <div className="mx-auto flex min-h-11 max-w-[1600px] items-center justify-between px-4 sm:px-6">
                    <div className="flex min-w-0 items-center">
                        <div className="min-w-0 text-on-surface" aria-label={t.brand}>
                            <span className="block max-w-36 text-sm font-bold leading-5 sm:max-w-none">{t.brand}</span>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowLangDropdown(!showLangDropdown)}
                                aria-expanded={showLangDropdown}
                                aria-haspopup="menu"
                                className="focus-apple flex h-8 items-center gap-1 rounded-full border border-outline-variant bg-transparent px-3 text-[11px] font-medium leading-4 text-on-surface-variant transition-colors hover:bg-surface-container-high"
                            >
                                <MaterialIcon name="translate" size={16} />
                                {activeLanguage.shortLabel}
                                <MaterialIcon name="keyboard_arrow_down" size={16} className={`transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            {showLangDropdown && (
                                <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowLangDropdown(false)} />
                                    <div className="app-popover animate-popover-in absolute right-0 top-full z-[70] mt-2 w-40 origin-top-right overflow-hidden rounded-xl p-1" role="menu">
                                        {languageOptions.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleLangSelect(option.value)}
                                                className={`focus-apple flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors hover:bg-surface-container-high ${uiLanguage === option.value ? 'bg-primary-fixed font-medium text-on-primary-fixed' : 'text-on-surface-variant'}`}
                                                role="menuitemradio"
                                                aria-checked={uiLanguage === option.value}
                                            >
                                                {option.label}
                                                {uiLanguage === option.value && <MaterialIcon name="check" size={18} />}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={showApiKeyPanel ? handleClosePanel : handleOpenPanel}
                            aria-expanded={showApiKeyPanel}
                            aria-haspopup="dialog"
                            aria-controls="api-key-dialog"
                            className="focus-apple flex h-8 items-center gap-1.5 rounded-full border border-outline-variant bg-transparent px-3 text-[11px] font-medium leading-4 text-primary transition-colors hover:bg-primary-fixed/50"
                            aria-label={t.apiKey}
                        >
                            <MaterialIcon name="key" size={18} />
                            <span className="hidden sm:inline">{t.apiKey}</span>
                        </button>
                    </div>
                </div>
            </header>

            {showApiKeyPanel && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
                    <div
                        className="absolute inset-0 cursor-default bg-black/30"
                        onClick={handleClosePanel}
                        aria-hidden="true"
                    />
                    <section
                        id="api-key-dialog"
                        className="md3-dialog relative w-full max-w-[520px] rounded-[28px] bg-surface-container-high p-5 sm:p-6"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="api-key-panel-title"
                        aria-describedby="api-key-panel-description"
                    >
                        <div>
                            <h2 id="api-key-panel-title" className="text-2xl font-medium leading-8 text-on-surface">
                                {t.configApiKey}
                            </h2>
                            <p id="api-key-panel-description" className="mt-3 text-sm leading-5 text-on-surface-variant">
                                {t.apiKeyTip}
                            </p>
                            <a
                                href={userApiKey ? 'https://platform.openai.com/settings/organization/usage' : 'https://platform.openai.com/api-keys'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="focus-apple mt-2 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-sm font-medium text-primary transition-colors hover:bg-primary-fixed/60"
                            >
                                {userApiKey ? t.viewUsage : t.getApiKey}
                                <MaterialIcon name="open_in_new" size={18} />
                            </a>
                        </div>

                        <div
                            className={`md3-outlined-field relative mt-5 rounded-[4px] border bg-transparent ${keyError ? 'border-error' : 'border-outline'}`}
                            data-invalid={Boolean(keyError)}
                        >
                            <label
                                htmlFor="openai-api-key"
                                className={`absolute -top-2 left-3 bg-surface-container-high px-1 text-xs leading-4 ${keyError ? 'text-error' : 'text-on-surface-variant'}`}
                            >
                                {t.apiKeyFieldLabel}
                            </label>
                            <input
                                id="openai-api-key"
                                type="password"
                                value={tempApiKey}
                                onChange={(event) => setTempApiKey(event.target.value)}
                                placeholder="sk-..."
                                className="h-14 w-full bg-transparent px-4 pt-1 text-base text-on-surface outline-none placeholder:text-outline"
                                aria-invalid={Boolean(keyError)}
                                aria-describedby={keyError ? 'api-key-error' : undefined}
                                autoComplete="off"
                                spellCheck={false}
                                autoFocus
                            />
                        </div>

                        {keyError && (
                            <p id="api-key-error" className="mt-1.5 flex items-start gap-1.5 px-3 text-xs leading-4 text-error" role="alert">
                                <MaterialIcon name="error" size={16} />
                                <span>{keyError}</span>
                            </p>
                        )}

                        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                            {userApiKey && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isConfirmingDelete) {
                                            removeApiKey();
                                            setIsConfirmingDelete(false);
                                        } else {
                                            setIsConfirmingDelete(true);
                                        }
                                    }}
                                    className="focus-apple inline-flex min-h-10 items-center gap-2 self-start rounded-full px-3 text-sm font-medium text-error transition-colors hover:bg-error-container sm:mr-auto"
                                >
                                    <MaterialIcon name="delete" size={20} />
                                    {isConfirmingDelete ? t.confirmDelete : t.deleteKey}
                                </button>
                            )}
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={handleClosePanel}
                                    className="focus-apple min-h-10 rounded-full px-3 text-sm font-medium text-primary transition-colors hover:bg-primary-fixed/60"
                                >
                                    {t.cancel}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => saveApiKey(onApiKeySuccess)}
                                    disabled={isValidatingKey}
                                    className="focus-apple inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                                >
                                    <MaterialIcon name={isValidatingKey ? 'progress_activity' : 'check'} size={20} className={isValidatingKey ? 'animate-spin' : ''} />
                                    {t.verifyAndConfirm}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>,
                document.body
            )}
        </>
    );
};
