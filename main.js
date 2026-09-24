const { app, FitOptions, MeasurementUnits, RulerOrigin } = require("indesign");
const { storage } = require("uxp");

const fs = storage.localFileSystem;
const PRODUCT_PREFIX = "product:";
const SKU_KEY = "revemSKU";
const STATUS_KEY = "revemStatus";
const FIRST_PAGE_Y = 73;
const GAP_X = 5;
const GAP_Y = 10;

let csvFile = null;
let assetsFolder = null;

const $ = (id) => document.getElementById(id);

$("chooseCsv").addEventListener("click", chooseCsv);
$("chooseAssets").addEventListener("click", chooseAssets);
$("validateTemplate").addEventListener("click", validateTemplate);
$("update").addEventListener("click", () => run("update"));
$("add").addEventListener("click", () => run("add"));
$("audit").addEventListener("click", () => run("audit"));

async function chooseCsv() {
  const picked = await fs.getFileForOpening({ types: ["csv", "txt"] });
  if (!picked) return;
  csvFile = picked;
  $("csvName").textContent = picked.nativePath || picked.name;
}

async function chooseAssets() {
  const picked = await fs.getFolder();
  if (!picked) return;
  assetsFolder = picked;
  $("assetsName").textContent = picked.nativePath || picked.name;
}

function validateTemplate() {
  if (!app.documents.length) return report("Abre el documento de InDesign que deseas validar.");
  setBusy(true, "Validando etiquetas...");
  try {
    const doc = app.activeDocument;
    const items = documentItems(doc);
    const counts = {};
    for (const item of items) {
      const label = String(item.label || "").trim();
      if (label) counts[label] = (counts[label] || 0) + 1;
    }

    const requiredMasters = [
      "master_E27",
      "master_E27_multiproducto",
      "master_LED",
      "master_LED_multiproducto"
    ];
    const missingMasters = requiredMasters.filter((label) => !counts[label]);
    const duplicateMasters = requiredMasters.filter((label) => (counts[label] || 0) > 1);
    const labelLines = Object.keys(counts)
      .filter((label) => label.indexOf("lbl_") === 0 || label.indexOf("master_") === 0)
      .sort()
      .map((label) => label + ": " + counts[label]);

    const lines = [
      missingMasters.length ? "PLANTILLA INCOMPLETA" : "PLANTILLA LISTA",
      "Objetos revisados: " + items.length,
      "Etiquetas REVEM: " + labelLines.length
    ];
    appendDetails(lines, "Grupos master faltantes", missingMasters);
    appendDetails(lines, "Grupos master duplicados", duplicateMasters);
    appendDetails(lines, "Etiquetas encontradas", labelLines);
    report(lines.join("\n"));
  } catch (error) {
    report("ERROR AL VALIDAR\n" + (error && error.stack ? error.stack : error));
  } finally {
    setBusy(false);
  }
}

function documentItems(doc) {
  const result = [];
  const seen = {};
  const containers = [];
  try { containers.push(doc); } catch (_) {}
  try {
    for (let i = 0; i < doc.pages.length; i++) containers.push(doc.pages.item(i));
  } catch (_) {}
  try {
    for (let i = 0; i < doc.masterSpreads.length; i++) containers.push(doc.masterSpreads.item(i));
  } catch (_) {}

  for (const container of containers) {
    let items;
    try { items = allItems(container); } catch (_) { continue; }
    for (const item of items) {
      let key;
      try { key = String(item.id); } catch (_) { key = "item-" + result.length; }
      if (seen[key]) continue;
      seen[key] = true;
      result.push(item);
    }
  }
  return result;
}

async function run(mode) {
  if (!csvFile) return report("Selecciona primero el archivo CSV.");
  if (!app.documents.length) return report("Abre el documento de InDesign que deseas actualizar.");

  setBusy(true, "Leyendo CSV...");
  try {
    const text = await csvFile.read();
    const parsed = parseCsv(text);
    const products = normalizeProducts(parsed);
    validateProducts(products);

    const doc = app.activeDocument;
    prepareDocument(doc);
    const catalog = indexCatalog(doc);
    const images = assetsFolder ? await indexFolder(assetsFolder) : {};
    const result = await synchronize(doc, products, catalog, images, mode);
    report(formatResult(result, mode));
  } catch (error) {
    report("ERROR\n" + (error && error.stack ? error.stack : error));
  } finally {
    setBusy(false);
  }
}

