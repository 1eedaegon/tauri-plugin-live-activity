// One element of every component, compiled by tests/jsx.test.mjs with the package as its JSX import source.
import {
  Button, Custom, Divider, Gauge, HStack, Image, Link, Path, Progress, SFSymbol, Spacer, Text, TimerText, Toggle, VStack,
  ZStack, bind,
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
  link: <Link url="myapp://mochi/7" style="action"><Text>Open</Text></Link>,
  boundLink: <Link url={bind('target')}><SFSymbol name="map" /></Link>,
  toggle: <Toggle actionId="mute" bind="muted" unless="locked"><Text>Mute</Text></Toggle>,
  custom: <Custom name="Paw" props={{ size: 3 }} />,
  // The members any node may carry.
  stale: <Text ifStale transition="slide">No signal</Text>,
  fresh: <Text bind="eta" ifStale={false} privacy="sensitive" />,
  spoken: <Progress bind="done" accessibility={{ label: 'Snack', value: bind('percent'), hint: 'Opens the app' }} />,
  hidden: <SFSymbol name="sparkles" accessibility={{ hidden: true }} />,
};

/** A lock screen with a link, a toggle and those members, which tests/jsx.test.mjs gives to the reference validator. */
export const recorder = (
  <VStack spacing={8} accessibility={{ label: 'Recorder' }}>
    <HStack spacing={8}>
      <SFSymbol name="mic.fill" accessibility={{ hidden: true }} />
      <Text bind="elapsed" ifStale={false} privacy="sensitive" />
      <Text ifStale transition="opacity">Paused</Text>
    </HStack>
    <Progress bind="level" accessibility={{ label: 'Input level', value: bind('percent') }} />
    <HStack spacing={8}>
      <Toggle actionId="mute" bind="muted"><Text>Mute</Text></Toggle>
      <Link url={bind('target')}><Text>Open</Text></Link>
      <Link url="myapp://recordings"><SFSymbol name="list.bullet" accessibility={{ label: 'All recordings' }} /></Link>
      <Button actionId="stop"><Text>Stop</Text></Button>
    </HStack>
  </VStack>
);
