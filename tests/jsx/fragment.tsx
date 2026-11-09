// A fragment: the runtime has no Fragment, so this compiles but neither loads nor bundles (tests/jsx.test.mjs).
import { Text } from 'tauri-plugin-live-activity/jsx';

export const fragment = <><Text>a</Text></>;
