// Apps Script del Backup Drive (copia del código publicado en script.google.com).
// Los horarios se respaldan en el formato que pide Kronos ("06:00 a 14:00") y lo que no es
// horario (siglas de ausencia, comentarios, tardanzas, turno fijado) va como nota de la celda.

// Siglas de ausencia que se escriben delante del horario (E/6a14)
var SIGLAS_AUSENCIA = {
  NV: "No viene el feriado",
  E: "Enfermedad",
  LIC: "Licencia",
  ACA: "Ausente con aviso",
  ASA: "Ausente sin aviso",
  SUSP: "Suspensión",
  PG: "Permiso gremial"
};

function dosDigitos(n) {
  return ("0" + (n || 0)).slice(-2);
}

// Convierte un turno de la app al formato Kronos. Devuelve { valor, sigla }.
// "6a14" -> "06:00 a 14:00" · "E/6a14" -> "06:00 a 14:00" (sigla E) · "10a14/19a23" -> "10:00 a 14:00 / 19:00 a 23:00"
// "F" se respalda como "Franco" y "L"/"LIBRE" como "Libre"; el resto (V, una sigla sola) va tal cual.
function formatoKronos(raw) {
  var original = String(raw == null ? "" : raw).trim();
  if (!original) return { valor: "", sigla: "" };
  if (/^(f|franco)$/i.test(original)) return { valor: "Franco", sigla: "" };
  if (/^(l|libre)$/i.test(original)) return { valor: "Libre", sigla: "" };

  var resto = original;
  var sigla = "";
  var m = resto.match(/^(susp|lic|aca|asa|pg|nv|e)(?![a-z])[\/\-\s]*(.*)$/i);
  if (m) {
    sigla = m[1].toUpperCase();
    resto = m[2].trim();
  }
  if (!resto) return { valor: sigla, sigla: sigla };

  var tramos = resto.split("/");
  var salida = [];
  for (var i = 0; i < tramos.length; i++) {
    var t = tramos[i].trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(?:a|-)\s*(\d{1,2})(?::(\d{2}))?$/i);
    if (!t) return { valor: original, sigla: "" };
    salida.push(dosDigitos(t[1]) + ":" + dosDigitos(t[2]) + " a " + dosDigitos(t[3]) + ":" + dosDigitos(t[4]));
  }
  return { valor: salida.join(" / "), sigla: sigla };
}

function notaSigla(sigla) {
  if (!sigla) return "";
  var clave = sigla.toUpperCase();
  var visible = clave === "SUSP" ? "Susp" : clave; // Igual que en la app
  return SIGLAS_AUSENCIA[clave] ? visible + " – " + SIGLAS_AUSENCIA[clave] : sigla;
}

