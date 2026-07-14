
    // 1. FIREBASE INITIALIZATION
    // Reemplaza con tus credenciales de Firebase
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCJZeUE4k1XHIyxQ4lRmKvlH0eHeAZky4o",
      authDomain: "crew-bb7bb.firebaseapp.com",
      projectId: "crew-bb7bb",
      storageBucket: "crew-bb7bb.firebasestorage.app",
      messagingSenderId: "613900683663",
      appId: "1:613900683663:web:f825e871a9cbb32f3ba3fa"
    };

    // Para evitar errores en este prototipo si no hay config real, 
    // usaremos un flag de mock mode si falla la conexión real.
    let db;
    let isMockMode = false;
    try {
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
    } catch (e) {
      console.warn("Firebase no configurado, operando en modo Mock.");
      isMockMode = true;
    }

    // 2. PARSING Y LÓGICA DE TURNOS
    function parseShift(val, tardanzaMinutosTotales = 0) {
      if (!val) return null;
      val = val.toString().trim().toLowerCase();
      
      if (val === 'f') return { type: 'franco', label: 'F', class: 'input-franco', hours: 0 };
      if (val === 'v') return { type: 'vacation', label: 'V', class: 'input-absence', hours: 0 };
      if (val === 'e') return { type: 'absence', label: 'E', class: 'input-absence', hours: 0 };
      if (val === 'libre' || val === 'l') return { type: 'libre', label: 'LIBRE', class: 'input-libre', hours: 0 };
      if (val === '-') return { type: 'none', label: '', class: '', hours: 0 };

      const match = val.match(/^(\d{1,2})(?::(\d{2}))?a(\d{1,2})(?::(\d{2}))?$/);
      if (match) {
        let startH = parseInt(match[1], 10);
        let startM = match[2] ? parseInt(match[2], 10) : 0;
        let endH = parseInt(match[3], 10);
        let endM = match[4] ? parseInt(match[4], 10) : 0;
        
        let totalStartMins = startH * 60 + startM + tardanzaMinutosTotales;
        startH = Math.floor(totalStartMins / 60);
        startM = totalStartMins % 60;
        
        let start = startH + (startM / 60);
        let end = endH + (endM / 60);

        if (startH >= 0 && startH <= 24 && endH >= 0 && endH <= 24) {
           let hours = end <= start ? (24 - start) + end : end - start;
           
           let startStr = startM > 0 ? `${startH}:${String(startM).padStart(2, '0')}` : `${startH}`;
           let endStr = endM > 0 ? `${endH}:${String(endM).padStart(2, '0')}` : `${endH}`;
           let formattedLabel = `${startStr}a${endStr}`;
           
           let group = null;
           if (startH >= 4 && startH <= 10) group = 'M';
           else if (startH >= 11 && startH <= 13) group = 'I';
           else if (startH >= 14 && startH <= 19) group = 'T';
           else if (startH >= 20) group = 'N';
           else if (startH < 4) group = 'E';

           return { type: 'work', label: formattedLabel, start, end, hours, class: 'input-work', group };
        }
      }
      return { type: 'error', label: val, class: 'input-error', hours: 0 };
    }

    function getShiftAbsoluteTimes(dateStr, parsedSlot) {
      if (!parsedSlot || parsedSlot.type !== 'work') return null;
      // Tratar la fecha base como local (ej: "2026-07-06T00:00:00")
      const d = new Date(dateStr + "T00:00:00");
      const startMs = d.getTime() + parsedSlot.start * 3600000;
      let endMs = d.getTime() + parsedSlot.end * 3600000;
      if (parsedSlot.end <= parsedSlot.start) {
        endMs += 24 * 3600000; // Turno cruza medianoche, fin es al día siguiente
      }
      return { start: startMs, end: endMs };
    }

    function getVacationSeason(dateStr) {
       const parts = dateStr.split('-');
       if (parts.length !== 3) return 'Mala';
       const m = parseInt(parts[1], 10);
       const d = parseInt(parts[2], 10);
       if ((m === 12 && d >= 15) || (m === 1) || (m === 2) || (m === 3 && d <= 15)) {
           return 'Buena';
       }
       return 'Mala';
    }

    // 3. ESTADO DE LA APLICACIÓN (Caché local)
    const state = {
      viewRange: 14,
      currentWeekStart: getStartOfWeek(new Date()),
      collaborators: [],
      vacations: [], // { id, collabId, startDate, endDate, weeksCount }
      planning: {}, // key: `${collabId}_${dateString}`, value: slot object or string
      exportedRows: {}, // key: collabId for this week
      holidays: [], // array of date strings 'YYYY-MM-DD'
      monthlySundaysWorked: {}, // key: collabId, value: array of dateStrings (Sundays)
    };

    // Helpers para metadatos de turnos
    function getPlanningSlot(collabId, dateStr) {
       const obj = state.planning[`${collabId}_${dateStr}`];
       if (!obj) return '';
       if (typeof obj === 'string') return obj;
       return obj.slot || '';
    }

    function getPlanningObj(collabId, dateStr) {
       const obj = state.planning[`${collabId}_${dateStr}`];
       if (!obj) return null;
       if (typeof obj === 'string') return { slot: obj };
       return obj;
    }

    // 4. MOCK DATA PARA DESARROLLO
    const mockCollaborators = [
      { id: 'C01', name: 'Ana García', hours: 48, pasillo: 'Fideos', esquema: '3x1', domingosAcordados: 1 },
      { id: 'C02', name: 'Luis Pérez', hours: 30, pasillo: 'Fideos', esquema: 'Turno Fijo T', domingosAcordados: 0 },
      { id: 'C03', name: 'Marta Gómez', hours: 48, pasillo: 'Lácteos', esquema: '1x1', domingosAcordados: 2 },
      { id: 'C04', name: 'Juan Díaz', hours: 48, pasillo: 'Lácteos', esquema: '3x1', domingosAcordados: 1 },
      { id: 'C05', name: 'Sofía Ruiz', hours: 30, pasillo: 'Limpieza', esquema: 'Cortado', domingosAcordados: 0 },
    ];

    // 5. FUNCIONES DE FECHA
    function getStartOfWeek(date) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lunes
      return new Date(d.setDate(diff));
    }
    
    function formatDate(date) {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function addDays(date, days) {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d;
    }

    function getWeekDays() {
      const days = [];
      let current = new Date(state.currentWeekStart);
      const range = state.viewRange || 7;
      for(let i=0; i<range; i++) {
        days.push(new Date(current));
        current = addDays(current, 1);
      }
      return days;
    }

    function getSundaysOfMonth(date) {
      const year = date.getFullYear();
      const month = date.getMonth();
      const sundays = [];
      let d = new Date(year, month, 1);
      while (d.getDay() !== 0) { d.setDate(d.getDate() + 1); }
      while (d.getMonth() === month) {
         sundays.push(formatDate(d));
         d.setDate(d.getDate() + 7);
      }
      return sundays;
    }

    // 6. CARGA DE DATOS (Optimizada para plan Spark)
    async function loadInitialData() {
      // Cargar feriados nacionales desde API pública (Nager Date)
      const year = new Date().getFullYear();
      try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`);
        if (!res.ok) throw new Error("API Status: " + res.status);
        const data = await res.json();
        state.holidays = data.map(h => h.date);
      } catch (e) {
        console.error("Error fetching holidays API, using fallback:", e);
        // Fallback de feriados inamovibles
        state.holidays = [
          `${year}-01-01`, `${year}-02-12`, `${year}-02-13`, `${year}-03-24`, 
          `${year}-03-29`, `${year}-04-02`, `${year}-05-01`, `${year}-05-25`, 
          `${year}-06-20`, `${year}-07-09`, `${year}-12-08`, `${year}-12-25`
        ];
      }

      if (isMockMode) {
        state.collaborators = mockCollaborators;
      } else {
        try {
          // Leer colaboradores 1 sola vez (Caché)
          const colSnap = await getDocs(collection(db, "colaboradores"));
          state.collaborators = colSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          
          const vacSnap = await getDocs(collection(db, "vacaciones"));
          state.vacations = vacSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
          console.error("Error cargando Firestore:", e);
          state.collaborators = mockCollaborators;
          state.vacations = [];
        }
      }
      
      // Llenar selectores
      const vCollabSelect = document.getElementById('vCollab');
      vCollabSelect.innerHTML = state.collaborators.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      
      const vImputacion = document.getElementById('vImputacion');
      if (vImputacion) {
          const currentY = new Date().getFullYear();
          let impHtml = '<option value="">Automático (Por Fecha)</option>';
          for (let y = currentY - 2; y <= currentY + 4; y++) {
              impHtml += `<option value="${y}">${y}</option>`;
          }
          vImputacion.innerHTML = impHtml;
      }
      
      renderSaldosVacaciones();

      // Orden por id o jerarquía para mantener estructura
      state.collaborators.sort((a, b) => a.id.localeCompare(b.id));
      
      checkLogin(); // Verificar login luego de cargar la BD

      await loadWeekPlanning();
    }

    async function loadWeekPlanning(append = false) {
      const range = state.viewRange || 7;
      
      // Calculate true bounding weeks to ensure full data for partial viewports
      const realStartD = getStartOfWeek(state.currentWeekStart);
      const realEndD = addDays(getStartOfWeek(addDays(state.currentWeekStart, range - 1)), 6);
      
      let fetchStartD = realStartD;
      
      if (append) {
         // Si estamos inyectando una semana, solo traemos los últimos 7 días del rango
         fetchStartD = addDays(realEndD, -6);
      } else {
         state.planning = {};
         state.monthlySundaysWorked = {};
      }
      
      const startStr = formatDate(fetchStartD);
      const endStr = formatDate(realEndD);
      
      const currentSunday = addDays(fetchStartD, 6);
      const monthSundays = getSundaysOfMonth(currentSunday);

      if (isMockMode) {
        // Generar mock data aleatoria sin romper reglas si es posible
      } else {
        try {
          const q = query(
            collection(db, "planificacion"), 
            where("fecha", ">=", startStr),
            where("fecha", "<=", endStr)
          );
          const snap = await getDocs(q);
          snap.forEach(doc => {
            const data = doc.data();
            state.planning[`${data.colaboradorId}_${data.fecha}`] = data;
          });

          // Fetch Sundays for the month
          if (monthSundays.length > 0) {
            const qDoms = query(collection(db, "planificacion"), where("fecha", "in", monthSundays));
            const snapDoms = await getDocs(qDoms);
            snapDoms.forEach(doc => {
              const data = doc.data();
              const parsed = parseShift(data.slot);
              if (parsed && (parsed.type === 'franco' || parsed.type === 'libre')) {
                if (!state.monthlySundaysWorked[data.colaboradorId]) state.monthlySundaysWorked[data.colaboradorId] = [];
                state.monthlySundaysWorked[data.colaboradorId].push(data.fecha);
              }
            });
          }
        } catch(e) {
          console.error("Error leyendo planificación", e);
        }
      }
      state.skeletonStartStr = null;
      renderUI();
    }

    // 7. MOTOR DE VALIDACIONES ABSOLUTAS
    function validateTurn(collabId, dateStr, parsedNewSlot) {
      if (!parsedNewSlot || parsedNewSlot.type === 'none' || parsedNewSlot.type === 'error') return { valid: true };
      
      const collab = state.collaborators.find(c => c.id === collabId);
      const targetDate = new Date(dateStr + "T00:00:00");
      
      const prevDateStr = formatDate(addDays(targetDate, -1));
      const nextDateStr = formatDate(addDays(targetDate, 1));
      
      const prevSlotKey = getPlanningSlot(collabId, prevDateStr);
      const nextSlotKey = getPlanningSlot(collabId, nextDateStr);
      
      const prevSlot = parseShift(prevSlotKey);
      const nextSlot = parseShift(nextSlotKey);

      // 7.1 Descanso Diario (>= 12h)
      if (parsedNewSlot.type === 'work' && prevSlot && prevSlot.type === 'work') {
         let currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
         let prevAbs = getShiftAbsoluteTimes(prevDateStr, prevSlot);
         if (currAbs && prevAbs) {
            let restMs = currAbs.start - prevAbs.end;
            let restH = restMs / 3600000;
            if (restH < 12) return { valid: false, type: 'legal', req: '12hs', actual: restH.toFixed(1) };
         }
      }
      if (parsedNewSlot.type === 'work' && nextSlot && nextSlot.type === 'work') {
         let currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
         let nextAbs = getShiftAbsoluteTimes(nextDateStr, nextSlot);
         if (currAbs && nextAbs) {
            let restMs = nextAbs.start - currAbs.end;
            let restH = restMs / 3600000;
            if (restH < 12) return { valid: false, type: 'legal', req: '12hs', actual: restH.toFixed(1) };
         }
      }

      // 7.2 Descanso con Franco (>= 35h)
      if (parsedNewSlot.type === 'work' && prevSlot && prevSlot.type === 'franco') {
        const prevPrevDateStr = formatDate(addDays(targetDate, -2));
        const prevPrevVal = getPlanningSlot(collabId, prevPrevDateStr);
        const prevPrevSlot = parseShift(prevPrevVal);
        if (prevPrevSlot && prevPrevSlot.type === 'work') {
           let currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
           let prevPrevAbs = getShiftAbsoluteTimes(prevPrevDateStr, prevPrevSlot);
           let restMs = currAbs.start - prevPrevAbs.end;
           let restH = restMs / 3600000;
           if (restH < 35) return { valid: false, type: 'legal', req: '35hs', actual: restH.toFixed(1) };
        }
      }
      
      if (parsedNewSlot.type === 'franco' && prevSlot && prevSlot.type === 'work' && nextSlot && nextSlot.type === 'work') {
         let prevAbs = getShiftAbsoluteTimes(prevDateStr, prevSlot);
         let nextAbs = getShiftAbsoluteTimes(nextDateStr, nextSlot);
         let restMs = nextAbs.start - prevAbs.end;
         let restH = restMs / 3600000;
         if (restH < 35) return { valid: false, type: 'legal', req: '35hs', actual: restH.toFixed(1) };
      }

      // 7.3 Lógica de Feriados: Las validaciones de francos adyacentes a feriados ahora son puramente visuales.
      // (Eliminadas las restricciones bloqueantes por pedido del usuario)

      return { valid: true };
    }

    // 8. CÁLCULO DE ABANDONO DE SECTOR
    function calculateAbandonment() {
      const days = getWeekDays().map(d => formatDate(d));
      const pasillos = [...new Set(state.collaborators.map(c => c.pasillo))];
      
      const abandonmentMap = {}; // { pasillo: { dateStr: consecutiveDays } }
      
      pasillos.forEach(pasillo => {
        abandonmentMap[pasillo] = {};
        const colIds = state.collaborators.filter(c => c.pasillo === pasillo).map(c => c.id);
        let consecutive = 0;

        days.forEach(dateStr => {
          let hasCoverage = false;
          colIds.forEach(id => {
            const val = getPlanningSlot(id, dateStr);
            const parsed = parseShift(val);
            if (parsed && parsed.type === 'work') {
              hasCoverage = true;
            }
          });

          if (!hasCoverage) {
            consecutive++;
          } else {
            consecutive = 0;
          }
          abandonmentMap[pasillo][dateStr] = consecutive;
        });
      });

      return abandonmentMap;
    }

    // 9. UI RENDERING
    function updateDynamicHours() {
      const allDays = getWeekDays();
      const startIndex = window.currentHeatmapStartIndex || 0;
      
      // 1. Identificar el día central del viewport
      const centerIndex = Math.min(startIndex + 3, allDays.length - 1);
      const centerDay = allDays[centerIndex] || allDays[0];
      
      if (!centerDay) return;
      
      // 2. Obtener el Lunes de esa semana calendario (Para las Horas)
      const weekStart = getStartOfWeek(centerDay);
      const visibleDays = [];
      for (let i = 0; i < 7; i++) {
         visibleDays.push(addDays(weekStart, i));
      }
      
      // 3. Obtener el mes calendario estricto (Para los Domingos)
      const activeYear = centerDay.getFullYear();
      const activeMonth = centerDay.getMonth();
      const daysInMonth = new Date(activeYear, activeMonth + 1, 0).getDate();
      
      const monthDays = [];
      for(let i = 1; i <= daysInMonth; i++) {
          monthDays.push(new Date(activeYear, activeMonth, i));
      }
      let monthName = centerDay.toLocaleString('es-ES', { month: 'long' });
      monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      
      state.collaborators.forEach(collab => {
          let w1Hours = 0, w2Hours = 0;
          let w1Vac = false, w2Vac = false;
          
          allDays.forEach((d, i) => {
             const dStr = formatDate(d);
             const val = getPlanningSlot(collab.id, dStr);
             const obj = getPlanningObj(collab.id, dStr) || {};
             const parsed = parseShift(val, obj.tardanzaMinutosTotales || 0);
             
             let isVac = state.vacations.some(vac => vac.colaboradorId === collab.id && dStr >= vac.startDate && dStr <= vac.endDate);
             if (i < 7) {
                 if (isVac) w1Vac = true;
                 if (parsed && parsed.type === 'work' && !w1Vac) w1Hours += parsed.hours;
             } else {
                 if (isVac) w2Vac = true;
                 if (parsed && parsed.type === 'work' && !w2Vac) w2Hours += parsed.hours;
             }
          });
          
          const renderBox = (hours, isVac, metaStr) => {
              if (isVac) return `<div class="hour-box" style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 0.65em; font-weight: bold; border: 1px solid var(--info); color: var(--info);" title="Vacaciones">V</div>`;
              let color = 'var(--danger)';
              let borderStyle = '1px solid';
              const meta = parseFloat(metaStr) || 48;
              if (hours === meta) { color = 'var(--success)'; borderStyle = '2px solid'; }
              else if (hours > meta) color = (hours <= 31) ? '#eab308' : (hours === 32 ? 'var(--success)' : 'var(--danger)');
              
              const text = Number.isInteger(hours) ? hours : hours.toFixed(1);
              return `<div class="hour-box" style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 0.65em; font-weight: bold; border: ${borderStyle} ${color}; color: ${color};" title="Meta: ${meta}h">${text}</div>`;
          };

          const w1Container = document.getElementById(`desktop-hours-w1-${collab.id}`);
          if (w1Container) w1Container.innerHTML = renderBox(w1Hours, w1Vac, collab.hours);
          
          const w2Container = document.getElementById(`desktop-hours-w2-${collab.id}`);
          if (w2Container) w2Container.innerHTML = renderBox(w2Hours, w2Vac, collab.hours);

          let tHours = 0;
          let hVacation = false;
          let hHoliday = false;
          
          visibleDays.forEach(d => {
             const dStr = formatDate(d);
             const val = getPlanningSlot(collab.id, dStr);
             const objForTardanza = getPlanningObj(collab.id, dStr) || {};
             const parsed = parseShift(val, objForTardanza.tardanzaMinutosTotales || 0);
             const isHoliday = state.holidays.includes(dStr);
             
             // Check vacations
             const targetD = new Date(dStr + "T00:00:00");
             for (let vac of state.vacations) {
                if (vac.colaboradorId === collab.id) {
                   const vacStart = new Date(vac.startDate + "T00:00:00");
                   const vacEnd = new Date(vac.endDate + "T00:00:00");
                   if (targetD >= vacStart && targetD <= vacEnd) {
                      hVacation = true;
                      break;
                   }
                }
             }
             
             if (parsed) {
                 if (parsed.type === 'work' && !hVacation) {
                     tHours += parsed.hours;
                 }
                 if (isHoliday && ['franco', 'libre'].includes(parsed.type)) {
                     hHoliday = true;
                 }
             }
          });
          
          let hoursColor = 'var(--text)';
          if (hVacation) hoursColor = 'var(--info)';
          else if (tHours < collab.hours) hoursColor = hHoliday ? 'var(--warning)' : 'var(--danger)';
          else if (tHours === collab.hours) hoursColor = 'var(--success)';
          else hoursColor = 'var(--danger)';
          
          let extraHoursHtml = '';
          if (tHours > collab.hours) {
             const extraHours = Number.isInteger(tHours - collab.hours) ? (tHours - collab.hours) : (tHours - collab.hours).toFixed(1);
             const totalStr = Number.isInteger(tHours) ? tHours : tHours.toFixed(1);
             let extraColor = (tHours <= 31) ? '#eab308' : (tHours === 32 ? 'var(--success)' : 'var(--danger)');
             
             extraHoursHtml = `
               <div style="color: ${extraColor}; font-size: 0.68rem; font-weight: 700; text-align: center; line-height: 1.1; margin-top: 2px; letter-spacing: -0.2px; white-space: nowrap;">
                 +${extraHours}h (T: ${totalStr}h)
               </div>
             `;
          }
          
          const totalStr = Number.isInteger(tHours) ? tHours : tHours.toFixed(1);
          
          // Template para Desktop (Completo)
          const desktopHtml = `
             <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; min-width: 65px; padding: 0 0.2rem; flex: 1;">
               <div style="color: ${hoursColor}; font-weight: 600; font-size: 0.8rem; white-space: nowrap;">
                 ${totalStr}h / ${collab.hours}h
               </div>
               ${extraHoursHtml}
             </div>
          `;
          
          // Template para Móvil (Tag Compacto sin salto de línea en lo posible)
          const extraTag = tHours > collab.hours ? `<span style="color:${tHours <= 31 ? '#eab308' : (tHours === 32 ? 'var(--success)' : 'var(--danger)')}; margin-left: 4px;">+${Number.isInteger(tHours - collab.hours) ? (tHours - collab.hours) : (tHours - collab.hours).toFixed(1)}h</span>` : '';
          const mobileHtml = `
             <span style="color: ${hoursColor};">${totalStr}h / ${collab.hours}h</span>${extraTag}
          `;
          
          const mobileContainer = document.getElementById(`mobile-hours-${collab.id}`);
          if (mobileContainer) mobileContainer.innerHTML = mobileHtml;
          
          const desktopContainer = document.getElementById(`desktop-hours-${collab.id}`);
          if (desktopContainer) desktopContainer.innerHTML = desktopHtml;
          
          // Actualización de Domingos Mensuales
          let restCount = 0;
          monthDays.forEach(d => {
             if (d.getDay() === 0) { // Es domingo
                 const dStr = formatDate(d);
                 const val = getPlanningSlot(collab.id, dStr);
                 const parsed = parseShift(val);
                 if (parsed && (parsed.type === 'franco' || parsed.type === 'libre')) {
                     restCount++;
                 }
             }
          });
          
          let domClass = '';
          const limit = collab.domingosAcordados || 0;
          if (limit === 0) {
             domClass = ''; // neutro
          } else if (restCount < limit) {
             domClass = 'danger'; // faltan francos dominicales
          } else if (restCount >= limit) {
             domClass = 'success'; // cumplió la cuota de francos dominicales
          }
          
          const domBadge = document.getElementById(`dom-badge-${collab.id}`);
          if (domBadge) {
             domBadge.className = `dom-badge ${domClass}`;
             domBadge.innerText = `Dom ${monthName}: ${restCount}/${limit}`;
          }
      });
    }

    function renderUI() {
      // 1. Guardar Estado Antes del Render
      const activeEl = document.activeElement;
      let focusCollab = null;
      let focusDate = null;
      if (activeEl && activeEl.classList.contains('cell-input')) {
         focusCollab = activeEl.getAttribute('data-collab');
         focusDate = activeEl.getAttribute('data-date');
      }

      const days = getWeekDays();
      
      // Header Date
      const dOptions = { day: '2-digit', month: 'short' };
      document.getElementById('weekLabel').textContent = 
        `${days[0].toLocaleDateString('es-ES', dOptions)} - ${days[days.length - 1].toLocaleDateString('es-ES', dOptions)}`;

      // Table Headers
      const trHead = document.getElementById('tableHeader');
      trHead.innerHTML = `<th>Colaborador</th>`;
      days.forEach(d => {
        const dStr = formatDate(d);
        const isHoliday = state.holidays.includes(dStr);
        const weekDaysArr = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const monthsArr = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
        const dayNumStr = String(d.getDate()).padStart(2, '0');
        const dayName = `${weekDaysArr[d.getDay()]} ${dayNumStr} ${monthsArr[d.getMonth()]}`;
        
        const thClass = isHoliday ? 'holiday-col day-column' : 'day-column';
        trHead.innerHTML += `<th class="${thClass}" style="text-align: center;">${dayName} ${isHoliday ? '<span class="holiday-badge">Feriado</span>' : ''}</th>`;
      });
      
      trHead.innerHTML += `<th>Estado / Horas</th>`;

      // Table Body
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';
      
      // 1. FILA DE TOTAL FRANCOS (Fijada arriba dentro de la tabla)
      const francoRow = document.createElement('tr');
      francoRow.className = 'fila-total-francos';
      francoRow.style.background = 'rgba(15, 23, 42, 0.95)';
      francoRow.style.borderBottom = '2px solid var(--border)';
      
      const labelCell = document.createElement('td');
      labelCell.textContent = 'Total Francos';
      labelCell.style.fontWeight = 'bold';
      labelCell.style.color = '#a855f7';
      labelCell.style.fontSize = '0.8rem';
      labelCell.style.padding = '2px 0 2px 15px';
      francoRow.appendChild(labelCell);
  
      days.forEach(d => {
          const dStr = formatDate(d);
          let francos = 0;
          state.collaborators.forEach(c => {
             const val = getPlanningSlot(c.id, dStr);
             const parsed = parseShift(val);
             if (parsed && (parsed.type === 'franco' || parsed.type === 'libre')) {
                francos++;
             }
          });
          
          const numCell = document.createElement('td');
          numCell.textContent = francos;
          numCell.style.textAlign = 'center';
          numCell.style.fontWeight = 'bold';
          numCell.style.color = '#a855f7';
          numCell.style.fontSize = '0.9rem';
          numCell.style.padding = '2px 0';
          francoRow.appendChild(numCell);
      });
  
      const emptyCell = document.createElement('td');
      francoRow.appendChild(emptyCell);
      tbody.appendChild(francoRow);
      
      const abandonmentMap = calculateAbandonment();

      // Week contains holiday?
      const weekHasHoliday = days.some(d => state.holidays.includes(formatDate(d)));

      state.collaborators.forEach(collab => {
        const tr = document.createElement('tr');
        
        
        let cellsHTML = '';
        
        // Collab info
        // Calculamos abandono máximo de la semana para este colaborador (visual global) o por día.
        // Lo haremos global para la fila.
        const maxAbandon = Math.max(...days.map(d => abandonmentMap[collab.pasillo][formatDate(d)]));
        let indClass = '';
        if (maxAbandon >= 4) indClass = 'red';
        else if (maxAbandon >= 2) indClass = 'yellow';

        const isExported = state.exportedRows[collab.id];
        
        // Sunday Tracking (Francos Dominicales) - Lógica ahora delegada a updateDynamicHours
        
        const cleanName = collab.name.split('(')[0].split('-')[0].trim();

        let html = `
          <td class="collab-cell" style="width: 260px; min-width: 260px; padding: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; height: 100%; padding: 2px 12px; box-sizing: border-box;">
              <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
                <div style="font-weight: bold; font-size: 0.75em; color: #fff; display: flex; align-items: center;">
                  <div class="indicator ${indClass}" title="Abandono Sector: ${maxAbandon} días" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; position: relative;"></div>
                  ${collab.id} ${cleanName}
                </div>
                <div class="mobile-hours-tag" id="mobile-hours-${collab.id}"></div>
                <div class="collab-meta" style="font-size: 0.7em; display: flex; align-items: center; justify-content: flex-start; gap: 0.5rem; color: var(--text-muted);">
                  <span>${collab.pasillo}</span>
                  <span style="opacity: 0.3">|</span>
                  <span id="dom-badge-${collab.id}" class="dom-badge" style="padding: 0 0.2rem; font-size: 0.7em;" title="Francos Dominicales"></span>
                </div>
              </div>
              <div id="desktop-hours-${collab.id}-left" style="display: flex; gap: 4px; padding-left: 8px;">
                 <div id="desktop-hours-w1-${collab.id}"></div>
                 <div id="desktop-hours-w2-${collab.id}"></div>
              </div>
            </div>
          </td>
        `;

        let hasHolidayAbsenceByWeek = {};
        let hasVacationThisWeekByWeek = {};
        let totalHoursByWeek = {};
        let francoCountByWeek = {};
        
        let uniqueMondays = [];
        days.forEach(d => {
            const m = formatDate(getStartOfWeek(d));
            if (!uniqueMondays.includes(m)) uniqueMondays.push(m);
        });

        uniqueMondays.forEach(mondayStr => {
            francoCountByWeek[mondayStr] = 0;
            totalHoursByWeek[mondayStr] = 0;
            hasHolidayAbsenceByWeek[mondayStr] = false;
            hasVacationThisWeekByWeek[mondayStr] = false;

            let currentD = new Date(mondayStr + "T00:00:00");
            for (let i = 0; i < 7; i++) {
                const dStr = formatDate(currentD);
                const isHoliday = state.holidays.includes(dStr);
                
                let isOnVacation = false;
                for (let vac of state.vacations) {
                   if (vac.colaboradorId === collab.id) {
                      const vacStart = new Date(vac.startDate + "T00:00:00");
                      const vacEnd = new Date(vac.endDate + "T00:00:00");
                      if (currentD >= vacStart && currentD <= vacEnd) {
                         isOnVacation = true;
                         hasVacationThisWeekByWeek[mondayStr] = true;
                         break;
                      }
                   }
                }

                let isPreVacationSunday = false;
                if (currentD.getDay() === 0 && !isOnVacation) {
                   const nextMonStr = formatDate(addDays(currentD, 1));
                   const nextTueStr = formatDate(addDays(currentD, 2));
                   for (let vac of state.vacations) {
                      if (vac.colaboradorId === collab.id) {
                         if (vac.startDate === nextMonStr) { isPreVacationSunday = true; break; }
                         if (vac.startDate === nextTueStr && state.holidays.includes(nextMonStr)) { isPreVacationSunday = true; break; }
                      }
                   }
                   if (!isPreVacationSunday) {
                       const valMon = getPlanningSlot(collab.id, nextMonStr).toLowerCase();
                       const valTue = getPlanningSlot(collab.id, nextTueStr).toLowerCase();
                       if (valMon === 'v' || valMon === 'vacaciones') isPreVacationSunday = true;
                       else if ((valTue === 'v' || valTue === 'vacaciones') && state.holidays.includes(nextMonStr)) isPreVacationSunday = true;
                   }
                }

                let val = getPlanningSlot(collab.id, dStr);
                if (isPreVacationSunday) {
                   francoCountByWeek[mondayStr]++;
                } else {
                   const objForTardanza = getPlanningObj(collab.id, dStr) || {};
                   const parsed = parseShift(val, objForTardanza.tardanzaMinutosTotales || 0);
                   if (parsed) {
                       if (parsed.type === 'work') totalHoursByWeek[mondayStr] += parsed.hours;
                       if (parsed.type === 'franco') francoCountByWeek[mondayStr]++;
                       if (isHoliday && ['franco', 'libre'].includes(parsed.type)) hasHolidayAbsenceByWeek[mondayStr] = true;
                   }
                }
                
                currentD = addDays(currentD, 1);
            }
        });
        
        // Days
        days.forEach((d, dayIndex) => {
          const mondayStr = formatDate(getStartOfWeek(d));
          const dStr = formatDate(d);
          const isHoliday = state.holidays.includes(dStr);
          
          let isOnVacation = false;
          const targetD = new Date(dStr + "T00:00:00");
          for (let vac of state.vacations) {
             if (vac.colaboradorId === collab.id) {
                const vacStart = new Date(vac.startDate + "T00:00:00");
                const vacEnd = new Date(vac.endDate + "T00:00:00");
                if (targetD >= vacStart && targetD <= vacEnd) {
                   isOnVacation = true;
                   break;
                }
             }
          }

          let isPreVacationSunday = false;
           if (d.getDay() === 0 && !isOnVacation) {
              const nextMonStr = formatDate(addDays(d, 1));
              const nextTueStr = formatDate(addDays(d, 2));
              
              // 1. Check official vacations plan (robust string match)
              for (let vac of state.vacations) {
                 if (vac.colaboradorId === collab.id) {
                    if (vac.startDate === nextMonStr) {
                       isPreVacationSunday = true; break;
                    }
                    if (vac.startDate === nextTueStr && state.holidays.includes(nextMonStr)) {
                       isPreVacationSunday = true; break;
                    }
                 }
              }

              // 2. Fallback: check grid cell directly
              if (!isPreVacationSunday) {
                  const valMon = getPlanningSlot(collab.id, nextMonStr).toLowerCase();
                  const valTue = getPlanningSlot(collab.id, nextTueStr).toLowerCase();
                  if (valMon === 'v' || valMon === 'vacaciones') {
                      isPreVacationSunday = true;
                  } else if ((valTue === 'v' || valTue === 'vacaciones') && state.holidays.includes(nextMonStr)) {
                      isPreVacationSunday = true;
                  }
              }
           }

          let val = getPlanningSlot(collab.id, dStr);
          let parsed = null;
          let inputClass = '';
          let isDisabled = false;

          let vacationTagHtml = '';

          if (isPreVacationSunday) {
             val = 'FRANCO';
             inputClass = 'input-franco-locked';
             isDisabled = true;
          } else {
             let objForTardanza = getPlanningObj(collab.id, dStr) || {};
             parsed = parseShift(val, objForTardanza.tardanzaMinutosTotales || 0);
             
             inputClass = parsed ? parsed.class : '';
             
             if (isHoliday && parsed && ['franco', 'libre', 'absence'].includes(parsed.type)) {
                inputClass += ' input-holiday-absence';
             }
             
             if (!isHoliday && parsed && parsed.type === 'franco') {
                const prevDateStr = formatDate(addDays(d, -1));
                const nextDateStr = formatDate(addDays(d, 1));
                if (state.holidays.includes(prevDateStr) || state.holidays.includes(nextDateStr)) {
                   inputClass += ' franco-warning';
                }
             }
             
             if (francoCountByWeek[mondayStr] > 1 && parsed && parsed.type === 'franco') {
                inputClass += ' franco-error';
             }

             if (isOnVacation) {
                vacationTagHtml = `<div class="vacation-tag">[V]</div>`;
                inputClass += ' vacation-active';
             }
          }

          let styleStr = '';
          if (val.length > 6) styleStr = 'font-size: 0.65rem; letter-spacing: -0.5px;';
          
          let titleAttr = '';
          let wrapperClass = 'cell-wrapper';
          let obj = getPlanningObj(collab.id, dStr);
          if (obj) {
             let hasObservation = obj.comentario || obj.tardanzaMinutosTotales;
             
             // Remove redundant comment indicator if the cell is locked for vacations
             if (isOnVacation || isPreVacationSunday) {
                 hasObservation = false;
             }

             if (hasObservation) {
                wrapperClass += ' has-comment';
                let titleParts = [];
                if (obj.tardanzaMinutosTotales) titleParts.push(`Tardanza: ${obj.tardanzaTexto || obj.tardanzaMinutosTotales}`);
                if (obj.comentario) titleParts.push(obj.comentario);
                titleAttr = `title="${titleParts.join(' | ')}"`;
             }
             if (obj.fijado) {
                wrapperClass += ' is-fixed';
                if (titleAttr) {
                   titleAttr = `title="Fijado | ${titleAttr.replace('title="', '').replace('"', '')}"`;
                } else {
                   titleAttr = `title="Turno Fijado"`;
                }
             }
          }
          
          let isSkeleton = state.skeletonStartStr && dStr >= state.skeletonStartStr;
          let finalWrapperClass = wrapperClass + (isSkeleton ? ' skeleton-cell' : '') + ' day-cell';
          let finalInputClass = inputClass + (isSkeleton ? ' skeleton-input' : '');

          html += `
            <td class="${isHoliday ? 'holiday-col' : ''} ${finalWrapperClass}" ${titleAttr} style="position: relative; ${isOnVacation ? 'background-color: rgba(14, 165, 233, 0.08);' : ''}">
              ${vacationTagHtml}
              <input type="text" class="cell-input ${finalInputClass}" style="${styleStr}" data-collab="${collab.id}" data-date="${dStr}" value="${val}" ${isDisabled ? 'disabled' : ''} placeholder="-">
            </td>
          `;
        });

        html += `
          <td class="col-estado" style="vertical-align: middle; padding: 0; min-width: 100px;">
            <div id="desktop-hours-${collab.id}" style="display:flex; flex-direction:row; justify-content:center; align-items:center; height: 100%;">
            </div>
          </td>
        `;

        tr.innerHTML = html;
        tbody.appendChild(tr);
      });

      // Counters Footer
      renderCounters(days);
      
      // Attach events
      const inputs = Array.from(document.querySelectorAll('.cell-input'));
      inputs.forEach((el, index) => {
        el.addEventListener('blur', handleInputChange);
        el.addEventListener('contextmenu', handleContextMenu);
        
        let touchTimer;
        el.addEventListener('touchstart', e => {
           if (currentRole === 'visitor') return;
           touchTimer = setTimeout(() => {
              const touch = e.touches[0];
              const mockEvent = {
                 preventDefault: () => {},
                 target: e.target,
                 pageX: touch.pageX,
                 pageY: touch.pageY
              };
              handleContextMenu(mockEvent);
           }, 500);
        }, {passive: true});
        
        el.addEventListener('touchmove', () => clearTimeout(touchTimer), {passive: true});
        el.addEventListener('touchend', () => clearTimeout(touchTimer));
        el.addEventListener('touchcancel', () => clearTimeout(touchTimer));

        el.addEventListener('focus', e => {
           if (currentRole === 'visitor') {
              requireEditor(e);
           } else {
              e.target.select();
           }
        });
        el.addEventListener('click', e => {
           if (currentRole === 'visitor') requireEditor(e);
        });
        el.addEventListener('keydown', e => {
           if (e.key === 'Enter') {
             e.preventDefault();
             e.target.blur();
           } else if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
             e.preventDefault();
             
             let nextIndex = null;
             if (e.key === 'Tab') nextIndex = e.shiftKey ? index - 1 : index + 1;
             else if (e.key === 'ArrowUp') nextIndex = index - 7;
             else if (e.key === 'ArrowDown') nextIndex = index + 7;
             else if (e.key === 'ArrowLeft') nextIndex = index - 1;
             else if (e.key === 'ArrowRight') nextIndex = index + 1;

             const nextNode = inputs[nextIndex];
             if (nextNode) {
                const targetCollab = nextNode.getAttribute('data-collab');
                const targetDate = nextNode.getAttribute('data-date');
                
                // Forzar el blur y el posible re-render síncrono ANTES de saltar
                el.blur();
                
                // Buscar el nodo en el DOM actualizado (reconstruido)
                const freshNode = document.querySelector(`.cell-input[data-collab="${targetCollab}"][data-date="${targetDate}"]`);
                if (freshNode) {
                   freshNode.focus();
                   freshNode.select();
                }
             }
           }
        });
      });

      renderHeatmap();
      updateDynamicHours(); // Llama a la actualización de horas inicial

      // 3. Restaurar Estado Después del Render
      if (focusCollab && focusDate) {
         const toFocus = document.querySelector(`.cell-input[data-collab="${focusCollab}"][data-date="${focusDate}"]`);
         if (toFocus) {
            toFocus.focus();
            toFocus.select();
         }
      }
    }

    function renderCounters(days) {      const tfoot = document.getElementById('tableFooter');
      
      let html = `<tr>
        <td>
          <div style="font-weight: bold; margin-bottom: 0.1rem;">Cobertura</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">
            M(05-10)|I(11-13)|T(14-19)|N(20-00)|E(00-04)
          </div>
        </td>`;
      
      // Franjas estándar para conteo
      const blocks = {
        'M': [5, 10],
        'I': [11, 13],
        'T': [14, 19],
        'N': [20, 24],
        'E': [0, 4]
      };

      days.forEach(d => {
        const dStr = formatDate(d);
        const counts = { 'M': 0, 'I': 0, 'T': 0, 'N': 0, 'E': 0 };

        state.collaborators.forEach(c => {
          let isOnVacationToday = false;
          const targetD = new Date(dStr + "T00:00:00");
          
          for (let vac of state.vacations) {
             if (vac.colaboradorId === c.id) {
                const vacStart = new Date(vac.startDate + "T00:00:00");
                const vacEnd = new Date(vac.endDate + "T00:00:00");
                if (targetD >= vacStart && targetD <= vacEnd) isOnVacationToday = true;
             }
          }

          if (!isOnVacationToday) {
             const objForTardanza = getPlanningObj(c.id, dStr) || {};
             const valToday = getPlanningSlot(c.id, dStr);
             const parsedToday = parseShift(valToday, objForTardanza.tardanzaMinutosTotales || 0);
             if (parsedToday && parsedToday.group && counts[parsedToday.group] !== undefined) {
                counts[parsedToday.group]++;
             }
          }
        });

        html += `
          <td>
            <div style="display: flex; justify-content: center; font-size: 0.65rem; line-height: 1.2;">
               <div style="display: flex; flex-wrap: wrap; gap: 0.15rem 0.35rem; justify-content: center; color: var(--text-muted);">
                  <div>M:<strong style="color: var(--text); margin-left:2px;">${counts['M']}</strong></div>
                  <div>I:<strong style="color: var(--text); margin-left:2px;">${counts['I']}</strong></div>
                  <div>T:<strong style="color: var(--text); margin-left:2px;">${counts['T']}</strong></div>
                  <div>N:<strong style="color: var(--text); margin-left:2px;">${counts['N']}</strong></div>
                  <div>E:<strong style="color: var(--text); margin-left:2px;">${counts['E']}</strong></div>
               </div>
            </div>
          </td>
        `;
      });
      html += `<td></td></tr>`;

      // Fila de Francos removida del footer de la tabla
      
      tfoot.innerHTML = html;
    }

    function renderHeatmap() {
      const allDays = getWeekDays();
      const startIndex = window.currentHeatmapStartIndex || 0;
      const days = allDays.slice(startIndex, startIndex + 7);
      const grid = document.getElementById('heatmapGrid');
      if (!grid) return;
      
      let html = `<div class="heatmap-row heatmap-header-row">`;
      html += `<div style="border-bottom: 1px solid rgba(255,255,255,0.05);"></div>`; // Empty corner cell
      for (let h = 0; h <= 23; h++) {
         const timeLabel = String(h).padStart(2, '0');
         html += `<div class="heatmap-header-cell" style="border-bottom: 1px solid rgba(255,255,255,0.05);">${timeLabel}h</div>`;
      }
      html += `</div>`;

      days.forEach(d => {
         const dStr = formatDate(d);
         const weekDaysArr = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
         const monthsArr = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
         const dayNumStr = String(d.getDate()).padStart(2, '0');
         const dayLabel = `${weekDaysArr[d.getDay()]} ${dayNumStr} ${monthsArr[d.getMonth()]}`;

         const prevDateStr = formatDate(addDays(d, -1));
         
         const capitalizedLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
         
         const isSkeleton = state.skeletonStartStr && dStr >= state.skeletonStartStr;
         
         html += `<div class="heatmap-row ${isSkeleton ? 'skeleton-cell' : ''}" data-date="${dStr}">`;
         html += `<div class="heatmap-row-label">${capitalizedLabel}</div>`;
         
         const hourlyCounts = {};
         for (let h = 0; h <= 23; h++) hourlyCounts[h] = 0;

         state.collaborators.forEach(c => {
            const objForTardanza = getPlanningObj(c.id, dStr) || {};
            const valToday = getPlanningSlot(c.id, dStr);
            const parsedToday = parseShift(valToday, objForTardanza.tardanzaMinutosTotales || 0);
            
            const targetDToday = new Date(dStr + "T00:00:00");
            const targetDPrev = new Date(prevDateStr + "T00:00:00");
            let isOnVacationToday = false;
            let isOnVacationPrev = false;
            for (let vac of state.vacations) {
               if (vac.colaboradorId === c.id) {
                  const vacStart = new Date(vac.startDate + "T00:00:00");
                  const vacEnd = new Date(vac.endDate + "T00:00:00");
                  if (targetDToday >= vacStart && targetDToday <= vacEnd) isOnVacationToday = true;
                  if (targetDPrev >= vacStart && targetDPrev <= vacEnd) isOnVacationPrev = true;
               }
            }

            const valPrev = getPlanningSlot(c.id, prevDateStr);
            const parsedPrev = parseShift(valPrev);

            for (let h = 0; h <= 23; h++) {
               if (!isOnVacationToday && parsedToday && parsedToday.type === 'work') {
                  if (parsedToday.end <= parsedToday.start) {
                     if (h >= parsedToday.start) hourlyCounts[h]++;
                  } else {
                     if (h >= parsedToday.start && h < parsedToday.end) hourlyCounts[h]++;
                  }
               }
               if (!isOnVacationPrev && parsedPrev && parsedPrev.type === 'work') {
                  if (parsedPrev.end <= parsedPrev.start) {
                     if (h < parsedPrev.end) hourlyCounts[h]++;
                  }
               }
            }
         });

         for (let h = 0; h <= 23; h++) {
            const count = hourlyCounts[h];
            let heatClass = 'heat-danger';
            if (count >= 3) heatClass = 'heat-success';
            else if (count >= 1) heatClass = 'heat-warning';
            
            html += `<div class="heatmap-cell ${heatClass}" title="${h}h: ${count} personas">${count}</div>`;
         }
         html += `</div>`;
      });
      
      grid.innerHTML = html;
    }


    // 10. INTERACCION Y GUARDADO
    async function handleInputChange(e) {
      const input = e.target;
      const collabId = input.getAttribute('data-collab');
      const dateStr = input.getAttribute('data-date');
      const rawValue = input.value;
      
      const parsedNew = parseShift(rawValue);
      const oldValue = getPlanningSlot(collabId, dateStr);

      if (parsedNew && parsedNew.type === 'error') {
         showToast("Error de Formato", `El turno '${rawValue}' no es válido. Usa '6a14', 'F', 'V', 'E'.`);
         input.value = oldValue; // Revert
         return;
      }

      const finalValue = parsedNew ? parsedNew.label : ''; 
      if (finalValue === oldValue) {
         input.value = finalValue; // Limpia el formato de vista
         return; 
      }

      // Check for fixed shift override
      const currentObj = getPlanningObj(collabId, dateStr);
      if (currentObj && currentObj.fijado) {
         const dateTxt = currentObj.fechaFijado || 'fecha desconocida';
         if (!confirm(`Este horario fue fijado a petición del colaborador el ${dateTxt}.\n\n¿Estás seguro de que deseas modificarlo?`)) {
            input.value = oldValue;
            return;
         }
      }

      const validation = validateTurn(collabId, dateStr, parsedNew);
      
      if (!validation.valid) {
        if (validation.type === 'legal') {
           showToast("ERROR CRÍTICO DE LEY", `No se puede asignar este horario.<br>El colaborador no cumple con las ${validation.req} de descanso obligatorio por Ley. (Descanso calculado: ${validation.actual} horas)`);
        } else {
           showToast("Restricción Violada", validation.msg);
        }
        input.value = oldValue;
        input.classList.add('input-error');
        return;
      }

      input.classList.remove('input-error');
      
      if (parsedNew && parsedNew.type === 'vacation') {
         const touchesBuena = getVacationSeason(dateStr) === 'Buena';
         if (touchesBuena) {
           const collab = state.collaborators.find(c => c.id === collabId);
           const hist = collab?.historialVacaciones || {};
           const currYear = new Date().getFullYear();
           const lastYear = currYear - 1;
           const twoYearsAgo = currYear - 2;
           if (hist[lastYear] === 'Buena' || hist[twoYearsAgo] === 'Buena') {
              showToast("Regla 2x1", `El colaborador ${collab?.name || collabId} ya tuvo temporada Buena en los últimos 2 años. Solo le corresponde temporada Mala.`);
              return;
           }
        }
      }

      // Preserve metadata
      let obj = getPlanningObj(collabId, dateStr) || {};
      obj.slot = finalValue;

      if (finalValue === '') {
        delete state.planning[`${collabId}_${dateStr}`];
      } else {
        state.planning[`${collabId}_${dateStr}`] = obj;
      }
      
      if (oldValue !== finalValue) {
         logAudit('Modificar Turno', collabId, dateStr, oldValue, finalValue);
         if (typeof window.registrarLogActividad === 'function') {
            window.registrarLogActividad(collabId, dateStr, oldValue, finalValue);
         }
      }

      // Check for multiple Francos in the real calendar week
      const targetDateObj = new Date(dateStr + "T00:00:00");
      const weekStart = getStartOfWeek(targetDateObj);
      let francoCount = 0;
      for (let i = 0; i < 7; i++) {
         const d = addDays(weekStart, i);
         const val = getPlanningSlot(collabId, formatDate(d));
         const parsed = parseShift(val);
         if (parsed && parsed.type === 'franco') francoCount++;
      }
      
      if (francoCount > 1) {
         const collabName = state.collaborators.find(c => c.id === collabId)?.name || "el colaborador";
         showToast("Error de Planificación", `El colaborador ${collabName} tiene más de un Franco asignado en esta semana calendario. Usa 'Libre' para días extra.`);
      }

      renderHeatmap(); // Update heat map in real time

      // Async save to Firestore
      if (!isMockMode) {
        try {
          const docId = `${collabId}_${dateStr}`;
          setDoc(doc(db, "planificacion", docId), {
            colaboradorId: collabId,
            fecha: dateStr,
            slot: finalValue
          }, { merge: true });
        } catch(err) {
          console.error("Error guardando:", err);
          showToast("Error de conexión", "No se pudo guardar en la base de datos.");
        }
      }
      
      renderUI();
    }

    // 12. UTILS Y EVENTOS

    function showToast(title, msg) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast show';
      toast.innerHTML = `
        <div class="toast-title">${title}</div>
        <div class="toast-desc">${msg}</div>
      `;
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 5000);
    }


    document.getElementById('prevDayBtn').addEventListener('click', () => {
      state.currentWeekStart = addDays(state.currentWeekStart, -1);
      loadWeekPlanning();
    });

    document.getElementById('prevWeekBtn').addEventListener('click', () => {
      state.currentWeekStart = addDays(state.currentWeekStart, -7);
      loadWeekPlanning();
    });

    document.getElementById('nextWeekBtn').addEventListener('click', () => {
      state.currentWeekStart = addDays(state.currentWeekStart, 7);
      loadWeekPlanning();
    });

    document.getElementById('nextDayBtn').addEventListener('click', () => {
      state.currentWeekStart = addDays(state.currentWeekStart, 1);
      loadWeekPlanning();
    });





    // 13. GESTION DE DOTACION
    const configModal = document.getElementById('configModal');
    const collabForm = document.getElementById('collabForm');

    document.getElementById('configBtn').addEventListener('click', () => {
      renderConfigModalList();
      collabForm.reset();
      document.getElementById('collabMode').value = 'add';
      document.getElementById('cLegajo').disabled = false;
      document.getElementById('cCancelBtn').style.display = 'none';
      document.getElementById('cDeleteBtn').style.display = 'none';
      document.getElementById('cSubmitBtn').innerText = 'Guardar';
      configModal.classList.add('active');
    });

    document.getElementById('closeConfigModal').addEventListener('click', () => {
      configModal.classList.remove('active');
    });

    document.getElementById('cCancelBtn').addEventListener('click', () => {
      collabForm.reset();
      document.getElementById('collabMode').value = 'add';
      document.getElementById('cLegajo').disabled = false;
      document.getElementById('cCancelBtn').style.display = 'none';
      document.getElementById('cDeleteBtn').style.display = 'none';
      document.getElementById('cSubmitBtn').innerText = 'Guardar';
    });
    
    document.getElementById('cDeleteBtn').addEventListener('click', () => {
      const id = document.getElementById('cLegajo').value;
      if (id) deleteCollab(id);
    });

    collabForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const legajo = document.getElementById('cLegajo').value.trim();
      
      const existingCollab = state.collaborators.find(c => c.id === legajo) || {};
      
      const newCollab = {
        id: legajo,
        name: document.getElementById('cName').value.trim(),
        esquema: document.getElementById('cEsquema').value.trim(),
        hours: parseInt(document.getElementById('cHours').value),
        domingosAcordados: parseInt(document.getElementById('cDoms').value),
        pasillo: document.getElementById('cPasillo').value.trim(),
        fechaAlta: document.getElementById('cFechaAlta').value
      };

      // Guardar en Firebase
      if (!isMockMode) {
        try {
          await setDoc(doc(db, "colaboradores", legajo), newCollab, { merge: true });
          logAudit(document.getElementById('collabMode').value === 'edit' ? 'Editar Colaborador' : 'Crear Colaborador', legajo, "N/A", "", newCollab.name);
        } catch(err) {
          console.error("Error al guardar colaborador", err);
          showToast("Error", "No se pudo guardar en la base de datos.");
          return;
        }
      }

      // Actualizar estado local (preservando historialVacaciones, saldoVacaciones, etc)
      const mergedCollab = { ...existingCollab, ...newCollab };
      const idx = state.collaborators.findIndex(c => c.id === legajo);
      if (idx >= 0) {
        state.collaborators[idx] = mergedCollab;
        showToast("Éxito", "Colaborador actualizado.");
      } else {
        state.collaborators.push(mergedCollab);
        showToast("Éxito", "Colaborador agregado.");
      }

      // Ordenar estrictamente por legajo de forma ascendente
      state.collaborators.sort((a, b) => a.id.localeCompare(b.id));
      
      collabForm.reset();
      document.getElementById('collabMode').value = 'add';
      document.getElementById('cLegajo').disabled = false;
      
      document.getElementById('cCancelBtn').style.display = 'none';
      document.getElementById('cDeleteBtn').style.display = 'none';
      document.getElementById('cSubmitBtn').innerText = 'Guardar';
      
      renderConfigModalList();
      renderUI(); // Renderizar DOM sin recargar
    });

    function renderConfigModalList() {
      const container = document.getElementById('collabListContainer');
      container.innerHTML = '';
      
      state.collaborators.forEach(c => {
        const div = document.createElement('div');
        div.className = 'bento-card';
        div.onclick = () => editCollab(c.id);
        
        const badgeColor = getCollabColor(c.id);
        
        div.innerHTML = `
          <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 2px;">${c.name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">ID: ${c.id}</div>
          <div style="font-size: 0.75rem;">Contrato: ${c.hours}h</div>
          <div class="bento-badge" style="background-color: ${badgeColor}33; color: ${badgeColor}; border-color: ${badgeColor}55;">
             ${c.pasillo}
          </div>
        `;
        container.appendChild(div);
      });
    }

    // Funciones globales para acceder desde el HTML inyectado
    window.editCollab = function(id) {
      const c = state.collaborators.find(x => x.id === id);
      if (!c) return;
      document.getElementById('collabMode').value = 'edit';
      const legInput = document.getElementById('cLegajo');
      legInput.value = c.id;
      legInput.disabled = true; // Bloquear edición de ID
      document.getElementById('cName').value = c.name;
      document.getElementById('cEsquema').value = c.esquema || '';
      document.getElementById('cHours').value = c.hours;
      document.getElementById('cDoms').value = c.domingosAcordados || 0;
      document.getElementById('cPasillo').value = c.pasillo;
      document.getElementById('cFechaAlta').value = c.fechaAlta || '';

      
      document.getElementById('cCancelBtn').style.display = 'block';
      document.getElementById('cDeleteBtn').style.display = 'block';
      document.getElementById('cSubmitBtn').innerText = 'Actualizar';
    }

    window.deleteCollab = async function(id) {
      if (!confirm('¿Seguro que deseas eliminar al colaborador ' + id + '?')) return;
      
      if (!isMockMode) {
        try {
          await deleteDoc(doc(db, "colaboradores", id));
        } catch(err) {
          console.error("Error al eliminar", err);
          showToast("Error", "No se pudo eliminar en la base de datos.");
          return;
        }
      }

      state.collaborators = state.collaborators.filter(c => c.id !== id);
      
      // Limpiar turnos asociados localmente para que no queden huérfanos en la UI
      Object.keys(state.planning).forEach(key => {
        if (key.startsWith(id + '_')) {
          delete state.planning[key];
        }
      });
      
      renderConfigModalList();
      renderUI(); // Renderizar DOM sin recargar
      showToast("Éxito", "Colaborador eliminado.");
    }

    // 14. MODULO ANUAL DE VACACIONES Y METRICAS
    
    let currentMetricsYear = new Date().getFullYear().toString();

    window.renderMetrics = async function() {
       const container = document.getElementById('metricsBentoGrid');
       if (!container) return;
       
       const yearSelector = document.getElementById('metricsYearSelector');
       if (yearSelector) {
          yearSelector.innerHTML = ''; // Resetear opciones
          
          let uniqueYears = new Set();
          const cy = new Date().getFullYear().toString();
          uniqueYears.add(cy); // Garantizar al menos el año actual
          
          if (state.planning) {
              Object.keys(state.planning).forEach(key => {
                  const parts = key.split('_');
                  if (parts.length > 1) {
                      const dateStr = parts[1];
                      if (dateStr) {
                          const year = dateStr.split('-')[0];
                          if (year && year.length === 4) uniqueYears.add(year);
                      }
                  }
              });
          }
          
          const yearsArr = Array.from(uniqueYears).sort((a,b) => b - a);
          
          if (!yearsArr.includes(currentMetricsYear)) currentMetricsYear = yearsArr[0];

          yearsArr.forEach(y => {
             const opt = document.createElement('option');
             opt.value = y;
             opt.text = y;
             if (y === currentMetricsYear) opt.selected = true;
             yearSelector.appendChild(opt);
          });

          yearSelector.onchange = (e) => {
             currentMetricsYear = e.target.value;
             renderMetrics();
          };
       }

       container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px; width: 100%;">Cargando métricas anuales de ${currentMetricsYear}...</div>`;

       // 1. Fetch holidays dynamically for currentMetricsYear
       try {
           const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${currentMetricsYear}/AR`);
           if (res.ok) {
               const data = await res.json();
               state.holidays = data.map(h => h.date);
           }
       } catch(e) {
           console.error("Feriados error:", e);
           state.holidays = [
             `${currentMetricsYear}-01-01`, `${currentMetricsYear}-02-12`, `${currentMetricsYear}-02-13`, `${currentMetricsYear}-03-24`, 
             `${currentMetricsYear}-03-29`, `${currentMetricsYear}-04-02`, `${currentMetricsYear}-05-01`, `${currentMetricsYear}-05-25`, 
             `${currentMetricsYear}-06-20`, `${currentMetricsYear}-07-09`, `${currentMetricsYear}-12-08`, `${currentMetricsYear}-12-25`
           ];
       }

       // 2. Fetch full year from Firestore
       try {
           if (!isMockMode) {
               const q = query(collection(db, "planificacion"), 
                   where("fecha", ">=", `${currentMetricsYear}-01-01`), 
                   where("fecha", "<=", `${currentMetricsYear}-12-31`));
               const snap = await getDocs(q);
               snap.forEach(doc => {
                   state.planning[doc.id] = doc.data();
               });
           }
       } catch(e) {
           console.error("Firestore metrics fetch error:", e);
       }

       container.innerHTML = '';
       
       const isAbsence = (text) => {
          if (!text) return false;
          const t = text.trim().toLowerCase();
          if (t === 'e') return true;
          const longKeywords = ["enfermo", "médico", "medico", "art", "parte", "certificado"];
          return longKeywords.some(kw => t.includes(kw));
       };

       const isDayOff = (text) => {
          if (!text) return false;
          const t = text.toLowerCase();
          return t === 'f' || t === 'libre' || t === 'v' || t === 'vacaciones';
       };

       const metricsData = [];

       state.collaborators.forEach(collab => {
          let tardanzaTotalMins = 0;
          let partesPegados = [];
          let cambiosSolicitados = 0;
          let feriadosTrabajados = 0;
          let feriadosLibres = 0;

          // Process all unique dates in planning to calculate metrics
          const allDates = Object.keys(state.planning)
              .filter(k => k.startsWith(collab.id + '_'))
              .map(k => k.split('_')[1])
              .filter(d => d.startsWith(currentMetricsYear))
              .sort();
          
          allDates.forEach(dateStr => {
             const docId = `${collab.id}_${dateStr}`;
             const obj = state.planning[docId];
             if (!obj) return;
             
             // a. Tardanzas
             if (obj.tardanzaMinutosTotales) {
                tardanzaTotalMins += obj.tardanzaMinutosTotales;
             }
             
             // c. Cambios Solicitados
             if (obj.fijado) {
                cambiosSolicitados++;
             }

             // b. Partes Pegados
             const val = obj.slot || '';
             const isSick = isAbsence(val) || isAbsence(obj.comentario);
             if (isSick) {
                // Ensure date object properly reflects the date string natively without timezone offset issues
                const [year, month, day] = dateStr.split('-');
                const d = new Date(year, month - 1, day);
                const prevD = formatDate(addDays(d, -1));
                const nextD = formatDate(addDays(d, 1));
                
                const objPrev = getPlanningObj(collab.id, prevD);
                const objNext = getPlanningObj(collab.id, nextD);
                const slotPrev = objPrev ? objPrev.slot : getPlanningSlot(collab.id, prevD);
                const slotNext = objNext ? objNext.slot : getPlanningSlot(collab.id, nextD);
                
                if (isDayOff(slotPrev) || isDayOff(slotNext)) {
                   partesPegados.push(dateStr);
                }
             }

             // d. Asistencia Feriados
             if (state.holidays.includes(dateStr)) {
                const isClosed = dateStr.endsWith("-01-01") || dateStr.endsWith("-05-01") || dateStr.endsWith("-12-25");
                if (!isClosed) {
                   const isFeriadoNoTrabajado = (val.toLowerCase() === 'f' || (obj.comentario && obj.comentario.includes("Feriado No Trabajado")));
                   
                   let isOnVacation = false;
                   const targetD = new Date(dateStr + "T00:00:00");
                   for (let vac of state.vacations) {
                      if (vac.colaboradorId === collab.id) {
                         const vacStart = new Date(vac.startDate + "T00:00:00");
                         const vacEnd = new Date(vac.endDate + "T00:00:00");
                         if (targetD >= vacStart && targetD <= vacEnd) { isOnVacation = true; break; }
                      }
                   }

                   if (isFeriadoNoTrabajado || isOnVacation) {
                      feriadosLibres++;
                   } else {
                      const parsed = parseShift(val);
                      if (parsed && parsed.type === 'work') {
                         feriadosTrabajados++;
                      } else if (isDayOff(val) || isAbsence(val) || isAbsence(obj.comentario) || (parsed && ['franco', 'libre', 'absence', 'vacation'].includes(parsed.type))) {
                         feriadosLibres++;
                      }
                   }
                }
             }
          });
          
          metricsData.push({
             collab,
             tardanzaTotalMins,
             partesPegados,
             cambiosSolicitados,
             feriadosTrabajados,
             feriadosLibres
          });
       });

       // SORTING: Peores a Mejores (más alertas y tardanzas primero)
       metricsData.sort((a, b) => {
          if (b.partesPegados.length !== a.partesPegados.length) {
             return b.partesPegados.length - a.partesPegados.length;
          }
          if (b.tardanzaTotalMins !== a.tardanzaTotalMins) {
             return b.tardanzaTotalMins - a.tardanzaTotalMins;
          }
          return a.collab.name.localeCompare(b.collab.name);
       });

       metricsData.forEach(data => {
          const { collab, tardanzaTotalMins, partesPegados, cambiosSolicitados, feriadosTrabajados, feriadosLibres } = data;

          // Crear UI para colaborador
          const tardanzaHs = (tardanzaTotalMins / 60).toFixed(1);
          const ratioFeriados = feriadosTrabajados + feriadosLibres > 0 
             ? Math.round((feriadosTrabajados / (feriadosTrabajados + feriadosLibres)) * 100) 
             : 0;

          let alertsHtml = partesPegados.map(p => `<div style="font-size: 0.75rem; color: var(--danger); margin-bottom: 2px;">⚠ Parte el ${p.substring(8,10)}/${p.substring(5,7)} pegado a Franco</div>`).join('');
          
          const card = document.createElement('div');
          card.style = `background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;`;
          card.onmouseover = () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 6px 12px rgba(0,0,0,0.3)'; };
          card.onmouseout = () => { card.style.transform = 'translateY(0)'; card.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'; };
          card.onclick = () => openMetricsDetail(collab.id);
          
          card.innerHTML = `
            <div style="font-weight: bold; font-size: 1.1rem; color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 4px; display: flex; justify-content: space-between; align-items: baseline;">
               <span>${collab.name.split('(')[0].trim()}</span>
               <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">Leg: ${collab.id}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Tardanza Total</div>
                  <div style="font-size: 1rem; font-weight: bold; color: ${tardanzaTotalMins > 0 ? 'var(--warning)' : 'var(--success)'};">${tardanzaTotalMins} min <span style="font-size: 0.7rem; font-weight: normal;">(${tardanzaHs}h)</span></div>
               </div>
               
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Turnos Fijados</div>
                  <div style="font-size: 1rem; font-weight: bold; color: var(--text);">${cambiosSolicitados}</div>
               </div>
               
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border); grid-column: span 2;">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Presentismo en Feriados</div>
                  <div style="font-size: 1rem; font-weight: bold; color: var(--text);">${feriadosTrabajados} trab. / ${feriadosLibres} lib. <span style="font-size: 0.8rem; font-weight: normal; color: var(--info);">(${ratioFeriados}%)</span></div>
               </div>
            </div>
            
            ${partesPegados.length > 0 ? `
            <div style="margin-top: 4px; background: rgba(225, 29, 72, 0.1); border: 1px solid rgba(225, 29, 72, 0.3); padding: 8px; border-radius: 6px;">
               <div style="font-size: 0.75rem; font-weight: bold; color: var(--danger); margin-bottom: 4px;">Alertas de Auditoría:</div>
               ${alertsHtml}
            </div>` : `
            <div style="margin-top: 4px; font-size: 0.75rem; color: var(--success); text-align: center; padding: 4px; border: 1px dashed var(--border); border-radius: 6px;">
               ✓ Sin alertas de ausentismo estratégico
            </div>
            `}
          `;
          
          container.appendChild(card);
       });
    };

    window.openMetricsDetail = async function(collabId) {
       const collab = state.collaborators.find(c => c.id === collabId);
       if (!collab) return;

       document.getElementById('metricsDetailTitle').innerHTML = `${collab.name.split('(')[0].trim()} <span style="font-size: 0.9rem; color: var(--text-muted); font-weight: normal;">(Legajo: ${collab.id})</span>`;
       const content = document.getElementById('metricsDetailContent');
       content.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px; width: 100%;">Cargando historial completo...</div>`;

       // Fetch employee full history from Firestore
       try {
           if (!isMockMode) {
               const q = query(collection(db, "planificacion"), where("colaboradorId", "==", collabId));
               const snap = await getDocs(q);
               snap.forEach(doc => {
                   state.planning[doc.id] = doc.data();
               });
           }
       } catch(e) {
           console.error("Firestore history fetch error:", e);
       }

       const isAbsence = (text) => {
          if (!text) return false;
          const t = text.trim().toLowerCase();
          if (t === 'e') return true;
          const longKeywords = ["enfermo", "médico", "medico", "art", "parte", "certificado"];
          return longKeywords.some(kw => t.includes(kw));
       };
       const isDayOff = (text) => text && ['f', 'libre', 'v', 'vacaciones'].includes(text.toLowerCase());

       const allDates = Object.keys(state.planning)
           .filter(k => k.startsWith(collabId + '_'))
           .map(k => k.split('_')[1])
           .sort();

       // Fetch holidays for all unique years in history
       const uniqueYears = Array.from(new Set(allDates.map(d => d.substring(0, 4))));
       const holidayFetches = uniqueYears.map(async y => {
           try {
               const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/AR`);
               if (res.ok) {
                   const data = await res.json();
                   data.forEach(h => {
                       if (!state.holidays.includes(h.date)) state.holidays.push(h.date);
                   });
               }
           } catch(e) {
               console.error(`Feriados error ${y}:`, e);
           }
       });
       await Promise.all(holidayFetches);

       content.innerHTML = '';

       // Agrupar por año y luego por mes
       const historyData = {};

       allDates.forEach(dateStr => {
          const docId = `${collabId}_${dateStr}`;
          const obj = state.planning[docId];
          if (!obj) return;

          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(5, 7);
          
          if (!historyData[year]) historyData[year] = {};
          if (!historyData[year][month]) historyData[year][month] = { tardanza: 0, alertas: [], ausencias: 0, feriadosTrab: 0 };
          
          const monthData = historyData[year][month];

          if (obj.tardanzaMinutosTotales) monthData.tardanza += obj.tardanzaMinutosTotales;

          const val = obj.slot || '';
          const isSick = isAbsence(val) || isAbsence(obj.comentario);
          if (isSick) {
             monthData.ausencias++;

             const [y, m, dNum] = dateStr.split('-');
             const d = new Date(y, m - 1, dNum);
             const prevD = formatDate(addDays(d, -1));
             const nextD = formatDate(addDays(d, 1));
             
             const objPrev = getPlanningObj(collab.id, prevD);
             const objNext = getPlanningObj(collab.id, nextD);
             const slotPrev = objPrev ? objPrev.slot : getPlanningSlot(collab.id, prevD);
             const slotNext = objNext ? objNext.slot : getPlanningSlot(collab.id, nextD);
             
             if (isDayOff(slotPrev) || isDayOff(slotNext)) {
                let msg = '';
                if (isDayOff(slotPrev) && isDayOff(slotNext)) msg = `previo al ${prevD.substring(8,10)}/${prevD.substring(5,7)} y posterior al ${nextD.substring(8,10)}/${nextD.substring(5,7)}`;
                else if (isDayOff(slotPrev)) msg = `posterior al Franco del ${prevD.substring(8,10)}/${prevD.substring(5,7)}`;
                else msg = `previo al Franco del ${nextD.substring(8,10)}/${nextD.substring(5,7)}`;
                
                monthData.alertas.push({ date: dateStr, desc: msg });
             }
          }

          if (state.holidays.includes(dateStr)) {
             const isClosed = dateStr.endsWith("-01-01") || dateStr.endsWith("-05-01") || dateStr.endsWith("-12-25");
             if (!isClosed) {
                 const isFeriadoNoTrabajado = (val.toLowerCase() === 'f' || (obj.comentario && obj.comentario.includes("Feriado No Trabajado")));
                 
                 let isOnVacation = false;
                 const targetD = new Date(dateStr + "T00:00:00");
                 for (let vac of state.vacations) {
                    if (vac.colaboradorId === collab.id) {
                       const vacStart = new Date(vac.startDate + "T00:00:00");
                       const vacEnd = new Date(vac.endDate + "T00:00:00");
                       if (targetD >= vacStart && targetD <= vacEnd) { isOnVacation = true; break; }
                    }
                 }

                 const parsed = parseShift(val);
                 if (!isFeriadoNoTrabajado && !isOnVacation && parsed && parsed.type === 'work') monthData.feriadosTrab++;
             }
          }
       });

       const sortedYears = Object.keys(historyData).sort((a, b) => b - a);

       if (sortedYears.length === 0) {
          content.innerHTML = `<p style="color: var(--text-muted); text-align: center; margin-top: 40px;">No hay registros históricos para este colaborador.</p>`;
       }

       const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

       sortedYears.forEach(year => {
          let yearTardanza = 0;
          let yearAlertas = 0;

          const monthsContent = Object.keys(historyData[year]).sort((a,b)=>b-a).map(month => {
             const md = historyData[year][month];
             yearTardanza += md.tardanza;
             yearAlertas += md.alertas.length;

             let alertList = md.alertas.map(a => `<div style="color: var(--danger); font-size: 0.8rem; margin-top: 2px;">• ${a.date.substring(8,10)}/${a.date.substring(5,7)} (${a.desc})</div>`).join('');

             return `
                <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                   <h4 style="margin: 0 0 10px 0; color: var(--text); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">${monthNames[parseInt(month)-1]} ${year}</h4>
                   <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                      <div>
                         <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Enfermedad</div>
                         <div style="font-size: 1rem; font-weight: bold;">${md.ausencias} ${md.ausencias===1?'día':'días'}</div>
                      </div>
                      <div>
                         <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Tardanza</div>
                         <div style="font-size: 1rem; font-weight: bold; color: ${md.tardanza > 0 ? 'var(--warning)' : 'var(--text)'};">${md.tardanza} min</div>
                      </div>
                      <div style="grid-column: span 2;">
                         <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Partes Pegados</div>
                         <div style="font-size: 1rem; font-weight: bold; color: ${md.alertas.length > 0 ? 'var(--danger)' : 'var(--success)'};">${md.alertas.length} alertas</div>
                         ${alertList}
                      </div>
                      <div>
                         <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Feriados Trab.</div>
                         <div style="font-size: 1rem; font-weight: bold;">${md.feriadosTrab}</div>
                      </div>
                   </div>
                </div>
             `;
          }).join('');

          const yearBlock = document.createElement('div');
          yearBlock.innerHTML = `
             <div style="background: rgba(30,41,59,0.5); padding: 10px 15px; border-radius: 6px; border-left: 4px solid var(--primary); margin-bottom: 15px;">
                <h3 style="margin: 0; color: white;">AÑO CALENDARIO ${year}</h3>
                <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">Totales: ${yearTardanza} min de tardanza, ${yearAlertas} alertas de auditoría</p>
             </div>
             <div style="padding-left: 10px;">
                ${monthsContent}
             </div>
          `;
          content.appendChild(yearBlock);
       });

       document.getElementById('metricsDetailModal').style.display = 'flex';
    };

    window.switchTab = function(tabId) {
      document.querySelectorAll('.app-tab-btn').forEach(b => b.classList.remove('active'));
      
      const btn = document.getElementById(tabId === 'horarios' ? 'tabHorarios' : (tabId === 'vacaciones' ? 'vacationTabBtn' : 'metricsTabBtn'));
      if (btn) btn.classList.add('active');
      
      const seccionHorarios = document.getElementById('seccionHorarios');
      const seccionVacaciones = document.getElementById('seccionVacaciones');
      const seccionMetricas = document.getElementById('seccionMetricas');
      
      if (seccionHorarios) seccionHorarios.style.display = 'none';
      if (seccionVacaciones) seccionVacaciones.style.display = 'none';
      if (seccionMetricas) seccionMetricas.style.display = 'none';

      if (tabId === 'vacaciones') {
          if (seccionVacaciones) seccionVacaciones.style.display = 'flex';
          renderVacationTable();
      } else if (tabId === 'metricas') {
          if (seccionMetricas) seccionMetricas.style.display = 'block';
          renderMetrics();
      } else if (tabId === 'horarios') {
          if (seccionHorarios) seccionHorarios.style.display = 'flex';
          renderUI();
      }
    };

    const collabColors = [
      '#00d2ff', '#00e676', '#ff9100', '#ffd600',
      '#ff4081', '#00e5ff', '#b200ff', '#ff5252'
    ];
    
    function getContrastColor(hex) {
       if (hex.indexOf('#') === 0) hex = hex.slice(1);
       if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
       const r = parseInt(hex.slice(0, 2), 16);
       const g = parseInt(hex.slice(2, 4), 16);
       const b = parseInt(hex.slice(4, 6), 16);
       return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000000' : '#ffffff';
    }
    
    function getCollabColor(id) {
       const sortedVacations = [...state.vacations].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
       const uniqueIdsInOrder = [...new Set(sortedVacations.map(v => v.colaboradorId))];
       let index = uniqueIdsInOrder.indexOf(id);
       if (index === -1) {
           const allIds = state.collaborators.map(c => c.id).sort();
           index = allIds.indexOf(id);
           if (index === -1) index = 0;
       }
       return collabColors[index % collabColors.length];
    }

    function getVacationYear(v) {
        if (v.imputacionAnio) return parseInt(v.imputacionAnio, 10);
        const vStart = new Date(v.startDate + "T00:00:00");
        let y = vStart.getFullYear();
        if (vStart.getMonth() < 9) y -= 1;
        return y;
    }

    window.exportVacationsCSV = function() {
        const filterSelect = document.getElementById('vFilterYear');
        const selectedYear = filterSelect ? filterSelect.value : 'Todos';
        
        let filteredVacations = state.vacations;
        if (selectedYear !== 'Todos') {
            filteredVacations = state.vacations.filter(v => getVacationYear(v).toString() === selectedYear);
        }
        
        filteredVacations.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
        let csvContent = "\uFEFF"; 
        csvContent += "Legajo;Apellido y Nombre;Año Imputación;Fecha Inicio;Fecha Fin;Total Días\n";
        
        filteredVacations.forEach(v => {
            const collab = state.collaborators.find(c => c.id === v.colaboradorId);
            let cName = v.colaboradorId;
            if (collab) {
                const parts = collab.name.split('(')[0].trim().split(' ');
                cName = parts.length > 1 ? `${parts[0]}, ${parts.slice(1).join(' ')}` : parts[0];
            }
            
            const totalDays = Math.ceil(Math.abs(new Date(v.endDate + "T00:00:00") - new Date(v.startDate + "T00:00:00")) / (1000 * 60 * 60 * 24)) + 1;
            const formatDDMMYYYY = (d) => d ? d.split('-').reverse().join('-') : d;
            
            csvContent += `${v.colaboradorId};"${cName}";${getVacationYear(v)};${formatDDMMYYYY(v.startDate)};${formatDDMMYYYY(v.endDate)};${totalDays}\n`;
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Vacaciones_RRHH_${selectedYear}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    let isVFilterPopulated = false;

    window.renderVacationTable = function renderVacationTable() {
       const tbody = document.getElementById('vacationTableBody');
       if (!tbody) return;
       tbody.innerHTML = '';
       
       const filterSelect = document.getElementById('vFilterYear');
       const currentSelection = filterSelect ? filterSelect.value : 'Todos';
       
       if (filterSelect) {
           const years = [...new Set(state.vacations.map(v => getVacationYear(v)))].sort((a,b) => b - a);
           let currentYear = new Date().getFullYear();
           let optionsHtml = '<option value="Todos">Todos</option>';
           years.forEach(y => {
               optionsHtml += `<option value="${y}">${y}</option>`;
           });
           filterSelect.innerHTML = optionsHtml;
           
           if (!isVFilterPopulated) {
               if (years.includes(currentYear)) {
                   filterSelect.value = currentYear.toString();
               } else if (years.length > 0) {
                   filterSelect.value = years.includes(currentYear + 1) ? (currentYear + 1).toString() : years[0].toString();
               }
               isVFilterPopulated = true;
           } else {
               filterSelect.value = currentSelection;
           }
       }
       
       const selectedYear = filterSelect ? filterSelect.value : 'Todos';
       let filteredVacations = state.vacations;
       if (selectedYear !== 'Todos') {
           filteredVacations = state.vacations.filter(v => getVacationYear(v).toString() === selectedYear);
       }
       
       filteredVacations.sort((a, b) => new Date(a.startDate) - new Date(b.startDate)).forEach(v => {
          const collab = state.collaborators.find(c => c.id === v.colaboradorId);
          const cName = collab ? collab.name : v.colaboradorId;
          const color = getCollabColor(v.colaboradorId);
          
          const tr = document.createElement('tr');
          tr.style.borderBottom = "1px solid var(--border)";
          const formatDDMMYYYY = (d) => d ? d.split('-').reverse().join('-') : d;
          tr.innerHTML = `
            <td style="padding: 6px 8px; display: flex; align-items: center; gap: 0.5rem;">
               <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${color};"></span>
               <span><strong>${v.colaboradorId}</strong> - ${cName}</span>
            </td>
            <td style="padding: 6px 8px;">${formatDDMMYYYY(v.startDate)}</td>
            <td style="padding: 6px 8px;">${v.weeksCount} Sem.</td>
            <td style="padding: 6px 8px;">
               <button type="button" style="padding: 2px 6px; font-size: 0.75rem; margin-right: 4px; border-radius: 4px;" onclick="editVacation('${v.id}')">Editar</button>
               <button type="button" class="btn-danger" style="padding: 2px 6px; font-size: 0.75rem; border-radius: 4px;" onclick="deleteVacation('${v.id}')">Eliminar</button>
            </td>
          `;
          tbody.appendChild(tr);
       });
       
       if (document.getElementById('seccionVacaciones').style.display !== 'none') {
          renderVacationCalendar();
       }
    }

    window.editVacation = function(id) {
       const v = state.vacations.find(x => x.id === id);
       if (!v) return;
       document.getElementById('vEditId').value = v.id;
       document.getElementById('vCollab').value = v.colaboradorId;
       document.getElementById('vStartDate').value = v.startDate;
       document.getElementById('vWeeks').value = v.weeksCount;
       if (v.imputacionAnio) {
           document.getElementById('vImputacion').value = v.imputacionAnio;
       } else {
           document.getElementById('vImputacion').value = "";
       }
       
       document.getElementById('vFormTitle').innerText = 'Editar Vacaciones';
       document.getElementById('vSubmitBtn').innerText = 'Actualizar Periodo';
       document.getElementById('vCancelBtn').style.display = 'block';
    };

    document.getElementById('vCancelBtn').addEventListener('click', () => {
       document.getElementById('vacationForm').reset();
       document.getElementById('vEditId').value = '';
       document.getElementById('vImputacion').value = '';
       document.getElementById('vFormTitle').innerText = 'Registrar Vacaciones';
       document.getElementById('vSubmitBtn').innerText = 'Guardar Periodo';
       document.getElementById('vCancelBtn').style.display = 'none';
       renderSaldosVacaciones();
    });

    document.getElementById('vCollab').addEventListener('change', renderSaldosVacaciones);

    document.getElementById('vStartDate').addEventListener('change', (e) => {
        if (!e.target.value) return;
        const vStart = new Date(e.target.value + "T00:00:00");
        let yearOfVacation = vStart.getFullYear();
        if (vStart.getMonth() < 9) {
            yearOfVacation -= 1;
        }
        const vImputacion = document.getElementById('vImputacion');
        if (vImputacion && vImputacion.value === "") {
            vImputacion.value = yearOfVacation;
        }
    });

    function calcularDiasTomados(collabId, año) {
        let diasTomados = 0;
        state.vacations.forEach(v => {
            if (v.colaboradorId === collabId) {
                const vStart = new Date(v.startDate + "T00:00:00");
                const vEnd = new Date(v.endDate + "T00:00:00");
                
                let yearOfVacation = v.imputacionAnio;
                if (!yearOfVacation) {
                    yearOfVacation = vStart.getFullYear();
                    if (vStart.getMonth() < 9) {
                        yearOfVacation -= 1;
                    }
                }
                
                if (yearOfVacation === año) {
                    const diffDays = Math.ceil(Math.abs(vEnd - vStart) / (1000 * 60 * 60 * 24)) + 1;
                    diasTomados += diffDays;
                }
            }
        });
        return diasTomados;
    }

    async function autoSaveSaldos(collabId) {
       const collab = state.collaborators.find(c => c.id === collabId);
       if (!collab) return;
       
       if (!collab.saldosVacaciones) collab.saldosVacaciones = {};
       
       const container = document.getElementById('saldosVacacionesContainer');
       const years = Array.from(container.querySelectorAll('.saldo-year-row'));
       
       years.forEach(row => {
           const y = row.dataset.year;
           const tipo = row.querySelector('.saldo-tipo').value;
           const asignados = parseInt(row.querySelector('.saldo-asignados').value, 10) || 0;
           const disp = parseInt(row.querySelector('.saldo-disponibles').innerText, 10) || 0;
           
           if (!collab.saldosVacaciones[y]) collab.saldosVacaciones[y] = {};
           collab.saldosVacaciones[y].periodoTipo = tipo;
           collab.saldosVacaciones[y].diasAsignados = asignados;
           collab.saldosVacaciones[y].diasDisponibles = disp;
       });
       
       if (!isMockMode) {
          try {
             await updateDoc(doc(db, "colaboradores", collabId), { saldosVacaciones: collab.saldosVacaciones });
          } catch(e) {
             console.error("Error auto-saving saldos:", e);
          }
       }
    }

    function renderSaldosVacaciones() {
       const collabId = document.getElementById('vCollab').value;
       const container = document.getElementById('saldosVacacionesContainer');
       if (!collabId) {
          container.innerHTML = '';
          return;
       }
       
       const collab = state.collaborators.find(c => c.id === collabId);
       if (!collab) return;
       
       let maxYear = new Date().getFullYear();
       let minYear = maxYear - 3;
       if (collab.saldosVacaciones) {
           const savedYears = Object.keys(collab.saldosVacaciones).map(y => parseInt(y, 10));
           if (savedYears.length > 0) {
               maxYear = Math.max(maxYear, ...savedYears);
               const actualMin = Math.min(...savedYears);
               if (actualMin < minYear) {
                   minYear = actualMin;
               }
           }
       }

       let html = `
          <!-- Columna Izquierda: Años -->
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
             <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
                <div style="font-size: 0.75rem; font-weight: 600; color: var(--text);">Gestión de Saldos y Temporadas</div>
                <div style="display: flex; gap: 4px;">
                   <button type="button" id="removeYearBtn" title="Eliminar año superior" style="background: var(--danger); color: white; border: none; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1rem; line-height: 1;">-</button>
                   <button type="button" id="addNextYearBtn" title="Agregar año siguiente" style="background: var(--primary); color: white; border: none; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1rem; line-height: 1;">+</button>
                </div>
             </div>
             
             <!-- Contenedor scrolleable de años -->
             <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 200px; overflow-y: auto; padding-right: 4px;">
       `;
       
       // Show years from maxYear down to minYear
       for (let y = maxYear; y >= minYear; y--) {
          
          let tipo = 'N/A';
          let asignados = 0;
          let calculatedLawDays = calcularDiasVacacionesLey(collab.fechaAlta, y);
          
          if (collab.saldosVacaciones && collab.saldosVacaciones[y]) {
              tipo = collab.saldosVacaciones[y].periodoTipo || 'N/A';
              asignados = collab.saldosVacaciones[y].diasAsignados;
              if (asignados === undefined || isNaN(asignados)) asignados = calculatedLawDays;
          } else {
              if (collab.historialVacaciones && collab.historialVacaciones[y]) {
                  tipo = collab.historialVacaciones[y];
              }
              asignados = calculatedLawDays;
          }
          
          const tomados = calcularDiasTomados(collabId, y);
          const disponibles = asignados - tomados;
          
          let colorCls = '';
          let fw = '';
          if (disponibles === 0 && asignados > 0) colorCls = 'var(--success)';
          else if (disponibles < 0) { colorCls = 'var(--danger)'; fw = 'bold'; }
          
          html += `
             <div class="saldo-year-row" data-year="${y}" style="display: flex; gap: 0.5rem; align-items: center; background: rgba(255,255,255,0.02); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="width: 35px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">${y}</div>
                <select class="saldo-tipo" style="flex: 1; padding: 2px; font-size: 0.75rem; background: var(--background); color: var(--text); border: 1px solid var(--border); border-radius: 2px;">
                   <option value="N/A" ${tipo === 'N/A' ? 'selected' : ''}>N/A</option>
                   <option value="Buena" ${tipo === 'Buena' ? 'selected' : ''}>B (Buena)</option>
                   <option value="Mala" ${tipo === 'Mala' ? 'selected' : ''}>M (Mala)</option>
                </select>
                <div style="display: flex; flex-direction: column; align-items: center; width: 60px;">
                   <label style="font-size: 0.55rem; color: var(--text-muted); margin-bottom: 2px;">Asignados</label>
                   <input type="number" class="saldo-asignados" data-law-days="${calculatedLawDays}" value="${asignados}" min="0" style="width: 100%; padding: 2px; font-size: 0.75rem; text-align: center; background: var(--background); color: var(--text); border: 1px solid var(--border); border-radius: 2px;">
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; width: 60px;">
                   <label style="font-size: 0.55rem; color: var(--text-muted); margin-bottom: 2px;">Disponibles</label>
                   <div class="saldo-disponibles" style="font-size: 0.85rem; color: ${colorCls}; font-weight: ${fw};">${disponibles}</div>
                </div>
             </div>
          `;
       }
       
       // Calcular historial automático
       const historyByYear = {};
       state.vacations.forEach(v => {
          if (v.colaboradorId === collabId) {
             const vStart = new Date(v.startDate + "T00:00:00");
             const vEnd = new Date(v.endDate + "T00:00:00");
             
             let yearOfVacation = v.imputacionAnio;
             if (!yearOfVacation) {
                 yearOfVacation = vStart.getFullYear();
                 if (vStart.getMonth() < 9) {
                     yearOfVacation -= 1;
                 }
             }
             
             if (!historyByYear[yearOfVacation]) {
                 historyByYear[yearOfVacation] = [];
             }
             
             const diffDays = Math.ceil(Math.abs(vEnd - vStart) / (1000 * 60 * 60 * 24)) + 1;
             
             historyByYear[yearOfVacation].push({
                 start: vStart,
                 end: vEnd,
                 days: diffDays
             });
          }
       });
       
       let historyHtml = '';
       const historyYears = Object.keys(historyByYear).sort((a, b) => b - a);
       
       if (historyYears.length === 0) {
           historyHtml = '<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Sin vacaciones aprobadas registradas.</div>';
       } else {
           historyYears.forEach(y => {
               historyByYear[y].sort((a, b) => a.start - b.start);
               
               let tipoStr = 'N/A';
               if (collab.saldosVacaciones && collab.saldosVacaciones[y]) {
                   tipoStr = collab.saldosVacaciones[y].periodoTipo || 'N/A';
               } else if (collab.historialVacaciones && collab.historialVacaciones[y]) {
                   tipoStr = collab.historialVacaciones[y] || 'N/A';
               }
               if (tipoStr === 'Mala') tipoStr = 'Malas';
               if (tipoStr === 'Buena') tipoStr = 'Buenas';

               const periodsStr = historyByYear[y].map(p => {
                   const sDay = String(p.start.getDate()).padStart(2, '0');
                   const sMonth = String(p.start.getMonth()+1).padStart(2, '0');
                   const sYear = String(p.start.getFullYear()).slice(-2);
                   const sStr = `${sDay}-${sMonth}/${sYear}`;
                   
                   const eDay = String(p.end.getDate()).padStart(2, '0');
                   const eMonth = String(p.end.getMonth()+1).padStart(2, '0');
                   const eYear = String(p.end.getFullYear()).slice(-2);
                   const eStr = `${eDay}-${eMonth}/${eYear}`;
                   
                   return `${p.days} dias: del ${sStr} al ${eStr} |`;
               }).join('<br>');
               
               historyHtml += `<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4;">
                   <strong>${y} | ${tipoStr} |</strong><br>
                   ${periodsStr}
               </div>`;
           });
       }
       
       html += `
             </div>
          </div>
       `;
       
       if (container) container.innerHTML = html;
       
       const containerHistorial = document.getElementById('historialVacacionesContainer');
       if (containerHistorial) {
           containerHistorial.innerHTML = historyHtml;
       }
       
       if (container) container.querySelectorAll('.saldo-tipo, .saldo-asignados').forEach(el => {
          el.addEventListener('change', (e) => {
             const row = e.target.closest('.saldo-year-row');
             const y = parseInt(row.dataset.year, 10);
             const asignadosInput = row.querySelector('.saldo-asignados');
             const asignados = parseInt(asignadosInput.value, 10) || 0;
             
             if (e.target.classList.contains('saldo-asignados')) {
                 const lawDays = parseInt(asignadosInput.dataset.lawDays, 10);
                 if (lawDays > 0 && asignados !== lawDays) {
                     const confirmed = confirm(`Atención: Estás modificando los días de vacaciones calculados por Ley. El valor original era de ${lawDays} días.\n\n¿Deseas confirmar el cambio manual?`);
                     if (!confirmed) {
                         asignadosInput.value = lawDays; // revert
                         return; // do not save
                     } else {
                         // Send audit log!
                         if (typeof logAudit === 'function') {
                             logAudit('Modificación manual días vacaciones', collabId, `${lawDays} días (Ley)`, `${asignados} días (Manual)`, collab.name);
                         }
                     }
                 }
             }

             const tomados = calcularDiasTomados(collabId, y);
             const disponibles = asignados - tomados;
             
             const dispEl = row.querySelector('.saldo-disponibles');
             dispEl.innerText = disponibles;
             
             if (disponibles === 0 && asignados > 0) { dispEl.style.color = 'var(--success)'; dispEl.style.fontWeight = 'normal'; }
             else if (disponibles < 0) { dispEl.style.color = 'var(--danger)'; dispEl.style.fontWeight = 'bold'; }
             else { dispEl.style.color = 'var(--text)'; dispEl.style.fontWeight = 'normal'; }
             
             autoSaveSaldos(collabId);
          });
       });
       
       const addNextBtn = document.getElementById('addNextYearBtn');
       if (addNextBtn) {
           addNextBtn.addEventListener('click', async () => {
               const nextYear = maxYear + 1;
               
               let tipo1 = (collab.saldosVacaciones && collab.saldosVacaciones[maxYear]) ? collab.saldosVacaciones[maxYear].periodoTipo : 'N/A';
               let tipo2 = (collab.saldosVacaciones && collab.saldosVacaciones[maxYear - 1]) ? collab.saldosVacaciones[maxYear - 1].periodoTipo : 'N/A';
               
               if (tipo1 === 'N/A' && collab.historialVacaciones && collab.historialVacaciones[maxYear]) tipo1 = collab.historialVacaciones[maxYear];
               if (tipo2 === 'N/A' && collab.historialVacaciones && collab.historialVacaciones[maxYear - 1]) tipo2 = collab.historialVacaciones[maxYear - 1];

               let newTipo = 'Mala';
               if (tipo1 === 'Mala' && tipo2 === 'Mala') {
                   newTipo = 'Buena';
               }
               
               if (!collab.saldosVacaciones) collab.saldosVacaciones = {};
               const lawDays = calcularDiasVacacionesLey(collab.fechaAlta, nextYear);
               collab.saldosVacaciones[nextYear] = {
                   periodoTipo: newTipo,
                   diasAsignados: lawDays,
                   diasDisponibles: lawDays
               };
               
               if (!isMockMode) {
                   try {
                       await updateDoc(doc(db, "colaboradores", collabId), { saldosVacaciones: collab.saldosVacaciones });
                   } catch(e) {
                       console.error("Error creating next year:", e);
                   }
               }
               renderSaldosVacaciones();
           });
       }

       const removeBtn = document.getElementById('removeYearBtn');
       if (removeBtn) {
           removeBtn.addEventListener('click', async () => {
               if (!confirm(`¿Seguro que deseas eliminar el año ${maxYear}?`)) return;
               
               if (collab.saldosVacaciones && collab.saldosVacaciones[maxYear]) {
                   delete collab.saldosVacaciones[maxYear];
                   if (!isMockMode) {
                       try {
                           await updateDoc(doc(db, "colaboradores", collabId), { saldosVacaciones: collab.saldosVacaciones });
                       } catch(e) {
                           console.error("Error deleting year:", e);
                       }
                   }
                   renderSaldosVacaciones();
               }
           });
       }
    }

    document.getElementById('vacationForm').addEventListener('submit', async (e) => {
       e.preventDefault();
       
       const editId = document.getElementById('vEditId').value;
       const collabId = document.getElementById('vCollab').value;
       const startDateStr = document.getElementById('vStartDate').value;
       const weeks = parseInt(document.getElementById('vWeeks').value, 10);
       
       if (!collabId || !startDateStr || !weeks) return;
       
       const startD = new Date(startDateStr + "T00:00:00");
       
       // Validación Lunes o Martes post feriado
       const dayOfWeek = startD.getDay(); // 0 Sun, 1 Mon, 2 Tue
       let validStart = false;
       if (dayOfWeek === 1) validStart = true;
       else if (dayOfWeek === 2) {
          const prevMonStr = formatDate(addDays(startD, -1));
          if (state.holidays.includes(prevMonStr)) validStart = true;
       }
       
       if (!validStart) {
          showToast("Error de Fecha", "El inicio de vacaciones debe ser un Lunes (o Martes si el Lunes es feriado).");
          return;
       }
       
       const endD = addDays(startD, (weeks * 7) - 1);
       const endDateStr = formatDate(endD);
       
       // Validación 2x1 Temporada Buena
       let touchesBuena = false;
       for (let d = new Date(startD); d <= endD; d = addDays(d, 1)) {
          if (getVacationSeason(formatDate(d)) === 'Buena') {
             touchesBuena = true;
             break;
          }
       }
       
       if (touchesBuena) {
          const collab = state.collaborators.find(c => c.id === collabId);
          const hist = collab?.historialVacaciones || {};
          if (hist.year1 === 'Buena' || hist.year2 === 'Buena') {
             showToast("Regla 2x1", `El colaborador ${collab?.name || collabId} ya tuvo temporada Buena en los últimos 2 años. Solo le corresponde temporada Mala.`);
             return;
          }
       }
       
       // Validación Superposición Semanal
       // Máximo 2 por semana
       let overlapError = false;
       for (let weekOffset = 0; weekOffset < weeks; weekOffset++) {
          const wStart = addDays(startD, weekOffset * 7);
          const wEnd = addDays(wStart, 6);
          let overlapCount = 0;
          
          state.vacations.forEach(v => {
             if (editId && v.id === editId) return; // Ignorar el registro que se está editando
             
             const vStart = new Date(v.startDate + "T00:00:00");
             const vEnd = new Date(v.endDate + "T00:00:00");
             // Si los rangos se cruzan
             if (vStart <= wEnd && vEnd >= wStart) {
                overlapCount++;
             }
          });
          
          if (overlapCount >= 2) {
             overlapError = true;
             break;
          }
       }
       
       if (overlapError) {
          showToast("Superposición", "No se puede aprobar. En alguna de las semanas seleccionadas ya hay 2 o más personas de vacaciones.");
          return;
       }
       
       const newVacId = `${collabId}_${startDateStr}`;
       const impVal = document.getElementById('vImputacion').value;
       
       const newVac = {
          id: newVacId,
          colaboradorId: collabId,
          startDate: startDateStr,
          endDate: endDateStr,
          weeksCount: weeks
       };
       if (impVal) {
           newVac.imputacionAnio = parseInt(impVal, 10);
       }
       
       if (!isMockMode) {
          try {
             const batch = writeBatch(db);
             if (editId && editId !== newVacId) {
                batch.delete(doc(db, "vacaciones", editId));
             }
             batch.set(doc(db, "vacaciones", newVacId), newVac);
             await batch.commit();
             logAudit(editId ? 'Editar Vacaciones' : 'Registrar Vacaciones', collabId, `${startDateStr} a ${endDateStr}`, editId || "", `${weeks} Semanas`);
          } catch(err) {
             showToast("Error", "No se pudo guardar la vacación en la base de datos.");
             return;
          }
       }
       
       if (editId) {
          state.vacations = state.vacations.filter(v => v.id !== editId);
          showToast("Éxito", "Vacaciones actualizadas correctamente.");
       } else {
          showToast("Éxito", "Vacaciones registradas correctamente.");
       }
       
       state.vacations.push(newVac);
       document.getElementById('vCancelBtn').click(); // Reset form and mode
       renderVacationTable();
    });

    window.deleteVacation = async function(id) {
       if (!confirm("¿Eliminar este registro de vacaciones?")) return;
       if (!isMockMode) {
          try {
             await deleteDoc(doc(db, "vacaciones", id));
             logAudit('Eliminar Vacaciones', id.split('_')[0], id, "Eliminado", "");
          } catch(err) {
             showToast("Error", "No se pudo eliminar de la base de datos.");
             return;
          }
       }
       state.vacations = state.vacations.filter(v => v.id !== id);
       renderVacationTable();
    };

    let calCurrentMonth = new Date();
    
    document.getElementById('vCalPrevMonth').addEventListener('click', () => {
       calCurrentMonth.setMonth(calCurrentMonth.getMonth() - 1);
       renderVacationCalendar();
    });
    
    document.getElementById('vCalNextMonth').addEventListener('click', () => {
       calCurrentMonth.setMonth(calCurrentMonth.getMonth() + 1);
       renderVacationCalendar();
    });

    window.renderVacationCalendar = function() {
       const container = document.getElementById('vacationCalendarContainer');
       if (!container) return;
       
       container.innerHTML = '';
       
       // Generar 6 meses en grilla 2x3
       for (let i = 0; i < 6; i++) {
          const mDate = new Date(calCurrentMonth.getFullYear(), calCurrentMonth.getMonth() + i, 1);
          const monthName = mDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
          
          const monthDiv = document.createElement('div');
          monthDiv.className = 'vac-cal-month';
          
          let html = `<div class="vac-cal-header">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</div>`;
          html += `<div class="vac-cal-grid">`;
          
          const dayHeaders = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
          dayHeaders.forEach(dh => {
             html += `<div class="vac-cal-day-header">${dh}</div>`;
          });
          
          const daysInMonth = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
          const firstDay = mDate.getDay(); // 0: Sun, 1: Mon, ...
          let startOffset = firstDay === 0 ? 6 : firstDay - 1;
          
          // Agrupar por semanas lógicas (L-D)
          let currentWeek = [];
          const weeks = [];
          
          for (let j = 0; j < startOffset; j++) {
             currentWeek.push(null);
          }
          
          for (let day = 1; day <= daysInMonth; day++) {
             const d = new Date(mDate.getFullYear(), mDate.getMonth(), day);
             const dStr = formatDate(d);
             const dTarget = new Date(dStr + "T00:00:00");
             
             const onVacation = [];
             const onVacationIds = [];
             state.vacations.forEach(v => {
                const vStart = new Date(v.startDate + "T00:00:00");
                const vEnd = new Date(v.endDate + "T00:00:00");
                if (dTarget >= vStart && dTarget <= vEnd) {
                   const collab = state.collaborators.find(c => c.id === v.colaboradorId);
                   let nameFormatted = v.colaboradorId;
                   if (collab) {
                       const parts = collab.name.split('(')[0].trim().split(' ');
                       nameFormatted = parts.length > 1 ? `${parts[0]}, ${parts.slice(1).join(' ')}` : parts[0];
                   }
                   onVacation.push(nameFormatted);
                   onVacationIds.push(v.colaboradorId);
                }
             });
             
             currentWeek.push({ day, onVacation, onVacationIds, isHoliday: state.holidays.includes(dStr) });
             
             if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
             }
          }
          if (currentWeek.length > 0) {
             while (currentWeek.length < 7) {
                currentWeek.push(null);
             }
             weeks.push(currentWeek);
          }
          
          // Render weeks
          weeks.forEach(week => {
             // Rule of 3: If any day has >= 3 people on vacation, the whole week is danger
             const isWeekDanger = week.some(wday => wday && wday.onVacation.length >= 3);
             
             week.forEach(wday => {
                if (!wday) {
                   html += `<div class="vac-cal-cell empty"></div>`;
                } else {
                   const count = wday.onVacation.length;
                   let densClass = 'density-0';
                   let inlineStyle = '';
                   
                   if (count === 1) {
                      const color = getCollabColor(wday.onVacationIds[0]);
                      const textColor = getContrastColor(color);
                      inlineStyle = `background-color: ${color}; color: ${textColor}; border-color: transparent;`;
                   } else if (count === 2) {
                      const c1 = getCollabColor(wday.onVacationIds[0]);
                      const c2 = getCollabColor(wday.onVacationIds[1]);
                      inlineStyle = `background: linear-gradient(135deg, ${c1} 50%, ${c2} 50%); color: #fff; border-color: transparent; text-shadow: 0 0 2px #000;`;
                   } else if (count >= 3) {
                      densClass = 'density-3';
                   }
                   
                   if (isWeekDanger) {
                      densClass = 'week-danger';
                      inlineStyle = '';
                   }
                   
                   if (wday.isHoliday) {
                      densClass += ' holiday';
                   }
                   
                   let tooltip = count > 0 ? wday.onVacation.join(', ') : 'Sin vacaciones';
                   if (wday.isHoliday) {
                      tooltip = 'Feriado' + (count > 0 ? ' | ' + tooltip : '');
                   }
                   
                   html += `<div class="vac-cal-cell ${densClass}" style="${inlineStyle}" title="${tooltip}">${wday.day}</div>`;
                }
             });
          });
          
          html += `</div>`;
          monthDiv.innerHTML = html;
          container.appendChild(monthDiv);
       }
    };

    // -- LÓGICA DE LOGIN Y RBAC --
    let currentRole = 'visitor';
    
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const configBtn = document.getElementById('configBtn');
    const pdfBtn = document.getElementById('pdfBtn');
    // Actualiza la UI basada en el rol
    const vacationTabBtn = document.getElementById('vacationTabBtn');
    
    const loginModal = document.getElementById('loginModal');
    const editorModal = document.getElementById('editorModal');
    const userRoleText = document.getElementById('userRoleText');
    
    if (sessionStorage.getItem('adminLogged') === 'true') {
       currentRole = 'admin';
    } else if (sessionStorage.getItem('editorLegajo')) {
       currentRole = 'editor';
    }

    function checkLogin() {
       logoutBtn.style.display = 'none';
       configBtn.style.display = 'none';
       if (pdfBtn) pdfBtn.style.display = 'inline-flex';
       vacationTabBtn.style.display = 'none';
       if (metricsTabBtn) metricsTabBtn.style.display = 'none';
       adminLoginBtn.style.display = 'flex'; // Siempre visible por defecto, se oculta si hay login
       
       const auditBellBtn = document.getElementById('auditBellBtn');
       if (auditBellBtn) auditBellBtn.style.display = 'none';

       const backupDriveBtn = document.getElementById('backupDriveBtn');
       if (backupDriveBtn) backupDriveBtn.style.display = 'none';

       if (currentRole === 'admin') {
          adminLoginBtn.style.display = 'none';
          logoutBtn.style.display = 'inline-flex';
          if (backupDriveBtn) backupDriveBtn.style.display = 'inline-flex';
          logoutBtn.innerHTML = 'Cerrar Sesión Admin';
          configBtn.style.display = 'inline-flex';
          vacationTabBtn.style.display = 'inline-block';
          if (metricsTabBtn) metricsTabBtn.style.display = 'inline-block';
          if (auditBellBtn) {
             auditBellBtn.style.display = 'flex';
             if (typeof window.checkAuditLogs === 'function') {
                window.checkAuditLogs();
             }
          }
       } else if (currentRole === 'editor') {
          adminLoginBtn.style.display = 'none';
          logoutBtn.style.display = 'inline-flex';
          logoutBtn.innerHTML = 'Cerrar Sesión de Editor';
       }
       
       document.querySelectorAll('.cell-input').forEach(input => {
          if (currentRole === 'visitor') {
             input.setAttribute('readonly', 'true');
          } else {
             input.removeAttribute('readonly');
          }
       });
    };

    let currentContextCell = null;
    function handleContextMenu(e) {
       e.preventDefault();
       if (currentRole === 'visitor') return;
       currentContextCell = e.target;
       
       const collabId = currentContextCell.getAttribute('data-collab');
       const dateStr = currentContextCell.getAttribute('data-date');
       const obj = getPlanningObj(collabId, dateStr) || {};
       
       document.getElementById('cellCommentInput').value = obj.comentario || '';
       document.getElementById('cellFixedInput').checked = !!obj.fijado;
       document.getElementById('cellFixedDateText').textContent = obj.fijado && obj.fechaFijado ? `*(Solicitado con tiempo: ${obj.fechaFijado})` : '*(Solicitado con tiempo)';
       
       document.getElementById('cellTardanzaInput').value = obj.tardanzaTexto || '';
       document.getElementById('cellTardanzaCheck').checked = !!obj.tardanzaConfirmada;

       const ctxMenu = document.getElementById('contextMenu');
       ctxMenu.style.display = 'block';
       
       let topPos = e.pageY;
       let leftPos = e.pageX;
       if (leftPos + 450 > window.innerWidth) leftPos = window.innerWidth - 470;
       if (topPos + 400 > window.innerHeight) topPos = window.innerHeight - 420;
       if (topPos < 0) topPos = 10;
       
       ctxMenu.style.left = leftPos + 'px';
       ctxMenu.style.top = topPos + 'px';
    }

    document.addEventListener('click', e => {
       const ctxMenu = document.getElementById('contextMenu');
       if (ctxMenu && ctxMenu.style.display === 'block') {
          if (!ctxMenu.contains(e.target) && e.target !== currentContextCell) {
             ctxMenu.style.display = 'none';
          }
       }
    });

    window.closeContextMenu = function() {
       document.getElementById('contextMenu').style.display = 'none';
    };

    window.deleteCellComment = async function() {
       document.getElementById('cellCommentInput').value = '';
       await autoSaveContextMenu();
       window.closeContextMenu();
       renderHeatmap();
    };

    document.getElementById('cellFixedInput').addEventListener('change', async (e) => {
       if (!currentContextCell) return;
       const collabId = currentContextCell.getAttribute('data-collab');
       const dateStr = currentContextCell.getAttribute('data-date');
       
       const obj = getPlanningObj(collabId, dateStr) || {};
       obj.slot = obj.slot || getPlanningSlot(collabId, dateStr) || currentContextCell.value;
       
       const isFixedNow = e.target.checked;
       if (isFixedNow) {
          const dt = new Date();
          const dia = String(dt.getDate()).padStart(2, '0');
          const mes = String(dt.getMonth() + 1).padStart(2, '0');
          const anio = dt.getFullYear();
          obj.fechaFijado = `${dia}/${mes}/${anio}`;
          document.getElementById('cellFixedDateText').textContent = `*(Solicitado con tiempo el dia ${obj.fechaFijado})`;
       } else {
          obj.fechaFijado = null;
          document.getElementById('cellFixedDateText').textContent = '*(Solicitado con tiempo)';
       }
       obj.fijado = isFixedNow;
       
       state.planning[`${collabId}_${dateStr}`] = obj;
       
       if (!isMockMode) {
         try {
           const docId = `${collabId}_${dateStr}`;
           setDoc(doc(db, "planificacion", docId), {
             colaboradorId: collabId,
             fecha: dateStr,
             slot: obj.slot,
             fijado: obj.fijado,
             fechaFijado: obj.fechaFijado
           }, { merge: true });
         } catch(err) {
           console.error("Error auto-guardando fijado:", err);
         }
       }
       renderUI();
    });

    async function autoSaveContextMenu() {
       if (!currentContextCell) return;
       const collabId = currentContextCell.getAttribute('data-collab');
       const dateStr = currentContextCell.getAttribute('data-date');
       
       const tardanzaStr = document.getElementById('cellTardanzaInput').value.trim();
       let tardanzaMins = 0;
       if (tardanzaStr) {
          if (tardanzaStr.includes(':')) {
             let parts = tardanzaStr.split(':');
             tardanzaMins = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
          } else {
             tardanzaMins = parseInt(tardanzaStr, 10) || 0;
          }
       }
       
       const slotValue = getPlanningSlot(collabId, dateStr) || currentContextCell.value;
       const parsedWithNewTardanza = parseShift(slotValue, tardanzaMins);
       
       const validation = validateTurn(collabId, dateStr, parsedWithNewTardanza);
       if (!validation.valid && validation.type === 'legal') {
          showToast("ERROR CRÍTICO DE LEY", `No se puede asignar esta modificación.<br>El colaborador no cumple con las ${validation.req} de descanso obligatorio por Ley. (Descanso calculado: ${validation.actual} horas)`);
          return false;
       }

       const obj = getPlanningObj(collabId, dateStr) || {};
       const oldSlot = obj.slot || currentContextCell.value;
       const oldComment = obj.comentario || "";
       
       obj.slot = obj.slot || getPlanningSlot(collabId, dateStr) || currentContextCell.value;
       obj.comentario = document.getElementById('cellCommentInput').value.trim();
       
       if (oldSlot !== obj.slot || oldComment !== obj.comentario) {
          if (typeof window.registrarLogActividad === 'function') {
             const oldStr = oldSlot + (oldComment ? ` (${oldComment})` : '');
             const newStr = obj.slot + (obj.comentario ? ` (${obj.comentario})` : '');
             window.registrarLogActividad(collabId, dateStr, oldStr, newStr);
          }
       }
       
       obj.tardanzaTexto = tardanzaStr;
       obj.tardanzaMinutosTotales = tardanzaMins;
       obj.tardanzaConfirmada = document.getElementById('cellTardanzaCheck').checked;
       
       state.planning[`${collabId}_${dateStr}`] = obj;
       
       if (!isMockMode) {
         try {
           const docId = `${collabId}_${dateStr}`;
           setDoc(doc(db, "planificacion", docId), {
             colaboradorId: collabId,
             fecha: dateStr,
             slot: obj.slot,
             comentario: obj.comentario,
             tardanzaTexto: obj.tardanzaTexto || "",
             tardanzaMinutosTotales: obj.tardanzaMinutosTotales || 0,
             tardanzaConfirmada: obj.tardanzaConfirmada || false
           }, { merge: true });
         } catch(err) {
           console.error("Error auto-guardando detalles:", err);
         }
       }
       renderUI();
    }

    document.getElementById('cellTardanzaInput').addEventListener('blur', autoSaveContextMenu);
    document.getElementById('cellTardanzaCheck').addEventListener('change', (e) => {
       if (!e.target.checked) {
          document.getElementById('cellTardanzaInput').value = '';
       }
       autoSaveContextMenu();
    });
    document.getElementById('cellCommentInput').addEventListener('blur', autoSaveContextMenu);

    document.getElementById('saveCellDetailsBtn').addEventListener('click', async () => {
       const saved = await autoSaveContextMenu();
       if (saved !== false) {
           window.closeContextMenu();
           renderHeatmap();
       }
    });

    adminLoginBtn.addEventListener('click', () => {
       loginModal.style.display = 'flex';
    });

    document.getElementById('loginCancelBtn').addEventListener('click', () => {
       loginModal.style.display = 'none';
    });

    document.getElementById('loginForm').addEventListener('submit', (e) => {
       e.preventDefault();
       const leg = document.getElementById('loginLegajo').value.trim();
       const pass = document.getElementById('loginPass').value.trim();
       if (leg === '10045875' && pass === 'AdminGDN2026') {
          sessionStorage.setItem('adminLogged', 'true');
          currentRole = 'admin';
          loginModal.style.display = 'none';
          document.getElementById('loginPass').value = '';
          checkLogin();
          showToast('Admin', 'Acceso Administrador concedido.');
       } else {
          showToast('Error', 'Credenciales incorrectas.');
       }
    });

    logoutBtn.addEventListener('click', () => {
       sessionStorage.removeItem('adminLogged');
       sessionStorage.removeItem('editorLegajo');
       sessionStorage.removeItem('editorNombre');
       currentRole = 'visitor';
       checkLogin();
       switchTab('horarios');
       renderUI();
       showToast('Sesión', 'Sesión cerrada correctamente.');
    });

    let pendingEditTarget = null;
    
    document.getElementById('editorLegajo').addEventListener('input', (e) => {
       const leg = e.target.value.trim();
       const nomInput = document.getElementById('editorNombre');
       const nomDisplay = document.getElementById('editorNombreDisplay');
       
       const authorizedEditors = {
          '10021755': 'Salazar Torres, Carmen Elena',
          '10021393': 'Bazan, Rodolfo Fabian',
          '10021701': 'Vargas Chirino, Mauro Javier',
          '10036476': 'Guidet Fredes, Maria Laura',
          '10045541': 'Diaz, Daiana Maillen'
       };

       if (leg) {
          let editorName = authorizedEditors[leg];
          if (!editorName) {
             const collab = state.collaborators.find(c => String(c.id).trim() === leg || String(c.legajo).trim() === leg);
             if (collab && collab.name) editorName = collab.name;
          }

          if (editorName) {
             nomInput.value = editorName;
             nomDisplay.textContent = editorName;
          } else {
             nomInput.value = '';
             nomDisplay.textContent = 'Legajo no encontrado';
          }
       } else {
          nomInput.value = '';
          nomDisplay.textContent = '';
       }
    });

    document.getElementById('editorCancelBtn').addEventListener('click', () => {
       editorModal.style.display = 'none';
       pendingEditTarget = null;
    });
    
    document.getElementById('editorForm').addEventListener('submit', (e) => {
       e.preventDefault();
       const nom = document.getElementById('editorNombre').value.trim();
       const leg = document.getElementById('editorLegajo').value.trim();
       if (!nom) {
          showToast('Error', 'Legajo inválido o sin nombre asociado.');
          return;
       }
       if (nom && leg) {
          sessionStorage.setItem('editorNombre', nom);
          sessionStorage.setItem('editorLegajo', leg);
          currentRole = 'editor';
          editorModal.style.display = 'none';
          checkLogin();
          showToast('Firma', `Habilitado como editor: ${nom}`);
          if (pendingEditTarget) {
             pendingEditTarget.focus();
             pendingEditTarget = null;
          }
       }
    });

    window.requireEditor = function(e) {
       if (currentRole === 'visitor') {
          e.preventDefault();
          pendingEditTarget = e.target;
          editorModal.style.display = 'flex';
       }
    };

    // -- LOG AUDITORÍA --
    window.logAudit = async function(action, collabId, targetDate, oldValue, newValue) {
       if (isMockMode) return;
       try {
          let authorName = "Desconocido";
          if (currentRole === 'admin') authorName = "Administrador (10045875)";
          else if (currentRole === 'editor') authorName = `${sessionStorage.getItem('editorNombre')} (${sessionStorage.getItem('editorLegajo')})`;

          const logRef = doc(collection(db, "logs_cambios"));
          await setDoc(logRef, {
             autor: authorName,
             accion: action,
             afectado: collabId,
             fechaTarget: targetDate || "N/A",
             valorAnterior: oldValue || "",
             valorNuevo: newValue || "",
             timestamp: new Date().toISOString()
          });
       } catch (err) {
          console.error("Error al guardar log de auditoría:", err);
       }
    };

    // -- EXPORTAR PDF AVANZADO --
    const pdfModal = document.getElementById('pdfModal');
    const pdfForm = document.getElementById('pdfForm');
    const pdfCustomDates = document.getElementById('pdfCustomDates');
    const pdfRadios = document.getElementsByName('pdfRange');

    if (document.getElementById('pdfBtn')) {
        document.getElementById('pdfBtn').addEventListener('click', () => {
           pdfModal.style.display = 'flex';
        });
    }

    document.getElementById('pdfCancelBtn').addEventListener('click', () => {
       pdfModal.style.display = 'none';
    });

    pdfRadios.forEach(radio => {
       radio.addEventListener('change', (e) => {
          if (e.target.value === 'custom') {
             pdfCustomDates.style.display = 'flex';
          } else {
             pdfCustomDates.style.display = 'none';
          }
       });
    });

    pdfForm.addEventListener('submit', async (e) => {
       e.preventDefault();
       const rangeType = document.querySelector('input[name="pdfRange"]:checked').value;
       
       let startD = new Date(state.currentWeekStart);
       let endD = addDays(startD, 6); // Semana actual
       
       if (rangeType === 'custom') {
          const valStart = document.getElementById('pdfDateStart').value;
          if (!valStart) {
             showToast("Error", "Debes seleccionar la fecha de inicio.");
             return;
          }
          startD = new Date(valStart + "T00:00:00");
          // Asegurar que sea lunes, opcionalmente, pero el usuario elige.
          endD = addDays(startD, 20); // 21 días total
       }
       
       pdfModal.style.display = 'none';
       showToast("Generando PDF", "El documento se está preparando...", 3000);
       
       try {
          await buildAndDownloadPDF(startD, endD);
       } catch (err) {
          console.error("Error al generar PDF:", err);
          showToast("Error", "Hubo un problema al generar el PDF.");
       }
    });

    async function buildAndDownloadPDF(startDate, endDate) {
       const totalDays = [];
       let curr = new Date(startDate);
       while (curr <= endDate) {
          totalDays.push(new Date(curr));
          curr = addDays(curr, 1);
       }
       
       const weeks = [];
       for (let i = 0; i < totalDays.length; i += 7) {
          weeks.push(totalDays.slice(i, i + 7));
       }
       
       let htmlStr = `
           <style>
           .pdf-table-compact td {
               border: 1px solid #000 !important;
               text-align: center !important;
               padding: 2px 4px !important;
               font-size: 0.75rem !important; /* Tamaño único y legible */
               font-weight: bold !important;
               white-space: nowrap !important; /* Fuerza a que todo se mantenga en una sola línea */
               height: 18px !important; /* Fila súper delgada */
               background: #fff !important;
               color: #000 !important;
           }
           </style>
           <div style="background: white; color: black; padding: 10px; font-family: Arial, sans-serif; width: 100%;">
             <div style="text-align: center; margin-bottom: 15px;">
                <h2 style="margin: 0; font-size: 1.5rem; text-transform: uppercase;">Planilla de Horarios Semanales</h2>
                <p style="margin: 5px 0 0 0; color: #333; font-size: 0.9rem;">
                   Periodo: ${startDate.toLocaleDateString('es-ES')} al ${endDate.toLocaleDateString('es-ES')}
                </p>
             </div>
       `;
       
       state.collaborators.forEach(collab => {
          htmlStr += `
          <div class="pdf-collaborator-card" style="margin-bottom: 6px; page-break-inside: avoid; border-bottom: 1px dashed #ccc; padding-bottom: 4px;">
            <div style="background-color: #e6e6e6; color: #000; font-weight: bold; padding: 2px 6px; font-size: 0.8rem; text-transform: uppercase; border: 1px solid #000;">
              ${collab.id} - ${collab.name.split('(')[0].trim()}
            </div>
            <table class="pdf-table-compact" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2px;">
              <tbody>
          `;

          weeks.forEach((weekDays, wIndex) => {
             htmlStr += `
                 <tr>
             `;
             
             weekDays.forEach(d => {
                const dStr = formatDate(d);
                let isOnVacation = false;
                const targetD = new Date(dStr + "T00:00:00");
                for (let vac of state.vacations) {
                   if (vac.colaboradorId === collab.id) {
                      const vacStart = new Date(vac.startDate + "T00:00:00");
                      const vacEnd = new Date(vac.endDate + "T00:00:00");
                      if (targetD >= vacStart && targetD <= vacEnd) isOnVacation = true;
                   }
                }
                
                let val = getPlanningSlot(collab.id, dStr);
                if (isOnVacation) val = 'VACACIONES';
                if (!val.trim()) val = '-';
                if (val === 'VACACIONES') val = 'VAC';
                const dText = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
                let cellStyle = val.length > 6 ? 'font-size: 0.65rem !important; letter-spacing: -0.5px !important;' : '';
                
                htmlStr += `
                  <td style="${cellStyle}">${dText} - ${val}</td>
                `;
             });
             
             htmlStr += `
                 </tr>
             `;
          });

          htmlStr += `
              </tbody>
            </table>
          </div>
          `;
       });
       
       htmlStr += `</div>`;
       
       const opt = {
          margin:       [10, 10, 10, 10], // Márgenes de 10mm en los cuatro lados
          filename:     `Planificacion_${formatDate(startDate)}_al_${formatDate(endDate)}.pdf`,
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2, useCORS: true },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' } // A4 Horizontal
       };
       
       try {
           const worker = html2pdf().set(opt).from(htmlStr);
           await worker.save();
           showToast("PDF Generado", "La descarga ha finalizado.");
       } catch(e) {
           console.error("PDF error:", e);
           showToast("Error", "Falló la generación del PDF.");
       }
    }

    // -- LOGS DE ACTIVIDAD (Auditoría de Turnos) --
    window.registrarLogActividad = async function(collabId, targetDate, oldValue, newValue) {
       if (isMockMode) return;
       if (currentRole === 'admin') return; 

       try {
          let execLegajo = "Desconocido";
          let execNombre = "Desconocido";
          if (currentRole === 'editor') {
             execLegajo = sessionStorage.getItem('editorLegajo') || "";
             execNombre = sessionStorage.getItem('editorNombre') || "";
          }

          const collab = state.collaborators.find(c => String(c.id) === String(collabId));
          const collabNombre = collab ? collab.name : "Desconocido";

          const logRef = doc(collection(db, "logs_actividad"));
          await setDoc(logRef, {
             fechaCambio: new Date().toISOString(),
             ejecutorLegajo: execLegajo,
             ejecutorNombre: execNombre,
             colaboradorAfectado: collabId + " " + collabNombre,
             fechaTurno: targetDate,
             estadoAnterior: oldValue || "",
             estadoNuevo: newValue || "",
             revisadoAdmin: false
          });
       } catch (err) {
          console.error("Error guardando log de actividad:", err);
       }
    };

    window.checkAuditLogs = async function() {
       if (currentRole !== 'admin') return;
       try {
          const q = query(collection(db, "logs_actividad"), where("revisadoAdmin", "==", false));
          const snapshot = await getDocs(q);
          const auditBadge = document.getElementById('auditBadge');
          
          const docs = snapshot.docs.filter(doc => doc.data().ejecutorLegajo !== "10045875");
          
          if (docs.length > 0) {
             auditBadge.style.display = 'flex';
             auditBadge.textContent = docs.length;
          } else {
             auditBadge.style.display = 'none';
          }
       } catch (err) {
          console.error("Error al consultar logs:", err);
       }
    };

    const auditBellBtn = document.getElementById('auditBellBtn');
    const auditoriaModal = document.getElementById('auditoriaModal');
    const auditCloseBtn = document.getElementById('auditCloseBtn');
    const auditListContainer = document.getElementById('auditListContainer');
    const auditHistoryToggleBtn = document.getElementById('auditHistoryToggleBtn');
    let showingReviewedLogs = false;

    if (auditHistoryToggleBtn) {
       auditHistoryToggleBtn.addEventListener('click', async () => {
          showingReviewedLogs = !showingReviewedLogs;
          auditHistoryToggleBtn.innerText = showingReviewedLogs ? 'Ver Solo Pendientes' : 'Ver Historial Completo';
          await renderAuditLogs();
       });
    }

    if (auditBellBtn) {
       auditBellBtn.addEventListener('click', async () => {
          auditoriaModal.style.display = 'flex';
          showingReviewedLogs = false;
          if (auditHistoryToggleBtn) auditHistoryToggleBtn.innerText = 'Ver Historial Completo';
          await renderAuditLogs();
       });
    }

    if (auditCloseBtn) {
       auditCloseBtn.addEventListener('click', () => {
          auditoriaModal.style.display = 'none';
       });
    }

    async function renderAuditLogs() {
       auditListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted);">Cargando logs...</div>';
       try {
          let q;
          if (showingReviewedLogs) {
             q = query(collection(db, "logs_actividad")); // Trae todos para ordenarlos por fecha
          } else {
             q = query(collection(db, "logs_actividad"), where("revisadoAdmin", "==", false));
          }
          
          const snapshot = await getDocs(q);
          let docs = snapshot.docs.filter(doc => doc.data().ejecutorLegajo !== "10045875");
          
          // Ordenar por fecha descendente (más recientes primero)
          docs.sort((a, b) => {
             return new Date(b.data().fechaCambio) - new Date(a.data().fechaCambio);
          });
          
          if (docs.length === 0) {
             auditListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 1rem;">No hay cambios para mostrar.</div>';
             return;
          }

          auditListContainer.innerHTML = '';
          docs.forEach(docSnap => {
             const data = docSnap.data();
             const div = document.createElement('div');
             div.className = 'audit-item';
             if (data.revisadoAdmin) {
                div.style.opacity = '0.7';
                div.style.background = 'rgba(255,255,255,0.05)';
             }
             
             let dateParts = data.fechaTurno.split('-');
             let dateFormatted = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : data.fechaTurno;
             
             let actionHtml = '';
             if (!data.revisadoAdmin) {
                actionHtml = `<button class="mark-reviewed-btn" data-id="${docSnap.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--success); color: white; border: none; border-radius: 0.25rem; cursor: pointer;">Marcar como Revisado</button>`;
             } else {
                actionHtml = `<span style="color: var(--success); font-size: 0.8rem; font-weight: bold;">✓ Revisado</span>`;
             }

             // Formatear timestamp de cuando se hizo
             let horaCambio = new Date(data.fechaCambio).toLocaleString();

             div.innerHTML = `
               <div>
                  <strong>${data.ejecutorLegajo} ${data.ejecutorNombre}</strong> cambió el <span class="audit-date">${dateFormatted}</span> de 
                  <span class="audit-action">${data.estadoAnterior || '(vacío)'}</span> a <span class="audit-action">${data.estadoNuevo || '(vacío)'}</span> 
                  <br><span style="color: var(--text-muted); font-size: 0.75rem;">Afectado: ${data.colaboradorAfectado} | Editado: ${horaCambio}</span>
               </div>
               ${actionHtml}
             `;
             auditListContainer.appendChild(div);
          });
          
          document.querySelectorAll('.mark-reviewed-btn').forEach(btn => {
             btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                e.target.innerText = 'Guardando...';
                e.target.disabled = true;
                e.target.style.background = 'var(--text-muted)';
                await updateDoc(doc(db, "logs_actividad", id), { revisadoAdmin: true });
                await window.checkAuditLogs();
                await renderAuditLogs();
             });
          });
       } catch (err) {
          console.error("Error al renderizar logs:", err);
          auditListContainer.innerHTML = '<div style="color: var(--danger);">Error al cargar logs.</div>';
       }
    }

    // 12. BACKUP GOOGLE SHEETS
    if (document.getElementById('backupDriveBtn')) {
       document.getElementById('backupDriveBtn').addEventListener('click', generarBackupSheets);
    }

    async function generarBackupSheets() {
       const backupBtn = document.getElementById('backupDriveBtn');
       const originalText = backupBtn.innerText;
       const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxQ-HYUql7hIe7DUSzRjjQjiFSAxDFrLpXrhMPhKwqmB53DTV_b7BVmIP_QO79QHeWw/exec";
       const SPREADSHEET_ID = "1X3T8JIQ6APN8Gc3z7vVxz3rCEoiRRgSAUY4HIljm604";

       backupBtn.innerText = 'Extrayendo...';
       backupBtn.disabled = true;

       try {
          // 1. Obtener toda la data de planificacion
          const planSnap = await getDocs(collection(db, 'planificacion'));
          
          const monthMap = {};
          const datesByMonth = {};
          
          planSnap.forEach(docSnap => {
             const data = docSnap.data();
             if (!data.fecha || !data.colaboradorId) return;
             
             const monthKey = data.fecha.substring(0, 7); // "YYYY-MM"
             
             if (!monthMap[monthKey]) {
                monthMap[monthKey] = {};
                datesByMonth[monthKey] = new Set();
             }
             if (!monthMap[monthKey][data.colaboradorId]) {
                monthMap[monthKey][data.colaboradorId] = {};
             }
             
             monthMap[monthKey][data.colaboradorId][data.fecha] = data.slot;
             datesByMonth[monthKey].add(data.fecha);
          });

          // 2. Construir la estructura para Apps Script
          const sheets = [];
          const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

          for (const monthKey of Object.keys(monthMap)) {
             const [year, monthNum] = monthKey.split('-');
             const sheetName = monthNames[parseInt(monthNum)-1] + " " + year;
             
             const datesArray = Array.from(datesByMonth[monthKey]).sort();
             const headers = ["Legajo", "Nombre"].concat(datesArray.map(d => {
                const [y, m, day] = d.split('-');
                return day + '/' + m;
             }));

             const matrix = [headers];

             state.collaborators.forEach(collab => {
                const row = [collab.id, collab.name.split('(')[0].trim()];
                const collabData = monthMap[monthKey][collab.id] || {};
                
                datesArray.forEach(d => {
                   row.push(collabData[d] || "-");
                });
                matrix.push(row);
             });

             sheets.push({ name: sheetName, data: matrix });
          }

          backupBtn.innerText = 'Enviando a Drive...';

          // 3. Enviar al Web App
          const response = await fetch(WEB_APP_URL, {
             method: 'POST',
             mode: 'no-cors', // Evita bloqueos CORS en el navegador al hablar con GAS
             headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain es mandatorio en no-cors
             body: JSON.stringify({
                spreadsheetId: SPREADSHEET_ID,
                sheets: sheets
             })
          });

          showToast("Backup Enviado", "El proceso de respaldo se envió a Google Drive.");

       } catch (error) {
          console.error(error);
          alert("Ocurrió un error en el Backup: " + error.message);
       } finally {
          backupBtn.innerText = originalText;
          backupBtn.disabled = false;
       }
    }

    // LEY DE CONTRATO DE TRABAJO (AR)
    function calcularDiasVacacionesLey(fechaAlta, añoDestino) {
        if (!fechaAlta) return 0;
        const [yyyy, mm, dd] = fechaAlta.split('-');
        const fechaIngreso = new Date(yyyy, mm - 1, dd);
        const fechaCorte = new Date(añoDestino, 11, 31);
        
        if (fechaIngreso > fechaCorte) return 0;
        
        let antiguedad = añoDestino - fechaIngreso.getFullYear();
        if (fechaCorte.getMonth() < fechaIngreso.getMonth() || 
            (fechaCorte.getMonth() === fechaIngreso.getMonth() && fechaCorte.getDate() < fechaIngreso.getDate())) {
            antiguedad--;
        }
        
        const diffMs = fechaCorte - fechaIngreso;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays < 180) {
            return Math.floor(diffDays / 20);
        }
        
        if (antiguedad < 5) return 14;
        if (antiguedad < 10) return 21;
        if (antiguedad < 20) return 28;
        return 35;
    }

    // INICIO MIGRACION FECHAS
    async function migrateFechas() {
       if (isMockMode) return;
       if (localStorage.getItem('fechasMigradasV1')) return;
       
       const dates = {
           "10047984": "2025-06-17",
           "10047985": "2025-06-17",
           "10047483": "2025-05-05",
           "10047482": "2025-05-05",
           "10044768": "2021-03-01",
           "10036547": "2012-08-13",
           "10036544": "2012-08-13",
           "10036484": "2012-08-01",
           "10036330": "2012-08-13",
           "10036542": "2012-08-13",
           "10036541": "2012-08-13",
           "10023038": "2007-08-17"
       };
       
       console.log("Iniciando migración de fechas de alta...");
       for (let id in dates) {
           try {
               await updateDoc(doc(db, "colaboradores", id), { fechaAlta: dates[id] }, { merge: true });
           } catch(e) { console.error("Fallo al migrar " + id, e) }
       }
       localStorage.setItem('fechasMigradasV1', 'true');
       console.log('Fechas migradas exitosamente.');
    }
    // SCROLL INFINITO & WHEEL
    const gridContainer = document.querySelector('.grid-container');
    let isFetchingNextWeek = false;

    // 1. Wheel event para scroll horizontal en escritorio
    gridContainer.addEventListener('wheel', (e) => {
       if (e.deltaY !== 0) {
         e.preventDefault(); // CRÍTICO: Evita que el navegador intente hacer scroll vertical
         gridContainer.scrollLeft += e.deltaY * 1.2; // Traduce el movimiento vertical a horizontal
       }
    }, { passive: false });

    // 1b. Mouse Drag-to-Scroll (Arrastrar con el click en PC)
    let isDown = false;
    let startX;
    let scrollLeft;

    gridContainer.addEventListener('mousedown', (e) => {
        // Ignorar si hace click en un input
        if (e.target.tagName.toLowerCase() === 'input') return;
        isDown = true;
        gridContainer.style.cursor = 'grabbing';
        startX = e.pageX - gridContainer.offsetLeft;
        scrollLeft = gridContainer.scrollLeft;
    });
    
    gridContainer.addEventListener('mouseleave', () => {
        isDown = false;
        gridContainer.style.cursor = '';
    });
    
    gridContainer.addEventListener('mouseup', () => {
        isDown = false;
        gridContainer.style.cursor = '';
    });
    
    gridContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // Previene selección de texto
        const x = e.pageX - gridContainer.offsetLeft;
        const walk = (x - startX) * 1.5; // Multiplicador de velocidad de arrastre
        gridContainer.scrollLeft = scrollLeft - walk;
    });

    // 2. Scroll event para lazy loading y sincronización del mapa de calor
    gridContainer.addEventListener('scroll', async (e) => {
       // A. Sincronización dinámica del Mapa de Calor Superior (espejo del viewport)
       const colWidth = window.innerWidth <= 768 ? 75 : 120; 
       let startIndex = Math.floor(gridContainer.scrollLeft / colWidth);
       if (startIndex < 0) startIndex = 0;
       
       if (startIndex !== window.currentHeatmapStartIndex) {
           window.currentHeatmapStartIndex = startIndex;
           renderHeatmap(); // Renderiza solo los 7 días correspondientes al frame actual
           updateDynamicHours(); // Actualiza etiquetas de horas flotantes (Móvil y Escritorio)
       }

       // B. Lazy Loading de las siguientes semanas (Prefetch Hacia Adelante)
       if (isFetchingNextWeek) return;
       
       // Disparar cuando el scroll horizontal pase el 60% del ancho actual
       if (gridContainer.scrollLeft > (gridContainer.scrollWidth - gridContainer.clientWidth) * 0.6) {
          isFetchingNextWeek = true;
          
          const currentScroll = gridContainer.scrollLeft;
          const heatmapArea = document.querySelector('.top-heatmap-area');
          const currentHeatmapScroll = heatmapArea ? heatmapArea.scrollLeft : 0;
          
          const prevRange = state.viewRange || 7;
          state.viewRange = prevRange + 7;
          
          // Calcula a partir de qué fecha empiezan los esqueletos
          const skeletonStartDate = addDays(getStartOfWeek(state.currentWeekStart), prevRange);
          state.skeletonStartStr = formatDate(skeletonStartDate);
          
          // Renderiza los esqueletos temporalmente (síncrono)
          renderUI();
          
          // Restauramos el scroll exacto para que no haya salto al inyectar las columnas grises
          gridContainer.scrollLeft = currentScroll;
          if (heatmapArea) heatmapArea.scrollLeft = currentHeatmapScroll;
          
          // Realiza el fetch de datos en segundo plano
          await loadWeekPlanning(true); // append = true
          
          isFetchingNextWeek = false;
       }
       
       // C. Lazy Loading de las semanas anteriores (Prepend Hacia Atrás)
       else if (gridContainer.scrollLeft <= 100) {
          isFetchingNextWeek = true; // Usamos el mismo candado para evitar cargas duplicadas
          
          const currentScroll = gridContainer.scrollLeft;
          const heatmapArea = document.querySelector('.top-heatmap-area');
          const currentHeatmapScroll = heatmapArea ? heatmapArea.scrollLeft : 0;
          
          // Restar 7 días al inicio y sumar 7 días al rango total
          state.currentWeekStart = addDays(state.currentWeekStart, -7);
          state.viewRange = (state.viewRange || 7) + 7;
          
          // El ancho de los días insertados a la izquierda
          const shiftWidth = (window.innerWidth <= 768 ? 75 : 120) * 7;
          
          // Fetch sincrono (se podría optimizar con esqueleto si es lento)
          await loadWeekPlanning(false); 
          
          // Restaurar el scroll compensando el ancho de los 7 días inyectados
          gridContainer.scrollLeft = currentScroll + shiftWidth;
          if (heatmapArea) heatmapArea.scrollLeft = currentHeatmapScroll + shiftWidth;
          
          // Actualizar índice actual para no romper el heatmap
          window.currentHeatmapStartIndex = (window.currentHeatmapStartIndex || 0) + 7;
          
          isFetchingNextWeek = false;
       }
    });

    // 3. Salto a fecha específica desde el almanaque (Móvil y Escritorio)
    const mobileDatepickerTrigger = document.getElementById('mobile-datepicker-trigger');
    const desktopDatepickerTrigger = document.getElementById('desktop-datepicker-trigger');
    
    function attachDatepickerJump(triggerEl) {
        if (!triggerEl) return;
        triggerEl.addEventListener('change', async (e) => {
            if (!e.target.value) return;
            const parts = e.target.value.split('-');
            const selectedDate = new Date(Date.UTC(parts[0], parts[1]-1, parts[2], 12, 0, 0));
            
            const currentStart = getStartOfWeek(state.currentWeekStart);
            const diffMs = selectedDate - currentStart;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            const colWidth = window.innerWidth <= 768 ? 75 : 120;
            
            if (diffDays >= 0 && diffDays < (state.viewRange || 7)) {
                gridContainer.scrollLeft = diffDays * colWidth;
            } else {
                state.currentWeekStart = getStartOfWeek(selectedDate);
                state.viewRange = 14;
                await loadWeekPlanning(false);
                
                const targetDayIndex = selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1;
                gridContainer.scrollLeft = targetDayIndex * colWidth;
            }
            e.target.value = ''; 
        });
    }
    
    attachDatepickerJump(mobileDatepickerTrigger);
    attachDatepickerJump(desktopDatepickerTrigger);

    // INICIO
    migrateFechas().then(() => {
        loadInitialData();
    });
  