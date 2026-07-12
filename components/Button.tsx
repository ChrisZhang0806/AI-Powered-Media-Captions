import React from 'react';
import { MaterialIcon } from './MaterialIcon';

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
  const baseStyle = "focus-apple inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    primary: "bg-primary text-on-primary shadow-md hover:opacity-90 active:scale-[0.99]",
    secondary: "border border-outline-variant bg-surface-container text-primary hover:bg-surface-container-high active:scale-[0.99]",
    ghost: "text-on-surface-variant hover:bg-surface-container-high active:scale-[0.99]"
  };

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <MaterialIcon name="progress_activity" size={20} className="animate-spin" />
          {children}
        </span>
      ) : children}
    </button>
  );
};
