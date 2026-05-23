import type { ReactNode } from "react";

export function Button({
  children,
  icon,
  disabled,
  onClick,
  variant = "default"
}: {
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "primary" | "quiet" | "danger";
}) {
  return (
    <button className={`button ${variant}`} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
