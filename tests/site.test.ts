// The site under site/, which .github/workflows/pages.yml publishes to GitHub Pages, says what the READMEs say: each
// page asks its README's questions in the same order and gives the same supported versions, and its structured data
// (FAQPage) holds the questions and answers that the page shows, as search engines require. The test reads the files
// as text and needs no package.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const SITE = 'https://1eedaegon.github.io/tauri-plugin-live-activity/';
/** Each page of the site, the README it follows, its address, and the headings of that README's two parts. */
const PAGES = [
  { page: 'site/index.html', readme: 'README.md', address: SITE, questions: '## Questions', versions: '## Supported versions' },
  { page: 'site/ko/index.html', readme: 'README.ko.md', address: `${SITE}ko/`, questions: '## 자주 묻는 질문', versions: '## 지원 버전' },
] as const;

/** What a page shows for the entities that its text holds. */
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML as a page shows it: no tags, entities read, white space as one blank. */
const shown = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/&(\w+);/g, (entity, name: string) => ENTITIES[name] ?? entity).replace(/\s+/g, ' ').trim();

/** Markdown as a reader reads it: no bold, no code marks, a link as its text, white space as one blank. */
const said = (markdown: string): string =>
  markdown.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** The part of a README from a heading of the second level to the next one. */
function part(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `the README has no ${heading}`);
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The part of a page from its `<h2 id>` to the next `<h2`. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<h2 id="${id}">`);
  assert.ok(start >= 0, `the page has no #${id}`);
  const end = html.indexOf('<h2', start + 1);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/** The rows of a Markdown table, the header among them and the line under it not. */
const markdownRows = (text: string): string[][] =>
  text.split('\n').filter(line => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map(line => line.slice(1, -1).split(' | ').map(cell => said(cell)));

/** The rows of the HTML table of a part, the header among them. */
const htmlRows = (html: string): string[][] =>
  [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map(([, row = '']) => [...row.matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map(([, cell = '']) => shown(cell)));

/** The questions of a README: each paragraph of its questions' part opens with one in bold. */
const readmeQuestions = (text: string, heading: string): string[] =>
  [...part(text, heading).matchAll(/^\*\*(.+?)\*\*/gm)].map(([, question = '']) => question);

/** The questions and answers that a page shows: each `<h3>` of its questions and the paragraph after it. */
const pageQuestions = (html: string): { question: string; answer: string }[] =>
  [...section(html, 'questions').matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
    .map(([, question = '', answer = '']) => ({ question: shown(question), answer: shown(answer) }));

interface Answered { readonly name: string; readonly acceptedAnswer: { readonly text: string } }

/** The questions and answers of a page's FAQPage. */
function structuredQuestions(html: string): { question: string; answer: string }[] {
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(json, 'the page has no structured data');
  const graph = (JSON.parse(json) as { '@graph': { '@type': string; mainEntity?: Answered[] }[] })['@graph'];
  const faq = graph.find(node => node['@type'] === 'FAQPage');
  assert.ok(faq?.mainEntity, 'the structured data has no FAQPage');
  assert.ok(graph.some(node => node['@type'] === 'SoftwareSourceCode'), 'the structured data has no SoftwareSourceCode');
  return faq.mainEntity.map(entry => ({ question: entry.name, answer: entry.acceptedAnswer.text }));
}

// TP-CI-9
test("each page of the site asks its README's questions and gives its supported versions, and its structured data holds what it shows", () => {
  for (const { page, readme, questions, versions } of PAGES) {
    const html = read(page), text = read(readme);
    const shownQuestions = pageQuestions(html);
    assert.deepEqual(shownQuestions.map(entry => entry.question), readmeQuestions(text, questions), `${page} asks ${readme}'s questions`);
    assert.deepEqual(structuredQuestions(html), shownQuestions, `${page}'s FAQPage holds what it shows`);

    // The first paragraph of the versions, in short, and the table of them.
    const supported = part(text, versions), shownPart = section(html, 'supported-versions');
    const inShort = /^\s*\n(.+)\n/.exec(supported)?.[1] ?? '';
    assert.equal(shown(/<p>([\s\S]*?)<\/p>/.exec(shownPart)?.[1] ?? ''), said(inShort), `${page} says ${readme}'s versions in short`);
    assert.deepEqual(htmlRows(shownPart), markdownRows(supported), `${page}'s table is ${readme}'s`);
  }
});

// TP-CI-9
test("the site's addresses hold together: each page's canonical and alternates, the sitemap, and the links into the repository", () => {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
  const sitemap = read('site/sitemap.xml');
  for (const { page, address } of PAGES) {
    const html = read(page);
    assert.ok(html.includes(`<link rel="canonical" href="${address}">`), `${page}'s canonical address is ${address}`);
    for (const { address: other } of PAGES) {
      assert.ok(html.includes(` href="${other}">`), `${page} names ${other} as an alternate`);
    }
    assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${SITE}">`), `${page} names the default page`);
    assert.ok(sitemap.includes(`<loc>${address}</loc>`), `the sitemap lists ${address}`);
  }
  // Every link of a page or of llms.txt into this repository names a file that is tracked.
  const repository = /https:\/\/(?:github\.com\/1eedaegon\/tauri-plugin-live-activity\/blob\/main|raw\.githubusercontent\.com\/1eedaegon\/tauri-plugin-live-activity\/main)\/([^"#)\s]+)/g;
  for (const file of ['site/index.html', 'site/ko/index.html', 'site/llms.txt']) {
    const named = [...read(file).matchAll(repository)].map(([, path = '']) => path);
    assert.ok(named.length > 0, `${file} links into the repository`);
    for (const path of named) assert.ok(tracked.has(path), `${file} names ${path}, which is not tracked`);
  }
  // The workflow publishes this folder.
  assert.match(read('.github/workflows/pages.yml'), /upload-pages-artifact@[0-9a-f]{40} # v\S+\n\s+with:\n\s+path: site\n/);
});
