// Ekspor naskah ke .docx memakai library `docx`.
// Menerima paragraf sederhana dari perbupNaskah.js supaya penyusun naskah tidak
// perlu tahu apa pun tentang OOXML.

import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'
// file-saver berupa modul CommonJS: impor default, lalu ambil saveAs.
// Impor bernama gagal di Node ESM (skrip pengujian), meski jalan di Vite.
import fileSaver from 'file-saver'
const { saveAs } = fileSaver

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
  both: AlignmentType.JUSTIFIED
}

// F4/Folio 21,5 x 33 cm — ukuran kertas naskah peraturan daerah, dalam twips.
const HALAMAN = {
  size: { width: 12190, height: 18710 },
  margin: { top: 1701, right: 1701, bottom: 1701, left: 2268 }
}

/**
 * @param {Array<{teks:string,bold?:boolean,italic?:boolean,align?:string,indent?:number,after?:number}>} paragraf
 *        `indent` dan `after` dalam twips (1 cm = 567).
 * @returns {Promise<Blob>}
 */
export function buatDocx(paragraf, opsi = {}) {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: opsi.font || 'Bookman Old Style', size: (opsi.ukuranPt || 12) * 2 },
          paragraph: { spacing: { line: 276 } }
        }
      }
    },
    sections: [{
      properties: { page: HALAMAN },
      children: paragraf.map(p => new Paragraph({
        alignment: ALIGN[p.align] || AlignmentType.JUSTIFIED,
        spacing: { after: p.after === undefined ? 120 : p.after, line: 276 },
        indent: p.indent ? { left: p.indent } : undefined,
        children: [new TextRun({ text: p.teks ?? '', bold: !!p.bold, italics: !!p.italic })]
      }))
    }]
  })

  return Packer.toBlob(doc)
}

export { saveAs }
