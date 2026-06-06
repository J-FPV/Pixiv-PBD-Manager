import type { ReactNode } from "react";

export function Button({
  children,
  icon,
  disabled,
  onClick,
  variant = "default",
  title,
  ariaLabel,
  iconOnly = false,
  className
}: {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "primary" | "quiet" | "danger";
  title?: string;
  ariaLabel?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`button ${variant}${iconOnly ? " iconOnly" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
    >
      {icon}
      <span className={iconOnly ? "srOnly" : undefined}>{children}</span>
    </button>
  );
}