function parseCsv(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("El CSV no contiene registros.");

  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).filter((r) => r.some((v) => String(v).trim())).map((r) => {
    const item = {};
    headers.forEach((header, i) => { item[header] = r[i] == null ? "" : r[i]; });
    return item;
  });
}

function normalizeProducts(rows) {
  return rows.map((row) => {
    const product = {
      sku: value(row, ["SKU", "sku", "Codigo", "Código", "codigo"]),
      name: value(row, ["Name", "name", "Nombre", "Nombre_Producto", "Producto"]),
      description: value(row, ["Description", "description", "Descripcion", "Descripción", "desc"]),
      stock: value(row, ["Stock", "stock", "Cantidad", "CANTIDAD"]),
      color: value(row, ["Color", "color"]),
      interiorColor: value(row, ["Color_interior", "Color interior"]),
      base: value(row, ["Base", "base"]),
      material: value(row, ["Material", "material"]),
      height: value(row, ["Altura", "altura", "Dimensiones"]),
      power: value(row, ["Potencia", "potencia"]),
      cct: value(row, ["CCT", "cct", "Temperatura de color"]),
      voltage: value(row, ["Voltaje", "voltaje"]),
      recommendedCode: value(row, ["Codigo recomendado", "Código recomendado"]),
      recommendation: value(row, ["Recomendacion_descripcion", "Recomendación_descripción"]),
      images: {
        primary: value(row, ["@Image", "@Imagen", "Image", "Imagen", "img", "@Imagen_limpia"]),
        clean: value(row, ["@Imagen_limpia"]),
        diagram: value(row, ["@Diagrama"]),
        background: value(row, ["@Fondo"]),
        recommendation: value(row, ["@imagen_recomendaciones", "@Imagen_recomendaciones"]),
        logo: value(row, ["@Logo"])
      }
    };
    if (!product.description) product.description = technicalDescription(product);
    return product;
  }).filter((p) => p.sku || p.name);
}

function technicalDescription(product) {
  const parts = [];
  if (product.color) parts.push("Color: " + product.color);
  if (product.interiorColor) parts.push("Color interior: " + product.interiorColor);
  if (product.base) parts.push("Base: " + product.base);
  if (product.material) parts.push("Material: " + product.material);
  if (product.height) parts.push("Altura: " + product.height);
  if (product.power) parts.push("Potencia: " + product.power);
  if (product.cct) parts.push("CCT: " + product.cct);
  if (product.voltage) parts.push("Voltaje: " + product.voltage);
  return parts.join(" | ");
}

function value(object, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return String(object[key]).trim();
  }
  return "";
}

function validateProducts(products) {
  if (!products.length) throw new Error("No se encontraron productos en el CSV.");
  const seen = {};
  const duplicate = [];
  products.forEach((p, index) => {
    if (!p.sku) throw new Error("La fila " + (index + 2) + " no tiene SKU.");
    const key = skuKey(p.sku);
    if (seen[key]) duplicate.push(p.sku);
    seen[key] = true;
  });
  if (duplicate.length) throw new Error("SKU duplicados en el CSV: " + duplicate.join(", "));
}

function prepareDocument(doc) {
  doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
  doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
  doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
  doc.zeroPoint = [0, 0];
}

function allItems(container) {
  const collection = container.allPageItems;
  const result = [];
  for (let i = 0; i < collection.length; i++) result.push(collection[i]);
  return result;
}

function indexCatalog(doc) {
  const bySku = {};
  let master = null;
  const items = allItems(doc);

  for (const item of items) {
    if (item.label === "masterProduct") {
      master = item;
      continue;
    }

    let sku = safeExtract(item, SKU_KEY);
    if (!sku && String(item.label || "").indexOf(PRODUCT_PREFIX) === 0) {
      sku = String(item.label).slice(PRODUCT_PREFIX.length);
    }
    if (!sku && isProductGroup(item)) sku = childText(item, "lbl_sku");

    if (sku) {
      const key = skuKey(sku);
      if (!bySku[key]) {
        tagProduct(item, sku, "active");
        bySku[key] = item;
      }
    }
  }
  return { bySku, master };
}

function isProductGroup(item) {
  try {
    return !!childByLabel(item, "lbl_sku");
  } catch (_) {
    return false;
  }
}

