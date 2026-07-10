const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

function parseShift(cell) {
    let raw = cell.trim();
    if (!raw) return null;
    
    // 1. Ignorar números puros, #REF!, #VALUE!
    if (/^\d+(\.\d+)?$/.test(raw) || raw === '#REF!' || raw === '#VALUE!') {
        return null;
    }

    // 2. Valores genéricos que mapean a Franco "F"
    const isFreeMatch = /^(f|f |libre|no|x|\?|cargado en taw)$/i;
    if (isFreeMatch.test(raw)) {
        return { slot: "F", raw };
    }

    let result = {
        slot: "",
        comentario: "",
        raw: raw
    };

    // 3. Extracción y Normalización de Franja Horaria
    const timeRegex = /(\d{1,2}(?::\d{2})?)\s*[a\-\/\.\.]\s*(\d{1,2}(?::\d{2})?)/i;
    const timeMatch = raw.match(timeRegex);
    
    if (timeMatch) {
        let start = timeMatch[1].replace(/\s/g, '');
        let end = timeMatch[2].replace(/\s/g, '');
        result.slot = `${start}a${end}`;
    }

    // 4. Mapeo por Prefijos
    if (/^(v\b|v\d|vacaciones)/i.test(raw)) {
        result.comentario = "Vacaciones";
        result.isVacation = true;
        if (!result.slot) result.slot = "v";
    }
    else if (/^(m\b|m\d|m\s+\d|medico|med\b)/i.test(raw)) {
        result.comentario = "Ausencia Médica";
        result.isSick = true;
        if (!result.slot) result.slot = "e";
    }
    else if (/^(e\b|e\d|e\s+\d|art\b)/i.test(raw)) {
        result.comentario = "Enfermedad/ART";
        result.isSick = true;
        if (!result.slot) result.slot = "e";
    }
    else if (/^(l\b|l\d|l\s+\d|lic\b|licencia)/i.test(raw)) {
        result.comentario = "Licencia";
        result.isLeave = true;
        if (!result.slot) result.slot = "licencia";
    }
    else if (/^(t\b|t\d|t\s+\d|tardanza|tard\b)/i.test(raw)) {
        result.comentario = "Llegada Tarde";
        result.hasTardiness = true;
        if (!result.slot) result.slot = raw; 
    }
    else if (/^(c\b|c\d|c\s+\d|curso)/i.test(raw)) {
        result.comentario = "Capacitación";
        result.isTraining = true;
        if (!result.slot) result.slot = raw;
    }
    else {
        if (!result.slot) {
            result.slot = raw;
        }
    }
    
    // 5. Fallback para detección de enfermedad
    if (!result.isSick && /(e\b|enfermo|m[eé]dico|art|parte|certificado)/i.test(raw)) {
        result.isSick = true;
        if (!result.comentario) result.comentario = "Enfermedad";
    }

    return result;
}

function processCSV() {
    const csvFilePath = path.join(__dirname, 'Historico.csv');
    const jsonFilePath = path.join(__dirname, 'Historico_Procesado.json');
    
    if (!fs.existsSync(csvFilePath)) {
        console.error(`No se encontró el archivo: ${csvFilePath}`);
        return;
    }

    const csvData = fs.readFileSync(csvFilePath, 'utf8');
    
    // Usamos csv-parse para no perder filas por comas en comentarios o saltos de línea internos
    const records = parse(csvData, {
        skip_empty_lines: true,
        relax_column_count: true
    });
    
    if (records.length === 0) {
        console.log("El archivo está vacío.");
        return;
    }
    
    const headers = records[0];
    const results = [];

    // Empezamos desde la línea 1 (ignorando headers)
    for (let i = 1; i < records.length; i++) {
        const cols = records[i];
        
        // Columna 0 es Legajo
        const legajo = (cols[0] || '').trim();
        
        // Validar legajo sin importar cantidad de horas o estructura
        if (!legajo || !/^\d+$/.test(legajo)) continue;
        
        const employeeData = { legajo, records: {} };
        let hasRecords = false;
        
        for (let j = 1; j < cols.length; j++) {
            const dateStr = headers[j] ? headers[j].trim() : '';
            
            // Filtros de encabezado
            if (!dateStr || dateStr.toLowerCase().startsWith('unnamed') || dateStr.includes('1900')) {
                continue;
            }
            
            const cell = cols[j] || '';
            if (!cell.trim()) continue;
            
            const parsed = parseShift(cell);
            if (parsed) {
                employeeData.records[dateStr] = parsed;
                hasRecords = true;
            }
        }
        
        if (hasRecords) {
            results.push(employeeData);
        }
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(results, null, 2));
    console.log(`Procesamiento exitoso. Se exportaron datos de ${results.length} empleados a Historico_Procesado.json.`);
}

processCSV();
