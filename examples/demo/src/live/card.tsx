/** @jsxImportSource tauri-plugin-live-activity/jsx */
// The card of the live-editing page (docs/live-editing.md). Edit it while `npm run live:ios` runs in examples/demo and
// save: Vite sends the new module, the page draws again, and `useLiveActivity` passes on what changed. New values
// update the running activity. A new layout, new styles, or a value added, removed or of another type end it and start
// another, since an activity keeps its layout and the names and types of its values for its whole life.
import { HStack, Progress, SFSymbol, Spacer, Text, VStack } from 'tauri-plugin-live-activity/jsx';
import type { Layout, LayoutColor, LayoutStyle, LayoutValues } from 'tauri-plugin-live-activity';

// Mochi's colors, as the demo's other examples have them. The Dynamic Island is always dark.
const background: LayoutColor = { light: '#FAF7EF', dark: '#2E3229' };
const coral: LayoutColor = '#C9654D';
const teal: LayoutColor = { light: '#286D60', dark: '#A3D9C2' };
const mint: LayoutColor = '#A3D9C2';

export const values: LayoutValues = {
  title: 'Mochi’s snack',
  status: 'Packing a tiny treat',
  eta: '9 min',
  done: 0.3,
};

export const styles: { readonly [token: string]: LayoutStyle } = {
  card: { padding: 16, frame: { maxWidth: 'infinity', alignment: 'leading' } },
  title: { font: 'headline', design: 'rounded', lineLimit: 1 },
  status: { font: 'subheadline', color: 'secondary', lineLimit: 2 },
  eta: { font: 'caption', weight: 'semibold', monospacedDigit: true },
  paw: { color: coral },
  meter: { tint: teal },
  islandTitle: { font: 'headline', design: 'rounded', color: 'white', lineLimit: 1 },
  islandValue: { font: 'caption', weight: 'semibold', monospacedDigit: true, color: mint },
  islandMeter: { tint: mint },
};

export const layout: Layout = {
  lockScreen: (
    <VStack alignment="leading" spacing={8} style="card">
      <HStack spacing={8}>
        <SFSymbol name="pawprint.fill" style="paw" />
        <Text bind="title" style="title" />
        <Spacer />
        <Text bind="eta" style="eta" />
      </HStack>
      <Text bind="status" style="status" />
      <Progress bind="done" style="meter" />
    </VStack>
  ),
  island: {
    expanded: {
      leading: <SFSymbol name="pawprint.fill" style="paw" />,
      center: <Text bind="title" style="islandTitle" />,
      trailing: <Text bind="eta" style="islandValue" />,
      bottom: <Progress bind="done" style="islandMeter" />,
    },
    compactLeading: <SFSymbol name="pawprint.fill" style="paw" />,
    compactTrailing: <Text bind="eta" style="islandValue" />,
    minimal: <Progress bind="done" kind="circular" style="islandMeter" />,
  },
  background,
  keyline: mint,
};
