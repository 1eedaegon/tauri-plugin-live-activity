// One element of every component, compiled by tests/jsx.test.mjs with the package as its JSX import source.
import {
  Button, Custom, Divider, Gauge, HStack, Image, Path, Progress, SFSymbol, Spacer, Text, TimerText, VStack, ZStack,
} from 'tauri-plugin-live-activity/jsx';

const rows = ['one', 'two'];

export const elements = {
  vstack: <VStack spacing={4} alignment="leading" style="card"><Text>Mochi</Text></VStack>,
  hstack: <HStack spacing={8}>{rows.map((row) => <Text>{row}</Text>)}{false}</HStack>,
  zstack: <ZStack alignment="topLeading" if="shown"><Divider /></ZStack>,
  spacer: <Spacer minLength={8} />,
  divider: <Divider unless="hidden" />,
  text: <Text style="title">{3} of {5}</Text>,
  bound: <Text bind="status" style="status" />,
  symbol: <SFSymbol name="cat.fill" rendering="hierarchical" />,
  asset: <Image asset="badge" resizable />,
  file: <Image file="badge.png" contentMode="fit" />,
  path: <Path d="M0 0 L10 10" box={[10, 10]} stroke={2} />,
  progress: <Progress bind="done" kind="circular" />,
  gauge: <Gauge bind="level" min={0} max={10} />,
  timer: <TimerText start="from" end="to" countsDown={false} />,
  button: <Button actionId="pet" style="action"><Text>Pet Mochi</Text></Button>,
  custom: <Custom name="Paw" props={{ size: 3 }} />,
};
