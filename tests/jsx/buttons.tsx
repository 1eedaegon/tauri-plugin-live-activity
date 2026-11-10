// The lock screen of the demo's buttons example (examples/demo/src/layouts.ts), written in TSX.
import { Button, HStack, SFSymbol, Text, VStack } from 'tauri-plugin-live-activity/jsx';

export const lockScreen = (
  <VStack alignment="leading" spacing={8} style="card">
    <HStack spacing={8}>
      <SFSymbol name="cat.fill" style="icon" />
      <Text bind="title" style="title" />
    </HStack>
    <Text bind="status" style="status" />
    <HStack spacing={8}>
      <Button actionId="pet" style="action"><Text>Pet Mochi</Text></Button>
      <Button actionId="done" style="quiet"><Text>All done</Text></Button>
    </HStack>
  </VStack>
);
