const WHITESPACE_CHARACTERS = "\x00\t\n\x0c\r ";
const DELIMITER_CHARACTERS = "()<>[]{}/%";
const DELIMITER_AND_WHITESPACE_CHARACTERS = DELIMITER_CHARACTERS + WHITESPACE_CHARACTERS;

window.addEventListener('load', () => {
  const fileElement = document.getElementById('file');

  class PdfBuffer {
    position = 0;

    constructor(array) {
      this.array = array;
      this.length = this.array.length;
    }

    eof() {
      return this.position >= this.length;
    }

    readLine() {
      if (this.eof()) { return; }

      let c, line = '';
      do {
        c = this.readChar();

        if (c === "\r") {
          if (this.peekChar() === '\n') { this.position++; }
          break;
        }
        if (c === "\n") {
          break;
        }

        line += c;
      }
      while (c);

      return line;
    }

    readLineBackwards() {
      let c, line = '';

      while (WHITESPACE_CHARACTERS.includes(this.peekChar()) && this.position) {
        this.position--;
      }

      do {
        c = this.peekChar();

        if (c === "\r" || c === "\n") {
          break;
        }

        line = c + line;
        this.position--;
      }
      while (c && this.position);

      return line;
    }

    readBytes(count) {
      if (this.eof()) { return; }

      const subarray = this.array.subarray(this.position, this.position + count);
      this.position += count;
      return subarray;
    }

    readNumber(bytes) {
      let number = 0;

      while (bytes--) {
        number = (number << 8) | this.array[this.position++];
      }

      return number;
    }

    readChar() {
      if (this.eof()) { return; }

      const c = this.array[this.position++];
      return String.fromCharCode(c);
    }

    readKeyword() {
      this.skipSpaceChars();

      let c, keyword = '';
      do {
        c = this.readChar();
        if (DELIMITER_AND_WHITESPACE_CHARACTERS.includes(c)) {
          if (c === '\r' && this.peekChar() === '\n') {
            this.position++;
          }
          break;
        }
        keyword += c;
      }
      while (c);
      return keyword;
    }

    skipSpaceChars() {
      let c;
      do {
        c = this.peekChar();
        if (!WHITESPACE_CHARACTERS.includes(c)) {
          return c;
        }
        this.position++;
      }
      while (c);
    }

    readNonSpaceChar() {
      let c;
      do {
        c = this.readChar();
        if (!WHITESPACE_CHARACTERS.includes(c)) {
          return c;
        }
      }
      while (c);
    }

    peekChar() {
      if (!this.eof()) { return String.fromCharCode(this.array[this.position]); }
    }

    peekChars(count) {
      if (!this.eof()) {
        const subarray = this.array.subarray(this.position, this.position + count);
        return String.fromCharCode.apply(null, subarray);
      }
    }

    advance(count) {
      this.position += count;
    }

    rewind() {
      this.position--;
    }

    seek(to) {
      this.position = to;
    }

    seekToEnd() {
      this.position = this.length - 1;
    }
  }


  const FALSE_OBJECT = 1;
  const TRUE_OBJECT = 2;
  const NULL_OBJECT = 3;
  const DICTIONARY_OBJECT = 4;
  const HEX_STRING_OBJECT = 5;
  const LITERAL_STRING_OBJECT = 6;
  const NAME_OBJECT = 7;
  const ARRAY_OBJECT = 8;
  const NUMBER_OBJECT = 9;
  const INDIRECT_REFERENCE_OBJECT = 10;

  const OBJECT_TYPE_NAMES = {
    [FALSE_OBJECT]: "false",
    [TRUE_OBJECT]: "true",
    [NULL_OBJECT]: "null",
    [DICTIONARY_OBJECT]: "dictionary",
    [HEX_STRING_OBJECT]: "hexadecimal string",
    [LITERAL_STRING_OBJECT]: "literal string",
    [NAME_OBJECT]: "name",
    [ARRAY_OBJECT]: "array",
    [NUMBER_OBJECT]: "number",
    [INDIRECT_REFERENCE_OBJECT]: "indirect reference",
  };

  function parseDictionary(pdf) {
    const dictionary = [];

    while (true) {
      pdf.skipSpaceChars();

      if (pdf.peekChars(2) === '>>') {
        pdf.advance(2);
        return {type: DICTIONARY_OBJECT, dictionary};
      }

      const key = parseObject(pdf);
      if (key.type !== NAME_OBJECT) {
        throw `dictionary can only have name objects for keys at position ${pdf.position}`;
      }

      const value = parseObject(pdf);

      dictionary.push([key, value]);
    }
  }

  function parseHexString(pdf) {
    let string = '';

    while (true) {
      const c = pdf.readChar();
      if ("0123456789abcdefABCDEF".includes(c)) {
        string += c;
      }
      else if (c === '>') {
        return {type: HEX_STRING_OBJECT, string};
      }
      else {
        throw `invalid character in hex string at position ${pdf.position}`;
      }
    }
  }

  function parseLiteralString(pdf) {
    let string = '';
    let bracketDepth = 0;
    let escapeFlag = false;

    while (true) {
      const c = pdf.readChar();

      switch (c) {
        case '(':
          string += c;
          if (!escapeFlag) { bracketDepth++; }
          escapeFlag = false;
          break;

        case ')':
          if (escapeFlag) {
            string += c;
          }
          else if (bracketDepth === 0) {
            return {type: LITERAL_STRING_OBJECT, string};
          }
          else {
            string += c;
            bracketDepth--;
          }
          escapeFlag = false;
          break;

        case '\\':
          string += c;
          escapeFlag = !escapeFlag;
          break;

        default:
          string += c;
          escapeFlag = false;
          break;
      }
    }
  }

  function parseName(pdf) {
    let name = "";

    while (true) {
      const c = pdf.readChar();

      if (DELIMITER_AND_WHITESPACE_CHARACTERS.includes(c)) {
        pdf.rewind();
        return {type: NAME_OBJECT, name};
      }

      name += c;
    }
  }

  function parseArray(pdf) {
    const array = [];

    while (true) {
      pdf.skipSpaceChars();
      if (pdf.peekChar() === ']') {
        pdf.advance(1);
        return {type: ARRAY_OBJECT, array};
      }

      const object = parseObject(pdf);
      array.push(object);
    }
  }

  function parseNumberOrReference(pdf) {
    let string = "";
    let dotFlag = false;

    string = pdf.readChar();

    while (true) {
      const c = pdf.peekChar();
      if (c === '.' && !dotFlag) {
        dotFlag = true;
        string += c;
        pdf.advance(1);
      }
      else if ("0123456789".includes(c)) {
        string += c;
        pdf.advance(1);
      }
      else {
        const number = dotFlag ? parseFloat(string) : parseInt(string);
        if (!dotFlag && number > 0 && WHITESPACE_CHARACTERS.includes(c)) {
          const savedPosition = pdf.position;
          pdf.skipSpaceChars();
          let generationString = '';
          while (true) {
            const c = pdf.readChar();
            if (WHITESPACE_CHARACTERS.includes(c)) {
              pdf.skipSpaceChars();
              if (pdf.readChar() === 'R') {
                return {type: INDIRECT_REFERENCE_OBJECT, objectNumber: number, generation: parseInt(generationString)};
              }
              break;
            }

            if ("0123456789".includes(c)) {
              generationString += c;
            }
            else {
              break;
            }
          }
          pdf.position = savedPosition;
        }

        return {type: NUMBER_OBJECT, number};
      }
    }
  }

  function dereference(pdf, object) {
    let maxReferences = 100;

    while (object && object.type === INDIRECT_REFERENCE_OBJECT && maxReferences--) {
      object = findObject(pdf, object.objectNumber).object;
    }

    return object;
  }

  function wrapArray(object) {
    if (object) {
      return object.type === ARRAY_OBJECT ? object : {type: ARRAY_OBJECT, array: [object]};
    }
  }

  function readStream(pdf, dictionary) {
    const streamLength = extractNumber(dereference(pdf, findValueByKey(dictionary, 'Length')));
    if (!streamLength) {
      throw `no Length key in dictionary before stream at ${pdf.position}`;
    }

    const filter = findValueByKey(dictionary, 'Filter');

    let filterChain = [];
    if (filter) {
      filterChain = wrapArray(filter).array.map(obj => obj.type === NAME_OBJECT && obj.name).filter(a => a);
    }

    const streamData = pdf.readBytes(streamLength);

    const endstreamLine = pdf.readKeyword();
    if (endstreamLine !== 'endstream') {
      console.log('endstream was', endstreamLine.charCodeAt(0));
      throw `expecting endstream and didn't get it at position ${pdf.position}`;
    }

    const filtered = filterChain.reduce(applyFilter, streamData);

    const decodeParms = wrapArray(dereference(pdf, findValueByKey(dictionary, 'DecodeParms')));

    const decoded = decodeParms ? decodeParms.array.reduce(applyDecoder, filtered) : filtered;

    return decoded;
  }

  function readObject(pdf) {
    const position = pdf.position;
    const objectLine = pdf.readLine().trim();
    const matches = objectLine.match(/^(\d+) (\d+) obj$/);

    if (!matches) {
      console.error(line);
      throw `invalid object header line at position ${pdf.position}`;
    }

    const [_, number, generation] = matches;

    const object = parseObject(pdf);
    let stream;

    pdf.skipSpaceChars();
    if (object.type === DICTIONARY_OBJECT && pdf.peekChars(6) === 'stream') {
      pdf.advance(6);

      let c = pdf.readChar();
      if (c === '\r') {
        c = pdf.readChar();
      }
      if (c !== '\n') {
        throw `stream keyword must be followed by either a line feed or a carriage return and line feed at position ${pdf.position}`;
      }

      stream = readStream(pdf, object);
    }

    return {number, generation, object, stream, position};
  }

  function findValueByKey(object, keyName) {
    if (object.type === DICTIONARY_OBJECT) {
      for (const [key, value] of object.dictionary) {
        if (key.name === keyName) {
          return value;
        }
      }
    }
  }

  function parseObject(pdf) {
    const c1 = pdf.readNonSpaceChar();

    switch (c1) {
      case '<':
        const c2 = pdf.peekChar();
        if (c2 === '<') {
          pdf.advance(1);
          return parseDictionary(pdf);
        }
        else {
          return parseHexString(pdf);
        }

      case 'f':
        if (pdf.peekChars(4) == 'alse') {
          pdf.advance(4);
          return {type: FALSE_OBJECT};
        }

      case 't':
        if (pdf.peekChars(3) == 'rue') {
          pdf.advance(3);
          return {type: TRUE_OBJECT};
        }
        break;

      case 'n':
        if (pdf.peekChars(3) == 'ull') {
          pdf.advance(3);
          return {type: NULL_OBJECT};
        }
        break;

      case '(':
        return parseLiteralString(pdf);

      case '/':
        return parseName(pdf);

      case '[':
        return parseArray(pdf);
    }

    if ("-+0123456789.".includes(c1)) {
      pdf.rewind();
      return parseNumberOrReference(pdf);
    }

    throw `unknown character ${c1} at position ${pdf.position}`;
  }

  function applyFilter(data, filter) {
    switch (filter) {
      case 'FlateDecode':
        return pako.inflate(data);

      default:
        var enc = new TextEncoder();
        return enc.encode(`(don't know filter "${filter}")`);
    }
  }

  function applyDecoder(data, decoderObject) {
    const decoder = extractDictionary(decoderObject);

    if (decoder.Predictor) {
      const predictor = extractNumber(decoder.Predictor);
      if (predictor === 1) { return data; }

      if (predictor >= 10) {
        const columns = extractNumber(decoder.Columns) || 1;

        if (data.length % (columns + 1) !== 0) {
          throw `data length is not divisible by specified columns plus 1 ${data.length} / ${columns + 1}`;
        }

        const rowCount = data.length / (columns + 1);
        const output = new Array(columns * rowCount);

        let previousRow;

        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          const offsetIn = rowIndex * (columns + 1);
          const offsetOut = rowIndex * columns;
          const operation = data[offsetIn];
          const row = data.slice(offsetIn + 1, offsetIn + columns);

          switch (operation) {
            case 0:
              for (let column = 0; column < columns; column++) {
                output[offsetOut + column] = row[column];
              }
              break;

            case 1:
              output[offsetOut] = row[column];
              for (let column = 1; column < columns; column++) {
                output[offsetOut + column] = (row[column] + row[column - 1]) & 0xff;
              }
              break;

            case 2:
              if (previousRow) {
                for (let column = 0; column < columns; column++) {
                  output[offsetOut + column] = (row[column] + previousRow[column]) & 0xff;
                }
              }
              else {
                for (let column = 0; column < columns; column++) {
                  output[offsetOut + column] = row[column];
                }
              }
              break;

            default:
              throw `don't know how to decode predictor with operation ${operation}`;
          }

          previousRow = row;
        }

        return new Uint8Array(output);

      }
      else {
        const enc = new TextEncoder();
        return enc.encode(`(don't know how to decode predictor ${predictor})`);
      }
    }
    else {
      const enc = new TextEncoder();
      return enc.encode(`(don't know decoder)`);
    }
  }

  function parseXref(pdf) {
    const xrefs = [];

    pdf.skipSpaceChars();
    while ("0123456789".includes(pdf.peekChar())) {
      const header = pdf.readLine();
      const matches = header.match(/^(\d+) (\d+)$/);
      if (!matches) {
        throw `invalid xref header at position ${pdf.position}`;
      }

      const [_, startObject, count] = matches.map(n => parseInt(n));

      const subsection = {
        startObject, count, xrefs: []
      };

      for (let i = 0; i < count; i++) {
        const line = pdf.readLine();
        const matches = line.match(/^(\d{10}) (\d{5}) ([fn])\s*$/);
        if (!matches) {
          throw `invalid xref line at position ${pdf.position}`;
        }

        subsection.xrefs.push({offset: matches[1], generation: matches[2], inUseFlag: matches[3]});
      }

      xrefs.push(subsection);
    }

    return xrefs;
  }

  function extractName(object) {
    if (object && object.type === NAME_OBJECT) { return object.name; }
  }

  function extractNumber(object) {
    if (object && object.type === NUMBER_OBJECT) { return object.number; }
  }

  function extractArrayOfNumbers(object) {
    if (object && object.type === ARRAY_OBJECT && object.array.every(o => o.type === NUMBER_OBJECT)) {
      return object.array.map(o => o.number);
    }
  }

  function extractDictionary(object) {
    if (object && object.type === DICTIONARY_OBJECT) {
      const result = {};
      for ([key, value] of object.dictionary) {
        result[extractName(key)] = value;
      }

      return result;
    }
  }

  function findObject(pdf, objectNumber) {
    for (const {startObject, count, xrefs} of pdf.xrefTable) {
      if (objectNumber >= startObject && objectNumber < startObject + count) {
        const xref = xrefs[objectNumber - startObject];

        if (xref.objectStreamFlag) {
          const {object, stream} = findObject(pdf, xref.number);
          const n = extractNumber(findValueByKey(object, 'N'));
          const first = extractNumber(firstValueByKey(object, 'First'));

          const contents = String.fromCharCode.apply(null, stream.slice(0, first)).split(/\s+/);
          const offset = contents[xref.index * 2 + 1];

          const streamPdf = new PdfBuffer(stream.slice(first + offset));
          return parseObject(streamPdf);
        }
        else if (xref.inUseFlag) {
          const originalPosition = pdf.position;
          pdf.seek(xref.offset);
          const object = readObject(pdf);
          pdf.seek(originalPosition);
          return object;
        }

        return {type: NULL_OBJECT};
      }
    }
  }

  function h(input) {
    input = input.replace(/&/g, '&amp;');
    input = input.replace(/</g, '&lt;');
    input = input.replace(/>/g, '&gt;');
    return input;
  }

  function renderObject(object) {
    switch (object.type) {
      case FALSE_OBJECT:
        return `<span class="boolean-object">false</span>`;

      case TRUE_OBJECT:
        return `<span class="boolean-object">true</span>`;

      case NULL_OBJECT:
        return `<span class="null-object">null</span>`;

      case DICTIONARY_OBJECT:
        const dictionary = object.dictionary.map(([key, value]) => `<li><span class="dictionary-key">${renderObject(key)}</span> <span class="dictionary-value">${renderObject(value)}</span></li>`).join("");
        return `
          <span class="dictionary-object">
            <span class="dictionary-marker">&lt;&lt;</span>
            <ul class="dictionary-items">
              ${dictionary}
            </ul>
            <span class="dictionary-marker">&gt;&gt;</span>
          </span>
        `;

      case HEX_STRING_OBJECT:
        return `<span class="hex-string-object">&lt;${h(object.string)}&gt;</span>`;

      case LITERAL_STRING_OBJECT:
        return `<span class="literal-string-object">(${h(object.string)})</span>`;

      case NAME_OBJECT:
        return `<span class="name-object">\\${h(object.name)}</span>`;

      case ARRAY_OBJECT:
        const array = object.array.map(value => `<li>${renderObject(value)}</li>`).join("");
        const lineClass = array.replace(/<[^>]+>/g, '').length > 20 ? 'multiline' : 'singleline';
        return `
          <span class="array-object">
            <span class="array-marker">[</span>
            <ul class="array-items ${lineClass}">
              ${array}
            </ul>
            <span class="array-marker">]</span>
          </span>
        `;

      case NUMBER_OBJECT:
        return `<span class="number-object">${object.number}</span>`;

      case INDIRECT_REFERENCE_OBJECT:
        return `<span class="indirect-reference-object">${object.objectNumber} ${object.generation} R</span>`;

      default:
        return `<span class="unknown-object">unknown object</span>`;
    }
  }

  function parseXrefStream({object, stream}) {
    const size = extractNumber(findValueByKey(object, 'Size'));
    const w = extractArrayOfNumbers(findValueByKey(object, 'W'));
    const index = extractArrayOfNumbers(findValueByKey(object, 'Index')) || [0, size];
    const prev = extractNumber(findValueByKey(object, 'Prev'));

    if (!size) { throw 'Size cannot be undefined for XRef objects'; }
    if (!w) { throw 'W cannot be undefined for XRef objects'; }
    if (w.length !== 3) { throw 'W must be three numbers long for XRef objects'; }
    if (index.length !== 2) { throw 'Index must be two numbers long for XRef objects'; }

    const [startObject, count] = index;
    const xref = [];

    const streamBuffer = new PdfBuffer(stream);

    for (let i = 0; i < count; i++) {
      const type = w[0] ? streamBuffer.readNumber(w[0]) : 1;

      switch (type) {
        case 0:
          const nextFreeObject = w[1] ? streamBuffer.readNumber(w[1]) : 0;
          const nextGeneration = w[2] ? streamBuffer.readNumber(w[2]) : 65536;
          xref.push({offset: nextFreeObject, generation: nextGeneration, inUseFlag: false});
          break;

        case 1:
          const offset = w[1] ? streamBuffer.readNumber(w[1]) : 0;
          const generation = w[2] ? streamBuffer.readNumber(w[2]) : 0;
          xref.push({offset, generation, inUseFlag: true});
          break;

        case 2:
          const number = w[1] ? streamBuffer.readNumber(w[1]) : 0;
          const index = w[2] ? streamBuffer.readNumber(w[2]) : 0;
          xref.push({number, index, inUseFlag: true, objectStreamFlag: true});
          break;

        default: // ignore
          break;
      }
    }

    return {xrefs: {startObject, count, xref}, prev};
  }

  function renderXrefStream({object, stream}) {
    try {
      const {xrefs} = parseXrefStream({object, stream});
      let html = '';

      let objectNumber = xrefs.startObject;
      for (const xref of xrefs.xref) {
        let line;

        if (!xref.inUseFlag) {
          line = `object ${objectNumber} is not in use; next free object at ${xref.offset}, next generation will be ${xref.generation}`;
        }
        else if (!xref.objectStreamFlag) {
          line = `object ${objectNumber} is at offset ${xref.offset} in generation ${xref.generation}`;
        }
        else {
          line = `object ${objectNumber} is inside object stream ${xref.number} at index ${xref.index}`;
        }

        html += `<li>${line}</li>`;
        objectNumber++;
      }

      return `<ul class="xref-stream">${html}</ul>`;
    }
    catch (e) {
      return '<div class="error">error parsing XRef stream data</div>';
    }
  }

  function render(className, html) {
    const div = document.createElement('div');
    div.className = className;
    div.innerHTML = html;

    const code = document.querySelector('section#viewer .code');
    code.appendChild(div);
  }

  document.querySelector('input').addEventListener('change', () => {
    const reader = new FileReader();

    let pdfVersion;
    let binaryMarker = false;

    reader.onload = function() {
      const pdf = new PdfBuffer(new Uint8Array(this.result));

      let line;

      line = pdf.readLine();
      const match = line.match(/^%PDF-(1\.\d+)$/);
      if (!match) {
        throw "Not a PDF 1.x file";
      }
      pdfVersion = match[1];

      console.log('PDF version', pdfVersion);

      pdf.seekToEnd();
      const lastLine = pdf.readLineBackwards();
      if (lastLine !== '%%EOF') {
        console.log('last line is', lastLine);
        throw "Doesn't end with %%EOF";
      }

      let startxref = parseInt(pdf.readLineBackwards());
      const startxrefkeyword = pdf.readLineBackwards();

      if (startxrefkeyword !== 'startxref') {
        throw "Couldn't find startxref keyword on the third-to-last line of PDF file";
      }

      if (startxref < 1) {
        throw "Invalid startxref number";
      }

      pdf.xrefTable = [];

      while (startxref) {
        pdf.seek(startxref);

        const c = pdf.peekChar();
        if (c === 'x') {
          if (pdf.readLine() != 'xref') {
            throw `expecting xref keyword at ${startxref} but couldn't find it`;
          }
          const xref = parseXref(pdf);
          pdf.xrefTable = pdf.xrefTable.concat(xref);

          if (pdf.readLine() != 'trailer') {
            throw `expecting trailer keyword at ${pdf.position} but couldn't find it`;
          }
          const trailer = parseObject(pdf);
          startxref = extractNumber(findValueByKey(trailer, 'Prev'));
        }
        else if ("123456789".includes(c)) {
          const {object, stream} = readObject(pdf);

          if (object.type !== DICTIONARY_OBJECT) {
            throw `xref objects must be dictionaries`;
          }

          if (extractName(findValueByKey(object, 'Type')) !== 'XRef') {
            throw 'object pointed to by xrefstart/Prev does not have type XRef';
          }

          const {xrefs, prev} = parseXrefStream({object, stream});
          pdf.xrefTable.push(xrefs);

          startxref = prev;
        }
        else {
          throw `need an xref keyword or xref object at offset ${pdf.position}`;
        }
      }

      document.querySelector('section#upload').style.display = 'none';
      document.querySelector('section#viewer').style.display = 'block';

      pdf.seek(0);

      while (!pdf.eof()) {
        pdf.skipSpaceChars();
        const c = pdf.peekChar();

        let objectDescription = '';
        if ("0123456789".includes(c)) {
          const {number, generation, object, stream, position} = readObject(pdf);

          const TYPE_DESCRIPTIONS = {
            Catalog: 'The Catalog object is used at the root of the document and points to the pages',
            Pages: 'The Pages object points to the pages in this document',
            Page: 'The Page object sets up the resources for a page and points to its content',
            XRef: 'The XRef object provides a lookup table for objects so they can be quickly found',
            ObjStm: 'The ObjStm (object stream) object contains multiple objects compressed in its stream data',
            XObject: 'The XObject object holds graphics content that can be reused multiple times',
          };

          let dictionaryType;
          if (object.type === DICTIONARY_OBJECT) {
            dictionaryType = extractName(dereference(pdf, findValueByKey(object, 'Type')));
            const description = TYPE_DESCRIPTIONS[dictionaryType];
            if (description) {
              objectDescription = `<div>${description}</div>`;
            }
          }

          let html = `
            <div class="explanation">
              Define an object: number ${number}, generation ${generation}, at offset ${position}
              ${objectDescription}
            </div>
            <div class="header object-header">
              ${number} ${generation} obj
            </div>
            <div class="object-data">
              ${renderObject(object)}
            </div>
          `;

          if (stream) {
            html += '<div class="header stream-header">stream</div>';

            if (dictionaryType === 'XRef') {
              html += renderXrefStream({object, stream});
            }
            else if (stream.some(x => x > 127)) {
              html += `<div class="stream-placeholder data">${stream.length} bytes of binary data</div>`;
            }
            else if (stream.length > 16 * 1024) {
              html += `<div class="stream-placeholder data">${stream.length} bytes of text data</div>`;
            }
            else {
              html += `<div class="data stream-data">${h(String.fromCharCode.apply(null, stream))}</div>`;
            }
          }

          html += `
            <div class="header object-footer">
              endobj
            </div>
          `;

          render('object', html);
        }
        else if (c === '%') {
          const comment = pdf.readLine();
          render('comment', h(comment));
        }
        else {
          const keyword = pdf.readKeyword();
          let html;

          switch (keyword) {
            case 'endobj':
              break;

            case 'xref':
              const table = parseXref(pdf);
              let xrefHtml = '';
              for (const {startObject, count, xrefs} of table) {
                xrefHtml += `<div class="xref-section-header">${startObject} ${count}</div><ul class="xref-section">`;
                for (const {offset, generation, inUseFlag} of xrefs) {
                  xrefHtml += `<li>${offset} ${generation} ${inUseFlag}`;
                }
                xrefHtml += '</ul>';
              }

              html = `
                <div class="header xref-header">xref</div>
                <div class="data xref-data">
                ${xrefHtml}
                </div>
              `;

              render('xref', html);
              break;

            case 'trailer':
              const trailer = parseObject(pdf);
              html = `
                <div class="header trailer-header">trailer</div>
                <div class="data trailer-data">
                  ${renderObject(trailer)}
                </div>
              `;
              render('trailer', html);
              break;

            case 'startxref':
              const startxref = parseObject(pdf);
              html = `
                <div class="header startxref-header">startxref</div>
                <div class="data startxref-data">
                  ${renderObject(startxref)}
                </div>
              `;
              render('startxref', html);
              break;

            default:
              throw `unknown keyword ${keyword} at position ${pdf.position}`;
          }
        }
      }
      console.log('--end parse--');
    }

    reader.readAsArrayBuffer(fileElement.files[0]);
  });
});