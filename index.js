/*
 * PDF Pretty Print
 * Copyright 2020 Roger Nesbitt
 * Licensed under an MIT licence
 *
 * Welcome to the source code!  Yep, it's a single handrolled file.
 *
 * This is how I get a project out.  Slam it all in a single file, see if it works, and when it is
 * working well then refactor it, introduce a build system, and all those other time consuming
 * parts.
 *
 * Apologies in the meantime if you're trying to make sense of it :)  Get in touch on GitHub if
 * you'd like to participate, there's a lot to do.
 */

const WHITESPACE_CHARACTERS = "\x00\t\n\x0c\r ";
const DELIMITER_CHARACTERS = "()<>[]{}/%";
const DELIMITER_AND_WHITESPACE_CHARACTERS = DELIMITER_CHARACTERS + WHITESPACE_CHARACTERS;

window.addEventListener('load', () => {
  const fileElement = document.getElementById('file');

  function arrayToString(array) {
    return String.fromCharCode.apply(null, array);
  }

  class PdfBuffer {
    offset = 0;

    constructor(array) {
      this.array = array;
      this.length = this.array.length;
    }

    getOffset() {
      return this.offset;
    }

    eof() {
      return this.offset >= this.length;
    }

    readLine() {
      if (this.eof()) { return; }

      let c, line = '';
      do {
        c = this.readChar();

        if (c === "\r") {
          if (this.peekChar() === '\n') { this.offset++; }
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

      while (WHITESPACE_CHARACTERS.includes(this.peekChar()) && this.offset) {
        this.offset--;
      }

      do {
        c = this.peekChar();

        if (c === "\r" || c === "\n") {
          break;
        }

        line = c + line;
        this.offset--;
      }
      while (c && this.offset);

      return line;
    }

    readBytes(count) {
      if (this.eof()) { return; }

      const subarray = this.array.subarray(this.offset, this.offset + count);
      this.offset += count;
      return subarray;
    }

    readNumber(bytes) {
      let number = 0;

      while (bytes--) {
        number = (number << 8) | this.array[this.offset++];
      }

      return number;
    }

    readChar() {
      if (this.eof()) { return; }

      const c = this.array[this.offset++];
      return String.fromCharCode(c);
    }

    readKeyword() {
      this.skipSpaceChars();

      let c, keyword = '';
      while (true) {
        c = this.readChar();

        if (!c || DELIMITER_AND_WHITESPACE_CHARACTERS.includes(c)) {
          if (c === '\r' && this.peekChar() === '\n') {
            this.offset++;
          }
          break;
        }

        keyword += c;
      }

      return keyword;
    }

    skipSpaceChars() {
      let c;
      do {
        c = this.peekChar();
        if (!WHITESPACE_CHARACTERS.includes(c)) {
          return c;
        }
        this.offset++;
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
      if (!this.eof()) { return String.fromCharCode(this.array[this.offset]); }
    }

    peekChars(count) {
      if (!this.eof()) {
        const subarray = this.array.subarray(this.offset, this.offset + count);
        return String.fromCharCode.apply(null, subarray);
      }
    }

    advance(count) {
      this.offset += count;
    }

    rewind() {
      this.offset--;
    }

    seek(to) {
      this.offset = to;
    }

    seekToEnd() {
      this.offset = this.length - 1;
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

  function parseDictionary(pdf, keyContext) {
    const dictionary = [];

    while (true) {
      pdf.skipSpaceChars();

      if (pdf.peekChars(2) === '>>') {
        pdf.advance(2);
        return {type: DICTIONARY_OBJECT, dictionary};
      }

      const key = parseObject(pdf);
      if (key.type !== NAME_OBJECT) {
        throw `dictionary can only have name objects for keys at offset ${pdf.offset}`;
      }

      if (!keyContext && keyToTypeMap[key.name]) {
        keyContext = key.name;
      }

      const value = parseObject(pdf, keyContext);

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
      else if (!c) {
        throw `unexpected end of data at offset ${pdf.offset}`;
      }
      else {
        throw `invalid character ${c} in hex string at offset ${pdf.offset}`;
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

  function parseArray(pdf, keyContext) {
    const array = [];

    while (true) {
      pdf.skipSpaceChars();
      if (pdf.peekChar() === ']') {
        pdf.advance(1);
        return {type: ARRAY_OBJECT, array};
      }

      const object = parseObject(pdf, keyContext);
      array.push(object);
    }
  }

  function parseNumberOrReference(pdf, allowReference = true, keyContext) {
    let string = "";
    let dotFlag = false;

    string = pdf.readChar();
    if (string == '.') { string = "0."; }

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
        if (allowReference && !dotFlag && number > 0 && WHITESPACE_CHARACTERS.includes(c)) {
          const savedOffset = pdf.offset;
          pdf.skipSpaceChars();
          let generationString = '';
          while (true) {
            const c = pdf.readChar();
            if (WHITESPACE_CHARACTERS.includes(c)) {
              pdf.skipSpaceChars();
              if (pdf.readChar() === 'R') {
                const typeHint = keyToTypeMap[keyContext];

                if (typeHint) {
                  objectTypeHints[number] = typeHint;
                }

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
          pdf.seek(savedOffset);
        }

        if (isNaN(number)) {
          console.log("NaN:", string);
        }

        return {type: NUMBER_OBJECT, number};
      }
    }
  }

  function dereference(pdf, object) {
    let maxReferences = 100;

    while (object && object.type === INDIRECT_REFERENCE_OBJECT && maxReferences--) {
      const result = findObject(pdf, object.objectNumber);
      if (!result) {
        throw `Trying to look up indirect reference for object ${object.objectNumber} but couldn't find that object in the xref tables`;
      }

      object = result.object;
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
      throw `no Length key in dictionary before stream at ${pdf.offset}`;
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
      throw `expecting endstream and didn't get it at offset ${pdf.offset}`;
    }

    const filtered = filterChain.reduce(applyFilter, streamData);

    const decodeParms = wrapArray(dereference(pdf, findValueByKey(dictionary, 'DecodeParms')));

    const decoded = decodeParms ? decodeParms.array.reduce(applyDecoder, filtered) : filtered;

    return decoded;
  }

  function readObject(pdf) {
    const offset = pdf.offset;
    // TODO : doesn't need to be a line break at the end of obj
    const objectLine = pdf.readLine().trim();
    const matches = objectLine.match(/^(\d+) (\d+) obj$/);

    if (!matches) {
      console.error(line);
      throw `invalid object header line at offset ${pdf.offset}`;
    }

    const [_, number, generation] = matches;

    const object = parseObject(pdf);
    let stream, streamOffset;

    pdf.skipSpaceChars();
    if (object.type === DICTIONARY_OBJECT && pdf.peekChars(6) === 'stream') {
      pdf.advance(6);

      let c = pdf.readChar();
      if (c === '\r') {
        c = pdf.readChar();
      }
      if (c !== '\n') {
        throw `stream keyword must be followed by either a line feed or a carriage return and line feed at offset ${pdf.offset}`;
      }

      streamOffset = pdf.offset;
      stream = readStream(pdf, object);
    }

    return {number, generation, object, stream, offset, streamOffset};
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

  function parseObject(pdf, keyContext) {
    const c1 = pdf.readNonSpaceChar();

    switch (c1) {
      case '<':
        const c2 = pdf.peekChar();
        if (c2 === '<') {
          pdf.advance(1);
          return parseDictionary(pdf, keyContext);
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
        return parseArray(pdf, keyContext);
    }

    if ("-+0123456789.".includes(c1)) {
      pdf.rewind();
      return parseNumberOrReference(pdf, true, keyContext);
    }

    throw `unknown character ${c1} at offset ${pdf.offset}`;
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
        let outputIndex = 0;

        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          const offsetIn = rowIndex * (columns + 1);
          const offsetOut = rowIndex * columns;
          const operation = data[offsetIn];
          const row = data.slice(offsetIn + 1, offsetIn + columns);

          switch (operation) {
            case 0:
              for (let column = 0; column < columns; column++) {
                output[outputIndex++] = row[column];
              }
              break;

            case 1:
              output[offsetOut] = row[column];
              for (let column = 1; column < columns; column++) {
                output[outputIndex++] = (row[column] + row[column - 1]) & 0xff;
              }
              break;

            case 2:
              if (rowIndex) {
                const previousRow = output.slice((rowIndex - 1) * columns);
                for (let column = 0; column < columns; column++) {
                  output[outputIndex++] = (row[column] + previousRow[column]) & 0xff;
                }
              }
              else {
                for (let column = 0; column < columns; column++) {
                  output[outputIndex++] = row[column];
                }
              }
              break;

            default:
              throw `don't know how to decode predictor with operation ${operation}`;
          }
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
        throw `invalid xref header at offset ${pdf.offset}`;
      }

      const [_, startObject, count] = matches.map(n => parseInt(n));

      const subsection = {
        startObject, count, xrefs: []
      };

      for (let i = 0; i < count; i++) {
        const line = pdf.readLine();
        const matches = line.match(/^(\d{10}) (\d{5}) ([fn])\s*$/);
        if (!matches) {
          throw `invalid xref line at offset ${pdf.offset}`;
        }

        subsection.xrefs.push({offset: matches[1], generation: matches[2], inUseFlag: matches[3] === 'n'});
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
          const first = extractNumber(findValueByKey(object, 'First'));

          const contents = String.fromCharCode.apply(null, stream.slice(0, first)).split(/\s+/);
          let offset;
          if (xref.index > 0) {
            offset = parseInt(contents[xref.index * 2 + 1]);
          }
          else {
            for (let i = 0; i < n; i++) {
              if (parseInt(contents[i * 2]) === objectNumber) {
                offset = parseInt(contents[i * 2 + 1]);
              }
            }
          }

          if (typeof offset === 'undefined') {
            throw `Couldn't find the offset for object number ${objectNumber} in object stream ${xref.number}`;
          }

          const streamPdf = new PdfBuffer(stream.subarray(first + offset));
          return parseObject(streamPdf);
        }
        else if (xref.inUseFlag) {
          const originalOffset = pdf.offset;
          pdf.seek(xref.offset);
          const object = readObject(pdf);
          pdf.seek(originalOffset);
          return object;
        }

        return {type: NULL_OBJECT};
      }
    }
  }

  function parseObjStm({object, stream}) {
    const n = extractNumber(findValueByKey(object, 'N'));
    const first = extractNumber(findValueByKey(object, 'First'));

    const headerLine = String.fromCharCode.apply(null, stream.slice(0, first));
    const regexp = RegExp('\\s*(\\d+)\\s+(\\d+)', 'g')
    let match;
    const header = [];

    while ((match = regexp.exec(headerLine)) !== null) {
      header.push({number: parseInt(match[1]), offset: parseInt(match[2])});
    }

    const streamPdf = new PdfBuffer(stream.subarray(first));
    const objects = [];

    while (!streamPdf.eof()) {
      objects.push(parseObject(streamPdf));
      streamPdf.skipSpaceChars();
    }

    return {header, headerLine, objects};
  }

  function renderObjStm({object, stream}) {
    const {header, headerLine, objects} = parseObjStm({object, stream});

    let html = `
      <div class="inline-explanation">% Pairs of numbers: the object number and its offset in this stream</div>
      <div class="obj-stm-header">${headerLine}</div>
    `;

    for (const {number, offset} of header) {
      html += `
        <a id="object${number}x0">
        <div class="obj-stm-object-header inline-explanation">% Object ${number} at offset ${offset}</div>
        ${renderObject(objects.shift())}
        </a>
      `;
    }

    return `<div class="data">${html}</div>`;
  }

  function renderGraphicsObject(stream) {
    const streamPdf = new PdfBuffer(stream);

    let html = '';
    let args = [];

    try {
      while (!streamPdf.eof()) {
        const c = streamPdf.readNonSpaceChar();

        switch (c) {
          case '<':
            const c2 = streamPdf.peekChar();
            if (c2 === '<') {
              streamPdf.advance(1);
              args.push(parseDictionary(streamPdf));
            }
            else {
              args.push(parseHexString(streamPdf));
            }
            break;

          case '/':
            args.push(parseName(streamPdf));
            break;

          case '(':
            args.push(parseLiteralString(streamPdf));
            break;

          default:
            streamPdf.rewind();

            if ("0123456789-+.".includes(c)) {
              args.push(parseNumberOrReference(streamPdf, false));
            }
            else {
              const command = streamPdf.readKeyword();
              const argsHtml = args.map(a => renderObject(a)).join(" ");
              args = [];

              html += `<li>${argsHtml} <span class="command">${command}</span></li>`;
            }
        }
      }

      return `<ul class="graphics-objects">${html}</ul>`;
    }
    catch (e) {
      console.error(e);
      return `
        <div class="inline-explanation">% Couldn't parse this graphics object data, showing without pretty printing
        <div class="data">
          ${h(arrayToString(stream))}
        </div>
      `;
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
        const lineClass = (object.array[0] && object.array[0].type !== NUMBER_OBJECT) && array.replace(/<[^>]+>/g, '').length > 20 ? 'multiline' : 'singleline';
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
        return `<span class="indirect-reference-object"><a href="#object${object.objectNumber}x${object.generation}">${object.objectNumber} ${object.generation} R</a></span>`;

      default:
        return `<span class="unknown-object">unknown object</span>`;
    }
  }

  function parseXrefStream({object, stream}) {
    const size = extractNumber(findValueByKey(object, 'Size'));
    const w = extractArrayOfNumbers(findValueByKey(object, 'W'));
    const index = extractArrayOfNumbers(findValueByKey(object, 'Index')) || [0, size];
    const prev = extractNumber(findValueByKey(object, 'Prev'));

    if (!size) { throw 'Size must be a number for XRef objects'; }
    if (!w) { throw 'W must be an array of numbers for XRef objects'; }
    if (w.length !== 3) { throw 'W must have an array of three numbers for XRef objects'; }
    if (index.length === 0 || index.length % 2 !== 0) { throw 'There must be a positive even number of elements in the Index array for XRef objects'; }

    const streamBuffer = new PdfBuffer(stream);
    const table = [];

    for (let indexIndex = 0; indexIndex < index.length; indexIndex += 2) {
      const startObject = index[indexIndex];
      const count       = index[indexIndex + 1];
      const xref        = [];

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

      table.push({startObject, count, xref});
    }

    return {xrefs: table, prev};
  }

  function renderXrefStream({object, stream}) {
    try {
      const {xrefs: table} = parseXrefStream({object, stream});
      let html = '';

      for (const xrefs of table) {
        let objectNumber = xrefs.startObject;

        for (const xref of xrefs.xref) {
          let line;

          if (!xref.inUseFlag) {
            line = `object ${objectNumber} is not in use; next free object at ${xref.offset}, next generation will be ${xref.generation}`;
          }
          else if (!xref.objectStreamFlag) {
            line = `object ${objectNumber} is at <a href="#offset${xref.offset}">offset ${xref.offset}</a> in generation ${xref.generation}`;
          }
          else {
            line = `object ${objectNumber} is inside <a href="#object${xref.number}x0">object stream ${xref.number}</a> at index ${xref.index}`;
          }

          html += `<li>${line}</li>`;
          objectNumber++;
        }
      }

      return `
        <ul class="xref-stream">
          <li class="inline-explanation">% XRef streams are stored as binary data.  Following is an interpretation of that data:</li>
          ${html}
        </ul>
      `;
    }
    catch (e) {
      console.error(e);
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

  const keyToTypeMap = {
    Contents: 'Content',
    XObject: 'XObject',
  };

  const objectTypeHints = {};

  function validateFileHeader(pdf) {
    pdf.seek(0);
    line = pdf.readLine();
    const match = line.match(/^%PDF-(1\.\d+)$/);
    if (!match) {
      throw "Not a PDF 1.x file";
    }
  }

  function getStartxref(pdf) {
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

    return startxref;
  }

  function loadXrefTables(pdf, startxref) {
    let table = [];

    while (startxref) {
      pdf.seek(startxref);

      const c = pdf.peekChar();
      if (c === 'x') {
        if (pdf.readLine() != 'xref') {
          throw `expecting xref keyword at ${startxref} but couldn't find it`;
        }
        const xref = parseXref(pdf);
        table = table.concat(xref);

        if (pdf.readLine() != 'trailer') {
          throw `expecting trailer keyword at ${pdf.offset} but couldn't find it`;
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
        table = table.concat(xrefs);

        startxref = prev;
      }
      else {
        throw `need an xref keyword or xref object at offset ${pdf.offset}`;
      }
    }

    return table;
  }

  function renderStream({object, stream, type}) {
    let html = '<div class="header stream-header">stream</div>';

    if (type === 'XRef') {
      html += renderXrefStream({object, stream});
    }
    else if (type === 'ObjStm') {
      html += renderObjStm({object, stream});
    }
    else if (['Content', 'XObject'].includes(type)) {
      html += renderGraphicsObject(stream);
    }
    else if (type === 'XObject/Image') {
      html += `<div class="stream-placeholder data">[ image data ]</div>`;
    }
    else if (stream.some(x => x > 127)) {
      html += `<div class="stream-placeholder data">[ ${stream.length} bytes of binary data ]</div>`;
    }
    else if (stream.length > 32 * 1024) {
      html += `<div class="stream-placeholder data">[ ${stream.length} bytes of text data ]</div>`;
    }
    else {
      html += `<div class="data stream-data">${h(String.fromCharCode.apply(null, stream))}</div>`;
    }

    return html;
  }

  function renderObjectTypeExplanation(type) {
    const description = TYPE_DESCRIPTIONS[type];
    if (description) {
      return `<div>${description}</div>`;
    }
  }

  const TYPE_DESCRIPTIONS = {
    Catalog: 'The Catalog object sits at the root of the document and points to its pages object',
    Pages: 'The Pages object points to the individual pages in this document',
    Page: 'The Page object sets up the resources for a page and points to its graphical content',
    XRef: 'The XRef object provides a lookup table for objects so they can be quickly found',
    ObjStm: 'The ObjStm (object stream) object contains multiple objects compressed in its stream data',
    XObject: 'The XObject object holds graphics content that can be reused multiple times',
    Content: 'This object contains graphical content',
  };

  const unidentifiedObjects = [];

  function displayPDF(filename, array) {
    const pdf = new PdfBuffer(array);

    const startxref = getStartxref(pdf);
    pdf.xrefTable = loadXrefTables(pdf, startxref);

    pdf.seek(0);

    while (!pdf.eof()) {
      pdf.skipSpaceChars();
      const c = pdf.peekChar();

      let objectDescription = '';
      if ("0123456789".includes(c)) {
        const {number, generation, object, stream, offset, streamOffset} = readObject(pdf);

        let dictionaryType;
        if (object.type === DICTIONARY_OBJECT) {
          dictionaryType = extractName(dereference(pdf, findValueByKey(object, 'Type')));
        }
        if (dictionaryType) {
          const subtype = extractName(dereference(pdf, findValueByKey(object, 'Subtype')));
          if (subtype) { dictionaryType += `/${subtype}`; }
        }
        if (!dictionaryType) { dictionaryType = objectTypeHints[number]; }

        if (!dictionaryType) {
          unidentifiedObjects.push({number, offset, streamOffset});
        }

        let html = `
          <a id="offset${offset}"></a>
          <a id="object${number}x${generation}"></a>
          <div class="explanation">
            Define object number ${number}, generation ${generation}, at offset ${offset}
            ${renderObjectTypeExplanation(dictionaryType) || ''}
          </div>
          <div class="header object-header">
            ${number} ${generation} obj
          </div>
          <div class="object-data">
            ${renderObject(object)}
          </div>
        `;

        if (stream) {
          html += renderStream({object, stream, type: dictionaryType});
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

        let matches;
        matches = comment.match(/^%PDF-([0-9.]+)$/);
        if (matches) {
          render('explanation', `This is a PDF version ${matches[1]} compliant file`);
        }
        else if (comment.match(/^%[\x80-\xff]{4}$/)) {
          render('explanation', 'This comment marks that there is binary data contained in this file');
        }
        else if (comment === '%%EOF') {
          render('explanation', 'This marks the end of the document, although may be appended to after this point with more PDF content');
        }

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
                if (inUseFlag) {
                  xrefHtml += `<li><a href="#offset${offset.replace(/^0+/, '')}">${offset}</a> ${generation} n`;
                }
                else {
                  xrefHtml += `<li>${offset} ${generation} f`;
                }
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
              <div class="explanation">Points to the last cross-reference table which stores object offsets</div>
              <div class="header startxref-header">startxref</div>
              <div class="data startxref-data">
                <a href="#offset${startxref.number}">
                  ${renderObject(startxref)}
                </a>
              </div>
            `;
            render('startxref', html);
            break;

          default:
            throw `unknown keyword ${keyword} at offset ${pdf.offset}`;
        }
      }
    }

    console.log('--success--');
  }

  document.querySelector('input').addEventListener('change', event => {
    const filename = event.target.files[0].name;

    document.querySelector('section#upload').style.display = 'none';
    document.querySelector('section#viewer').style.display = 'block';
    document.querySelector('#filename').innerText = filename;

    const reader = new FileReader();

    reader.onload = function() {
      displayPDF(filename, new Uint8Array(this.result));
    }

    setTimeout(() => reader.readAsArrayBuffer(fileElement.files[0]), 0);
  });
});