function childByLabel(parent, label) {
  const children = allItems(parent);
  for (const child of children) if (child.label === label) return child;
  return null;
}

function childText(parent, label) {
  const child = childByLabel(parent, label);
  if (!child) return "";
  try { return String(child.contents || "").trim(); } catch (_) { return ""; }
}

function safeExtract(item, key) {
  try { return item.extractLabel(key) || ""; } catch (_) { return ""; }
}

function tagProduct(item, sku, status) {
  item.label = PRODUCT_PREFIX + sku;
  item.insertLabel(SKU_KEY, sku);
  item.insertLabel(STATUS_KEY, status);
}

async function indexFolder(folder) {
  const result = {};
  const entries = await folder.getEntries();
  entries.forEach((entry) => {
    if (!entry.isFolder) result[String(entry.name).toLowerCase()] = entry;
  });
  return result;
}

async function synchronize(doc, products, catalog, images, mode) {
  const result = {
    csv: products.length,
    updated: [],
    added: [],
    missingInCsv: [],
    missingImages: [],
    overflow: [],
    skipped: []
  };

  const csvKeys = {};
  products.forEach((p) => { csvKeys[skuKey(p.sku)] = true; });

  if (mode !== "add") {
    for (const product of products) {
      const item = catalog.bySku[skuKey(product.sku)];
      if (!item) continue;
      if (mode === "update") {
        updateProduct(item, product, images, result);
        result.updated.push(product.sku);
      }
    }
  }

  if (mode !== "audit") {
    const newProducts = products.filter((p) => !catalog.bySku[skuKey(p.sku)]);
    if (newProducts.length) {
      if (!catalog.master) {
        result.skipped.push("No se encontro el grupo masterProduct; no se agregaron productos.");
      } else {
        addProducts(doc, newProducts, catalog.master, images, result);
      }
    }
  }

  Object.keys(catalog.bySku).forEach((key) => {
    const item = catalog.bySku[key];
    const sku = safeExtract(item, SKU_KEY) || childText(item, "lbl_sku");
    if (!csvKeys[key]) {
      result.missingInCsv.push(sku);
      if (mode === "update") item.insertLabel(STATUS_KEY, "missing-in-csv");
    } else if (mode === "update") {
      item.insertLabel(STATUS_KEY, "active");
    }
  });

  return result;
}

function updateProduct(group, product, images, result) {
  setText(group, "lbl_sku", product.sku);
  setText(group, "lbl_name", product.name);
  setText(group, "lbl_stock", product.stock);
  setText(group, "lbl_desc", product.description);
  setText(group, "lbl_color", product.color);
  setText(group, "lbl_color_interior", product.interiorColor);
  setText(group, "lbl_base", product.base);
  setText(group, "lbl_material", product.material);
  setText(group, "lbl_altura", product.height);
  setText(group, "lbl_potencia", product.power);
  setText(group, "lbl_cct", product.cct);
  setText(group, "lbl_voltaje", product.voltage);
  setText(group, "lbl_codigo_recomendado", product.recommendedCode);
  setText(group, "lbl_recomendacion_desc", product.recommendation);
  tagProduct(group, product.sku, "active");

  if ($("updateImages").checked) {
    placeImage(group, ["lbl_img", "lbl_imagen_limpia"], product.images.primary || product.images.clean, images, product.sku, result);
    placeImage(group, ["lbl_diagrama"], product.images.diagram, images, product.sku, result);
    placeImage(group, ["lbl_fondo"], product.images.background, images, product.sku, result);
    placeImage(group, ["lbl_imagen_recomendaciones"], product.images.recommendation, images, product.sku, result);
    placeImage(group, ["lbl_logo"], product.images.logo, images, product.sku, result);
  }

  for (const label of ["lbl_name", "lbl_stock", "lbl_desc"]) {
    const frame = childByLabel(group, label);
    try {
      if (frame && frame.overflows) result.overflow.push(product.sku + " -> " + label);
    } catch (_) {}
  }
}

