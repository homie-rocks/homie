/**
 * Is a JavaScript file minified, and how much of it is strings and GLSL shader source? Read from the code itself,
 * never from how well the whole file gzips.
 *
 * How well a file compresses says nothing about it: minified JavaScript gzips to a quarter or a third of its bytes
 * (three.core.min.js 26%, three.module.min.js 24%), more than its indented source does (20%: whitespace is the easiest
 * thing to compress). And a bundle with three.js in it carries the shaders as GLSL source in strings, line by line, with
 * their indentation and their long names, which no minifier touches: a game's minified three.js bundle can be thousands
 * of lines, nearly all of them inside shader strings.
 *
 * So the file is read the way a JavaScript parser reads it, just far enough to tell code from strings, template
 * literals, regular expressions and comments, and only the code is judged:
 *   - whitespace: the share of the code's characters that are spaces, tabs and line breaks. A minifier leaves the
 *     few a keyword needs (about 1 to 2%); indented source is 15 to 30%;
 *   - comments: the share of the file in comments, licence comments (`/*!`, `@license`, `@preserve`) apart, since a
 *     minifier keeps those;
 *   - lines: the code's characters per line (string contents not counted);
 *   - names: the identifiers that are not a property (after `.`) or an object's key, which a minifier renames: their
 *     mean length and the share one or two characters long (`mangled`). A minifier that keeps names (whitespace and
 *     syntax only) is still a minifier.
 * And the strings: the share of the file inside string and template literals, and the share of those that are GLSL
 * shader source (#ifdef, uniform vec3, gl_FragColor, texture2D( ...).
 *
 * It is a reader, not a parser: a `/` after `)` or `}` is division unless the `(` followed if/while/for/with or the
 * `{` opened a block, and a regular expression never spans a line (when it seems to, it was division). That is what a
 * minifier's output and ordinary source need; a file it cannot read cleanly is judged on what it read.
 */

const KEYWORDS = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'of', 'null', 'true', 'false', 'static', 'async', 'get', 'set', 'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'undefined', 'arguments', 'eval']);
/** After these a `/` starts a regular expression; after any other keyword (this, null, true ...) it is division. */
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
/** A `{` after one of these opens a block (a `/` after its `}` starts a statement); anywhere else, an object. */
const BLOCK_AFTER_PUNCT = new Set([')', ';', '{', '}', '=>']);
const BLOCK_AFTER_KEYWORD = new Set(['else', 'do', 'try', 'finally']);

