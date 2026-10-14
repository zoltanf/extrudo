import {
  LayoutGrid,
  LogOut,
  Mouse,
  Palette,
  Puzzle,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuSeparator,
  MenuSub,
  type ThemeChoice,
} from '../design-system';
import { type DisplayAccess, useDisplaySettings } from '../settings/displaySettings';
import { NAV_PRESETS } from '../viewport/navigation';

export interface AppMenuProps {
  /** The display settings: the project's viewport, or the preference on the home screen. */
  display: DisplayAccess;
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
  /** The same state as the command "Right-Click Menu: Use a List / Use the Ring". */
  markingRadial: boolean;
  onMarkingRadial(radial: boolean): void;
  /** Opens the Settings dialog (ADR-0082). */
  onSettings(): void;
  /** Opens the Plugins dialog (R3-12). */
  onPlugins?: (() => void) | undefined;
  /** Opens "Customize Marking Menu…"; absent where no commands exist (the home screen). */
  onCustomizeMarking?: (() => void) | undefined;
  /** Desktop only: saves everything, then quits. */
  onQuit?: (() => void) | undefined;
  /** The web's stand-in for Quit inside a design (a page can't close its tab): back to Home. */
  onCloseDesign?: (() => void) | undefined;
}

/** A command's first key as it reads here ("Ctrl+K"). */
const keyLabel = (id: string) => {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
};

/**
 * The app menu (four squares): the same on the home screen and in a design.
 * Settings and Plugins first, then the quick preferences as submenus, Quit last.
 */
export function AppMenu({
  display,
  theme,
  onThemeChange,
  markingRadial,
  onMarkingRadial,
  onSettings,
  onPlugins,
  onCustomizeMarking,
  onQuit,
  onCloseDesign,
}: AppMenuProps) {
  const { autoProject, autoProjectFace, preset } = useDisplaySettings(display);
  return (
    <Menu
      label="Menu"
      align="end"
      trigger={
        <IconButton label="Menu" hint="Settings, plugins, theme and mouse controls.">
          <LayoutGrid size={18} strokeWidth={1.75} />
        </IconButton>
      }
    >
      <MenuItem
        icon={<Settings size={14} />}
        shortcut={keyLabel('openSettings')}
        onSelect={onSettings}
      >
        Settings…
      </MenuItem>
      {onPlugins && (
        <MenuItem icon={<Puzzle size={14} />} onSelect={onPlugins}>
          Plugins…
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuSub label="Behaviour" icon={<SlidersHorizontal size={14} />}>
        <MenuCheckboxItem checked={autoProject} onChange={(v) => display.set({ autoProject: v })}>
          Auto-project body edges
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={autoProjectFace}
          onChange={(v) => display.set({ autoProjectFace: v })}
        >
          Auto-project face outline
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={markingRadial} onChange={onMarkingRadial}>
          Radial right-click menu
        </MenuCheckboxItem>
        {onCustomizeMarking && (
          <MenuItem onSelect={onCustomizeMarking}>Customize Marking Menu…</MenuItem>
        )}
      </MenuSub>
      {/* Each preset says what it binds before it is chosen (R3-03). The Settings
          dialog's "Mouse buttons" is the same preference. */}
      <MenuSub label="Mouse controls" icon={<Mouse size={14} />}>
        <MenuRadioGroup
          value={preset}
          onChange={(value) => display.set({ preset: value })}
          options={NAV_PRESETS.map((p) => ({
            value: p.value,
            label: p.label,
            description: p.summary,
          }))}
        />
      </MenuSub>
      <MenuSub label="Theme" icon={<Palette size={14} />}>
        <MenuRadioGroup
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </MenuSub>
      {onCloseDesign && (
        <>
          <MenuSeparator />
          <MenuItem icon={<X size={14} />} onSelect={onCloseDesign}>
            Close design
          </MenuItem>
        </>
      )}
      {onQuit && (
        <>
          <MenuSeparator />
          <MenuItem icon={<LogOut size={14} />} shortcut={keyLabel('quit')} onSelect={onQuit}>
            Quit
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
