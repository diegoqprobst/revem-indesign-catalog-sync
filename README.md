# REVEM Catalog Sync for Adobe InDesign

Plugin UXP para mantener un catalogo de Adobe InDesign sincronizado por SKU a
partir de un archivo CSV. Actualiza textos y fotografias sin reconstruir ni
perder los ajustes editoriales de cada ficha.

## Funciones

- Identifica cada ficha mediante un SKU persistente.
- Actualiza nombre, descripcion, stock y fotografia.
- Conserva las fotografias como vinculos de InDesign.
- Agrega productos nuevos desde un grupo `masterProduct`.
- Migra fichas creadas anteriormente con el script ExtendScript.
- Detecta SKU retirados sin eliminarlos automaticamente.
- Reporta imagenes ausentes y cuadros de texto desbordados.
- Incluye un modo de auditoria que no modifica el documento.

## Requisitos

- Adobe InDesign 18.5 o posterior.
- Adobe UXP Developer Tools para cargar el plugin durante el desarrollo.

## Cargar en UXP Developer Tool

1. Abre Adobe UXP Developer Tool.
2. Pulsa **Add Plugin**.
3. Selecciona `manifest.json` de esta carpeta.
4. Pulsa **Load** junto al plugin.
5. En InDesign abre el panel **Plugins > REVEM Catalogo**.

## Preparar el documento

El grupo de plantilla debe tener la etiqueta de script `masterProduct`. Dentro del
grupo, usa estas etiquetas:

- `lbl_sku`
- `lbl_name` (opcional)
- `lbl_stock`
- `lbl_desc`
- `lbl_img`

Campos opcionales para catalogos tecnicos:

- `lbl_color`
- `lbl_color_interior`
- `lbl_base`
- `lbl_material`
- `lbl_altura`
- `lbl_potencia`
- `lbl_cct`
- `lbl_voltaje`
- `lbl_diagrama`
- `lbl_fondo`
- `lbl_imagen_limpia`
- `lbl_imagen_recomendaciones`
- `lbl_codigo_recomendado`
- `lbl_recomendacion_desc`
- `lbl_logo`

El plugin reconoce tambien las fichas creadas previamente por
`GeneradorCatalogo_v2.jsx`: lee `lbl_sku` y les agrega automaticamente la identidad
persistente `revemSKU`.

## CSV

Columnas reconocidas:

- `SKU`, `Codigo` o `Código`
- `Name`, `Nombre`, `Nombre_Producto` o `Producto`
- `Description` o `Descripcion`
- `Stock` o `Cantidad`
- `Color`, `Color_interior`, `Base`, `Material`, `Altura`, `Potencia`, `CCT` y `Voltaje`
- `@Image`, `@Imagen` o `@Imagen_limpia`
- `@Diagrama`, `@Fondo`, `@imagen_recomendaciones` y `@Logo`
- `Codigo recomendado` y `Recomendacion_descripcion`

La base maestra puede mantenerse en Excel. Para usarla en el plugin, exporta la
hoja de datos como **CSV UTF-8**. Los encabezados se reconocen directamente, por
lo que no es necesario renombrar las columnas.

La imagen debe existir dentro de la carpeta de fotos seleccionada. Al colocarla,
InDesign conserva el vinculo al archivo original.

## Flujo recomendado

1. Trabaja primero sobre una copia del archivo `.indd`.
2. Selecciona el CSV.
3. Selecciona la carpeta `Assets`.
4. Ejecuta **Revisar sin modificar**.
5. Revisa el reporte de SKU e imagenes.
6. Ejecuta **Actualizar catalogo**.
7. Guarda el documento cuando hayas validado el resultado.

Antes de seleccionar datos, puedes ejecutar **Validar plantilla** para comprobar
los cuatro grupos `master_...` y listar todas las etiquetas `lbl_...` detectadas
en paginas y paginas padre.

El plugin no elimina automaticamente fichas que ya no aparecen en el CSV. Las
reporta y las marca internamente con el estado `missing-in-csv` para proteger los
ajustes editoriales.

## Privacidad

Este repositorio contiene solamente el codigo del plugin. Los documentos de
InDesign, archivos CSV, hojas de calculo y fotografias del catalogo se excluyen
del control de versiones.

## Licencia

MIT.
