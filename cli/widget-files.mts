// The files that `setup --font` and `setup --asset` copy into the widget extension: fonts into
// LiveActivityWidget/Fonts, which the extension's Info.plist lists under UIAppFonts, and images into the
// extension's asset catalog, LiveActivityWidget/Assets.xcassets.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { SetupContext, SetupOptions } from './setup.mjs';
import { SetupError, isList, isRecord, member, parseJson, readText, step, writeFile } from './steps.mjs';
import type { Effect, PlannedStep } from './steps.mjs';

export const FONTS = 'Fonts';
export const CATALOG = 'Assets.xcassets';
const FONT_TYPES: ReadonlySet<string> = new Set(['.ttf', '.otf', '.ttc']);
const IMAGE_TYPES: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.svg']);
const VECTOR_TYPES: ReadonlySet<string> = new Set(['.pdf', '.svg']);
// The rule of an image node's asset name, and a file name the bundle can carry.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,127}$/;
const CATALOG_INFO = { info: { author: 'xcode', version: 1 } };
const SCALES: readonly ImageScale[] = ['2x', '3x'];

/** A file named on the command line: where it is, its name in the widget, and its extension in lower case. */
export interface WidgetFile {
  readonly source: string;
  readonly file: string;
  readonly kind: string;
}

/** The scale of a bitmap that is one of several for its asset name. */
export type ImageScale = '2x' | '3x';

/** An image for the asset catalog: the asset name a layout's `image()` takes, and the scale of a scaled bitmap. */
export interface WidgetImage extends WidgetFile {
  readonly name: string;
  readonly scale: ImageScale | undefined;
}

/** An image's entry in the Contents.json of its image set. */
interface CatalogImage {
  readonly filename: string;
  readonly idiom: 'universal';
  readonly properties?: { readonly 'preserves-vector-representation': true };
  readonly scale?: ImageScale;
}

/** The fonts and images that a run of setup puts into the widget extension. */
export interface WidgetFiles {
  readonly fonts: readonly WidgetFile[];
  readonly assets: readonly WidgetImage[];
}

/** The names of a font that a style's `fontFamily` takes. */
export interface FontNames {
  readonly family: string | undefined;
  readonly postScript: string | undefined;
}

/** What the steps of this module read of setup's context. */
type FileContext = Pick<SetupContext, 'files' | 'show'>;

/** A record of a font's name table: the platform it is for and its text. */
interface FontName {
  readonly platform: number;
  readonly text: string;
}

/**
 * The fonts and images named on the command line, checked before anything is written: each exists, is a
 * file of a kind the widget can use and has a name the bundle and a layout can carry.
 */
export function widgetFiles(cwd: string, { fonts = [], assets = [] }: Pick<SetupOptions, 'fonts' | 'assets'>): WidgetFiles {
  const file = (given: string, kinds: ReadonlySet<string>, what: string): WidgetFile => {
    const source = resolve(cwd, given);
    if (!existsSync(source) || !statSync(source).isFile()) throw new SetupError(`${given}: no such file.`);
    const kind = extname(source).toLowerCase();
    if (!kinds.has(kind)) throw new SetupError(`${given}: ${what} must be ${[...kinds].join(', ')}.`);
    if (!FILE_NAME.test(basename(source))) {
      throw new SetupError(`${given}: rename it to ASCII letters, digits, spaces, '.', '_', '@' and '-' first.`);
    }
    return { source, file: basename(source), kind };
  };
  const once = <File extends WidgetFile>(list: readonly File[]): readonly File[] => {
    const repeated = list.find((item, index) => list.findIndex(other => other.file === item.file) !== index);
    if (repeated) throw new SetupError(`${repeated.file} is named twice; the widget keeps one file of each name.`);
    return list;
  };
  return {
    fonts: once(fonts.map(given => file(given, FONT_TYPES, 'a font'))),
    assets: once(assets.map((given): WidgetImage => {
      const image = file(given, IMAGE_TYPES, 'an image');
      const base = basename(image.file, extname(image.file));
      const scale = SCALES.find(item => base.endsWith(`@${item}`));
      const name = scale ? base.slice(0, -(scale.length + 1)) : base;
      if (!NAME.test(name)) throw new SetupError(`${given}: the asset name ${JSON.stringify(name)} must be 1 to 64 ASCII letters, digits, '.', '_' or '-'.`);
      if (scale && VECTOR_TYPES.has(image.kind)) throw new SetupError(`${given}: a PDF or SVG image has one scale; drop the @${scale}.`);
      return { ...image, name, scale };
    })),
  };
}

/** Copies `source` to `target`: created when absent, updated when its bytes differ, unchanged otherwise. */
function copyStep(show: FileContext['show'], source: string, target: string, detail: string): PlannedStep {
  if (!existsSync(target)) return step('created', show(target), detail, copyEffect(source, target));
  if (readFileSync(source).equals(readFileSync(target))) return step('unchanged', show(target));
  return step('updated', show(target), detail, copyEffect(source, target));
}

const copyEffect = (source: string, target: string): Effect => () => {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
};