function placeImage(group, labels, filename, images, sku, result) {
  if (!filename) return;
  let frame = null;
  for (const label of labels) {
    frame = childByLabel(group, label);
    if (frame) break;
  }
  if (!frame) return;
  const image = images[String(filename).toLowerCase()];
  if (!image) {
    result.missingImages.push(sku + " -> " + filename);
    return;
  }
  try {
    frame.place(image);
    frame.fit(FitOptions.CONTENT_TO_FRAME);
    frame.fit(FitOptions.PROPORTIONALLY);
    frame.fit(FitOptions.CENTER_CONTENT);
  } catch (_) {
    result.missingImages.push(sku + " -> no se pudo colocar " + filename);
  }
}

function setText(group, label, value) {
  const item = childByLabel(group, label);
  if (!item) return;
  try { item.contents = value == null ? "" : String(value); } catch (_) {}
}

function addProducts(doc, products, master, images, result) {
  const bounds = master.geometricBounds;
  const height = bounds[2] - bounds[0];
  const width = bounds[3] - bounds[1];
  const pageWidth = doc.documentPreferences.pageWidth;
  const pageHeight = doc.documentPreferences.pageHeight;
  const margins = doc.marginPreferences;
  const limitX = pageWidth - margins.right;
  const limitY = pageHeight - margins.bottom;
  let page = doc.pages.item(doc.pages.length - 1);
  let position = nextPosition(doc, page, width, height, margins, limitX, limitY);

  master.visible = false;
  products.forEach((product, index) => {
    if (position.y + height > limitY) {
      page = doc.pages.add();
      position = { x: margins.left, y: margins.top };
    }
    const item = master.duplicate(page);
    item.visible = true;
    item.move([position.x, position.y]);
    updateProduct(item, product, images, result);
    result.added.push(product.sku);
    position.x += width + GAP_X;
    if (position.x + width > limitX + 0.1) {
      position.x = margins.left;
      position.y += height + GAP_Y;
    }
    setProgress(index + 1, products.length, "Agregando " + product.sku);
  });
}

function nextPosition(doc, page, width, height, margins, limitX, limitY) {
  const products = allItems(page).filter((item) => safeExtract(item, SKU_KEY));
  if (!products.length) {
    return { x: margins.left, y: page === doc.pages.item(0) ? FIRST_PAGE_Y : margins.top };
  }

  let last = products[0];
  for (const item of products) {
    const a = item.geometricBounds;
    const b = last.geometricBounds;
    if (a[0] > b[0] + 0.1 || (Math.abs(a[0] - b[0]) < 0.1 && a[1] > b[1])) last = item;
  }
  const b = last.geometricBounds;
  let x = b[1] + width + GAP_X;
  let y = b[0];
  if (x + width > limitX + 0.1) {
    x = margins.left;
    y = b[0] + height + GAP_Y;
  }
  if (y + height > limitY) return { x: margins.left, y: limitY + 1 };
  return { x, y };
}

function skuKey(sku) {
  return String(sku || "").trim().toUpperCase();
}

function formatResult(result, mode) {
  const lines = [
    mode === "audit" ? "REVISION COMPLETADA" : "SINCRONIZACION COMPLETADA",
    "Registros CSV: " + result.csv,
    "Actualizados: " + result.updated.length,
    "Agregados: " + result.added.length,
    "No presentes en CSV: " + result.missingInCsv.length,
    "Imagenes faltantes: " + result.missingImages.length,
    "Textos desbordados: " + result.overflow.length
  ];
  appendDetails(lines, "Productos agregados", result.added);
  appendDetails(lines, "No presentes en CSV", result.missingInCsv);
  appendDetails(lines, "Imagenes faltantes", result.missingImages);
  appendDetails(lines, "Textos desbordados", result.overflow);
  appendDetails(lines, "Avisos", result.skipped);
  return lines.join("\n");
}

function appendDetails(lines, title, values) {
  if (!values.length) return;
  lines.push("", title + ":");
  values.forEach((value) => lines.push("- " + value));
}

function report(message) {
  $("output").textContent = String(message);
}

function setBusy(busy, message) {
  $("progress").hidden = !busy;
  ["chooseCsv", "chooseAssets", "validateTemplate", "update", "add", "audit"].forEach((id) => {
    $(id).disabled = busy;
  });
  if (busy) {
    $("progressBar").value = 0;
    $("progressText").textContent = message || "Procesando...";
  }
}

function setProgress(current, total, message) {
  $("progressBar").value = total ? Math.round((current / total) * 100) : 0;
  $("progressText").textContent = message;
}
