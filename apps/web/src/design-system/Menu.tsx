import { DropdownMenu as Radix, ContextMenu as RadixContext } from 'radix-ui';
import { createContext, type ReactElement, type ReactNode, useContext } from 'react';

const content =
  'z-50 min-w-48 overflow-y-auto rounded-dialog border border-line bg-raised p-1 text-base text-ink shadow-raised';
/**
 * A menu that is taller than the space it opens in scrolls instead of reaching
 * past the window (P4-05: two more Create items made the Sketch tab's menu
 * taller than a 900 px viewport, and its last items could not be clicked).
 * Radix measures the room and sets the variable per menu kind.
 */
const dropContent = `${content} max-h-[var(--radix-dropdown-menu-content-available-height)]`;
const contextContent = `${content} max-h-[var(--radix-context-menu-content-available-height)]`;
const item =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-input px-2 outline-none data-highlighted:bg-accent-soft data-disabled:text-muted data-disabled:opacity-60';

export interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  label?: string;
  /**
   * Runs when the menu has closed and is about to give focus back to its trigger;
   * `preventDefault()` keeps focus where it is, for an action that moves it
   * somewhere else (a rename field).
   */
  onCloseAutoFocus?(event: Event): void;
}

/** A dropdown menu (Radix): keyboard navigation, typeahead, focus return. */
export function Menu({ trigger, children, align = 'start', label, onCloseAutoFocus }: MenuProps) {
  return (
    <Radix.Root>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          align={align}
          sideOffset={4}
          className={dropContent}
          aria-label={label}
          {...(onCloseAutoFocus && { onCloseAutoFocus })}
        >
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
  /** As `Menu`'s: runs as the menu closes, before focus goes back to where it was. */
  onCloseAutoFocus?(event: Event): void;
}

/** A right-click menu (Radix): the same items as `Menu`. */
export function ContextMenu({
  trigger,
  children,
  label,
  disabled,
  onOpenChange,
  onCloseAutoFocus,
}: ContextMenuProps) {
  return (
    <RadixContext.Root onOpenChange={onOpenChange} modal={false}>
      <RadixContext.Trigger asChild disabled={disabled}>
        {trigger}
      </RadixContext.Trigger>
      <RadixContext.Portal>
        <RadixContext.Content
          className={contextContent}
          aria-label={label}
          collisionPadding={8}
          {...(onCloseAutoFocus && { onCloseAutoFocus })}
        >
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
          className={`${dropContent} max-h-80`}
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

/**
 * A submenu (P6-05: a body's "Move to Component ▸"): a trigger row that opens a nested
 * list of `MenuItem`s, in a dropdown or a context menu.
 */
export function MenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const inContext = useContext(InContextMenu);
  const Parts = inContext ? RadixContext : Radix;
  return (
    <Parts.Sub>
      <Parts.SubTrigger className={item}>
        <span className="grid w-4 place-items-center text-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        <span aria-hidden className="text-muted">
          ▸
        </span>
      </Parts.SubTrigger>
      <Parts.Portal>
        <Parts.SubContent
          className={inContext ? contextContent : dropContent}
          aria-label={label}
          collisionPadding={8}
        >
          {children}
        </Parts.SubContent>
      </Parts.Portal>
    </Parts.Sub>
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
