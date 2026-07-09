import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  className = '',
  isLoading = false,
  disabled,
  ...props
}) => {
  const baseStyle = "focus-apple inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    primary: "bg-zinc-950 text-white shadow-sm shadow-zinc-950/15 hover:bg-zinc-800 active:scale-[0.99] dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-white",
    secondary: "app-panel text-zinc-700 hover:bg-white/90 active:scale-[0.99] dark:text-zinc-200 dark:hover:bg-zinc-800/90",
    ghost: "text-zinc-600 hover:bg-zinc-950/5 active:scale-[0.99] dark:text-zinc-300 dark:hover:bg-white/10"
  };

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing...
        </span>
      ) : children}
    </button>
  );
};
