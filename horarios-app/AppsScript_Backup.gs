function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const spreadsheetId = payload.spreadsheetId;
    const sheetsData = payload.sheets; // Array de objetos { name: "Enero 2026", data: [[...], [...]] }

    if (!spreadsheetId) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Missing spreadsheetId" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);

    // Iterar sobre cada mes que manda el cliente
    sheetsData.forEach(sheetInfo => {
      const sheetName = sheetInfo.name;
      const matrix = sheetInfo.data;

      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        // Si no existe la pestaña para este mes, la creamos
        sheet = ss.insertSheet(sheetName);
      } else {
        // Si existe, limpiamos su contenido para sobreescribirlo fresco
        sheet.clear();
      }

      if (matrix && matrix.length > 0) {
        // Volcamos toda la matriz de golpe (súper eficiente)
        sheet.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
        
        // Dar formato básico (Negrita a la primera fila)
        sheet.getRange(1, 1, 1, matrix[0].length).setFontWeight("bold").setBackground("#f3f4f6");
        // Ajustar columnas
        sheet.autoResizeColumns(1, matrix[0].length);
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Backup completado correctamente." }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Necesario para que el Web App acepte peticiones CORS de preflight
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}
