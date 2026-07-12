import React from 'react';

interface MaterialIconProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
    name: string;
    size?: number;
    filled?: boolean;
}

export const MaterialIcon: React.FC<MaterialIconProps> = ({
    name,
    size = 24,
    filled = false,
    className = '',
    style,
    ...props
}) => (
    <span
        aria-hidden="true"
        className={`material-symbols-outlined ${className}`}
        style={{
            fontSize: `${size}px`,
            fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
            ...style,
        }}
        {...props}
    >
        {name}
    </span>
);
