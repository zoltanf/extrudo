import { DropdownMenu as Radix, ContextMenu as RadixContext } from 'radix-ui';
import { createContext, type ReactElement, type ReactNode, useContext } from 'react';

const content =
  'z-50 min-w-48 rounded-dialog border border-line bg-raised p-1 text-base text-ink shadow-raised';
const item =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-input px-2 outline-none data-highlighted:bg-accent-soft data-disabled:text-muted data-disabled:opacity-60';

export interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  label?: string;
}

/** A dropdown menu (Radix): keyboard navigation, typeahead, focus return. */
export function Menu({ trigger, children, align = 'start', label }: MenuProps) {
  return (
    <Radix.Root>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content align={align} sideOffset={4} className={content} aria-label={label}>
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

/** Which Radix menu the items are in: the parts aren't interchangeable. */
const InContextMenu = createContext(false);

export interface ContextMenuProps {
  /** The element that opens the menu on right-click (or the context-menu key, or a long press). */
  trigger: ReactElement;
  children: ReactNode;
  label?: string;
  /** Leave the trigger's own right-click alone. */
  disabled?: boolean;
  onOpenChange?(open: boolean): void;
}

/** A right-click menu (Radix): the same items as `Menu`. */
export function ContextMenu({
  trigger,
  children,
  label,
  disabled,
  onOpenChange,
}: ContextMenuProps) {
  return (
    <RadixContext.Root onOpenChange={onOpenChange} modal={false}>
      <RadixContext.Trigger asChild disabled={disabled}>
        {trigger}
      </RadixContext.Trigger>
      <RadixContext.Portal>
        <RadixContext.Content className={content} aria-label={label} collisionPadding={8}>
          <InContextMenu.Provider value={true}>{children}</InContextMenu.Provider>
        </RadixContext.Content>
      </RadixContext.Portal>
    </RadixContext.Root>
  );
}

export interface MenuItemProps {
  onSelect?(): void;
  disabled?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  children: ReactNode;
}

export function MenuItem({ onSelect, disabled, icon, shortcut, children }: MenuItemProps) {
  const Item = useContext(InContextMenu) ? RadixContext.Item : Radix.Item;
  return (
    <Item className={item} disabled={disabled} onSelect={onSelect}>
      <span className="grid w-4 place-items-center text-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <kbd className="font-mono text-xs text-muted">{shortcut}</kbd>}
    </Item>
  );
}

export function MenuRadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange(value: T): void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <Radix.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <Radix.RadioItem key={o.value} value={o.value} className={item}>
          <span className="grid w-4 place-items-center text-accent">
            <Radix.ItemIndicator>●</Radix.ItemIndicator>
          </span>
          {o.label}
        </Radix.RadioItem>
      ))}
    </Radix.RadioGroup>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <Radix.Label className="px-2 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </Radix.Label>
  );
}

export function MenuSeparator() {
  const Separator = useContext(InContextMenu) ? RadixContext.Separator : Radix.Separator;
  return <Separator className="my-1 h-px bg-line" />;
}
