// Minimal, dependency-free Word (.docx) writer. Supports headings (#, ##, ###),
// bullet lines (- or •), bold (**text**) and plain paragraphs.

const enc = new TextEncoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Build a ZIP (stored, no compression) from [{name, data: Uint8Array}]. */
export function writeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, 0, true) // stored
    local.setUint16(12, 0x0021, true) // date: 1980-01-01 (a zero date is invalid)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    chunks.push(new Uint8Array(local.buffer), name, f.data)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(14, 0x0021, true) // date: 1980-01-01
    cd.setUint32(16, crc, true)
    cd.setUint32(20, f.data.length, true)
    cd.setUint32(24, f.data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0))
  let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part => {
    const bold = /^\*\*[^*]+\*\*$/.test(part)
    const t = bold ? part.slice(2, -2) : part
    return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`
  }).join('')
}

export function textToDocx(text, { title } = {}) {
  const paras = []
  if (title) paras.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runs(title)}</w:p>`)
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const hm = line.match(/^(#{1,3})\s+(.*)/)
    const li = line.match(/^\s*[-*•]\s+(.*)/)
    if (hm) paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading${hm[1].length}"/></w:pPr>${runs(hm[2])}</w:p>`)
    else if (li) paras.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr>${runs('•\t' + li[1])}</w:p>`)
    else paras.push(`<w:p>${line.trim() ? runs(line) : ''}</w:p>`)
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const style = (id, name, size, bold) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr></w:style>`
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title', 'Title', 40, true)}${style('Heading1', 'heading 1', 32, true)}${style('Heading2', 'heading 2', 28, true)}${style('Heading3', 'heading 3', 24, true)}${style('ListParagraph', 'List Paragraph', 22, false)}</w:styles>`],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`]
  ]
  return writeZip(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })))
}
