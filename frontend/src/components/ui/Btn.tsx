import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: "primary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  full?: boolean;
}

export function Btn({ kind = "primary", size = "md", icon, full, children, className = "", ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${kind} btn-${size}${full ? " btn-full" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 19 : 16} />}
      {children}
    </button>
  );
}
