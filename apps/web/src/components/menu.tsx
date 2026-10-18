"use client";

import { Ellipsis } from "lucide-react";
import { DropdownMenu, Popover as PopoverPrimitive } from "radix-ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { button } from "./styles";

// Menus and popovers render in a portal on <body>. Inside a <dialog> opened
// as a modal, everything outside the dialog is inert, so don't nest them in
// a Modal.

const surface =
  "z-50 rounded-lg border border-line bg-surface p-1 text-sm text-foreground shadow-lg animate-pop";

// A menu of actions behind a button: by default the "…" button that holds a
// page's less frequent actions, such as rename and delete.
export function Menu({
  label = "More actions",
  trigger,
  align = "end",
  children,
}: {
  label?: string;
  trigger?: ReactNode;
  align?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={`${button.secondary} px-2`}
            aria-label={label}
            title={label}
          >
            <Ellipsis />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className={`${surface} min-w-48`}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const item =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export function MenuItem({
  icon,
  danger = false,
  disabled,
  onSelect,
  children,
}: {
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`${item} ${
        danger
          ? "text-danger data-[highlighted]:bg-danger-soft"
          : "data-[highlighted]:bg-surface-2 [&_svg]:text-muted"
      }`}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

// An entry that navigates, such as to another version.
export function MenuLink({
  href,
  current = false,
  children,
}: {
  href: string;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`${item} data-[highlighted]:bg-surface-2 aria-[current=page]:bg-accent-soft/60 [&_svg]:text-muted`}
      >
        {children}
      </Link>
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuRadioGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
      {options.map((option) => (
        <DropdownMenu.RadioItem
          key={option.value}
          value={option.value}
          className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted"
        >
          {option.icon}
          {option.label}
          <DropdownMenu.ItemIndicator className="ml-auto size-1.5 rounded-full bg-accent" />
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

// A panel of controls anchored to a button, such as an analysis's periods.
export function Popover({
  trigger,
  align = "start",
  width = "w-80",
  children,
}: {
  trigger: ReactNode;
  align?: "start" | "center" | "end";
  width?: string;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={`${surface} ${width} max-w-[calc(100vw-2rem)] p-4`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
