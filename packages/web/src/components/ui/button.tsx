import { type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-default",
      ghost: "ui-button-ghost",
      outline: "ui-button-outline",
    },
    size: {
      default: "ui-button-md",
      icon: "ui-button-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
