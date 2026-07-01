import { type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export function Input({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} data-slot="input" className={cn("ui-input", className)} {...props} />;
}