// Arma { valor, nota } de una celda a partir del turno guardado en la app
function celdaDesdeTurno(slotObj) {
  var esObjeto = typeof slotObj === "object" && slotObj !== null;
  var raw = esObjeto ? (slotObj.slot || "") : slotObj;
  var fmt = formatoKronos(raw);
  var notas = [];

  if (fmt.sigla) notas.push(notaSigla(fmt.sigla));
  if (esObjeto) {
    if (slotObj.comentario) notas.push("Comentario: " + slotObj.comentario);
    if (slotObj.tardanzaMinutosTotales) {
      notas.push("Tardanza: " + (slotObj.tardanzaTexto || slotObj.tardanzaMinutosTotales + " min"));
    }
    if (slotObj.fijado) {
      notas.push("Turno fijado a pedido del colaborador" + (slotObj.fechaFijado ? " (" + slotObj.fechaFijado + ")" : ""));
    }
    // Solo si cambió la hora (agregar una sigla al mismo horario no cuenta como cambio)
    var original = slotObj.horarioOriginal ? formatoKronos(slotObj.horarioOriginal).valor : "";
    if (original && original !== fmt.valor) {
      notas.push("Horario original: " + original);
    }
  }
  return { valor: fmt.valor, nota: notas.join("\n") };
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(data.spreadsheetId);

    var planning = data.planning || {};
    var vacations = data.vacations || [];
    var allCollabs = data.collaborators || [];
    var areaEnviada = data.area || "Disponibilidad";
    var mesesAbr = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    // 1. Fechas y nombres de hojas (ventana de 3 meses)
    var baseDate = data.timestamp ? new Date(data.timestamp + "T00:00:00") : new Date();
    var targetSheets = {};
    for (var offset = -1; offset <= 1; offset++) {
      var dOffset = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
      var sName = mesesAbr[dOffset.getMonth()] + " " + dOffset.getFullYear();
      targetSheets[sName] = {
        year: dOffset.getFullYear(),
        month: dOffset.getMonth() + 1
      };
    }

    // 2. Mapear turnos normales (valor en formato Kronos + nota con siglas y comentarios)
    var planBySheet = {};
    Object.keys(planning).forEach(function(key) {
      var parts = key.split("_");
      if (parts.length < 2) return;
      var collabId = String(parts[0]).replace(".0", "").trim();
      var dParts = parts[1].split("-");
      if (dParts.length < 3) return;

      var y = dParts[0];
      var m = parseInt(dParts[1], 10);
      var d = dParts[2];
      var sName = mesesAbr[m - 1] + " " + y;

      if (!targetSheets[sName]) return;
      if (!planBySheet[sName]) planBySheet[sName] = {};
      if (!planBySheet[sName][collabId]) planBySheet[sName][collabId] = {};

      planBySheet[sName][collabId][d + "/" + dParts[1]] = celdaDesdeTurno(planning[key]);
    });

    // 3. Mapear vacaciones ("V")
    vacations.forEach(function(vac) {
      if (!vac.colaboradorId || !vac.startDate || !vac.endDate) return;
      var cId = String(vac.colaboradorId).replace(".0", "").trim();
      var curr = new Date(vac.startDate + "T00:00:00");
      var endD = new Date(vac.endDate + "T00:00:00");

      while (curr <= endD) {
        var y = curr.getFullYear();
        var m = curr.getMonth() + 1;
        var d = ("0" + curr.getDate()).slice(-2);
        var mStr = ("0" + m).slice(-2);
        var sName = mesesAbr[m - 1] + " " + y;

        if (targetSheets[sName]) {
          if (!planBySheet[sName]) planBySheet[sName] = {};
          if (!planBySheet[sName][cId]) planBySheet[sName][cId] = {};

          var diaMesKey = d + "/" + mStr;
          var actual = planBySheet[sName][cId][diaMesKey];
          if (!actual || !actual.valor || actual.valor === "-") {
            planBySheet[sName][cId][diaMesKey] = { valor: "V", nota: actual ? actual.nota : "" };
          }
        }
        curr.setDate(curr.getDate() + 1);
      }
    });

    var totalActualizados = 0;

    // 4. Volcado a las hojas
    Object.keys(targetSheets).forEach(function(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;

      var year = targetSheets[sheetName].year;
      var month = targetSheets[sheetName].month;
      var daysInMonth = new Date(year, month, 0).getDate();

      // Encabezados de días (Fila 1)
      var maxCols = Math.max(sheet.getLastColumn(), 33);
      var headers = sheet.getRange(1, 1, 1, maxCols).getValues()[0];

      var colMap = {};
      for (var c = 2; c < headers.length; c++) {
        var hVal = headers[c];
        if (hVal) {
          var hStr = "";
          if (hVal instanceof Date) {
            hStr = ("0" + hVal.getDate()).slice(-2) + "/" + ("0" + (hVal.getMonth() + 1)).slice(-2);
          } else {
            hStr = String(hVal).trim();
            if (hStr.includes("/")) {
              var spl = hStr.split("/");
              hStr = ("0" + spl[0]).slice(-2) + "/" + ("0" + spl[1]).slice(-2);
            }
          }
          if (hStr) colMap[hStr] = c + 1;
        }
      }

      var mStr = ("0" + month).slice(-2);
      for (var dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        var dTag = ("0" + dayNum).slice(-2) + "/" + mStr;
        if (!colMap[dTag]) {
          var nextCol = Object.keys(colMap).length + 3;
          sheet.getRange(1, nextCol).setValue(dTag);
          colMap[dTag] = nextCol;
        }
      }

      // 5. Escaneo de filas existentes (valores y notas)
      var numRows = sheet.getLastRow();
      var existingData = {};
      if (numRows >= 2) {
        var gridRange = sheet.getRange(2, 1, numRows - 1, sheet.getLastColumn());
        var fullGrid = gridRange.getValues();
        var fullNotes = gridRange.getNotes();
        var currentSection = "Disponibilidad";
        for (var r = 0; r < fullGrid.length; r++) {
          var rowVal = String(fullGrid[r][0]).trim();
          if (rowVal.toUpperCase().includes("LINEA DE CAJAS") || rowVal.toUpperCase().includes("LÍNEA DE CAJAS")) {
            currentSection = "Linea de Cajas";
            continue;
          }
          if (rowVal.toUpperCase().includes("DISPONIBILIDAD") || rowVal === "Legajo") {
            currentSection = "Disponibilidad";
            continue;
          }
          if (rowVal) {
            var cid = rowVal.replace(".0", "");
            existingData[cid] = {
              legajo: cid,
              nombre: fullGrid[r][1] || "",
              area: currentSection,
              pasillo: "",
              rowValues: fullGrid[r],
              rowNotes: fullNotes[r]
            };
          }
        }
      }

      // 6. Fusionar colaboradores de la app
      allCollabs.forEach(function(c) {
        var cid = String(c.id || c.legajo || "").replace(".0", "").trim();
        if (!cid) return;
        var cArea = c.area || areaEnviada;
        var cPasillo = (c.pasillo || "").toLowerCase().trim();
        if (!existingData[cid]) {
          existingData[cid] = {
            legajo: cid,
            nombre: c.nombre || c.name || "",
            area: cArea,
            pasillo: cPasillo,
            rowValues: null,
            rowNotes: null
          };
        } else {
          existingData[cid].area = cArea;
          if (c.nombre) existingData[cid].nombre = c.nombre;
          if (cPasillo) existingData[cid].pasillo = cPasillo;
        }
      });

      // 7. Separar por grupo
      var dispoList = [];
      var cajasList = [];

      Object.keys(existingData).forEach(function(cid) {
        var item = existingData[cid];
        if (item.area === "Linea de Cajas") {
          cajasList.push(item);
        } else {
          dispoList.push(item);
        }
      });

      // Orden en Disponibilidad: Por legajo ascendente
      dispoList.sort(function(a, b) { return Number(a.legajo) - Number(b.legajo); });

      // Orden en Línea de Cajas: Cajeros primero, Rollers al final, y por legajo
      cajasList.sort(function(a, b) {
        var isRollerA = (a.pasillo || "").indexOf("roller") !== -1;
        var isRollerB = (b.pasillo || "").indexOf("roller") !== -1;

        if (!isRollerA && isRollerB) return -1;
        if (isRollerA && !isRollerB) return 1;

        return Number(a.legajo) - Number(b.legajo);
      });

      // 8. Limpiar (valores, formato y notas) y reescribir ordenado
      if (numRows >= 2) {
        sheet.getRange(2, 1, numRows - 1, sheet.getLastColumn()).clearContent().clearFormat().clearNote();
      }

      var currentRow = 2;
      var lastColCount = Math.max(sheet.getLastColumn(), 33);
      var sheetPlanning = planBySheet[sheetName] || {};

      // Escribe la fila de un colaborador: lo que ya había en la hoja (pasado a formato Kronos)
      // y encima los turnos que manda la app
      function escribirColaborador(collab) {
        sheet.getRange(currentRow, 1).setValue(collab.legajo);
        sheet.getRange(currentRow, 2).setValue(collab.nombre);
        if (collab.rowValues) {
          for (var c = 2; c < collab.rowValues.length; c++) {
            var previo = collab.rowValues[c];
            var notaPrevia = collab.rowNotes ? collab.rowNotes[c] : "";
            if (!previo && !notaPrevia) continue;
            var celda = sheet.getRange(currentRow, c + 1);
            if (previo instanceof Date) {
              celda.setValue(previo);
            } else if (previo) {
              var fmt = formatoKronos(previo);
              celda.setValue(fmt.valor);
              if (!notaPrevia && fmt.sigla) notaPrevia = notaSigla(fmt.sigla);
            }
            if (notaPrevia) celda.setNote(notaPrevia);
          }
        }
        var pDays = sheetPlanning[collab.legajo];
        if (pDays) {
          Object.keys(pDays).forEach(function(dKey) {
            var colIdx = colMap[dKey];
            if (!colIdx) return;
            var celda = sheet.getRange(currentRow, colIdx);
            celda.setValue(pDays[dKey].valor);
            celda.setNote(pDays[dKey].nota || "");
          });
        }
        currentRow++;
      }

      // Escribir DISPONIBILIDAD
      sheet.getRange(currentRow, 1).setValue("DISPONIBILIDAD");
      sheet.getRange(currentRow, 1, 1, lastColCount).setBackground("#1e293b").setFontColor("#94a3b8").setFontWeight("bold");
      currentRow++;
      dispoList.forEach(escribirColaborador);

      // Escribir LÍNEA DE CAJAS
      sheet.getRange(currentRow, 1).setValue("LÍNEA DE CAJAS");
      sheet.getRange(currentRow, 1, 1, lastColCount).setBackground("#1e293b").setFontColor("#38bdf8").setFontWeight("bold");
      currentRow++;
      cajasList.forEach(escribirColaborador);

      totalActualizados++;
    });

    return ContentService.createTextOutput("OK: Respaldo con ordenamiento por rol completado.")
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err.toString())
      .setMimeType(ContentService.MimeType.TEXT);
  }
}
