import fs from 'fs';

export const lineNumberPlugin = (fence, enable = true) => {
  return (...args) => {
    const rawCode = fence(...args)

    const [tokens, idx] = args
    const info = tokens[idx].info

    if (
      (!enable && !/:line-numbers($| |=)/.test(info)) ||
      (enable && /:no-line-numbers($| )/.test(info))
    ) {
      return rawCode
    }

    let startLineNumber = 1
    const matchStartLineNumber = info.match(/=(\d*)/)
    if (matchStartLineNumber && matchStartLineNumber[1]) {
      startLineNumber = parseInt(matchStartLineNumber[1])
    }

    const code = rawCode.slice(
      rawCode.indexOf('<code>'),
      rawCode.indexOf('</code>')
    )

    const lines = code.split('\n')

    let lineNumbersCode = '';
    for (let i = 0, len = lines.length; i < len; ++i) {
      lineNumbersCode += `<span class="line-number">${i + startLineNumber}</span><br>`;
    }

    const lineNumbersWrapperCode = `<div class="line-numbers-wrapper" aria-hidden="true">${lineNumbersCode}</div>`

    return rawCode
      .replace(/<\/div>$/, `${lineNumbersWrapperCode}</div>`)
      .replace(/"(language-[^"]*?)"/, '"$1 line-numbers-mode"')
  }
}

export function preWrapperPlugin(fence, options = {codeCopyButtonTitle: 'Copy Code'}) {
  return (...args) => {
    const [tokens, idx] = args
    const token = tokens[idx]

    // remove title from info
    token.info = token.info.replace(/\[.*\]/, '')

    const active = / active( |$)/.test(token.info) ? ' active' : ''
    token.info = token.info.replace(/ active$/, '').replace(/ active /, ' ')

    const lang = extractLang(token.info)

    return (
      `<div class="language-${lang}${active}">` +
      `<button title="${options.codeCopyButtonTitle}" class="copy"></button>` +
      `<span class="lang">${lang}</span>` +
      fence(...args) +
      '</div>'
    )
  }
}

export function extractTitle(info, html = false) {
  if (html) {
    return (
      info.replace(/<!--[^]*?-->/g, '').match(/data-title="(.*?)"/)?.[1] || ''
    )
  }
  return info.match(/\[(.*)\]/)?.[1] || extractLang(info) || 'txt'
}

