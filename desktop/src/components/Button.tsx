import type { ReactNode } from "react";

export function Button({
  children,
  icon,
  disabled,
  onClick,
  variant = "default",
  title,
  ariaLabel,
  iconOnly = false
}: {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "primary" | "quiet" | "danger";
  title?: string;
  ariaLabel?: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      className={`button ${variant}${iconOnly ? " iconOnly" : ""}`}
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