/** GLSL in a string: one of these marks a shader line; a literal with two different ones (or a long one with one) is shader source. */
const GLSL = [
  /#\s*(?:ifdef|ifndef|endif|elif|define|undef|include\s*<|pragma|extension|version)\b/,
  /\b(?:uniform|varying|attribute)\s+(?:(?:lowp|mediump|highp)\s+)?(?:float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?|sampler\w*)\b/,
  /\bprecision\s+(?:lowp|mediump|highp)\s+(?:float|int|sampler\w*)\b/,
  /\bgl_(?:Position|FragColor|FragCoord|FragData|PointSize|PointCoord|InstanceID|VertexID|FrontFacing)\b/,
  /\bvoid\s+main\s*\(/,
  /\b(?:texture2D|textureCube|texture2DLodEXT|textureLod|texelFetch)\s*\(/,
  /\b(?:[biu]?vec[234]|mat[234])\s+\w+\s*[=;,)]/,
  /\b(?:[biu]?vec[234]|mat[234])\s*\(/,
  /\b(?:smoothstep|inversesqrt|fract|clamp|saturate|dot|normalize|mix)\s*\([^)]*\)\s*;/,
];
function glslScore(text) {
  // A shader says what it is in its first lines; a huge literal (a base64 blob) is read only that far.
  const head = text.length > 65_536 ? text.slice(0, 65_536) : text;
  let n = 0;
  for (const re of GLSL) if (re.test(head)) n++;
  return n;
}
const isShader = (text) => { const s = glslScore(text); return s >= 2 || (s >= 1 && text.length >= 400); };

const isIdStart = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || c >= 0x80 || c === 92;
const isIdPart = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;

/**
 * Read `text` (a JavaScript file). Returns the measures above, rounded, and the verdict:
 *   { minified, mangled, whitespacePct, commentPct, licencePct, codeCharsPerLine, nameLength, shortNamesPct, names,
 *     stringPct, shaderPct, bytes, why }
 */
export function readCode(text) {
  const src = String(text);
  const n = src.length;
  let i = 0;
  let codeChars = 0; // characters read as code (not in a string, template, comment or regular expression's body)
  let codeWs = 0;
  let codeBreaks = 0;
  let commentChars = 0;
  let licenceChars = 0;
  let stringChars = 0;
  let shaderChars = 0;
  const names = { count: 0, short: 0, chars: 0 };
  /** The last significant token: { t: 'name'|'kw'|'num'|'str'|'regex'|'punct', v } */
  let prev = null;
  const braces = []; // '{b' a block, '{o' an object or other expression, '${' a template's substitution
  const parens = []; // true when the ( followed if/while/for/with
  const templates = []; // the text of each open template literal (one may hold ${ } with another inside)

  const literal = (body) => {
    stringChars += body.length;
    if (body.length >= 12 && isShader(body)) shaderChars += body.length;
  };

  const regexAllowed = () => {
    if (!prev) return true;
    if (prev.t === 'name' || prev.t === 'num' || prev.t === 'str' || prev.t === 'regex') return false;
    if (prev.t === 'kw') return REGEX_AFTER_KEYWORD.has(prev.v);
    if (prev.v === ')' || prev.v === ']' || prev.v === '}') return false;
    return true;
  };

  /** Scan a template literal's text from i up to its closing backtick (done) or a `${` (back to code). */
  const templateText = () => {
    const start = i;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 92) { i += 2; continue; }
      if (c === 96) { templates[templates.length - 1] += src.slice(start, i); i++; literal(templates.pop()); prev = { t: 'str' }; return; }
      if (c === 36 && src.charCodeAt(i + 1) === 123) { templates[templates.length - 1] += src.slice(start, i); i += 2; braces.push('${'); prev = { t: 'punct', v: '${' }; return; }
      i++;
    }
    templates[templates.length - 1] += src.slice(start, n);
    literal(templates.pop());
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (isWs(c)) {
      codeChars++; codeWs++;
      if (c === 10) codeBreaks++;
      i++;
      continue;
    }
    // Comments.
    if (c === 47 && src.charCodeAt(i + 1) === 47) {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      commentChars += stop - i;
      i = stop;
      continue;
    }
    if (c === 47 && src.charCodeAt(i + 1) === 42) {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      const body = src.slice(i, stop);
      if (body.startsWith('/*!') || /@license|@preserve|@copyright/i.test(body)) licenceChars += stop - i; else commentChars += stop - i;
      i = stop;
      continue;
    }
    // Strings.
    if (c === 39 || c === 34) {
      const start = i + 1;
      let j = start;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === c || d === 10) break;
        j++;
      }
      literal(src.slice(start, j));
      i = Math.min(n, j + 1);
      prev = { t: 'str' };
      continue;
    }
    if (c === 96) { i++; templates.push(''); templateText(); continue; }
    // Regular expressions (only where an expression can start, and never across a line).
    if (c === 47 && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 10 || d === 13) break;
        if (d === 92) { j += 2; continue; }
        if (d === 91) inClass = true;
        else if (d === 93) inClass = false;
        else if (d === 47 && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        j++;
        while (j < n && isIdPart(src.charCodeAt(j))) j++;
        codeChars += j - i;
        i = j;
        prev = { t: 'regex' };
        continue;
      }
    }
    // Names and keywords.
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      const word = src.slice(i, j);
      codeChars += j - i;
      const afterDot = prev && prev.t === 'punct' && prev.v === '.';
      if (!afterDot && KEYWORDS.has(word)) prev = { t: 'kw', v: word };
      else {
        // A property (after `.`) and an object's key (`{a:` or `,a:`) keep their names in any minifier: not counted.
        let k = j;
        while (k < n && isWs(src.charCodeAt(k))) k++;
        const key = prev && prev.t === 'punct' && (prev.v === '{' || prev.v === ',') && src.charCodeAt(k) === 58 && braces[braces.length - 1] === '{o';
        if (!afterDot && !key) {
          names.count++;
          names.chars += word.length;
          if (word.length <= 2) names.short++;
        }
        prev = { t: 'name', v: word };
      }
      i = j;
      continue;
    }
    // Numbers.
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (isIdPart(d) || d === 46) { j++; continue; }
        if ((d === 43 || d === 45) && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))) { j++; continue; }
        break;
      }
      codeChars += j - i;
      i = j;
      prev = { t: 'num' };
      continue;
    }
    // Punctuation.
    codeChars++;
    if (c === 123) { // {
      const block = !prev || (prev.t === 'punct' && BLOCK_AFTER_PUNCT.has(prev.v)) || (prev.t === 'kw' && BLOCK_AFTER_KEYWORD.has(prev.v));
      braces.push(block ? '{b' : '{o');
      prev = { t: 'punct', v: '{' };
      i++;
      continue;
    }
    if (c === 125) { // }
      const open = braces.pop();
      i++;
      if (open === '${') { templateText(); continue; }
      // After a block a statement starts (a `/` there is a regular expression); after an object it is division.
      prev = { t: 'punct', v: open === '{b' ? ';' : '}' };
      continue;
    }
    if (c === 40) { parens.push(Boolean(prev && prev.t === 'kw' && ['if', 'while', 'for', 'with'].includes(prev.v))); prev = { t: 'punct', v: '(' }; i++; continue; }
    if (c === 41) { const cond = parens.pop(); prev = { t: 'punct', v: cond ? ';' : ')' }; i++; continue; }
    if (c === 61 && src.charCodeAt(i + 1) === 62) { codeChars++; prev = { t: 'punct', v: '=>' }; i += 2; continue; }
    if (c === 46 && src.charCodeAt(i + 1) === 46 && src.charCodeAt(i + 2) === 46) { codeChars += 2; prev = { t: 'punct', v: '...' }; i += 3; continue; }
    prev = { t: 'punct', v: src[i] };
    i++;
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const whitespacePct = pct(codeWs, codeChars);
  const commentPct = pct(commentChars, n);
  const licencePct = pct(licenceChars, n);
  const codeCharsPerLine = Math.round((codeChars - codeWs) / (codeBreaks + 1));
  const nameLength = names.count ? Math.round((names.chars / names.count) * 10) / 10 : null;
  const shortNamesPct = pct(names.short, names.count);
  const stringPct = pct(stringChars, n);
  const shaderPct = pct(shaderChars, n);
  // Minified: the code carries almost no whitespace, and almost no comments but its licence. Mangled: most names
  // one or two characters. (Indented source: 15-30% whitespace; esbuild's or terser's output: 1-2%.)
  const minified = codeChars > 0 && whitespacePct < 6 && commentPct < 2;
  const mangled = names.count >= 20 && shortNamesPct >= 70;
  const said = `whitespace ${whitespacePct}% of the code, comments ${commentPct}%, ${codeCharsPerLine} characters a line of code, names ${nameLength ?? '-'} characters on average (${shortNamesPct}% one or two)`;
  const why = minified
    ? `minified${mangled ? ', names shortened' : ', names kept'} (${said})${stringPct >= 15 ? `; ${stringPct}% of its bytes are strings${shaderPct >= 5 ? `, ${shaderPct}% GLSL shader source` : ''}` : ''}`
    : `not minified (${said})`;
  return { minified, mangled, whitespacePct, commentPct, licencePct, codeCharsPerLine, nameLength, shortNamesPct, names: names.count, stringPct, shaderPct, bytes: n, why };
}