function extractLang(info) {
  return info
    .trim()
    .replace(/=(\d*)/, '')
    .replace(/:(no-)?line-numbers({| |$|=\d*).*/, '')
    .replace(/(-vue|{| ).*$/, '')
    .replace(/^vue-html$/, 'template')
    .replace(/^ansi$/, '')
}

/**
 * raw path format: "/path/to/file.extension#region {meta} [title]"
 *    where #region, {meta} and [title] are optional
 *    meta can be like '1,2,4-6 lang', 'lang' or '1,2,4-6'
 *    lang can contain special characters like C++, C#, F#, etc.
 *    path can be relative to the current file or absolute
 *    file extension is optional
 *    path can contain spaces and dots
 *
 * captures: ['/path/to/file.extension', 'extension', '#region', '{meta}', '[title]']
 */
export const rawPathRegexp =
  /^(.+?(?:(?:\.([a-z0-9]+))?))(?:(#[\w-]+))?(?: ?(?:{(\d+(?:[,-]\d+)*)? ?(\S+)? ?(\S+)?}))? ?(?:\[(.+)\])?$/

export function rawPathToToken(rawPath) {
  const [
    filepath = '',
    extension = '',
    region = '',
    lines = '',
    lang = '',
    attrs = '',
    rawTitle = ''
  ] = (rawPathRegexp.exec(rawPath) || []).slice(1)

  const title = rawTitle || filepath.split('/').pop() || ''

  return { filepath, extension, region, lines, lang, attrs, title }
}

export function dedent(text) {
  const lines = text.split('\n')

  const minIndentLength = lines.reduce((acc, line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== ' ' && line[i] !== '\t') return Math.min(i, acc)
    }
    return acc
  }, Infinity)

  if (minIndentLength < Infinity) {
    return lines.map((x) => x.slice(minIndentLength)).join('\n')
  }

  return text
}

const markers = [
  {
    start: /^\s*\/\/\s*#?region\b\s*(.*?)\s*$/,
    end: /^\s*\/\/\s*#?endregion\b\s*(.*?)\s*$/
  },
  {
    start: /^\s*<!--\s*#?region\b\s*(.*?)\s*-->/,
    end: /^\s*<!--\s*#?endregion\b\s*(.*?)\s*-->/
  },
  {
    start: /^\s*\/\*\s*#region\b\s*(.*?)\s*\*\//,
    end: /^\s*\/\*\s*#endregion\b\s*(.*?)\s*\*\//
  },
  {
    start: /^\s*#[rR]egion\b\s*(.*?)\s*$/,
    end: /^\s*#[eE]nd ?[rR]egion\b\s*(.*?)\s*$/
  },
  {
    start: /^\s*#\s*#?region\b\s*(.*?)\s*$/,
    end: /^\s*#\s*#?endregion\b\s*(.*?)\s*$/
  },
  {
    start: /^\s*(?:--|::|@?REM)\s*#region\b\s*(.*?)\s*$/,
    end: /^\s*(?:--|::|@?REM)\s*#endregion\b\s*(.*?)\s*$/
  },
  {
    start: /^\s*#pragma\s+region\b\s*(.*?)\s*$/,
    end: /^\s*#pragma\s+endregion\b\s*(.*?)\s*$/
  },
  {
    start: /^\s*\(\*\s*#region\b\s*(.*?)\s*\*\)/,
    end: /^\s*\(\*\s*#endregion\b\s*(.*?)\s*\*\)/
  }
]

export function findRegion(lines, regionName) {
  let chosen = null
  // find the regex pair for a start marker that matches the given region name
  for (let i = 0; i < lines.length; i++) {
    for (const re of markers) {
      if (re.start.exec(lines[i])?.[1] === regionName) {
        chosen = { re, start: i + 1 }
        break
      }
    }
    if (chosen) break
  }
  if (!chosen) return null

  let counter = 1
  // scan the rest of the lines to find the matching end marker, handling nested markers
  for (let i = chosen.start; i < lines.length; i++) {
    // check for an inner start marker for the same region
    if (chosen.re.start.exec(lines[i])?.[1] === regionName) {
      counter++
      continue
    }
    // check for an end marker for the same region
    const endRegion = chosen.re.end.exec(lines[i])?.[1]
    // allow empty region name on the end marker as a fallback
    if (endRegion === regionName || endRegion === '') {
      if (--counter === 0) return { ...chosen, end: i }
    }
  }

  return null
}

export const snippetPlugin = (fence) => {
  return (...args) => {
    const [tokens, idx, , {includes}] = args;
    const token = tokens[idx];
    const [src, regionName] = token.src ?? [];
    if (!src) return fence(...args);
    if (includes) {
      includes.push(src);
    }
    const isAFile = fs.statSync(src).isFile();
    if (!fs.existsSync(src) || !isAFile) {
      token.content = isAFile ? `Code snippet path not found: ${src}` : `Invalid code snippet option`;
      token.info = "";
      return fence(...args);
    }
    let content = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n");
    if (regionName) {
      const lines = content.split("\n");
      const region = findRegion(lines, regionName);
      if (region) {
        content = dedent(
          lines.slice(region.start, region.end).filter((line) => !region.regexp.test(line.trim())).join("\n")
        );
      }
    }
    token.content = content;
    const htmlContent = fence(...args);
    token.content = '';
    return htmlContent;
  }
}

const RE = /{([\d,-]+)}/

export const highlightLinePlugin = (fence) => {
  return (...args) => {
    const [tokens, idx] = args
    const token = tokens[idx]

    // due to use of markdown-it-attrs, the {0} syntax would have been
    // converted to attrs on the token
    const attr = token.attrs && token.attrs[0]

    let lines = null

    if (!attr) {
      // markdown-it-attrs maybe disabled
      const rawInfo = token.info

      if (!rawInfo || !RE.test(rawInfo)) {
        return fence(...args)
      }

      const langName = rawInfo.replace(RE, '').trim()

      // ensure the next plugin get the correct lang
      token.info = langName

      lines = RE.exec(rawInfo)[1]
    }

    if (!lines) {
      lines = attr[0]

      if (!lines || !/[\d,-]+/.test(lines)) {
        return fence(...args)
      }
    }

    token.info += ' ' + lines
    return fence(...args)
  }
}
