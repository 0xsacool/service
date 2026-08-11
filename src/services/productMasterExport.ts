import type { ProductCategory, ProductMasterEntry } from '../types';
import { buildCsv } from '../utils/csv';

const EXPORT_HEADERS = [
  'Brand',
  'SKU',
  'Model',
  'Product Name',
  'Category',
  'Warranty Months',
  'Status',
];
const TEMPLATE_HEADERS = ['Brand', 'SKU', 'Model', 'Product Name', 'Category'];

function categoryName(categoryId: string, categories: ProductCategory[]): string {
  return categories.find((c) => c.id === categoryId)?.name ?? '';
}

function exportRow(product: ProductMasterEntry, categories: ProductCategory[]): string[] {
  return [
    product.brand,
    product.sku ?? '',
    product.model,
    product.name,
    categoryName(product.categoryId, categories),
    String(product.warrantyMonths),
    product.status,
  ];
}

export function buildProductsExportCsv(
  products: ProductMasterEntry[],
  categories: ProductCategory[]
): string {
  return buildCsv([EXPORT_HEADERS, ...products.map((p) => exportRow(p, categories))]);
}

// Header-only — a template is something to fill in, not sample data the
// framework invented.
export function buildTemplateCsv(): string {
  return buildCsv([TEMPLATE_HEADERS]);
}

// --- SpreadsheetML (Excel 2003 XML) -----------------------------------
// Excel opens this natively (the mso-application processing instruction is
// what tells it to). Chosen specifically so Export/Template can produce
// genuine multi-sheet Excel-openable files with zero new dependencies —
// see Sprint P3's Architecture Summary for why real .xlsx (a zip of XML
// parts) isn't hand-rolled here.

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cell(value: string, type: 'String' | 'Number' = 'String'): string {
  return `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function xmlRow(cells: string): string {
  return `<Row>${cells}</Row>`;
}

function worksheet(name: string, rowsXml: string): string {
  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rowsXml}</Table></Worksheet>`;
}

function workbook(worksheetsXml: string): string {
  return (
    '<?xml version="1.0"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    worksheetsXml +
    '</Workbook>'
  );
}

export function buildProductsExportExcel(
  products: ProductMasterEntry[],
  categories: ProductCategory[]
): string {
  const headerRow = xmlRow(EXPORT_HEADERS.map((h) => cell(h)).join(''));
  const dataRows = products
    .map((product) => {
      const [brand, sku, model, name, category, warrantyMonths, status] = exportRow(
        product,
        categories
      );
      return xmlRow(
        [
          cell(brand),
          cell(sku),
          cell(model),
          cell(name),
          cell(category),
          cell(warrantyMonths, 'Number'),
          cell(status),
        ].join('')
      );
    })
    .join('');
  return workbook(worksheet('Products', headerRow + dataRows));
}

// Products sheet is header-only (fill-in template); Brands/Categories are
// reference sheets generated from the current Product Master, never
// hardcoded, so a future brand/category shows up automatically next time
// this is downloaded.
export function buildTemplateExcel(
  brands: string[],
  categories: ProductCategory[]
): string {
  const productsSheet = worksheet(
    'Products',
    xmlRow(TEMPLATE_HEADERS.map((h) => cell(h)).join(''))
  );

  const brandsSheet = worksheet(
    'Brands',
    xmlRow(cell('Brand')) + brands.map((brand) => xmlRow(cell(brand))).join('')
  );

  const categoriesSheet = worksheet(
    'Categories',
    xmlRow(cell('Category ID') + cell('Category Name')) +
      categories.map((c) => xmlRow(cell(c.id) + cell(c.name))).join('')
  );

  return workbook(productsSheet + brandsSheet + categoriesSheet);
}
