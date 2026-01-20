import React from 'react';
import { Loader2, Check, ExternalLink, Trash2 } from 'lucide-react';
import { useApiKey } from '../hooks/useApiKey';

interface HeaderProps {
    onReset: () => void;
    apiKeyData: ReturnType<typeof useApiKey>;
}

export const Header: React.FC<HeaderProps> = ({ onReset, apiKeyData }) => {
    const {
        userApiKey,
        showApiKeyPanel,
        tempApiKey,
        setTempApiKey,
        isValidatingKey,
        openPanel,
        closePanel,
        saveApiKey,
        removeApiKey,
    } = apiKeyData;

    const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false);

    const handleClosePanel = () => {
        setIsConfirmingDelete(false);
        closePanel();
    };

    return (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onReset}
                        className="text-lg text-slate-900 tracking-tight transition-all hover:scale-[1.02] active:scale-95 hover:opacity-80 flex items-center gap-2"
                    >
                        AI Powered <span className="text-primary-600">Media Captions</span>
                    </button>
                </div>

                <div className="relative">
                    <button
                        onClick={showApiKeyPanel ? closePanel : openPanel}
                        className={`flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-medium transition-all ${userApiKey ? 'bg-transparent hover:bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-transparent hover:bg-primary-50 text-primary-700 ring-1 ring-primary-200'} hover:shadow-sm active:scale-95`}
                    >
                        OPENAI API KEY
                    </button>

                    {showApiKeyPanel && (
                        <>
                            <div className="fixed inset-0 z-[60]" onClick={handleClosePanel} />
                            <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-[70] p-4 animate-in fade-in zoom-in slide-in-from-top-2 duration-150 origin-top-right">
                                <h4 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                    配置 OpenAI API Key
                                </h4>
                                <p className="text-[10px] text-slate-500 mb-3 leading-normal">
                                    本工具需配置有效的 OpenAI API Key 才能使用。Key 将仅保存在您的浏览器本地。
                                    <a
                                        href={userApiKey ? "https://platform.openai.com/settings/organization/usage" : "https://platform.openai.com/api-keys"}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary-600 hover:underline ml-1 inline-flex items-center gap-0.5"
                                    >
                                        {userApiKey ? "查看余额/用量" : "获取 API Key"}
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                </p>
                                <div className="space-y-3">
                                    <input
                                        type="password"
                                        value={tempApiKey}
                                        onChange={(e) => setTempApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full text-xs border-slate-200 rounded-lg focus:ring-primary-500 p-2 bg-slate-50"
                                        autoFocus
                                    />
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
                                                className={`flex-1 px-3 py-1.5 border rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 ${isConfirmingDelete
                                                        ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                                                        : 'border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50'
                                                    }`}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                {isConfirmingDelete ? '确认删除' : '删除 Key'}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleClosePanel}
                                                className="flex-1 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-slate-50 transition-colors"
                                            >
                                                取消
                                            </button>
                                        )}
                                        <button
                                            onClick={saveApiKey}
                                            disabled={isValidatingKey}
                                            className="flex-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                                        >
                                            {isValidatingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                            验证并确认
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
};
