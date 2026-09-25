import { SunMoon } from 'lucide-react';
import { IconButton, Menu, MenuLabel, MenuRadioGroup, type ThemeChoice } from '../design-system';

/** Dark, light or system (docs/05-brand.md §3), in the app bar and on the home screen. */
export function ThemeMenu({
  theme,
  onThemeChange,
}: {
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
}) {
  return (
    <Menu
      label="Theme"
      align="end"
      trigger={
        <IconButton label="Theme" hint="Dark, light, or follow the system.">
          <SunMoon size={18} strokeWidth={1.75} />
        </IconButton>
      }
    >
      <MenuLabel>Theme</MenuLabel>
      <MenuRadioGroup
        value={theme}
        onChange={onThemeChange}
        options={[
          { value: 'dark', label: 'Dark (Slate)' },
          { value: 'light', label: 'Light' },
          { value: 'system', label: 'Same as system' },
        ]}
      />
    </Menu>
  );
}