/** The steps that copy the fonts into the widget's Fonts folder. */
export function fontSteps({ files, show }: FileContext, widget: string): PlannedStep[] {
  return files.fonts.map(({ source, file }) => {
    const names = fontNames(readFileSync(source));
    const detail = names ? `fontFamily: ${[...new Set([names.postScript, names.family].filter(Boolean))].map(name => JSON.stringify(name)).join(' or ')}` : '';
    return copyStep(show, source, join(widget, FONTS, file), detail);
  });
}

/** The font files the widget bundles after this run: those in its Fonts folder and those being copied there. */
export function bundledFonts({ files }: Pick<SetupContext, 'files'>, widget: string): string[] {
  const folder = join(widget, FONTS);
  const present = existsSync(folder) ? readdirSync(folder).filter(name => FONT_TYPES.has(extname(name).toLowerCase())) : [];
  return [...new Set([...present, ...files.fonts.map(({ file }) => file)])].sort();
}

/** The steps that put the images into the widget's asset catalog, one image set per asset name. */
export function assetSteps({ files, show }: FileContext, widget: string): PlannedStep[] {
  if (files.assets.length === 0) return [];
  const catalog = join(widget, CATALOG);
  const root = join(catalog, 'Contents.json');
  const steps = existsSync(root) ? [] : [step('created', show(root), '', writeFile(root, catalogJson(CATALOG_INFO)))];
  const sets = Map.groupBy(files.assets, ({ name }) => name);
  for (const [name, images] of sets) {
    const folder = join(catalog, `${name}.imageset`);
    steps.push(...images.map(({ source, file }) => copyStep(show, source, join(folder, file), `the asset "${name}"`)));
    steps.push(contentsStep(show, join(folder, 'Contents.json'), images));
  }
  return steps;
}

/** An image set's Contents.json with an entry for each image; entries already there stay as they are. */
function contentsStep(show: FileContext['show'], path: string, images: readonly WidgetImage[]): PlannedStep {
  const text = readText(path);
  const current = text === undefined ? { images: [], ...CATALOG_INFO } : parseJson(text);
  const listed = member(current, 'images');
  if (!isRecord(current) || !isList(listed)) return step('todo', show(path), `not an image set's Contents.json; add ${images.map(({ file }) => file).join(', ')} to it in Xcode`);
  const missing = images.filter(({ file }) => !listed.some(item => member(item, 'filename') === file));
  if (missing.length === 0) return step('unchanged', show(path));
  const next = { ...current, images: [...listed, ...missing.map(entry)] };
  return step(text === undefined ? 'created' : 'updated', show(path), '', writeFile(path, catalogJson(next)));
}

/** The entry of an image: a bitmap at its scale or for any scale, a PDF or SVG kept as vector data. */
function entry({ file, kind, scale }: WidgetImage): CatalogImage {
  const vector: Pick<CatalogImage, 'properties'> = VECTOR_TYPES.has(kind) ? { properties: { 'preserves-vector-representation': true } } : {};
  return { filename: file, idiom: 'universal', ...vector, ...(scale && { scale }) };
}

/** JSON as Xcode writes an asset catalog: two spaces, and a space before each colon. */
const catalogJson = (value: unknown): string => `${JSON.stringify(value, null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1 : ')}\n`;

/**
 * The family and PostScript names in the name table of a TrueType or OpenType font, for the report: they are
 * what a style's `fontFamily` takes. Undefined for a collection or a file it cannot read.
 */
export function fontNames(bytes: Buffer): FontNames | undefined {
  try {
    if (!['\0\u0001\0\0', 'OTTO', 'true'].includes(bytes.toString('latin1', 0, 4))) return undefined;
    for (let index = 0; index < bytes.readUInt16BE(4); index += 1) {
      const record = 12 + index * 16;
      if (bytes.toString('latin1', record, record + 4) !== 'name') continue;
      const offset = bytes.readUInt32BE(record + 8);
      return names(bytes.subarray(offset, offset + bytes.readUInt32BE(record + 12)));
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return undefined;
}

/** Name IDs 1 (family), 16 (typographic family) and 6 (PostScript), Windows Unicode before Macintosh Roman. */
function names(table: Buffer): FontNames | undefined {
  const strings = table.readUInt16BE(4);
  const found: Record<number, FontName> = {};
  for (let index = 0; index < table.readUInt16BE(2); index += 1) {
    const record = 6 + index * 12;
    // A name record: its platform, its encoding and language, which are not read, then its name ID, length and offset.
    const platform = table.readUInt16BE(record);
    const id = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const offset = table.readUInt16BE(record + 10);
    if (![1, 6, 16].includes(id) || (platform !== 3 && platform !== 1) || found[id]?.platform === 3) continue;
    const raw = table.subarray(strings + offset, strings + offset + length);
    if (raw.length !== length) throw new RangeError('name record outside the table');
    const text = platform === 3 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
    found[id] = { platform, text };
  }
  const family = (found[16] ?? found[1])?.text;
  const postScript = found[6]?.text;
  return family || postScript ? { family, postScript } : undefined;
}
