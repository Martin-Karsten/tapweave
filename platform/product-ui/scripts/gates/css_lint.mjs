// Zero-dependency guard for the shell styling conventions (src/styles/).
// This is a line-oriented checker, not a CSS parser: every declaration is
// expected on its own line. tokens.css is the single home for colors,
// z-index values, px font sizes and the spacing scale; a declaration that
// must keep a raw value carries an inline `/* css-lint: reason */` marker.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src_root = new URL('../../src/', import.meta.url);
const styles_root = new URL('styles/', src_root);
const tokens_path = fileURLToPath(new URL('tokens.css', styles_root));

const MAX_LINES_PER_FILE = 320;
const MAX_TOKEN_FILE_LINES = 150;
const MIN_SCALED_PX = 2;
const MAX_SCALED_PX = 32;
const ALLOWED_BREAKPOINTS = ['(max-width: 760px)', '(prefers-reduced-motion: reduce)'];
// The spacing scale defines every 2px step even when a step is unused, and
// the lazer-pinned durations are kept for provenance before their screens
// adopt them.
const ALLOWED_UNUSED_TOKEN_PREFIXES = ['--space-'];
const ALLOWED_UNUSED_TOKENS = ['--duration-fade-out', '--duration-enter'];

const violations = [];
const warnings = [];

const list_files = async (directory, suffix) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entry_path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) files.push(...(await list_files(entry_path, suffix)));
    else if (entry.name.endsWith(suffix)) files.push(fileURLToPath(entry_path));
  }
  return files;
};

const strip_comments = (line, state) => {
  let working = line;
  if (state.in_block_comment) {
    const end_index = working.indexOf('*/');
    if (end_index < 0) return '';
    working = working.slice(end_index + 2);
    state.in_block_comment = false;
  }
  working = working.replace(/\/\*.*?\*\//g, ' ');
  const open_index = working.indexOf('/*');
  if (open_index >= 0) {
    state.in_block_comment = true;
    working = working.slice(0, open_index);
  }
  return working;
};

const HEX_COLOR_PATTERN = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z-])/g;
const PX_PATTERN = /(-?\d+(?:\.\d+)?)px/g;

const fail = (relative_path, line_number, message) => {
  violations.push(`${relative_path}:${line_number}: ${message}`);
};

const check_style_sheet = (relative_path, source) => {
  const lines = source.split('\n');
  if (relative_path === 'src/styles/tokens.css' && lines.length > MAX_TOKEN_FILE_LINES) {
    fail(relative_path, lines.length, `tokens.css grew past ${MAX_TOKEN_FILE_LINES} lines; split the token groups`);
  }
  if (relative_path !== 'src/styles/tokens.css' && lines.length > MAX_LINES_PER_FILE) {
    fail(relative_path, lines.length, `stylesheet grew past ${MAX_LINES_PER_FILE} lines; split it by feature`);
  }
  const comment_state = { in_block_comment: false };
  for (let line_index = 0; line_index < lines.length; line_index += 1) {
    const raw_line = lines[line_index];
    const line_number = line_index + 1;
    const allows_raw_value = raw_line.includes('css-lint:');
    const line = strip_comments(raw_line, comment_state).trim();
    if (line.length === 0) continue;

    if (line.startsWith('@media')) {
      const condition = line.slice('@media'.length).trim().replace(/\s*\{\s*$/, '');
      if (!ALLOWED_BREAKPOINTS.includes(condition)) {
        fail(relative_path, line_number, `breakpoint "${condition}" is not one of ${ALLOWED_BREAKPOINTS.join(', ')}; keep the narrow-viewport value in sync with tokens.css`);
      }
      continue;
    }

    const colon_index = line.indexOf(':');
    if (colon_index < 0) continue;
    const property = line.slice(0, colon_index).trim();
    const value = line.slice(colon_index + 1).split(';')[0].trim();
    if (property.length === 0 || value.length === 0) continue;

    if (relative_path === 'src/styles/tokens.css') continue;

    if (HEX_COLOR_PATTERN.test(value)) fail(relative_path, line_number, `color literal in "${property}"; use a token from tokens.css`);
    if (/\brgba?\(/.test(value)) fail(relative_path, line_number, `rgb()/rgba() literal in "${property}"; use a token from tokens.css`);
    if (property === 'z-index' && !value.startsWith('var(')) fail(relative_path, line_number, `raw z-index "${value}"; use an elevation token (--z-floating, --z-dialog)`);
    if ((property === 'font' || property === 'font-size') && /\dpx/.test(value)) fail(relative_path, line_number, `px font size in "${property}"; use a --font-size-* token (rem)`);
    for (const match of value.matchAll(PX_PATTERN)) {
      const magnitude = Math.abs(Number.parseFloat(match[1]));
      if (magnitude >= MIN_SCALED_PX && magnitude <= MAX_SCALED_PX && !allows_raw_value) {
        fail(relative_path, line_number, `raw px value "${match[0]}" in "${property}"; use a --space-* token or mark the line with /* css-lint: reason */`);
      }
    }
  }
};

const check_typescript_sources = async () => {
  const tsx_files = await list_files(src_root, '.tsx');
  for (const file_path of tsx_files) {
    const source = await readFile(file_path, 'utf8');
    for (const match of source.matchAll(HEX_COLOR_PATTERN)) {
      const relative_path = file_path.slice(file_path.indexOf('src/'));
      const line_number = source.slice(0, match.index).split('\n').length;
      fail(relative_path, line_number, `color literal "${match[0]}"; move the style into src/styles/ and use a token`);
    }
  }
};

const collect_unused_tokens = async () => {
  const token_source = await readFile(tokens_path, 'utf8');
  const token_names = [...token_source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);
  const style_files = await list_files(styles_root, '.css');
  const tsx_files = await list_files(src_root, '.tsx');
  const usage_sources = await Promise.all([...style_files, ...tsx_files].map((file_path) => readFile(file_path, 'utf8')));
  const usage_text = usage_sources.join('\n');
  for (const token_name of token_names) {
    if (ALLOWED_UNUSED_TOKEN_PREFIXES.some((prefix) => token_name.startsWith(prefix))) continue;
    if (ALLOWED_UNUSED_TOKENS.includes(token_name)) continue;
    if (!usage_text.includes(`var(${token_name}`)) {
      warnings.push(`token ${token_name} is defined in tokens.css but never referenced`);
    }
  }
  return token_names.length;
};

const style_files = (await list_files(styles_root, '.css')).sort();
for (const file_path of style_files) {
  const source = await readFile(file_path, 'utf8');
  const relative_path = file_path.slice(file_path.indexOf('src/'));
  check_style_sheet(relative_path, source);
}
await check_typescript_sources();
const token_count = await collect_unused_tokens();

for (const warning of warnings) console.warn(`css-lint warning: ${warning}`);
if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`css-lint: ${style_files.length} stylesheets, ${token_count} tokens ok`);
