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

export interface PointMenuProps {
  /** Where the menu opens, in viewport (client) px; `undefined` keeps it closed. */
  at: { x: number; y: number } | undefined;
  onClose(): void;
  label?: string;
  children: ReactNode;
}

/**
 * A dropdown menu that opens at a point instead of under a trigger ("Select
 * other…" in the viewport, P2-03). Radix anchors it to an invisible element
 * at `at`; focus returns to the page when it closes.
 */
export function PointMenu({ at, onClose, label, children }: PointMenuProps) {
  return (
    <Radix.Root
      open={at !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
    >
      <Radix.Trigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-0"
          style={at ? { left: at.x, top: at.y } : undefined}
        />
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          align="start"
          // Clear of the pointer: Radix takes a release over an item for a pick.
          sideOffset={10}
          collisionPadding={8}
          className={`${content} max-h-80 overflow-y-auto`}
          aria-label={label}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export interface MenuItemProps {
  onSelect?(): void;
  /** The pointer or the keyboard moved onto the item (it shows as highlighted). */
  onHighlight?(): void;
  disabled?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  children: ReactNode;
}

export function MenuItem({
  onSelect,
  onHighlight,
  disabled,
  icon,
  shortcut,
  children,
}: MenuItemProps) {
  const Item = useContext(InContextMenu) ? RadixContext.Item : Radix.Item;
  return (
    <Item className={item} disabled={disabled} onSelect={onSelect} onFocus={onHighlight}>
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

/** A menu item with a check mark that toggles (the selection filter, P2-03). */
export function MenuCheckboxItem({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  children: ReactNode;
}) {
  return (
    <Radix.CheckboxItem
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
      // Stay open: filters are usually changed several at a time.
      onSelect={(event) => event.preventDefault()}
      className={item}
    >
      <span className="grid w-4 place-items-center text-accent">
        <Radix.ItemIndicator>✓</Radix.ItemIndicator>
      </span>
      {children}
    </Radix.CheckboxItem>
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
