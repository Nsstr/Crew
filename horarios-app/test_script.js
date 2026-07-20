
    console.log("¡ESTOY EDITANDO ESTE ARCHIVO REAL! ->", window.location.href);
    // 1. FIREBASE INITIALIZATION
    // Reemplaza con tus credenciales de Firebase
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getFirestore, collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
    import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import { initPermissionsModule, checkAccess, syncPermissionsUI, renderGestionInvitados, loadPermisosInvitado, crearInvitado, INVITADOS_AUTORIZADOS } from "./admin-permissions.js";

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
    let auth;
    let isMockMode = false;
    try {
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      
      // Persistencia Local (Firestore IndexedDB) para reducir lecturas
      enableIndexedDbPersistence(db).catch((err) => {
          if (err.code == 'failed-precondition') {
              console.warn("Múltiples pestañas abiertas, la persistencia solo se puede habilitar en una.");
          } else if (err.code == 'unimplemented') {
              console.warn("El navegador no soporta persistencia.");
          }
      });

      auth = getAuth(app);
      
      // Persistencia local explícita solicitada
      setPersistence(auth, browserLocalPersistence).catch(console.error);

      // Redirección inteligente y validación
      onAuthStateChanged(auth, (user) => {
         if (user || localStorage.getItem('userLoggedIn') === 'true') {
            if (typeof checkLogin === 'function') {
               checkLogin();
            }
         }
      });
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
      currentWeekStart: (function() {
         const saved = localStorage.getItem('lastDateNav');
         if (saved) return new Date(saved + "T00:00:00");
         const now = new Date();
         const year = now.getFullYear();
         const month = String(now.getMonth() + 1).padStart(2, '0');
         const day = String(now.getDate()).padStart(2, '0');
         const todayStr = `${year}-${month}-${day}`;
         return new Date(todayStr + "T00:00:00");
      })(),
      collaborators: [],
      vacations: [], // { id, collabId, startDate, endDate, weeksCount }
      planning: {}, // key: `${collabId}_${dateString}`, value: slot object or string
      exportedRows: {}, // key: collabId for this week
      holidays: [], // array of date strings 'YYYY-MM-DD'
      monthlySundaysWorked: {}, // key: collabId, value: array of dateStrings (Sundays)
      // ── Gestión de Permisos por Rol ──
      // key: legajo, value: { activo: boolean, permisos: { modificarHorario, imprimirPdf, modificarVacaciones, verMetricas, sugeridos, bajarVacaciones } }
      permisosInvitado: {},
      eventos: {}, // key: 'YYYY-MM-DD', value: { tipo, descripcion, color } de Firebase eventos_diarios
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
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.getFullYear(), d.getMonth(), diff);
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
      let startMon = getStartOfWeek(state.currentWeekStart);
      let current = addDays(startMon, -1); 
      
      // Forzamos el visor estricto a 16 días en pantalla
      for(let i=0; i<16; i++) {
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
      
      // 1. CARGA AL ABRIR LA SESIÓN: Recuperar permisos si entra como invitado por localStorage/localStorage
      if (currentRole === 'invitado' && currentInvitadoLegajo) {
         await loadPermisosInvitado(currentInvitadoLegajo);
      }

      checkLogin(); // Verificar login luego de cargar la BD

      await loadWeekPlanning();
    }

    async function loadWeekPlanning(append = false) {
      if (state.currentWeekStart) {
         localStorage.setItem('lastDateNav', formatDate(state.currentWeekStart));
      }
      const range = state.viewRange || 7;
      const realStartD = getStartOfWeek(state.currentWeekStart);
      const realEndD = addDays(getStartOfWeek(addDays(state.currentWeekStart, range - 1)), 6);
      
      state.planning = state.planning || {};
      state.monthlySundaysWorked = state.monthlySundaysWorked || {};
      
      // Forzar el estado de carga estructural inmediatamente
      state.skeletonStartStr = formatDate(realStartD);
      renderUI(); 

      // Mapeamos los meses del rango para traer ambos si la quincena está partida
      const yearStart = realStartD.getFullYear();
      const monthStart = String(realStartD.getMonth() + 1).padStart(2, '0');
      const yearEnd = realEndD.getFullYear();
      const monthEnd = String(realEndD.getMonth() + 1).padStart(2, '0');

      if (isMockMode) {
        state.skeletonStartStr = null;
        renderUI();
      } else {
        try {
          // Consulta optimizada: Trae SOLAMENTE los días del rango visual
          const q = query(
            collection(db, "planificacion"), 
            where("fecha", ">=", formatDate(realStartD)),
            where("fecha", "<=", formatDate(realEndD))
          );
          const snap = await getDocs(q);
          snap.forEach(doc => {
            const data = doc.data();
            state.planning[`${data.colaboradorId}_${data.fecha}`] = data;
          });



          // Apagar el esqueleto de carga RECIÉN cuando todos los datos están en memoria
          state.skeletonStartStr = null;

          // Cargar eventos del rango visible
          const startStr = formatDate(realStartD);
          const endStr = formatDate(realEndD);
          await loadEventos(startStr, endStr);

          renderUI(); 
          
        } catch(e) {
          console.error("Error en la carga asrincrónica de datos:", e);
          state.skeletonStartStr = null;
          renderUI();
        }
      }
    }

    // Carga eventos del rango visible desde Firebase
    async function loadEventos(startStr, endStr) {
      if (isMockMode) return;
      try {
        const q = query(
          collection(db, "eventos_diarios"),
          where("__name__", ">=", startStr),
          where("__name__", "<=", endStr)
        );
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
          state.eventos[docSnap.id] = docSnap.data();
        });
      } catch(e) {
        console.warn("Error cargando eventos_diarios:", e);
      }
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

      // 7.4 Bloqueo estricto de 32 horas máximas para contratos de jornada reducida (<= 30hs)
      if (collab && collab.hours <= 30) {
         const targetDateObj = new Date(dateStr + "T00:00:00");
         const weekStart = getStartOfWeek(targetDateObj);
         let totalWeekHoursWithNewTurn = 0;

         for (let i = 0; i < 7; i++) {
            const d = addDays(weekStart, i);
            const currentDStr = formatDate(d);
            
            // Si es el día que estamos editando actualmente, sumamos las horas del nuevo turno
            if (currentDStr === dateStr) {
               if (parsedNewSlot && parsedNewSlot.type === 'work') {
                  totalWeekHoursWithNewTurn += parsedNewSlot.hours;
               }
            } else {
               // Si es otro día de la semana, sumamos lo que ya estaba cargado en memoria
               const valDay = getPlanningSlot(collabId, currentDStr);
               const parsedDay = parseShift(valDay);
               if (parsedDay && parsedDay.type === 'work') {
                  totalWeekHoursWithNewTurn += parsedDay.hours;
               }
            }
         }

         // Si la simulación supera el techo de 32 horas, se rechaza el cambio
         if (totalWeekHoursWithNewTurn > 32) {
            return { 
               valid: false, 
               type: 'exceso_horas', 
               msg: `Exceso de horas: Este colaborador tiene un contrato de ${collab.hours}hs y no puede superar las 32 horas semanales máximas permitidas. (Total calculado con este turno: ${totalWeekHoursWithNewTurn}hs)` 
            };
         }
      }

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
             
             // El día 0 es el margen, así que empezamos a contar desde el índice 1
             // SEMANA 1: Índices del 1 al 7 (son 7 días exactos)
             if (i >= 1 && i <= 7) {
                 if (isVac) w1Vac = true;
                 if (parsed && parsed.type === 'work' && !w1Vac) w1Hours += parsed.hours;
             } 
             // SEMANA 2: Índices del 8 al 14 (son 7 días exactos)
             else if (i >= 8 && i <= 14) {
                 if (isVac) w2Vac = true;
                 if (parsed && parsed.type === 'work' && !w2Vac) w2Hours += parsed.hours;
             }
          });
          
          const renderBox = (hours, isVac, metaStr) => {
              const meta = parseFloat(metaStr) || 48;
              const maxPermitido = meta <= 30 ? 32 : 48; 
              
              let color = (hours === meta) ? 'var(--success)' : (hours > meta ? (hours <= maxPermitido ? '#eab308' : 'var(--danger)') : 'var(--danger)');
              let borderStyle = (hours === meta) ? '2px solid' : '1px solid';
              let horasExtras = (hours > maxPermitido) ? (hours - maxPermitido) : 0;
              
              // Si es Vacaciones, devolvemos la misma estructura pero con la V
              if (isVac) {
                  return `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 32px; width: 24px;">
                       <div style="width: 22px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 0.60em; font-weight: bold; border: 1px solid var(--info); color: var(--info);">V</div>
                       <div style="font-size: 0.6rem; color: transparent; visibility: hidden;">Xtr</div>
                    </div>`;
              }
              
              // Bloque de horas con altura y estructura fija
              const text = Number.isInteger(hours) ? hours : hours.toFixed(1);
              return `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 32px; width: 26px; padding: 0 2px;">
                  <div class="hour-box" style="width: 24px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 0.60em; font-weight: bold; border: ${borderStyle} ${color}; color: ${color};">${text}</div>
                  <div style="font-size: 0.6rem; font-weight: bold; color: var(--danger); visibility: ${horasExtras > 0 ? 'visible' : 'hidden'};">
                    Xtr:${horasExtras > 0 ? (Number.isInteger(horasExtras) ? horasExtras : horasExtras.toFixed(1)) : '0'}h
                  </div>
                </div>
              `;
          };

          const w1Container = document.getElementById(`desktop-hours-w1-${collab.id}`);
          if (w1Container) w1Container.innerHTML = renderBox(w1Hours, w1Vac, collab.hours);
          
          const w2Container = document.getElementById(`desktop-hours-w2-${collab.id}`);
          if (w2Container) w2Container.innerHTML = renderBox(w2Hours, w2Vac, collab.hours);

          // Actualización de Domingos Mensuales Basada en Memoria Global
          let restCount = 0;
          monthDays.forEach(d => {
             if (d.getDay() === 0) { // Es domingo estricto
                 const dStr = formatDate(d);
                 
                 // Buscamos de forma directa en el estado de planificación acumulado de la base de datos
                 const objPlan = state.planning[`${collab.id}_${dStr}`];
                 let valToday = '';
                 if (objPlan) {
                     valToday = typeof objPlan === 'string' ? objPlan.toLowerCase() : (objPlan.slot || '').toLowerCase();
                 }
                 
                 if (valToday === 'f' || valToday === 'libre') {
                     restCount++;
                 }
             }
          });
          
          // Semáforo Corregido: El límite es un techo estricto
          let domClass = '';
          const limit = collab.domingosAcordados || 0;
          
          if (restCount > limit) {
              domClass = 'danger';  // ROJO: Se pasó de los domingos asignados (Alerta)
          } else if (restCount < limit) {
              domClass = 'success'; // VERDE: Todavía tiene domingos disponibles en el mes
          } else {
              domClass = '';        // NEUTRO/GRIS: Cumplió la cuota exacta (Equilibrio)
          }
          
          const domBadge = document.getElementById(`dom-badge-${collab.id}`);
          if (domBadge) {
              domBadge.className = `dom-badge ${domClass}`;
              domBadge.innerText = `Dom ${monthName}: ${restCount}/${limit}`;
          }
      });
    }

    window.openMobileProfile = function(collabId) {
       const collab = state.collaborators.find(c => c.id === collabId);
       if (!collab) return;
       const cleanName = (collab.name || 'Desconocido').split('(')[0].split('-')[0].trim();
       document.getElementById('pbName').textContent = cleanName;
       document.getElementById('pbLegajo').textContent = collab.legajo || collab.id || '-';
       document.getElementById('pbSector').textContent = collab.sector || '-';
       document.getElementById('pbCarga').textContent = collab.cargaHoraria ? `${collab.cargaHoraria} hs` : '-';
       document.getElementById('profileBottomSheet').style.display = 'block';
    };

    window.openMobileContextMenu = function(inputElement) {
       if (currentRole === 'visitor') return;
       const simulatedEvent = {
           preventDefault: () => {},
           target: inputElement,
           pageX: window.innerWidth / 2,
           pageY: window.innerHeight - 200
       };
       handleContextMenu(simulatedEvent);
    };

    function renderMobileDayView() {
      const userHasAccess = checkAccess('modificarHorario') || checkAccess('modificarVacaciones');
      const activeEl = document.activeElement;
      let focusCollab = null;
      let focusDate = null;
      if (activeEl && activeEl.classList.contains('cell-input')) {
         focusCollab = activeEl.getAttribute('data-collab');
         focusDate = activeEl.getAttribute('data-date');
      }

      const targetDate = state.currentWeekStart;
      const dStr = formatDate(targetDate);
      const isHoliday = state.holidays.includes(dStr);
      const evento = state.eventos[dStr];
      const prevDateStr = formatDate(addDays(targetDate, -1));

      const weekDaysArr = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
      const monthsArr = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
      const dayLabelText = `${weekDaysArr[targetDate.getDay()]} ${String(targetDate.getDate()).padStart(2, '0')} ${monthsArr[targetDate.getMonth()]}`;
      document.getElementById('weekLabel').textContent = dayLabelText;

      const trHead = document.getElementById('tableHeader');
      const thBg = evento ? `background-color: ${evento.color}22;` : '';
      const holidayBadge = isHoliday ? `<span class="holiday-badge">Feriado</span>` : '';
      const eventBadge = evento ? `<span class="event-badge" style="background-color:${evento.color};">&#128197; ${evento.descripcion}</span>` : '';
      
      trHead.innerHTML = `
        <th style="width: 60%; padding: 4px;">Colaborador</th>
        <th style="width: 40%; text-align: center; padding: 4px; ${thBg}">${dayLabelText} ${holidayBadge}${eventBadge}</th>
      `;

      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';
      console.log("Datos para render móvil:", state.collaborators);

      const hourlyCounts = {};
      for (let h = 0; h <= 23; h++) hourlyCounts[h] = 0;

      const areasOrderMobile = ['Disponibilidad', 'AP', 'Calidad', 'Linea de Cajas', 'Perecederos', 'Limpieza', 'RRHH', 'Gerentes', 'Direccion'];
      const groupedCollabsMobile = {};
      state.collaborators.forEach(c => {
         const area = c.area || 'Disponibilidad';
         if (!groupedCollabsMobile[area]) groupedCollabsMobile[area] = [];
         groupedCollabsMobile[area].push(c);
      });
      Object.keys(groupedCollabsMobile).forEach(k => { if (!areasOrderMobile.includes(k)) areasOrderMobile.push(k); });

      areasOrderMobile.forEach(areaName => {
         if (!groupedCollabsMobile[areaName] || groupedCollabsMobile[areaName].length === 0) return;
         
         const headerRow = document.createElement('tr');
         headerRow.className = 'area-header-row';
         headerRow.style.background = 'var(--danger)';
         headerRow.style.color = '#fff';
         headerRow.innerHTML = `<td colspan="2" style="padding: 4px 15px; font-weight: bold; font-size: 0.85rem; text-transform: uppercase;">${areaName}</td>`;
         tbody.appendChild(headerRow);

         groupedCollabsMobile[areaName].forEach(c => {
          const tr = document.createElement('tr');
          tr.style.willChange = 'transform';
          const objForTardanza = getPlanningObj(c.id, dStr) || {};
          const valToday = getPlanningSlot(c.id, dStr);
          const parsedToday = parseShift(valToday, objForTardanza.tardanzaMinutosTotales || 0);
          
          const targetDToday = new Date(dStr + "T00:00:00");
          const targetDPrev = new Date(prevDateStr + "T00:00:00");
          let isOnVacationToday = false;
          let isOnVacationPrev = false;
          for (let vac of (state.vacations || [])) {
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

      state.collaborators.forEach(collab => {
          const tr = document.createElement('tr');
          
          const targetDToday = new Date(dStr + "T00:00:00");
          let isOnVacationToday = false;
          for (let vac of (state.vacations || [])) {
              if (vac.colaboradorId === collab.id) {
                  const vacStart = new Date(vac.startDate + "T00:00:00");
                  const vacEnd = new Date(vac.endDate + "T00:00:00");
                  if (targetDToday >= vacStart && targetDToday <= vacEnd) isOnVacationToday = true;
              }
          }

          if (isOnVacationToday) {
             tr.style.background = 'rgba(234, 179, 8, 0.1)';
             tr.style.opacity = '0.7';
          }
          if (!collab.name) {
              // Si aún así no hay nombre, evitamos que se rompa.
              collab.name = 'Desconocido';
          }
          const cleanName = collab.name.split('(')[0].split('-')[0].trim();
          const nameParts = cleanName.split(' ');
          const apeF = nameParts[0] || '-';
          const nomF = nameParts.slice(1).join(' ') || '';
          
          let avatarStr = '';
          if (nameParts.length > 1) {
              avatarStr = apeF.charAt(0).toUpperCase() + nomF.charAt(0).toUpperCase();
          } else {
              avatarStr = apeF.charAt(0).toUpperCase() + (apeF.length > 1 ? apeF.charAt(1).toUpperCase() : '');
          }

          let cellsHTML = `
            <td style="cursor: pointer; padding: 2px !important;" onclick="openMobileProfile('${collab.id}')">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div class="avatar" style="width: 24px; height: 24px; font-size: 0.7rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">${avatarStr}</div>
                <div style="display: flex; flex-direction: column; overflow: hidden; white-space: nowrap;">
                  <span style="font-weight: 600; font-size: 0.85rem; text-overflow: ellipsis; overflow: hidden; line-height: 1.1;">${apeF}</span>
                  <span style="font-size: 0.7rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; line-height: 1.1;">${nomF}</span>
                </div>
              </div>
            </td>
          `;

          let shiftVal = getPlanningSlot(collab.id, dStr);
          if (isOnVacationToday) shiftVal = 'V';
          
          const isTiendaCerrada = evento && evento.tiendaCerrada;
          if (isTiendaCerrada) shiftVal = 'LIBRE';
          
          let inputDisabled = isOnVacationToday || isTiendaCerrada || !userHasAccess;
          let cellStyle = isTiendaCerrada ? "background-color: rgba(100, 116, 139, 0.2);" : "";
          
          cellsHTML += `
            <td style="padding: 2px; ${cellStyle}">
              <input type="text" class="cell-input" 
                     data-collab="${collab.id}" data-date="${dStr}" 
                     value="${shiftVal}" 
                     style="height: 48px; font-size: 1.25rem; font-weight: 700; width: 100%; margin: 0; display: block; border-radius: 6px; text-align: center; border: 1px solid var(--border); box-sizing: border-box; opacity: 1 !important; ${inputDisabled ? 'cursor: not-allowed;' : ''}"
                     ${inputDisabled ? 'disabled' : ''}
                     ${!inputDisabled ? 'readonly onclick="openMobileContextMenu(this)"' : ''}>
            </td>
          `;

          tr.innerHTML = cellsHTML;
          tbody.appendChild(tr);
         });
      });
      
      if (focusCollab && focusDate) {
         const inp = document.querySelector(`.cell-input[data-collab="${focusCollab}"][data-date="${focusDate}"]`);
         if (inp) {
            inp.focus();
            setTimeout(() => {
               if(inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length);
            }, 0);
         }
      }
    }

    window.addEventListener('resize', () => {
       clearTimeout(window.resizeTimer);
       window.resizeTimer = setTimeout(() => {
           renderUI();
       }, 250);
    });

    function renderMobileCoverageDashboard(targetDate) {
       const dashboard = document.getElementById('mobile-coverage-dashboard');
       if (!dashboard) return;
       if (window.innerWidth > 768) {
           dashboard.style.display = 'none';
           return;
       }
       dashboard.style.display = 'grid';
       
       let dStr = formatDate(targetDate);

       const isTiendaCerrada = state.eventos[dStr] && state.eventos[dStr].tiendaCerrada;
       if (isTiendaCerrada) {
           dashboard.style.display = 'block';
           dashboard.innerHTML = `
               <div style="width: 100%; text-align: center; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid var(--danger);">
                   <span style="font-size: 1.1rem; font-weight: 800; color: var(--danger); letter-spacing: 1px;">TIENDA CERRADA</span>
               </div>
           `;
           return;
       }

       const hourlyCounts = Array(24).fill(0);
       state.collaborators.forEach(collab => {
           const shiftVal = getPlanningSlot(collab.id, dStr);
           if (!shiftVal) return;
           
           let isOnVacationToday = false;
           const targetDToday = new Date(dStr + "T00:00:00");
           for (let vac of (state.vacations || [])) {
               if (vac.colaboradorId === collab.id) {
                   const vacStart = new Date(vac.startDate + "T00:00:00");
                   const vacEnd = new Date(vac.endDate + "T00:00:00");
                   if (targetDToday >= vacStart && targetDToday <= vacEnd) isOnVacationToday = true;
               }
           }
           if (isOnVacationToday) return;

           const lower = shiftVal.toLowerCase();
           if (lower === 'f' || lower === 'v' || lower === 'libre' || lower === 'vacaciones') return;

           const parsed = parseShift(shiftVal);
           if (parsed && parsed.type === 'work') {
               for (let h = 0; h <= 23; h++) {
                   if (parsed.end <= parsed.start) {
                       if (h >= parsed.start) hourlyCounts[h]++; 
                   } else {
                       if (h >= parsed.start && h < parsed.end) hourlyCounts[h]++;
                   }
               }
           }
       });

       let blocksHTML = '';
       for (let h = 0; h <= 23; h++) {
           let count = hourlyCounts[h];
           let colorStr = count >= 2 ? '#22c55e' : '#ef4444';
           let hStr = h.toString().padStart(2, '0') + ':00';
           
           blocksHTML += `
             <div class="mobile-cov-block">
               <span class="mobile-cov-time">${hStr}</span>
               <span class="mobile-cov-val" style="color: ${colorStr}; text-shadow: 0 0 10px ${colorStr}60;">${count}</span>
             </div>
           `;
       }
       dashboard.innerHTML = blocksHTML;
    }

    function renderUI() {
       const modularGrid = document.getElementById('modularGridContainer');
       const planningTable = document.getElementById('planningTable');

       if (window.innerWidth <= 768) {
           if(modularGrid) modularGrid.style.display = 'none';
           if(planningTable) planningTable.style.display = 'table';
           renderMobileDayView();
           renderMobileCoverageDashboard(state.currentWeekStart);
       } else {
           if(modularGrid) modularGrid.style.display = 'flex';
           if(planningTable) planningTable.style.display = 'none';
           renderDesktopView();
       }
    }

    function renderDesktopView() {
      // 1. Guardar Estado Antes del Render y centralizar permisos
      const userHasAccess = checkAccess('modificarHorario') || checkAccess('modificarVacaciones');
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

      // Build shared generic thead HTML string for all area tables
      let theadHTML = `<tr><th class="collab-cell collab-cell-sticky" style="z-index: 30; border-right: 2px solid var(--border);">Colaborador</th>`;
      days.forEach(d => {
        const dStr = formatDate(d);
        const isHoliday = state.holidays.includes(dStr);
        const evento = state.eventos[dStr];
        const weekDaysArr = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const monthsArr = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
        const dayNumStr = String(d.getDate()).padStart(2, '0');
        const dayName = `${weekDaysArr[d.getDay()]} ${dayNumStr} ${monthsArr[d.getMonth()]}`;
        
        const isToday = formatDate(d) === formatDate(new Date());
        const todayClass = isToday ? 'dia-actual ' : '';
        const thClass = todayClass + (isHoliday ? 'holiday-col day-column' : 'day-column');
        const thBg = evento ? `background-color: ${evento.color}22;` : '';
        const holidayBadge = isHoliday ? `<span class="holiday-badge">Feriado</span>` : '';
        const eventBadge = evento ? `<span class="event-badge" style="background-color:${evento.color};">&#128197; ${evento.descripcion}</span>` : '';
        theadHTML += `<th class="${thClass}" style="text-align: center; ${thBg}">${dayName} ${holidayBadge}${eventBadge}</th>`;
      });
      theadHTML += `</tr>`;
      
      const abandonmentMap = calculateAbandonment();
      const weekHasHoliday = days.some(d => state.holidays.includes(formatDate(d)));

      const areasOrderDesktop = ['Disponibilidad', 'AP', 'Calidad', 'Linea de Cajas', 'Perecederos', 'Limpieza', 'RRHH', 'Gerentes', 'Direccion'];
      const groupedCollabsDesktop = {};
      state.collaborators.forEach(c => {
         const area = c.area || 'Disponibilidad';
         if (!groupedCollabsDesktop[area]) groupedCollabsDesktop[area] = [];
         groupedCollabsDesktop[area].push(c);
      });
      Object.keys(groupedCollabsDesktop).forEach(k => { if (!areasOrderDesktop.includes(k)) areasOrderDesktop.push(k); });

      const modularGrid = document.getElementById('modularGridContainer');
      if(modularGrid) modularGrid.innerHTML = '';

      areasOrderDesktop.forEach(areaName => {
         if (!groupedCollabsDesktop[areaName] || groupedCollabsDesktop[areaName].length === 0) return;
         
         const areaCollabs = groupedCollabsDesktop[areaName];

         const moduleDiv = document.createElement('div');
         moduleDiv.className = 'area-module';

         const titleDiv = document.createElement('div');
         titleDiv.className = 'area-title-header';
         titleDiv.style.background = 'var(--danger)';
         titleDiv.style.color = '#fff';
         titleDiv.style.padding = '6px 15px';
         titleDiv.style.fontWeight = 'bold';
         titleDiv.style.fontSize = '0.9rem';
         titleDiv.style.textTransform = 'uppercase';
         titleDiv.style.position = 'sticky';
         titleDiv.style.left = '0';
         titleDiv.textContent = areaName;
         moduleDiv.appendChild(titleDiv);

         const scrollWrapper = document.createElement('div');
         scrollWrapper.className = 'area-scroll-wrapper';
         scrollWrapper.style.overflowX = 'auto';
         scrollWrapper.onscroll = (e) => window.syncScroll && window.syncScroll(e);

         const table = document.createElement('table');
         table.className = 'planningTable area-table';
         
         const thead = document.createElement('thead');
         thead.innerHTML = theadHTML;
         table.appendChild(thead);

         const tbody = document.createElement('tbody');

         // Fila Métrica Sectorial (Total Presentes)
         const metricRow = document.createElement('tr');
         metricRow.className = 'fila-metrica-sectorial';
         metricRow.style.background = 'rgba(16, 185, 129, 0.15)';
         metricRow.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
         
         const metricLabel = document.createElement('td');
         metricLabel.textContent = 'Total Presentes';
         metricLabel.className = 'collab-cell collab-cell-sticky';
         metricLabel.style.fontWeight = '600';
         metricLabel.style.color = 'var(--success)';
         metricLabel.style.fontSize = '0.8rem';
         metricLabel.style.padding = '4px 15px';
         metricRow.appendChild(metricLabel);

         days.forEach(d => {
             const dStr = formatDate(d);
             let presentes = 0;
             areaCollabs.forEach(c => {
                 const val = getPlanningSlot(c.id, dStr);
                 const parsed = parseShift(val);
                 if (parsed && (parsed.type === 'work' || parsed.type === 'normal' || parsed.type === 'cierre' || parsed.type === 'apertura' || parsed.type === 'reparto')) {
                     presentes++;
                 }
             });
             const td = document.createElement('td');
             td.textContent = presentes;
             td.style.textAlign = 'center';
             td.style.fontWeight = 'bold';
             td.style.color = 'var(--success)';
             td.style.fontSize = '0.9rem';
             metricRow.appendChild(td);
         });
         tbody.appendChild(metricRow);

         // Fila Total Francos Sectorial
         const francoRow = document.createElement('tr');
         francoRow.className = 'fila-francos-sectorial';
         francoRow.style.background = 'rgba(168, 85, 247, 0.1)';
         francoRow.style.borderBottom = '2px solid var(--border)';
         
         const francoLabel = document.createElement('td');
         francoLabel.textContent = 'Total Francos';
         francoLabel.className = 'collab-cell collab-cell-sticky';
         francoLabel.style.fontWeight = '600';
         francoLabel.style.color = '#a855f7';
         francoLabel.style.fontSize = '0.8rem';
         francoLabel.style.padding = '4px 15px';
         francoRow.appendChild(francoLabel);

         days.forEach(d => {
             const dStr = formatDate(d);
             let francos = 0;
             areaCollabs.forEach(c => {
                 const val = getPlanningSlot(c.id, dStr);
                 const parsed = parseShift(val);
                 if (parsed && (parsed.type === 'franco' || parsed.type === 'libre')) {
                     francos++;
                 }
             });
             const td = document.createElement('td');
             td.textContent = francos;
             td.style.textAlign = 'center';
             td.style.fontWeight = 'bold';
             td.style.color = '#a855f7';
             td.style.fontSize = '0.9rem';
             francoRow.appendChild(td);
         });
         tbody.appendChild(francoRow);

         areaCollabs.forEach(collab => {
        const tr = document.createElement('tr');
        tr.style.willChange = 'transform';
        
        let cellsHTML = '';
        
        // Collab info
        const maxAbandon = Math.max(...days.map(d => abandonmentMap[collab.pasillo][formatDate(d)]));
        let indClass = '';
        if (maxAbandon >= 4) indClass = 'red';
        else if (maxAbandon >= 2) indClass = 'yellow';

        const cleanName = collab.name.split('(')[0].split('-')[0].trim();

        let html = `
          <td class="collab-cell collab-cell-sticky" style="width: 350px; min-width: 350px; padding: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; height: 100%; padding: 2px 12px; box-sizing: border-box; gap: 8px;">
              
              <div style="display: flex; flex-direction: column; gap: 2px; text-align: left; min-width: 0; flex: 1;">
                <div style="font-weight: bold; font-size: 0.75em; color: #fff; display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  <div class="indicator ${indClass}" title="Abandono Sector: ${maxAbandon} días" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex-shrink: 0;"></div>
                  ${collab.id} ${cleanName}
                </div>
                <div class="mobile-hours-tag" id="mobile-hours-${collab.id}"></div>
                <div class="collab-meta" style="font-size: 0.8em; display: flex; align-items: center; justify-content: flex-start; gap: 0.4rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  <span>${collab.pasillo}</span>
                  <span style="opacity: 0.6;">(${collab.hours}h)</span>
                  <span style="opacity: 0.3">|</span>
                  <span id="dom-badge-${collab.id}" class="dom-badge" style="padding: 0 0.2rem; font-size: 0.7em;" title="Domingos"></span>
                </div>
              </div>
              
              <div id="desktop-hours-${collab.id}-left" style="display: flex; gap: 12px; padding-left: 4px; margin-left: auto; flex-shrink: 0; align-items: flex-start;">
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
          let isDisabled = !userHasAccess;

          let vacationTagHtml = '';
          const isTiendaCerrada = state.eventos[dStr] && state.eventos[dStr].tiendaCerrada;

          if (isTiendaCerrada) {
             val = 'LIBRE';
             inputClass = 'input-libre';
             isDisabled = true;
          } else if (isPreVacationSunday) {
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
          const isToday = dStr === formatDate(new Date());
          const todayClass = isToday ? ' dia-actual' : '';
          let finalWrapperClass = wrapperClass + (isSkeleton ? ' skeleton-cell' : '') + ' day-cell' + todayClass;
          
          let hasRestError = false;
          if (parsed && parsed.type === 'work') {
             const prevDateStr = formatDate(addDays(d, -1));
             const prevSlotKey = getPlanningSlot(collab.id, prevDateStr);
             const prevSlot = parseShift(prevSlotKey);
             if (prevSlot && prevSlot.type === 'work') {
                let currAbs = getShiftAbsoluteTimes(dStr, parsed);
                let prevAbs = getShiftAbsoluteTimes(prevDateStr, prevSlot);
                if (currAbs && prevAbs && (currAbs.start - prevAbs.end) / 3600000 < 12) {
                   hasRestError = true;
                }
             }
          }
          
          if (hasRestError) {
             inputClass += ' franco-error';
          }

          let finalInputClass = inputClass + (isSkeleton ? ' skeleton-input' : '');

          const eventoDelDia = state.eventos[dStr];
          const esInventarioCelda = obj && obj.esInventario && eventoDelDia;
          let eventoCellStyle = esInventarioCelda ? `background-color: ${eventoDelDia.color}33;` : '';
          
          if (isTiendaCerrada) {
              eventoCellStyle = 'background-color: rgba(100, 116, 139, 0.2);';
          }

          html += `
            <td class="${isHoliday ? 'holiday-col' : ''} ${finalWrapperClass}" ${titleAttr} style="position: relative; ${isOnVacation ? 'background-color: rgba(14, 165, 233, 0.08);' : ''}${eventoCellStyle}">
              ${vacationTagHtml}
              <input type="text" class="cell-input ${finalInputClass}" style="${styleStr}" data-collab="${collab.id}" data-date="${dStr}" value="${val}" ${isDisabled ? 'disabled' : ''} placeholder="-">
            </td>
          `;
        });


        tr.innerHTML = html;
        tr.innerHTML = html;
        tbody.appendChild(tr);
         }); // End areaCollabs.forEach
         
         table.appendChild(tbody);
         scrollWrapper.appendChild(table);
         moduleDiv.appendChild(scrollWrapper);
         if (modularGrid) modularGrid.appendChild(moduleDiv);
      }); // End areasOrderDesktop.forEach
      
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
             else if (e.key === 'ArrowUp') nextIndex = index - 16;   /* Sube recto en la grilla de 16 columnas */
             else if (e.key === 'ArrowDown') nextIndex = index + 16; /* Baja recto en la grilla de 16 columnas */
             else if (e.key === 'ArrowLeft') nextIndex = index - 1;
             else if (e.key === 'ArrowRight') nextIndex = index + 1;

             const nextNode = inputs[nextIndex];
             if (nextNode) {
                const targetCollab = nextNode.getAttribute('data-collab');
                const targetDate = nextNode.getAttribute('data-date');
                el.blur();
                const freshNode = document.querySelector(`.cell-input[data-collab="${targetCollab}"][data-date="${targetDate}"]`);
                if (freshNode) {
                   freshNode.focus();
                   freshNode.select();
                }
             }
           }
        });
      });

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

    // MÓDULO EVENTOS DIARIOS — Modal de gestión
    // ============================================================

    window.openEventosModal = async function() {
      document.getElementById('eventosModal').style.display = 'flex';
      const hoy = formatDate(new Date());
      document.getElementById('eventoFechaInput').value = hoy;
      if (document.getElementById('eventoTiendaCerradaInput')) {
        document.getElementById('eventoTiendaCerradaInput').checked = false;
      }

      // Mostrar/ocultar controles de escritura según permiso
      const puedeEditar = checkAccess('gestionarEventos');
      const formBox = document.querySelector('#eventosModal [data-eventos-form]') || document.querySelector('#eventosModal > div > div:nth-child(3)');
      const guardarBtn = document.querySelector('#eventosModal button[onclick="window.saveEvento()"]');
      if (guardarBtn) guardarBtn.style.display = puedeEditar ? '' : 'none';

      // Banner de solo lectura
      const banner = document.getElementById('eventosSoloLecturaBanner');
      if (banner) banner.style.display = puedeEditar ? 'none' : 'flex';

      await window.renderEventosList();
    };

    window.renderEventosList = async function() {
      const container = document.getElementById('eventosListContainer');
      container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">Cargando...</p>';
      if (isMockMode) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">No disponible en modo demo.</p>';
        return;
      }
      try {
        // Traer todos los eventos del año en curso para el listado del modal
        const year = new Date().getFullYear();
        const q = query(
          collection(db, "eventos_diarios"),
          where("__name__", ">=", `${year}-01-01`),
          where("__name__", "<=", `${year}-12-31`)
        );
        const snap = await getDocs(q);
        const eventos = [];
        snap.forEach(d => eventos.push({ id: d.id, ...d.data() }));
        eventos.sort((a, b) => a.id.localeCompare(b.id));
        if (eventos.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">Sin eventos registrados este año.</p>';
          return;
        }
        container.innerHTML = eventos.map(ev => `
          <div style="display: flex; align-items: center; gap: 10px; background: var(--bg); border: 1px solid ${ev.color}55; border-left: 4px solid ${ev.color}; border-radius: 8px; padding: 10px 12px;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; font-size: 0.9rem; color: var(--text);">${ev.tipo}: ${ev.descripcion} ${ev.tiendaCerrada ? '<span style="color:var(--danger); font-size:0.75rem; border:1px solid var(--danger); padding:2px 4px; border-radius:4px; margin-left:6px; display:inline-block;">CERRADO</span>' : ''}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${ev.id}</div>
            </div>
            <div style="width: 20px; height: 20px; border-radius: 50%; background: ${ev.color}; flex-shrink: 0; border: 2px solid rgba(255,255,255,0.2);"></div>
            <button onclick="window.deleteEvento('${ev.id}')" style="background: transparent; border: 1px solid var(--danger); color: var(--danger); border-radius: 6px; padding: 4px 10px; font-size: 0.75rem; cursor: pointer; font-family: inherit; flex-shrink: 0;">Borrar</button>
          </div>
        `).join('');
      } catch(e) {
        container.innerHTML = '<p style="color: var(--danger); font-size: 0.85rem; text-align: center; padding: 1rem;">Error al cargar eventos.</p>';
        console.error("Error cargando lista de eventos:", e);
      }
    };

    window.saveEvento = async function() {
      if (!requireAuth()) return;
      if (!checkAccessWithToast('gestionarEventos')) return;
      const fecha = document.getElementById('eventoFechaInput').value;
      const tipo = document.getElementById('eventoTipoInput').value;
      const descripcion = document.getElementById('eventoDescInput').value.trim();
      const color = document.getElementById('eventoColorInput').value;
      const tiendaCerrada = document.getElementById('eventoTiendaCerradaInput').checked;
      if (!fecha || !descripcion) {
        showToast("Campos incompletos", "Completá la fecha y la descripción del evento.", "warning");
        return;
      }
      if (!isMockMode) {
        try {
          await setDoc(doc(db, "eventos_diarios", fecha), { tipo, descripcion, color, tiendaCerrada });
          state.eventos[fecha] = { tipo, descripcion, color, tiendaCerrada };
          showToast("Evento guardado", `${tipo}: ${descripcion} — ${fecha}`, "success");
          document.getElementById('eventoDescInput').value = '';
          document.getElementById('eventoTiendaCerradaInput').checked = false;
          await window.renderEventosList();
          renderUI();
        } catch(e) {
          showToast("Error", "No se pudo guardar el evento.", "error");
          console.error("Error guardando evento:", e);
        }
      }
    };

    window.deleteEvento = async function(fecha) {
      if (!requireAuth()) return;
      if (!checkAccessWithToast('gestionarEventos')) return;
         if (!isMockMode) {
        try {
          const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
          await deleteDoc(doc(db, "eventos_diarios", fecha));
          delete state.eventos[fecha];
          showToast("Evento eliminado", `El evento del ${fecha} fue borrado.`, "info");
          await window.renderEventosList();
          renderUI();
        } catch(e) {
          showToast("Error", "No se pudo borrar el evento.", "error");
          console.error("Error borrando evento:", e);
        }
      }
    };

    window.forceHardRefresh = function() {
      if (!confirm("Esto cerrará la sesión actual, limpiará la caché y recargará la aplicación. ¿Deseás continuar?")) return;
      
      localStorage.clear();
      sessionStorage.clear();
      
      if ('caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        }).finally(() => {
          window.location.reload(true);
        });
      } else {
        window.location.reload(true);
      }
    };

    // Dropdown Header Menu Logic
    document.addEventListener('DOMContentLoaded', () => {
       const toggleBtn = document.getElementById('navDropdownToggle');
       const dropdownMenu = document.getElementById('navDropdownMenu');
       if (toggleBtn && dropdownMenu) {
           toggleBtn.addEventListener('click', (e) => {
               e.stopPropagation();
               const isVisible = dropdownMenu.style.display === 'flex';
               dropdownMenu.style.display = isVisible ? 'none' : 'flex';
           });

           document.addEventListener('click', (e) => {
               if (!dropdownMenu.contains(e.target) && e.target !== toggleBtn) {
                   dropdownMenu.style.display = 'none';
               }
           });
       }
    });
  