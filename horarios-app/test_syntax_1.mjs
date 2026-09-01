
console.log("MEJOR SALI! ->", window.location.href);

// 1. FIREBASE INITIALIZATION
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch, enableMultiTabIndexedDbPersistence, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJZeUE4k1XHIyxQ4lRmKvlH0eHeAZky4o",
  authDomain: "crew-bb7bb.firebaseapp.com",
  projectId: "crew-bb7bb",
  storageBucket: "crew-bb7bb.firebasestorage.app",
  messagingSenderId: "613900683663",
  appId: "1:613900683663:web:f825e871a9cbb32f3ba3fa",
};

let db, auth, storage;
let isMockMode = false;
window.appInitialized = false;

window.initApp = function() {
    if (window.appInitialized) return;
    window.appInitialized = true;
    loadInitialData();
    if (typeof migrateFechas === 'function') {
        migrateFechas().catch(e => console.warn("Migración pausada:", e));
    }
};

window.applyPermissionsUI = function() {
    const loginModalEl = document.getElementById("loginModal");
    if (loginModalEl) loginModalEl.style.setProperty("display", "none", "important");
    if (typeof checkLogin === "function") checkLogin();
    if (typeof renderUI === "function") renderUI();
};

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  auth = getAuth(app);

  enableMultiTabIndexedDbPersistence(db).catch(() => {});
  setPersistence(auth, browserLocalPersistence).catch(() => {});

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const legajoExtraido = user.email.split("@")[0];
        
        // CONSULTA EXCLUSIVA A FIREBASE (Única fuente de verdad para los roles)
        const q = query(collection(db, "usuarios"), where("email", "==", user.email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          window.userProfile = querySnapshot.docs[0].data();
        } else {
          // Si el usuario no tiene documento creado en la colección usuarios, se le asigna rol Consulta por defecto
          let nombreReal = "Usuario";
          if (typeof state !== 'undefined' && state.collaborators) {
              const empleado = state.collaborators.find(c => c.id === legajoExtraido || c.legajo === legajoExtraido);
              if (empleado) nombreReal = empleado.name.split("(")[0].trim();
          }
          
          window.userProfile = { 
              rol: "Consulta", 
              email: user.email, 
              legajo: legajoExtraido, 
              nombre: nombreReal 
          };
          
          if (!isMockMode) {
             setDoc(doc(db, "usuarios", user.email), window.userProfile).catch(console.error);
          }
        }

        const rolNorm = (window.userProfile.rol || "consulta").toLowerCase().trim();
        
        if (["admin", "administrador", "supervisor"].includes(rolNorm)) {
          currentRole = "admin";
          localStorage.setItem("adminLogged", "true");
        } else if (rolNorm === "editor") {
          currentRole = "editor";
          localStorage.setItem("editorLegajo", window.userProfile.legajo || "");
          localStorage.setItem("editorNombre", window.userProfile.nombre || "");
        } else {
          currentRole = "invitado";
          currentInvitadoLegajo = window.userProfile.legajo || "";
        }

        window.applyPermissionsUI();
      } catch (error) {
        console.error("Error al leer perfil de Firestore:", error);
        window.userProfile = { rol: "Consulta", email: user.email };
        currentRole = "invitado";
        window.applyPermissionsUI();
      }
    } else {
      currentRole = "visitor";
      window.userProfile = null;
      if (typeof checkLogin === "function") checkLogin();
    }
  });

  window.initApp();

} catch (e) {
  isMockMode = true;
  window.initApp();
}
  



// 2. PARSING Y LÓGICA DE TURNOS
function parseShift(val, tardanzaMinutosTotales = 0) {
  if (!val) return null;
  val = val.toString().trim().toLowerCase();

  // Extraer prefijo NV (No Viene) en distintas variantes: NV, NV/, NV-, NV 14a22, NV14a22
  let isNV = false;
  const nvMatch = val.match(/^nv[\/\-\s]*(.*)$/);
  if (nvMatch) {
    isNV = true;
    val = nvMatch[1];
    if (val === "") {
      return { type: "absence", label: "NV", class: "input-nv", hours: 0 };
    }
  }

  if (val === "f")
    return { type: "franco", label: "F", class: "input-franco", hours: 0 };
  if (val === "v")
    return { type: "vacation", label: "V", class: "input-absence", hours: 0 };
  if (val === "e")
    return { type: "absence", label: "E", class: "input-absence", hours: 0 };
  if (val === "libre" || val === "l")
    return { type: "libre", label: "LIBRE", class: "input-libre", hours: 0 };
  if (val === "-") return { type: "none", label: "", class: "", hours: 0 };

  const match = val.match(/^(\d{1,2})(?::(\d{2}))?a(\d{1,2})(?::(\d{2}))?$/);
  if (match) {
    let startH = parseInt(match[1], 10);
    let startM = match[2] ? parseInt(match[2], 10) : 0;
    let endH = parseInt(match[3], 10);
    let endM = match[4] ? parseInt(match[4], 10) : 0;

    let totalStartMins = startH * 60 + startM + tardanzaMinutosTotales;
    startH = Math.floor(totalStartMins / 60);
    startM = totalStartMins % 60;

    let start = startH + startM / 60;
    let end = endH + endM / 60;

    if (startH >= 0 && startH <= 24 && endH >= 0 && endH <= 24) {
      let hours = end <= start ? 24 - start + end : end - start;

      let startStr =
        startM > 0
          ? `${startH}:${String(startM).padStart(2, "0")}`
          : `${startH}`;
      let endStr =
        endM > 0 ? `${endH}:${String(endM).padStart(2, "0")}` : `${endH}`;
      let formattedLabel = `${startStr}a${endStr}`;

      let group = null;
      if (startH >= 4 && startH <= 10) group = "M";
      else if (startH >= 11 && startH <= 13) group = "I";
      else if (startH >= 14 && startH <= 19) group = "T";
      else if (startH >= 20) group = "N";
      else if (startH < 4) group = "E";

      if (isNV) {
        return {
          type: "work",
          label: `NV/${formattedLabel}`,
          start,
          end,
          hours: 0,
          realHours: hours,
          class: "input-nv",
          group,
          isNV: true,
        };
      }

      return {
        type: "work",
        label: formattedLabel,
        start,
        end,
        hours,
        class: "input-work",
        group,
      };
    }
  }
  return { type: "error", label: val, class: "input-error", hours: 0 };
}

function getShiftAbsoluteTimes(dateStr, parsedSlot) {
  if (!parsedSlot || parsedSlot.type !== "work") return null;
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
  const parts = dateStr.split("-");
  if (parts.length !== 3) return "Mala";
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if ((m === 12 && d >= 15) || m === 1 || m === 2 || (m === 3 && d <= 15)) {
    return "Buena";
  }
  return "Mala";
}

let unsubscribePlanning = null;

// 3. ESTADO DE LA APLICACIÓN (Caché local)
const state = {
  viewRange: 14,
  currentWeekStart: (function () {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;
    return new Date(todayStr + "T00:00:00");
  })(),
  collaborators: [],
  repositoresData: [],
  vacations: [], // { id, collabId, startDate, endDate, weeksCount }
  planning: {}, // key: `${collabId}_${dateString}`, value: slot object or string
  exportedRows: {}, // key: collabId for this week
  holidays: [], // array of date strings 'YYYY-MM-DD'
  monthlySundaysWorked: {}, // key: collabId, value: array of dateStrings (Sundays)
  // ── Gestión de Permisos por Rol ──
  // key: legajo, value: { activo: boolean, permisos: { modificarHorario, imprimirPdf, modificarVacaciones, verMetricas, sugeridos, bajarVacaciones } }
  permisosInvitado: {},
  eventos: {}, // key: 'YYYY-MM-DD', value: { tipo, descripcion, color } de Firebase eventos_diarios
  tawDates: [],
  armadoDates: [],
};

// Helpers para metadatos de turnos
function getMonthlyRotationCompliance(collab, currentWeekDays) {
  const weekDates = currentWeekDays.slice(0, 7);
  const monthCounts = {};
  weekDates.forEach((d) => {
    const m = d.getMonth();
    monthCounts[m] = (monthCounts[m] || 0) + 1;
  });
  let targetMonth = -1;
  let maxCount = 0;
  for (let m in monthCounts) {
    if (monthCounts[m] > maxCount) {
      maxCount = monthCounts[m];
      targetMonth = parseInt(m);
    }
  }
  const targetYear = weekDates
    .find((d) => d.getMonth() === targetMonth)
    .getFullYear();

  let weeks = [];
  let currentIter = getStartOfWeek(new Date(targetYear, targetMonth, 1));
  currentIter = addDays(currentIter, -1);

  for (let w = 0; w < 6; w++) {
    let weekDays = [];
    let monthDayCount = 0;
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(currentIter));
      if (currentIter.getMonth() === targetMonth) monthDayCount++;
      currentIter = addDays(currentIter, 1);
    }
    if (monthDayCount >= 4) {
      weeks.push(weekDays);
    }
    if (
      currentIter.getMonth() > targetMonth ||
      currentIter.getFullYear() > targetYear
    ) {
      if (monthDayCount < 4) break;
    }
  }

  let weeklyTypes = [];
  let tooltipLines = [];

  weeks.forEach((week, index) => {
    let mCount = 0;
    let tCount = 0;
    let iCount = 0;

    week.forEach((date) => {
      let dStr = formatDate(date);
      let rawVal = getPlanningSlot(collab.id, dStr);
      if (!rawVal) return;
      let parsed = parseShift(rawVal);
      if (parsed && parsed.type === "work") {
        if (parsed.group === "I") iCount++;
        else if (parsed.start < 14) mCount++;
        else tCount++;
      }
    });

    let weekType = "M";
    if (tCount > mCount && tCount > iCount) weekType = "T";
    else if (iCount > mCount && iCount > tCount) weekType = "I";
    else if (mCount === 0 && tCount === 0 && iCount === 0) weekType = "N/A";

    weeklyTypes.push(weekType);
    let d1 = week[0].toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
    });
    let d2 = week[6].toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
    });
    tooltipLines.push(
      `Semana ${index + 1} (${d1} a ${d2}): ${weekType !== "N/A" ? "Turno " + weekType : "Sin turnos"}`,
    );
  });

  let validTypes = weeklyTypes.filter((t) => t !== "N/A");
  let uniqueTypes = new Set(validTypes);
  let compliant = false;
  let statusStr = "";

  let esquema = collab.esquema || "";
  let esqUpper = esquema.toUpperCase().trim();
  let isFixed = false;
  let expectedFixedShift = null;

  if (esqUpper === "M" || esqUpper === "T" || esqUpper === "I") {
    isFixed = true;
    expectedFixedShift = esqUpper;
  } else if (esqUpper.includes("FIJO")) {
    isFixed = true;
    if (esqUpper.includes("M")) expectedFixedShift = "M";
    else if (esqUpper.includes("T")) expectedFixedShift = "T";
    else if (esqUpper.includes("I")) expectedFixedShift = "I";
  }

  if (isFixed) {
    if (expectedFixedShift) {
      compliant = validTypes.every((t) => t === expectedFixedShift);
      statusStr = compliant
        ? `Cumple (Fijo ${expectedFixedShift})`
        : `No Cumple (Debía ser ${expectedFixedShift})`;
    } else {
      compliant = uniqueTypes.size <= 1;
      statusStr = compliant
        ? "Cumple (Turno Fijo)"
        : "No Cumple (Rotó en turno fijo)";
    }
  } else {
    let requiredCounts = {};
    let isProportional = false;
    let baseTotal = 0;
    const regex = /(\d+)([MTI])/g;
    let match;
    while ((match = regex.exec(esqUpper)) !== null) {
      let cnt = parseInt(match[1], 10);
      requiredCounts[match[2]] = cnt;
      baseTotal += cnt;
      isProportional = true;
    }

    if (isProportional && baseTotal > 0 && validTypes.length > 1) {
      let actualCounts = { M: 0, T: 0, I: 0 };
      validTypes.forEach((t) => {
        if (actualCounts[t] !== undefined) actualCounts[t]++;
      });

      let pattern = [];
      for (let t in requiredCounts) {
        for (let i = 0; i < requiredCounts[t]; i++) pattern.push(t);
      }

      let validCombinations = new Set();
      for (let start = 0; start < pattern.length; start++) {
        let counts = { M: 0, T: 0, I: 0 };
        for (let i = 0; i < validTypes.length; i++) {
          counts[pattern[(start + i) % pattern.length]]++;
        }
        validCombinations.add(JSON.stringify(counts));
      }

      let isCompliant = false;
      for (let comboStr of validCombinations) {
        let combo = JSON.parse(comboStr);
        if (
          combo.M === actualCounts.M &&
          combo.T === actualCounts.T &&
          combo.I === actualCounts.I
        ) {
          isCompliant = true;
          break;
        }
      }

      let expectedStr = [];
      const regex2 = /(\d+)([MTI])/g;
      let match2;
      while ((match2 = regex2.exec(esqUpper)) !== null) {
        expectedStr.push(`${match2[1]}${match2[2]}`);
      }
      let expectedFormat = expectedStr.join(" y ");

      let actualStr = [];
      for (let t of ["M", "T", "I"]) {
        if (actualCounts[t] > 0) actualStr.push(`${actualCounts[t]}${t}`);
      }
      let actualFormat =
        actualStr.length > 0 ? actualStr.join(" y ") : "ninguno";

      if (isCompliant) {
        compliant = true;
        statusStr = `Cumple (Rotación esperada)`;
      } else {
        compliant = false;
        statusStr = `No Cumple (Esquema: ${expectedFormat} | Real: ${actualFormat})`;
      }
    } else {
      compliant = uniqueTypes.size > 1;
      if (validTypes.length <= 1) compliant = true;
      statusStr = compliant ? "Cumple (Rotó)" : "No Cumple (No rotó)";
    }
  }

  return {
    compliant,
    tooltip:
      "Rotación Mensual:&#10;" +
      tooltipLines.join("&#10;") +
      "&#10;Estado: " +
      statusStr,
  };
}

function getPlanningSlot(collabId, dateStr) {
  const obj = state.planning[`${collabId}_${dateStr}`];
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj.slot || "";
}

function getPlanningObj(collabId, dateStr) {
  const obj = state.planning[`${collabId}_${dateStr}`];
  if (!obj) return null;
  if (typeof obj === "string") return { slot: obj };
  return obj;
}

// 4. MOCK DATA PARA DESARROLLO
const mockCollaborators = [
  {
    id: "C01",
    name: "Ana García",
    hours: 48,
    pasillo: "Fideos",
    esquema: "3x1",
    domingosAcordados: 1,
  },
  {
    id: "C02",
    name: "Luis Pérez",
    hours: 30,
    pasillo: "Fideos",
    esquema: "Turno Fijo T",
    domingosAcordados: 0,
  },
  {
    id: "C03",
    name: "Marta Gómez",
    hours: 48,
    pasillo: "Lácteos",
    esquema: "1x1",
    domingosAcordados: 2,
  },
  {
    id: "C04",
    name: "Juan Díaz",
    hours: 48,
    pasillo: "Lácteos",
    esquema: "3x1",
    domingosAcordados: 1,
  },
  {
    id: "C05",
    name: "Sofía Ruiz",
    hours: 30,
    pasillo: "Limpieza",
    esquema: "Cortado",
    domingosAcordados: 0,
  },
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  for (let i = 0; i < 16; i++) {
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
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  while (d.getMonth() === month) {
    sundays.push(formatDate(d));
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}

// 6. CARGA DE DATOS (Optimizada para plan Spark)
async function loadInitialData() {
  // Cargar feriados nacionales desde API pública (Nager Date) multiaño (año actual y siguiente)
  const year = new Date().getFullYear();
  const nextYear = year + 1;

  try {
    const [resCurrent, resNext] = await Promise.all([
      fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`).catch(
        () => null,
      ),
      fetch(`https://date.nager.at/api/v3/PublicHolidays/${nextYear}/AR`).catch(
        () => null,
      ),
    ]);

    let allHolidays = [];

    if (resCurrent && resCurrent.ok) {
      const dataCurrent = await resCurrent.json();
      allHolidays = allHolidays.concat(dataCurrent.map((h) => h.date));
    }
    if (resNext && resNext.ok) {
      const dataNext = await resNext.json();
      allHolidays = allHolidays.concat(dataNext.map((h) => h.date));
    }

    if (allHolidays.length === 0) throw new Error("Both APIs failed");

    state.holidays = allHolidays;
  } catch (e) {
    console.error("Error fetching holidays API, using fallback:", e);
    // Fallback de feriados inamovibles
    const getFallback = (y) => [
      `${y}-01-01`,
      `${y}-03-24`,
      `${y}-04-02`,
      `${y}-05-01`,
      `${y}-05-25`,
      `${y}-06-20`,
      `${y}-07-09`,
      `${y}-12-08`,
      `${y}-12-25`,
    ];
    state.holidays = [...getFallback(year), ...getFallback(nextYear)];

    if (year === 2027 || nextYear === 2027) {
      state.holidays.push("2027-02-08", "2027-02-09", "2027-03-26");
    }
  }

  if (isMockMode) {
    state.collaborators = mockCollaborators;
  } else {
    try {
      // Suscripción a Colaboradores con await inicial
      const colPromise = new Promise((resolve) => {
        onSnapshot(collection(db, "colaboradores"), (snap) => {
          state.collaborators = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          state.collaborators.sort((a, b) => a.id.localeCompare(b.id));
          if (document.getElementById("tableBody")) renderUI();
          resolve();
        });
      });

      // Suscripción Global a Repositores
      onSnapshot(collection(db, "repositores"), (snap) => {
        state.repositoresData = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        if (document.getElementById("tableBody")) renderUI();
      });

      // Suscripción a Tags TAW y ARMADO
      onSnapshot(doc(db, "notas_globales", "tags"), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          state.tawDates = data.tawDates || [];
          state.armadoDates = data.armadoDates || [];
        } else {
          state.tawDates = [];
          state.armadoDates = [];
        }
        if (document.getElementById("tableBody")) renderUI();
      });

      // Suscripción a Vacaciones con await inicial
      const vacPromise = new Promise((resolve) => {
        onSnapshot(collection(db, "vacaciones"), (snap) => {
          state.vacations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (document.getElementById("tableBody")) renderUI();
          if (
            typeof window.renderVacationTable === "function" &&
            document.getElementById("vacationTableBody")
          )
            window.renderVacationTable();
          resolve();
        });
      });

      await Promise.all([colPromise, vacPromise]);
    } catch (e) {
      console.error("Error cargando Firestore:", e);
      state.collaborators = mockCollaborators;
      state.vacations = [];
    }
  }

  // Llenar selectores
  const vCollabSelect = document.getElementById("vCollab");
  vCollabSelect.innerHTML = state.collaborators
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  const vImputacion = document.getElementById("vImputacion");
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
  if (currentRole === "invitado" && currentInvitadoLegajo) {
    currentInvitadoLegajo = userProfile.legajo;
    state.currentInvitadoLegajo = userProfile.legajo;
  }

  await loadWeekPlanning();
}

async function loadWeekPlanning(append = false) {
  if (state.currentWeekStart) {
    localStorage.setItem("lastDateNav", formatDate(state.currentWeekStart));
  }
  const range = state.viewRange || 7;
  const realStartD = getStartOfWeek(state.currentWeekStart);
  const realEndD = addDays(
    getStartOfWeek(addDays(state.currentWeekStart, range - 1)),
    6,
  );

  state.planning = state.planning || {};
  state.monthlySundaysWorked = state.monthlySundaysWorked || {};

  // Forzar el estado de carga estructural inmediatamente
  state.skeletonStartStr = formatDate(realStartD);
  renderUI();

  // Mapeamos los meses del rango para traer ambos si la quincena está partida
  const yearStart = realStartD.getFullYear();
  const monthStart = String(realStartD.getMonth() + 1).padStart(2, "0");
  const yearEnd = realEndD.getFullYear();
  const monthEnd = String(realEndD.getMonth() + 1).padStart(2, "0");

  if (isMockMode) {
    state.skeletonStartStr = null;
    renderUI();
  } else {
    try {
      // Consulta ampliada: Traemos los datos desde el primer día del mes inicial hasta el último día del mes final
      // Esto es CRÍTICO para que el contador de domingos calcule correctamente la cuota mensual, incluso si no están en pantalla.
      const fetchStart = new Date(
        realStartD.getFullYear(),
        realStartD.getMonth(),
        1,
      );
      const fetchEnd = new Date(
        realEndD.getFullYear(),
        realEndD.getMonth() + 1,
        0,
      );

      const q = query(
        collection(db, "planificacion"),
        where("fecha", ">=", formatDate(fetchStart)),
        where("fecha", "<=", formatDate(fetchEnd)),
      );

      if (unsubscribePlanning) {
        unsubscribePlanning();
      }

      await new Promise((resolve) => {
        let firstLoad = true;
        unsubscribePlanning = onSnapshot(
          q,
          async (snap) => {
            console.log(
              "Snapshot detectado",
              snap.docs.map((d) => d.data()),
            );
            snap.docChanges().forEach((change) => {
              const data = change.doc.data();
              if (change.type === "added" || change.type === "modified") {
                state.planning[`${data.colaboradorId}_${data.fecha}`] = data;
              }
              if (change.type === "removed") {
                delete state.planning[`${data.colaboradorId}_${data.fecha}`];
              }
            });

            if (firstLoad) {
              firstLoad = false;
              // Apagar el esqueleto de carga RECIÉN cuando todos los datos están en memoria
              state.skeletonStartStr = null;

              // TAW y ARMADO ya se actualizan vía la suscripción notas_globales/tags en loadInitialData

              // Cargar eventos del rango visible
              const startStr = formatDate(realStartD);
              const endStr = formatDate(realEndD);
              await loadEventos(startStr, endStr);
              resolve();
            }

            renderUI();
          },
          (error) => {
            console.error("Error en onSnapshot de planificación:", error);
            if (firstLoad) {
              firstLoad = false;
              resolve();
            }
            state.skeletonStartStr = null;
            renderUI();
          },
        );
      });
    } catch (e) {
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
      where("__name__", "<=", endStr),
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      state.eventos[docSnap.id] = docSnap.data();
    });
  } catch (e) {
    console.warn("Error cargando eventos_diarios:", e);
  }
}

// -- LÓGICA DE HORAS EXTRAS --
function calculateWeeklyHours(collabId, weekMondayStr, excludeDateStr) {
  let total = 0;
  let currentD = new Date(weekMondayStr + "T00:00:00");

  for (let i = 0; i < 7; i++) {
    const dStr = formatDate(currentD);
    currentD = addDays(currentD, 1);

    if (dStr === excludeDateStr) continue;

    let isOnVacation = false;
    for (let vac of state.vacations || []) {
      if (vac.colaboradorId === collabId) {
        const vacStart = new Date(vac.startDate + "T00:00:00");
        const vacEnd = new Date(vac.endDate + "T00:00:00");
        const iterDate = new Date(dStr + "T00:00:00");
        if (iterDate >= vacStart && iterDate <= vacEnd) {
          isOnVacation = true;
          break;
        }
      }
    }
    if (isOnVacation) continue;

    const val = getPlanningSlot(collabId, dStr);
    const objForTardanza = getPlanningObj(collabId, dStr) || {};
    const parsed = parseShift(val, objForTardanza.tardanzaMinutosTotales || 0);

    if (parsed && parsed.type === "work") {
      total += parsed.hours;
    }
  }
  return total;
}

// 6. CALCULO HORAS EXTRAS PARA MENÚ CONTEXTUAL
function calculateOvertimeInfo(collabId, dateStr, newParsedSlot) {
  if (!newParsedSlot || newParsedSlot.type !== "work") return null;

  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return null;

  const cargaContrato =
    parseFloat(collab.hours) ||
    parseFloat(collab.cargaHoraria) ||
    parseFloat(collab.contractHours) ||
    0;
  if (cargaContrato <= 0) {
    return null;
  }

  const targetDate = new Date(dateStr + "T00:00:00");
  const mondayStr = formatDate(getStartOfWeek(targetDate));

  const hsActualesSinEsteDia = calculateWeeklyHours(
    collabId,
    mondayStr,
    dateStr,
  );
  const hsProyectadas = hsActualesSinEsteDia + newParsedSlot.hours;

  if (hsProyectadas > cargaContrato) {
    const horasExtras = hsProyectadas - cargaContrato;
    return {
      contract: cargaContrato,
      projected: hsProyectadas,
      excess: horasExtras,
    };
  }
  return null;
}

// 7. MOTOR DE VALIDACIONES ABSOLUTAS
function validateTurn(collabId, dateStr, parsedNewSlot) {
  if (
    !parsedNewSlot ||
    parsedNewSlot.type === "none" ||
    parsedNewSlot.type === "error"
  )
    return { valid: true };

  const collab = state.collaborators.find((c) => c.id === collabId);
  const targetDate = new Date(dateStr + "T00:00:00");

  const prevDateStr = formatDate(addDays(targetDate, -1));
  const nextDateStr = formatDate(addDays(targetDate, 1));

  const prevSlotKey = getPlanningSlot(collabId, prevDateStr);
  const nextSlotKey = getPlanningSlot(collabId, nextDateStr);

  const prevSlot = parseShift(prevSlotKey);
  const nextSlot = parseShift(nextSlotKey);

  // 7.1 Descanso Diario (>= 12h)
  if (parsedNewSlot.type === "work" && prevSlot && prevSlot.type === "work") {
    let currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
    let prevAbs = getShiftAbsoluteTimes(prevDateStr, prevSlot);
    if (currAbs && prevAbs) {
      let restMs = currAbs.start - prevAbs.end;
      let restH = restMs / 3600000;
      if (restH < 12)
        return {
          valid: false,
          type: "legal",
          req: "12hs",
          actual: restH.toFixed(1),
        };
    }
  }
  if (parsedNewSlot.type === "work" && nextSlot && nextSlot.type === "work") {
    let currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
    let nextAbs = getShiftAbsoluteTimes(nextDateStr, nextSlot);
    if (currAbs && nextAbs) {
      let restMs = nextAbs.start - currAbs.end;
      let restH = restMs / 3600000;
      if (restH < 12)
        return {
          valid: false,
          type: "legal",
          req: "12hs",
          actual: restH.toFixed(1),
        };
    }
  }

  // 7.2 Descanso con día de descanso intermedio (>= 35h)
  // Cubre: F, LIBRE, V, y celdas vacías (-). Excluye explícitamente ausencias (NV, E) para no disparar validaciones de 35hs en faltas.
  const isRestDay = (slot) =>
    !slot || ["franco", "libre", "vacation", "none"].includes(slot.type);

  // Helper: busca el último turno de trabajo real retrocediendo desde `fromDateStr`
  // (excluye `fromDateStr` mismo). Devuelve { dateStr, parsedSlot } o null.
  const findLastWorkDayBefore = (fromDateStr, maxLookback = 14) => {
    const from = new Date(fromDateStr + "T00:00:00");
    for (let i = 1; i <= maxLookback; i++) {
      const dStr = formatDate(addDays(from, -i));
      const slot = parseShift(getPlanningSlot(collabId, dStr));
      if (slot && slot.type === "work")
        return { dateStr: dStr, parsedSlot: slot };
      if (slot && !isRestDay(slot)) break; // tipo inesperado, parar
    }
    return null;
  };

  // Helper: busca el próximo turno de trabajo real avanzando desde `fromDateStr`.
  const findNextWorkDayAfter = (fromDateStr, maxLookforward = 14) => {
    const from = new Date(fromDateStr + "T00:00:00");
    for (let i = 1; i <= maxLookforward; i++) {
      const dStr = formatDate(addDays(from, i));
      const slot = parseShift(getPlanningSlot(collabId, dStr));
      if (slot && slot.type === "work")
        return { dateStr: dStr, parsedSlot: slot };
      if (slot && !isRestDay(slot)) break;
    }
    return null;
  };

  // CASO A: Se está guardando un turno de trabajo y el día anterior es descanso.
  //         Buscamos el último trabajo real hacia atrás para medir el gap total.
  if (parsedNewSlot.type === "work" && isRestDay(prevSlot)) {
    const lastWork = findLastWorkDayBefore(dateStr);
    if (lastWork) {
      const currAbs = getShiftAbsoluteTimes(dateStr, parsedNewSlot);
      const lastWorkAbs = getShiftAbsoluteTimes(
        lastWork.dateStr,
        lastWork.parsedSlot,
      );
      if (currAbs && lastWorkAbs) {
        const restH = (currAbs.start - lastWorkAbs.end) / 3600000;
        if (restH < 35)
          return {
            valid: false,
            type: "legal",
            req: "35hs",
            actual: restH.toFixed(1),
          };
      }
    }
  }

  // CASO B: Se está guardando un día de descanso (F, LIBRE, V, E, -).
  //         Verificamos el gap entre el último trabajo anterior y el próximo trabajo posterior.
  if (isRestDay(parsedNewSlot)) {
    const lastWork = findLastWorkDayBefore(dateStr);
    const nextWork = findNextWorkDayAfter(dateStr);
    if (lastWork && nextWork) {
      const lastWorkAbs = getShiftAbsoluteTimes(
        lastWork.dateStr,
        lastWork.parsedSlot,
      );
      const nextWorkAbs = getShiftAbsoluteTimes(
        nextWork.dateStr,
        nextWork.parsedSlot,
      );
      if (lastWorkAbs && nextWorkAbs) {
        const restH = (nextWorkAbs.start - lastWorkAbs.end) / 3600000;
        if (restH < 35)
          return {
            valid: false,
            type: "legal",
            req: "35hs",
            actual: restH.toFixed(1),
          };
      }
    }
  }

  // 7.3 Lógica de Feriados: Las validaciones de francos adyacentes a feriados ahora son puramente visuales.
  // (Eliminadas las restricciones bloqueantes por pedido del usuario)

  // 7.4 Bloqueo estricto de 42 horas máximas para contratos de jornada reducida (<= 30hs)
  if (collab && collab.hours <= 30) {
    const targetDateObj = new Date(dateStr + "T00:00:00");
    const weekStart = getStartOfWeek(targetDateObj);
    let totalWeekHoursWithNewTurn = 0;

    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const currentDStr = formatDate(d);

      // Si es el día que estamos editando actualmente, sumamos las horas del nuevo turno
      if (currentDStr === dateStr) {
        if (parsedNewSlot && parsedNewSlot.type === "work") {
          totalWeekHoursWithNewTurn += parsedNewSlot.hours;
        }
      } else {
        // Si es otro día de la semana, sumamos lo que ya estaba cargado en memoria
        const valDay = getPlanningSlot(collabId, currentDStr);
        const parsedDay = parseShift(valDay);
        if (parsedDay && parsedDay.type === "work") {
          totalWeekHoursWithNewTurn += parsedDay.hours;
        }
      }
    }

    // Si la simulación supera el techo de 42 horas, se rechaza el cambio
    if (totalWeekHoursWithNewTurn > 42) {
      return {
        valid: false,
        type: "exceso_horas",
        msg: `Exceso de horas: Este colaborador tiene un contrato de ${collab.hours}hs y no puede superar las 42 horas semanales máximas permitidas. (Total calculado con este turno: ${totalWeekHoursWithNewTurn}hs)`,
      };
    }
  }

  // 7.5 Límite diario de horas (Máximo 8.5 hs y Mínimo 4 hs por día)
  if (parsedNewSlot && parsedNewSlot.type === "work") {
    const checkHours = parsedNewSlot.isNV
      ? parsedNewSlot.realHours
      : parsedNewSlot.hours;
    if (checkHours > 8.5) {
      return {
        valid: false,
        type: "exceso_horas",
        msg: `Exceso de horas diarias: No se pueden cargar más de 8.5 horas en un solo día. (Turno ingresado: ${checkHours} hs)`,
      };
    }
    if (checkHours < 4) {
      return {
        valid: false,
        type: "exceso_horas",
        msg: `Mínimo de horas diarias: El turno ingresado (${checkHours} hs) es inferior al mínimo legal obligatorio de 4 horas por día.`,
      };
    }
  }

  return { valid: true };
}

// 8. CÁLCULO DE ABANDONO DE SECTOR
function calculateAbandonment() {
  const days = getWeekDays().map((d) => formatDate(d));
  const pasillos = [...new Set(state.collaborators.map((c) => c.pasillo))];

  const abandonmentMap = {}; // { pasillo: { dateStr: consecutiveDays } }

  pasillos.forEach((pasillo) => {
    abandonmentMap[pasillo] = {};
    const colIds = state.collaborators
      .filter((c) => c.pasillo === pasillo)
      .map((c) => c.id);
    let consecutive = 0;

    days.forEach((dateStr) => {
      let hasCoverage = false;
      colIds.forEach((id) => {
        const val = getPlanningSlot(id, dateStr);
        const parsed = parseShift(val);
        if (parsed && parsed.type === "work") {
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
  for (let i = 1; i <= daysInMonth; i++) {
    monthDays.push(new Date(activeYear, activeMonth, i));
  }
  let monthName = centerDay.toLocaleString("es-ES", { month: "long" });
  monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  let globalOvertimeW1 = 0;
  let globalOvertimeW2 = 0;

  state.collaborators.forEach((collab) => {
    // Estructura limpia para almacenar las hasta 4 semanas procesadas
    let weeklyData = {
      1: { hours: 0, vac: false },
      2: { hours: 0, vac: false },
      3: { hours: 0, vac: false },
      4: { hours: 0, vac: false }
    };

    // Detectar margen histórico: si el array inicia en Domingo y el 2do día es Lunes,
    // significa que index 0 es margen y las semanas reales inician desde index 1.
    let startIndex = 0;
    if (allDays.length > 1 && allDays[0].getDay() === 0 && allDays[1].getDay() === 1) {
      startIndex = 1; 
    }

    let currentWeekNum = 1;

    for (let i = startIndex; i < allDays.length; i++) {
      const d = allDays[i];
      
      // Corte de nómina real: Si es Lunes y NO es el primer día de nuestra evaluación, avanzamos a la semana siguiente.
      if (i > startIndex && d.getDay() === 1) {
        currentWeekNum++;
      }

      // Solo evaluamos el bucket de las 4 primeras semanas para mostrar
      if (currentWeekNum > 4) continue;

      const dStr = formatDate(d);
      const val = getPlanningSlot(collab.id, dStr);
      const obj = getPlanningObj(collab.id, dStr) || {};
      const parsed = parseShift(val, obj.tardanzaMinutosTotales || 0);

      let isVac = state.vacations.some(
        (vac) => vac.colaboradorId === collab.id && dStr >= vac.startDate && dStr <= vac.endDate
      );

      if (isVac) {
        weeklyData[currentWeekNum].vac = true;
      }
      
      if (parsed && parsed.type === "work" && !isVac) {
        weeklyData[currentWeekNum].hours += parsed.hours;
      }
    }

    const renderBox = (hours, isVac, metaStr) => {
      const meta = parseFloat(metaStr) || 48;
      const maxPermitido = meta <= 30 ? 32 : 48;

      let color =
        hours === meta
          ? "var(--success)"
          : hours > meta
            ? hours <= maxPermitido
              ? "#eab308"
              : "var(--danger)"
            : "var(--danger)";
      let borderStyle = hours === meta ? "2px solid" : "1px solid";
      let horasExtras = hours > meta ? hours - meta : 0;

      // Si es Vacaciones, devolvemos la misma estructura pero con la V
      if (isVac) {
        return `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 32px; width: 24px;">
                       <div style="width: 22px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 0.65rem; font-weight: bold; border: 1px solid var(--info); color: var(--info); box-sizing: border-box;">V</div>
                       <div style="font-size: 0.6rem; color: transparent; visibility: hidden; line-height: 1; margin-top: 2px;">Xtr</div>
                    </div>`;
      }

      // Bloque de horas con altura y estructura fija
      const text = Number.isInteger(hours) ? hours : hours.toFixed(1);
      return `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 32px; width: 26px; padding: 0 2px;">
                  <div class="hour-box" style="width: 24px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 0.65rem; font-weight: bold; border: ${borderStyle} ${color}; color: ${color}; box-sizing: border-box;">${text}</div>
                  <div style="font-size: 0.6rem; font-weight: bold; color: var(--danger); visibility: ${horasExtras > 0 ? "visible" : "hidden"}; line-height: 1.1; margin-top: 2px;">
                    Xtr:${horasExtras > 0 ? (Number.isInteger(horasExtras) ? horasExtras : horasExtras.toFixed(1)) : "0"}h
                  </div>
                </div>
              `;
    };

    const metaCollab = parseFloat(collab.hours) || 48;
    if (weeklyData[1].hours > metaCollab && !weeklyData[1].vac) {
      globalOvertimeW1 += weeklyData[1].hours - metaCollab;
    }
    if (weeklyData[2].hours > metaCollab && !weeklyData[2].vac) {
      globalOvertimeW2 += weeklyData[2].hours - metaCollab;
    }

    const injectTotals = (id, weekNum, meta) => {
      const el = document.getElementById(id);
      const data = weeklyData[weekNum];
      if (el && data) {
        el.innerHTML = renderBox(data.hours, data.vac, meta);
      }
    };

    injectTotals(`desktop-hours-w1-${collab.id}`, 1, collab.hours);
    injectTotals(`desktop-hours-w2-${collab.id}`, 2, collab.hours);
    injectTotals(`desktop-hours-w3-${collab.id}`, 3, collab.hours);
    injectTotals(`desktop-hours-w4-${collab.id}`, 4, collab.hours);

    // Actualización de Domingos Mensuales Basada en Memoria Global
    let restCount = 0;
    monthDays.forEach((d) => {
      if (d.getDay() === 0) {
        // Es domingo estricto
        const dStr = formatDate(d);

        // Buscamos de forma directa en el estado de planificación acumulado de la base de datos
        const objPlan = state.planning[`${collab.id}_${dStr}`];
        let valToday = "";
        if (objPlan) {
          valToday =
            typeof objPlan === "string"
              ? objPlan.toLowerCase()
              : (objPlan.slot || "").toLowerCase();
        }

        if (valToday === "f" || valToday === "libre") {
          restCount++;
        }
      }
    });

    // Semáforo Corregido: El límite es un techo estricto
    let domClass = "";
    const limit = parseInt(collab.domingosAcordados) || 0;

    if (restCount > limit) {
      domClass = "danger"; // ROJO: Se pasó de los domingos asignados (Alerta)
    } else if (restCount < limit) {
      domClass = "success"; // VERDE: Todavía tiene domingos disponibles en el mes
    } else {
      domClass = ""; // NEUTRO/GRIS: Cumplió la cuota exacta (Equilibrio)
    }

    const domBadge = document.getElementById(`dom-badge-${collab.id}`);
    if (domBadge) {
      const monthNumStr =
        monthDays.length > 0
          ? (monthDays[0].getMonth() + 1).toString().padStart(2, "0")
          : "00";
      domBadge.className = `dom-badge ${domClass}`;
      domBadge.innerText = `D${monthNumStr}: ${restCount}/${limit}`;
    }
  });

  // Actualizar el indicador global de horas extras en Subtotales Disponibilidad
  const globalOvertimeIndicatorW1 = document.getElementById(
    "global-overtime-budget-w1",
  );
  if (globalOvertimeIndicatorW1) {
    globalOvertimeIndicatorW1.textContent =
      globalOvertimeW1 > 0
        ? (Number.isInteger(globalOvertimeW1)
            ? globalOvertimeW1
            : globalOvertimeW1.toFixed(1)) + "h"
        : "0h";
  }
  const globalOvertimeIndicatorW2 = document.getElementById(
    "global-overtime-budget-w2",
  );
  if (globalOvertimeIndicatorW2) {
    globalOvertimeIndicatorW2.textContent =
      globalOvertimeW2 > 0
        ? (Number.isInteger(globalOvertimeW2)
            ? globalOvertimeW2
            : globalOvertimeW2.toFixed(1)) + "h"
        : "0h";
  }
}

window.toggleCollabDetails = function (collabId) {
  const meta = document.getElementById(`collab-meta-${collabId}`);
  const arrow = document.getElementById(`collab-arrow-${collabId}`);
  if (!meta || !arrow) return;
  if (meta.style.display === "none") {
    meta.style.display = "flex";
    arrow.style.transform = "rotate(-180deg)";
  } else {
    meta.style.display = "none";
    arrow.style.transform = "rotate(0deg)";
  }
};

window.openMobileProfile = function (collabId) {
  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return;
  const cleanName = (collab.name || "Desconocido")
    .split("(")[0]
    .split("-")[0]
    .trim();
  document.getElementById("pbName").textContent = cleanName;
  document.getElementById("pbLegajo").textContent =
    collab.legajo || collab.id || "-";
  document.getElementById("pbSector").textContent = collab.sector || "-";
  document.getElementById("pbCarga").textContent = collab.cargaHoraria
    ? `${collab.cargaHoraria} hs`
    : "-";
  document.getElementById("profileBottomSheet").style.display = "block";
};

window.openMobileContextMenu = function (inputElement) {
  if (!requireAuth()) return;
  const rect = inputElement.getBoundingClientRect();
  const simulatedEvent = {
    preventDefault: () => {},
    target: inputElement,
    pageX: rect.left + window.scrollX + rect.width / 2,
    pageY: rect.top + window.scrollY + rect.height,
  };
  handleContextMenu(simulatedEvent);
};

function renderMobileDayView() {
  const userHasAccess =
    checkAccess("modificarHorario") || checkAccess("modificarVacaciones");
  const activeEl = document.activeElement;
  let focusCollab = null;
  let focusDate = null;
  if (activeEl && activeEl.classList.contains("cell-input")) {
    focusCollab = activeEl.getAttribute("data-collab");
    focusDate = activeEl.getAttribute("data-date");
  }

  const targetDate = state.currentWeekStart;
  const dStr = formatDate(targetDate);
  const isHoliday = state.holidays.includes(dStr);
  const evento = state.eventos[dStr];
  const prevDateStr = formatDate(addDays(targetDate, -1));

  const weekDaysArr = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
  const monthsArr = [
    "ENE",
    "FEB",
    "MAR",
    "ABR",
    "MAY",
    "JUN",
    "JUL",
    "AGO",
    "SEP",
    "OCT",
    "NOV",
    "DIC",
  ];
  const dayLabelText = `${weekDaysArr[targetDate.getDay()]} ${String(targetDate.getDate()).padStart(2, "0")} ${monthsArr[targetDate.getMonth()]}`;
  const holidayBadge = isHoliday
    ? `<span class="holiday-badge" style="font-size: 0.6rem; padding: 2px 6px; margin: 2px;">Feriado</span>`
    : "";
  const eventBadge = evento
    ? `<span class="event-badge" style="background-color:${evento.color}; font-size: 0.6rem; padding: 2px 6px; margin: 2px;"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${evento.descripcion}</span>`
    : "";

  const tawBadge =
    state.tawDates && state.tawDates.includes(dStr)
      ? `<span class="taw-badge" style="font-size: 0.6rem; padding: 2px 6px; margin: 2px;">TAW</span>`
      : "";
  const armadoBadge =
    state.armadoDates && state.armadoDates.includes(dStr)
      ? `<span class="armado-badge" style="font-size: 0.6rem; padding: 2px 6px; margin: 2px;">ARMADO</span>`
      : "";
  const hasBadges =
    isHoliday ||
    evento ||
    (state.tawDates && state.tawDates.includes(dStr)) ||
    (state.armadoDates && state.armadoDates.includes(dStr));

  const navHtml = `
         <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1;">
            <span>${dayLabelText}</span>
            ${hasBadges ? `<div style="display: flex; justify-content: center; margin-top: 2px;">${holidayBadge}${eventBadge}${tawBadge}${armadoBadge}</div>` : ""}
         </div>
      `;
  document.getElementById("weekLabel").innerHTML = navHtml;

  const trHead = document.getElementById("tableHeader");
  trHead.innerHTML = "";
  trHead.style.display = "none";

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";
  const areasOrderMobile = [
    "Disponibilidad",
    "AP",
    "Calidad",
    "Linea de Cajas",
    "Perecederos",
    "Limpieza",
    "RRHH",
    "Gerentes",
    "Direccion",
  ];
  const groupedCollabsMobile = {};
  state.collaborators.forEach((c) => {
    const area = c.area || "Disponibilidad";
    if (!groupedCollabsMobile[area]) groupedCollabsMobile[area] = [];
    groupedCollabsMobile[area].push(c);
  });
  Object.keys(groupedCollabsMobile).forEach((k) => {
    if (!areasOrderMobile.includes(k)) areasOrderMobile.push(k);
  });

  areasOrderMobile.forEach((areaName) => {
    if (
      !groupedCollabsMobile[areaName] ||
      groupedCollabsMobile[areaName].length === 0
    )
      return;

    const areaHeaderTr = document.createElement("tr");
    areaHeaderTr.style.backgroundColor = "var(--surface)";
    areaHeaderTr.innerHTML = `
           <td colspan="2" style="padding: 8px 12px; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); letter-spacing: 0.5px;">
             ${areaName}
           </td>
         `;
    tbody.appendChild(areaHeaderTr);

    groupedCollabsMobile[areaName].forEach((collab) => {
      const tr = document.createElement("tr");
      tr.style.willChange = "transform";
      tr.setAttribute("data-area", areaName);

      const targetDToday = new Date(dStr + "T00:00:00");
      let isOnVacationToday = false;
      for (let vac of state.vacations || []) {
        if (vac.colaboradorId === collab.id) {
          const vacStart = new Date(vac.startDate + "T00:00:00");
          const vacEnd = new Date(vac.endDate + "T00:00:00");
          if (targetDToday >= vacStart && targetDToday <= vacEnd)
            isOnVacationToday = true;
        }
      }

      if (isOnVacationToday) {
        tr.style.background = "rgba(234, 179, 8, 0.1)";
        tr.style.opacity = "0.7";
      }
      if (!collab.name) {
        collab.name = "Desconocido";
      }
      const cleanName = collab.name.split("(")[0].split("-")[0].trim();
      const nameParts = cleanName.split(" ");
      const apeF = nameParts[0] || "-";
      const nomF = nameParts.slice(1).join(" ") || "";

      let avatarStr = "";
      if (nameParts.length > 1) {
        avatarStr = apeF.charAt(0).toUpperCase() + nomF.charAt(0).toUpperCase();
      } else {
        avatarStr =
          apeF.charAt(0).toUpperCase() +
          (apeF.length > 1 ? apeF.charAt(1).toUpperCase() : "");
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
      if (isOnVacationToday) shiftVal = "V";

      const isTiendaCerrada = evento && evento.tiendaCerrada;
      if (isTiendaCerrada) shiftVal = "LIBRE";

      let originalScheduleTitle = "";
      let obj = getPlanningObj(collab.id, dStr);
      if (
        obj &&
        obj.horarioOriginal &&
        obj.horarioOriginal !== shiftVal &&
        !isOnVacationToday &&
        !isTiendaCerrada
      ) {
        shiftVal += " *";
        originalScheduleTitle = `title="Horario original: ${obj.horarioOriginal}"`;
      }

      let logicDisabled = isOnVacationToday || isTiendaCerrada;
      let inputDisabled = logicDisabled || !userHasAccess;
      let cellStyle = isTiendaCerrada
        ? "background-color: rgba(100, 116, 139, 0.2);"
        : "";

      cellsHTML += `
              <td style="padding: 2px; ${cellStyle}">
                <input type="text" class="cell-input" 
                       data-collab="${collab.id}" data-date="${dStr}" 
                       value="${shiftVal}" ${originalScheduleTitle}
                       style="height: 48px; font-size: 1.25rem; font-weight: 700; width: 100%; margin: 0; display: block; border-radius: 6px; text-align: center; border: 1px solid var(--border); box-sizing: border-box; opacity: 1 !important; ${inputDisabled ? "cursor: not-allowed;" : ""}"
                       ${logicDisabled ? 'disabled data-disabled="true"' : ""}
                       ${!logicDisabled ? 'readonly onclick="openMobileContextMenu(this)"' : ""}>
              </td>
            `;

      tr.innerHTML = cellsHTML;
      tbody.appendChild(tr);
    });
  });

  // ── INYECCIÓN DE REPOSITORES EXTERNOS (MÓVIL) ──
  if (state.repositoresData && state.repositoresData.length > 0) {
    const sortedRepos = [...state.repositoresData].sort((a, b) => {
      const empA = (a.empresa || "").toLowerCase();
      const empB = (b.empresa || "").toLowerCase();
      if (empA < empB) return -1;
      if (empA > empB) return 1;
      const nomA = (a.nombre || "").toLowerCase();
      const nomB = (b.nombre || "").toLowerCase();
      if (nomA < nomB) return -1;
      if (nomA > nomB) return 1;
      return 0;
    });

    const repoHeaderTr = document.createElement("tr");
    repoHeaderTr.style.backgroundColor = "var(--surface)";
    repoHeaderTr.innerHTML = `
            <td colspan="2" style="padding: 12px; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; color: var(--primary); border-bottom: 2px solid var(--border); border-top: 2px solid var(--border); letter-spacing: 0.5px;">
              REPOSITORES EXTERNOS
            </td>
         `;
    tbody.appendChild(repoHeaderTr);

    const diasMap = { 1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S", 0: "D" };
    const dayLetter = diasMap[targetDate.getDay()];
    const dStr = formatDate(targetDate);

    sortedRepos.forEach((repo) => {
      const repoTr = document.createElement("tr");
      repoTr.dataset.area = "Repositores Externos";

      const cleanPhone = (phone) => {
        if (!phone) return "";
        if (phone.toLowerCase().trim() === "sin datos") return "";
        return phone.replace(/[\s\-\(\)]/g, "");
      };

      const repoPhoneRaw = repo.celular || "";
      const repoPhone = cleanPhone(repoPhoneRaw);
      const isRepoPhoneValid = repoPhone.length > 0;

      const supPhoneRaw = repo.telSupervisor || "";
      const supPhone = cleanPhone(supPhoneRaw);
      const isSupPhoneValid = supPhone.length > 0;

      const supEmailRaw = repo.email || repo.correo || "";
      const isSupEmailValid =
        supEmailRaw &&
        supEmailRaw.toLowerCase().trim() !== "sincorreo@sincorreo.com" &&
        supEmailRaw.toLowerCase().trim() !== "sin datos";

      const waIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-message-circle"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
      const mailIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-mail"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;

      const getIconStyle = (isValid, color) =>
        isValid
          ? `color: ${color}; cursor: pointer;`
          : `color: var(--text-muted); opacity: 0.3; pointer-events: none;`;

      const repoDias = repo.diasVisita || "";
      const isExpected = repoDias.includes(dayLetter);

      const valRaw = state.planning[repo.id + "_" + dStr];
      let displayVal = "";
      if (typeof valRaw === "object" && valRaw !== null) {
        displayVal = valRaw.slot || valRaw.horario || "";
      } else if (typeof valRaw === "string") {
        displayVal = valRaw;
      }

      let placeholderText = "-";
      if (isExpected && !displayVal) {
        placeholderText = repo.horario || "Visita";
      }

      let bgClass = isExpected ? "repo-esperado" : "";

      let cellsHTML = `
               <td style="padding: 4px 2px !important; ${isExpected ? "background-color: rgba(139, 92, 246, 0.15);" : ""}">
                 <div style="display: flex; align-items: center; justify-content: space-between; height: 100%; width: 100%; padding-right: 4px;">
                     <div style="display: flex; flex-direction: column; overflow: hidden; white-space: nowrap; max-width: 45%;">
                        <div style="font-weight: 500; font-size: 0.85rem; text-overflow: ellipsis; overflow: hidden;">${repo.nombre || "Sin Nombre"}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden;">${repo.empresa || "Sin Empresa"}</div>
                     </div>
                     <div style="display: flex; gap: 4px; align-items: center;">
                         <!-- Repo WP -->
                         <a href="https://wa.me/${repoPhone}" target="_blank" style="${getIconStyle(isRepoPhoneValid, "#22c55e")}; display: flex; align-items: center; padding: 4px;">
                             ${waIconSvg}
                         </a>
                         
                         <!-- Sup Block -->
                         <div style="display: flex; gap: 4px; align-items: center; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                             <span style="font-size: 0.55rem; color: var(--text-muted); font-weight: 600;">SUP</span>
                             <a href="https://wa.me/${supPhone}" target="_blank" style="${getIconStyle(isSupPhoneValid, "#22c55e")}; display: flex; align-items: center; padding: 2px;">
                                 ${waIconSvg}
                             </a>
                             <a href="mailto:${supEmailRaw}" target="_blank" style="${getIconStyle(isSupEmailValid, "#3b82f6")}; display: flex; align-items: center; padding: 2px;">
                                 ${mailIconSvg}
                             </a>
                         </div>
                     </div>
                 </div>
               </td>
             `;

      const inputDisabled = !userHasAccess;
      cellsHTML += `
               <td class="${bgClass}" style="padding: 2px; width: 100px;">
                 <input type="text" class="cell-input" 
                        data-collab="${repo.id}" data-date="${dStr}" data-is-repositor="true" readonly
                        value="${displayVal}" placeholder="${placeholderText}"
                        style="height: 48px; font-size: 1.1rem; font-weight: 600; width: 100%; margin: 0; display: block; border-radius: 6px; text-align: center; border: 1px solid var(--border); box-sizing: border-box; opacity: 1 !important; background: transparent; color: var(--text); cursor: default; pointer-events: none; ${inputDisabled ? "cursor: not-allowed;" : ""}"
                        ${inputDisabled ? 'disabled data-disabled="true"' : ""}>
               </td>
             `;

      repoTr.innerHTML = cellsHTML;
      tbody.appendChild(repoTr);
    });
  }

  attachScheduleEventListeners();

  if (focusCollab && focusDate) {
    const inp = document.querySelector(
      `.cell-input[data-collab="${focusCollab}"][data-date="${focusDate}"]`,
    );
    if (inp) {
      inp.focus();
      setTimeout(() => {
        if (inp.setSelectionRange)
          inp.setSelectionRange(inp.value.length, inp.value.length);
      }, 0);
    }
  }

  if (areasOrderMobile.length > 0) {
    const firstArea = areasOrderMobile.find(
      (a) => groupedCollabsMobile[a] && groupedCollabsMobile[a].length > 0,
    );
    if (firstArea) {
      const headerEl = document.getElementById("mobileAreaHeader");
      if (headerEl) headerEl.textContent = firstArea;
    }
  }

  if (!window._mobileScrollAttached) {
    window.addEventListener(
      "scroll",
      () => {
        if (window.innerWidth >= 768) return;
        const rows = document.querySelectorAll("#tableBody tr[data-area]");
        if (rows.length === 0) return;

        let activeArea = null;
        for (let r of rows) {
          const rect = r.getBoundingClientRect();
          if (rect.bottom > 130) {
            activeArea = r.getAttribute("data-area");
            break;
          }
        }

        const headerEl = document.getElementById("mobileAreaHeader");
        if (headerEl && activeArea && headerEl.textContent !== activeArea) {
          headerEl.textContent = activeArea;
        }
      },
      { passive: true },
    );
    window._mobileScrollAttached = true;
  }
}

window.addEventListener("resize", () => {
  clearTimeout(window.resizeTimer);
  window.resizeTimer = setTimeout(() => {
    renderUI();
  }, 250);
});

function renderMobileCoverageDashboard(targetDate) {
  const dashboard = document.getElementById("mobile-coverage-dashboard");
  if (!dashboard) return;
  if (window.innerWidth > 768) {
    dashboard.style.display = "none";
    return;
  }
  dashboard.style.display = "grid";

  let dStr = formatDate(targetDate);

  const isTiendaCerrada =
    state.eventos[dStr] && state.eventos[dStr].tiendaCerrada;
  if (isTiendaCerrada) {
    dashboard.style.display = "block";
    dashboard.innerHTML = `
               <div style="width: 100%; text-align: center; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid var(--danger);">
                   <span style="font-size: 1.1rem; font-weight: 800; color: var(--danger); letter-spacing: 1px;">TIENDA CERRADA</span>
               </div>
           `;
    return;
  }

  const hourlyCounts = Array(24).fill(0);
  state.collaborators.forEach((collab) => {
    const collabArea = collab.area || "Disponibilidad";
    if (collabArea !== "Disponibilidad") return;

    const shiftVal = getPlanningSlot(collab.id, dStr);
    if (!shiftVal) return;

    let isOnVacationToday = false;
    const targetDToday = new Date(dStr + "T00:00:00");
    for (let vac of state.vacations || []) {
      if (vac.colaboradorId === collab.id) {
        const vacStart = new Date(vac.startDate + "T00:00:00");
        const vacEnd = new Date(vac.endDate + "T00:00:00");
        if (targetDToday >= vacStart && targetDToday <= vacEnd)
          isOnVacationToday = true;
      }
    }
    if (isOnVacationToday) return;

    const lower = shiftVal.toLowerCase();
    if (
      lower === "f" ||
      lower === "v" ||
      lower === "libre" ||
      lower === "vacaciones"
    )
      return;

    const parsed = parseShift(shiftVal);
    if (parsed && parsed.type === "work") {
      for (let h = 0; h <= 23; h++) {
        if (parsed.end <= parsed.start) {
          if (h >= parsed.start) hourlyCounts[h]++;
        } else {
          if (h >= parsed.start && h < parsed.end) hourlyCounts[h]++;
        }
      }
    }
  });

  let blocksHTML = "";
  for (let h = 0; h <= 23; h++) {
    let count = hourlyCounts[h];
    let colorStr = count >= 2 ? "#22c55e" : "#ef4444";
    let hStr = h.toString().padStart(2, "0") + ":00";

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
  if (window.innerWidth <= 768) {
    renderMobileDayView();
    renderMobileCoverageDashboard(state.currentWeekStart);
  } else {
    renderDesktopView();
  }

  if (!window.hasInitialScrolled) {
    setTimeout(() => {
      const todayCol = document.querySelector("th.dia-actual, td.dia-actual");
      const container = document.querySelector(".grid-container");
      if (todayCol && container) {
        const containerWidth = container.clientWidth;
        const colLeft = todayCol.offsetLeft;
        const colWidth = todayCol.offsetWidth;
        // Calculate scroll position to center the column, keeping the fixed left column into account if necessary.
        // A simpler approach is to use scrollIntoView
        todayCol.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }, 500);
    window.hasInitialScrolled = true;
  }
}

function attachScheduleEventListeners() {
  const userHasAccess =
    checkAccess("modificarHorario") || checkAccess("modificarVacaciones");
  const isMobileDevice = window.innerWidth <= 768 || "ontouchstart" in window;
  const inputs = Array.from(document.querySelectorAll(".cell-input"));

  inputs.forEach((el, index) => {
    // Habilitar o deshabilitar celdas basado en el estado actual del login/permisos
    if (el.dataset.disabled === "true") {
      el.setAttribute("disabled", "true");
      el.removeAttribute("readonly");
      el.removeAttribute("tabindex");
    } else {
      if (userHasAccess && !isMobileDevice) {
        el.removeAttribute("disabled");
        el.removeAttribute("readonly");
        el.removeAttribute("tabindex");
      } else {
        el.removeAttribute("disabled");
        el.setAttribute("readonly", "true");
        if (isMobileDevice) {
          el.setAttribute("tabindex", "-1");
        } else {
          el.removeAttribute("tabindex");
        }
      }
    }

    // Si ya tiene los listeners adjuntos, saltar para no duplicarlos
    if (el.dataset.listenersAttached) return;
    el.dataset.listenersAttached = "true";

    el.addEventListener("blur", handleInputChange);

    // Delegar contextmenu a nivel de tbody para capturar clics interceptados o en celdas deshabilitadas
    const tbody = document.getElementById("tableBody");
    if (tbody && !tbody.dataset.ctxMenuAttached) {
      tbody.dataset.ctxMenuAttached = "true";
      tbody.addEventListener("contextmenu", (e) => {
        const validTarget = e.target.closest("[data-collab]");
        if (validTarget) {
          handleContextMenu(e);
        }
      });
    }

    // Prevenir selección de texto en móviles que levanta el teclado
    el.style.userSelect = "none";
    el.style.webkitUserSelect = "none";

    let touchTimer;
    el.addEventListener("touchstart", (e) => {
      if (!requireAuth()) return;
      touchTimer = setTimeout(() => {
        // Desenfoque del elemento activo para cerrar cualquier teclado
        if (document.activeElement) {
          document.activeElement.blur();
        }
        const touch = e.touches[0];
        const mockEvent = {
          preventDefault: () => {}, // preventDefault nativo no hace efecto asíncronamente
          target: e.target,
          pageX: touch.pageX,
          pageY: touch.pageY,
        };
        handleContextMenu(mockEvent);
      }, 500);
    });

    el.addEventListener("touchmove", () => clearTimeout(touchTimer));
    el.addEventListener("touchend", () => clearTimeout(touchTimer));
    el.addEventListener("touchcancel", () => clearTimeout(touchTimer));

    el.addEventListener("focus", (e) => {
      if (currentRole === "visitor") {
        requireEditor(e);
      } else {
        if (window.innerWidth <= 768 || "ontouchstart" in window) {
          e.target.blur();
          return;
        }
        e.target.select();
      }
    });
    el.addEventListener("click", (e) => {
      if (currentRole === "visitor") requireEditor(e);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.target.blur();
      } else if (
        ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.key,
        )
      ) {
        e.preventDefault();

        let nextIndex = null;
        if (e.key === "Tab") nextIndex = e.shiftKey ? index - 1 : index + 1;
        else if (e.key === "ArrowUp")
          nextIndex = index - 16; /* Sube recto en la grilla de 16 columnas */
        else if (e.key === "ArrowDown")
          nextIndex = index + 16; /* Baja recto en la grilla de 16 columnas */
        else if (e.key === "ArrowLeft") nextIndex = index - 1;
        else if (e.key === "ArrowRight") nextIndex = index + 1;

        const nextNode = inputs[nextIndex];
        if (nextNode) {
          const targetCollab = nextNode.getAttribute("data-collab");
          const targetDate = nextNode.getAttribute("data-date");
          el.blur();
          const freshNode = document.querySelector(
            `.cell-input[data-collab="${targetCollab}"][data-date="${targetDate}"]`,
          );
          if (freshNode) {
            freshNode.focus();
            freshNode.select();
          }
        }
      }
    });
  });
}

function renderDesktopView() {
  // 1. Guardar Estado Antes del Render y centralizar permisos
  const userHasAccess =
    checkAccess("modificarHorario") || checkAccess("modificarVacaciones");
  const activeEl = document.activeElement;
  let focusCollab = null;
  let focusDate = null;
  if (activeEl && activeEl.classList.contains("cell-input")) {
    focusCollab = activeEl.getAttribute("data-collab");
    focusDate = activeEl.getAttribute("data-date");
  }

  const days = getWeekDays();

  // Header Date
  const dOptions = { day: "2-digit", month: "short" };
  document.getElementById("weekLabel").textContent =
    `${days[0].toLocaleDateString("es-ES", dOptions)} - ${days[days.length - 1].toLocaleDateString("es-ES", dOptions)}`;

  // Table Headers
  const trHead = document.getElementById("tableHeader");
  trHead.style.display = "";
  trHead.innerHTML = `<th>Colaborador</th>`;
  days.forEach((d) => {
    const dStr = formatDate(d);
    const isHoliday = state.holidays.includes(dStr);
    const evento = state.eventos[dStr];
    const weekDaysArr = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
    const monthsArr = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];
    const dayNumStr = String(d.getDate()).padStart(2, "0");
    const dayName = `${weekDaysArr[d.getDay()]} ${dayNumStr} ${monthsArr[d.getMonth()]}`;

    const isToday = formatDate(d) === formatDate(new Date());
    const todayClass = isToday ? "dia-actual " : "";
    const thClass =
      todayClass + (isHoliday ? "holiday-col day-column" : "day-column");
    const thBg = evento ? `background-color: ${evento.color}22;` : "";
    const holidayBadge = isHoliday
      ? `<span class="holiday-badge">Feriado</span>`
      : "";
    const eventBadge = evento
      ? `<span class="event-badge" style="background-color:${evento.color};"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${evento.descripcion}</span>`
      : "";

    const tawBadge = state.tawDates.includes(dStr)
      ? `<span class="taw-badge">TAW</span>`
      : "";
    const armadoBadge = state.armadoDates.includes(dStr)
      ? `<span class="armado-badge">ARMADO</span>`
      : "";

    trHead.innerHTML += `<th class="${thClass}" data-header-date="${dStr}" style="text-align: center; ${thBg}">${dayName} ${holidayBadge}${eventBadge}${tawBadge}${armadoBadge}</th>`;
  });

  // Table Body
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  // (Fila de Total Francos global eliminada para pasar a subtotales por área)

  const abandonmentMap = calculateAbandonment();

  // Week contains holiday?
  const weekHasHoliday = days.some((d) =>
    state.holidays.includes(formatDate(d)),
  );

  const areasOrderDesktop = [
    "Disponibilidad",
    "AP",
    "Calidad",
    "Linea de Cajas",
    "Perecederos",
    "Limpieza",
    "RRHH",
    "Gerentes",
    "Direccion",
  ];
  const groupedCollabsDesktop = {};
  state.collaborators.forEach((c) => {
    const area = c.area || "Disponibilidad";
    if (!groupedCollabsDesktop[area]) groupedCollabsDesktop[area] = [];
    groupedCollabsDesktop[area].push(c);
  });
  Object.keys(groupedCollabsDesktop).forEach((k) => {
    if (!areasOrderDesktop.includes(k)) areasOrderDesktop.push(k);
  });

  areasOrderDesktop.forEach((areaName, index) => {
    if (
      !groupedCollabsDesktop[areaName] ||
      groupedCollabsDesktop[areaName].length === 0
    )
      return;

    if (index === 0) {
      if (trHead.firstElementChild) {
        trHead.firstElementChild.textContent = areaName.toUpperCase();
      }
    } else {
      // 1. Heatmap Row para esta área
      const heatmapTr = document.createElement("tr");
      heatmapTr.innerHTML = `<td colspan="${days.length + 1}" style="padding: 10px 0; background: var(--bg); position: sticky; left: 0;">
               <div class="top-heatmap-area" style="margin: 0; width: 100%; border-radius: 0;">
                  <div class="heatmap-grid" id="heatmapGrid_${areaName.replace(/\s+/g, "")}"></div>
               </div>
            </td>`;
      tbody.appendChild(heatmapTr);

      // 2. Date Header Row (Copia exacta del thead global)
      const dateTr = document.createElement("tr");
      dateTr.innerHTML = trHead.innerHTML;
      if (dateTr.firstElementChild) {
        dateTr.firstElementChild.textContent = areaName.toUpperCase();
      }
      tbody.appendChild(dateTr);
    }

    groupedCollabsDesktop[areaName].forEach((collab) => {
      const tr = document.createElement("tr");
      tr.style.willChange = "transform";
      tr.setAttribute("data-collab", collab.id);

      let cellsHTML = "";

      // Collab info
      // Calculamos rotación mensual para este colaborador.
      const rotationInfo = getMonthlyRotationCompliance(collab, days);
      let indClass = rotationInfo.compliant ? "" : "red"; // default is green

      const isExported = state.exportedRows[collab.id];

      // Sunday Tracking (Francos Dominicales) - Lógica ahora delegada a updateDynamicHours

      const cleanName = collab.name.split("(")[0].split("-")[0].trim();

      let html = `
          <td class="collab-cell">
            <div style="display: flex; flex-direction: column; justify-content: flex-start; width: 100%; height: 100%; padding: 6px 12px; box-sizing: border-box; gap: 6px;">
              
              <!-- Renglón 1: Nombre completo y flecha (Ocupa todo el ancho) -->
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer;" onclick="window.toggleCollabDetails('${collab.id}')">
                 <div style="font-weight: bold; font-size: 0.95rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center;">
                   <div class="indicator ${indClass}" title="${rotationInfo.tooltip}" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex-shrink: 0;"></div>
                   ${cleanName}
                 </div>
                 <div id="collab-arrow-${collab.id}" style="font-size: 0.7rem; color: var(--text-muted); transition: transform 0.2s; padding-left: 8px;">▼</div>
              </div>

              <!-- Renglón 2: Badges (D09 + W1 a W4) alineados horizontalmente -->
              <div id="desktop-hours-${collab.id}-left" class="weekly-totals-container" style="display: flex; align-items: center; gap: 4px; width: 100%;">
                  <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 32px; width: 56px;">
                    <span id="dom-badge-${collab.id}" class="dom-badge" style="display: flex; align-items: center; justify-content: center; height: 18px; width: 100%; font-size: 0.65rem; border: 1px solid currentColor; border-radius: 3px; font-weight: bold; opacity: 0.9; box-sizing: border-box; letter-spacing: 0.5px;" title="Domingos"></span>
                  </div>
                  <div id="desktop-hours-w1-${collab.id}"></div>
                  <div id="desktop-hours-w2-${collab.id}"></div>
                  <div id="desktop-hours-w3-${collab.id}"></div>
                  <div id="desktop-hours-w4-${collab.id}"></div>
              </div>

              <!-- Renglón Inferior: Metadata desplegable -->
              <div class="mobile-hours-tag" id="mobile-hours-${collab.id}"></div>
              <div id="collab-meta-${collab.id}" class="collab-meta" style="display: none; font-size: 0.75rem; align-items: center; justify-content: flex-start; gap: 0.4rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                <span>| Leg: ${collab.id} |</span>
                <span>${collab.pasillo || "Sin Área"} |</span>
                <span>${collab.hours}h |</span>
                <span>Esq: ${collab.esquema || "N/A"} |</span>
              </div>
            </div>
          </td>
        `;

      let hasHolidayAbsenceByWeek = {};
      let hasVacationThisWeekByWeek = {};
      let totalHoursByWeek = {};
      let francoCountByWeek = {};

      let uniqueMondays = [];
      days.forEach((d) => {
        const m = formatDate(getStartOfWeek(d));
        if (!uniqueMondays.includes(m)) uniqueMondays.push(m);
      });

      uniqueMondays.forEach((mondayStr) => {
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
                if (vac.startDate === nextMonStr) {
                  isPreVacationSunday = true;
                  break;
                }
                if (
                  vac.startDate === nextTueStr &&
                  state.holidays.includes(nextMonStr)
                ) {
                  isPreVacationSunday = true;
                  break;
                }
              }
            }
            if (!isPreVacationSunday) {
              const valMon = getPlanningSlot(
                collab.id,
                nextMonStr,
              ).toLowerCase();
              const valTue = getPlanningSlot(
                collab.id,
                nextTueStr,
              ).toLowerCase();
              if (valMon === "v" || valMon === "vacaciones")
                isPreVacationSunday = true;
              else if (
                (valTue === "v" || valTue === "vacaciones") &&
                state.holidays.includes(nextMonStr)
              )
                isPreVacationSunday = true;
            }
          }

          let val = getPlanningSlot(collab.id, dStr);
          if (isPreVacationSunday) {
            francoCountByWeek[mondayStr]++;
          } else {
            const objForTardanza = getPlanningObj(collab.id, dStr) || {};
            const parsed = parseShift(
              val,
              objForTardanza.tardanzaMinutosTotales || 0,
            );
            if (parsed) {
              if (parsed.type === "work")
                totalHoursByWeek[mondayStr] += parsed.hours;
              if (parsed.type === "franco") francoCountByWeek[mondayStr]++;
              if (isHoliday && ["franco", "libre"].includes(parsed.type))
                hasHolidayAbsenceByWeek[mondayStr] = true;
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
                isPreVacationSunday = true;
                break;
              }
              if (
                vac.startDate === nextTueStr &&
                state.holidays.includes(nextMonStr)
              ) {
                isPreVacationSunday = true;
                break;
              }
            }
          }

          // 2. Fallback: check grid cell directly
          if (!isPreVacationSunday) {
            const valMon = getPlanningSlot(collab.id, nextMonStr).toLowerCase();
            const valTue = getPlanningSlot(collab.id, nextTueStr).toLowerCase();
            if (valMon === "v" || valMon === "vacaciones") {
              isPreVacationSunday = true;
            } else if (
              (valTue === "v" || valTue === "vacaciones") &&
              state.holidays.includes(nextMonStr)
            ) {
              isPreVacationSunday = true;
            }
          }
        }

        let val = getPlanningSlot(collab.id, dStr) || "";
        let parsed = null;
        let inputClass = "input-empty";
        let isDisabled = false;

        let vacationTagHtml = "";
        const isTiendaCerrada =
          state.eventos[dStr] && state.eventos[dStr].tiendaCerrada;

        if (isTiendaCerrada) {
          val = "LIBRE";
          inputClass = "input-libre";
          isDisabled = true;
        } else if (isPreVacationSunday) {
          val = "FRANCO";
          inputClass = "input-franco-locked";
          isDisabled = true;
        } else {
          let objForTardanza = getPlanningObj(collab.id, dStr) || {};
          parsed = parseShift(val, objForTardanza.tardanzaMinutosTotales || 0);

          inputClass = parsed ? parsed.class : "input-empty";

          if (
            isHoliday &&
            parsed &&
            ["franco", "libre", "absence"].includes(parsed.type)
          ) {
            inputClass += " input-holiday-absence";
          }

          if (!isHoliday && parsed && parsed.type === "franco") {
            const prevDateStr = formatDate(addDays(d, -1));
            const nextDateStr = formatDate(addDays(d, 1));
            if (
              state.holidays.includes(prevDateStr) ||
              state.holidays.includes(nextDateStr)
            ) {
              inputClass += " franco-warning";
            }
          }

          if (
            francoCountByWeek[mondayStr] > 1 &&
            parsed &&
            parsed.type === "franco"
          ) {
            inputClass += " franco-error";
          }

          if (isOnVacation) {
            vacationTagHtml = `<div class="vacation-tag">[V]</div>`;
            inputClass += " vacation-active";
          }
        }

        let styleStr = "";
        if (val.length > 6)
          styleStr = "font-size: 0.65rem; letter-spacing: -0.5px;";

        let titleAttr = "";
        let wrapperClass = "cell-wrapper";
        let obj = getPlanningObj(collab.id, dStr);
        if (obj) {
          let hasObservation = obj.comentario || obj.tardanzaMinutosTotales;

          // Remove redundant comment indicator if the cell is locked for vacations
          if (isOnVacation || isPreVacationSunday) {
            hasObservation = false;
          }

          if (hasObservation) {
            wrapperClass += " has-comment";
            let titleParts = [];
            if (obj.tardanzaMinutosTotales)
              titleParts.push(
                `Tardanza: ${obj.tardanzaTexto || obj.tardanzaMinutosTotales}`,
              );
            if (obj.comentario) titleParts.push(obj.comentario);
            titleAttr = `title="${titleParts.join(" | ")}"`;
          }
          if (obj.fijado) {
            wrapperClass += " is-fixed";
            if (titleAttr) {
              titleAttr = `title="Fijado | ${titleAttr.replace('title="', "").replace('"', "")}"`;
            } else {
              titleAttr = `title="Turno Fijado"`;
            }
          }

          // NEW: Overtime indicator
          const otInfo = calculateOvertimeInfo(collab.id, dStr, parsed);
          if (otInfo) {
            if (obj.horaExtraValidada) {
              wrapperClass += " has-overtime-validated";
            } else {
              wrapperClass += " has-overtime-pending";
            }

            let otTitle = `Horas Extras: ${otInfo.excess}hs (${obj.horaExtraValidada ? "Validado" : "Pendiente"})`;
            if (titleAttr) {
              titleAttr = titleAttr.replace('title="', `title="${otTitle} | `);
            } else {
              titleAttr = `title="${otTitle}"`;
            }
          }
        }

        let isSkeleton =
          state.skeletonStartStr && dStr >= state.skeletonStartStr;
        const isToday = dStr === formatDate(new Date());
        const todayClass = isToday ? " dia-actual" : "";
        let finalWrapperClass =
          wrapperClass +
          (isSkeleton ? " skeleton-cell" : "") +
          " day-cell" +
          todayClass;

        // Validar descanso diario de 12 horas para turnos ya cargados
        let hasRestError = false;
        if (parsed && parsed.type === "work") {
          const prevDateStr = formatDate(addDays(d, -1));
          const prevSlotKey = getPlanningSlot(collab.id, prevDateStr);
          const prevSlot = parseShift(prevSlotKey);
          if (prevSlot && prevSlot.type === "work") {
            let currAbs = getShiftAbsoluteTimes(dStr, parsed);
            let prevAbs = getShiftAbsoluteTimes(prevDateStr, prevSlot);
            if (
              currAbs &&
              prevAbs &&
              (currAbs.start - prevAbs.end) / 3600000 < 12
            ) {
              hasRestError = true;
            }
          }
        }

        if (hasRestError) {
          inputClass += " franco-error"; // Aplica el estilo rojo fuerte nativo
        }

        let finalInputClass =
          inputClass + (isSkeleton ? " skeleton-input" : "");

        // Calcular color de evento si la celda está marcada como inventario
        const eventoDelDia = state.eventos[dStr];
        const esInventarioCelda = obj && obj.esInventario && eventoDelDia;
        let eventoCellStyle = esInventarioCelda
          ? `background-color: ${eventoDelDia.color}33;`
          : "";

        if (isTiendaCerrada) {
          eventoCellStyle = "background-color: rgba(100, 116, 139, 0.2);";
        }

        let displayVal = val;
        if (
          obj &&
          obj.horarioOriginal &&
          obj.horarioOriginal !== val &&
          !isOnVacation &&
          !isTiendaCerrada
        ) {
          displayVal += " *";
          let origTitle = `Horario original: ${obj.horarioOriginal}`;
          if (titleAttr) {
            titleAttr = titleAttr.replace('title="', `title="${origTitle} | `);
          } else {
            titleAttr = `title="${origTitle}"`;
          }
        }

        // 1. Detectar borde estricto de nómina (Domingos)
        let isSunday = targetD.getDay() === 0;
        let additionalCellClass = isSunday ? "sunday-cell" : "";

        // 2. Parsear el valor para apilamiento vertical
        let displayHtml = "";
        let matchHorario = displayVal.match(/^(\d{1,2}(?::\d{2})?)\s*(?:a|-)\s*(\d{1,2}(?::\d{2})?)$/i);
        
        if (matchHorario) {
          // Micro-celda de turno normal
          displayHtml = `
            <div class="shift-cell ${finalInputClass.replace('input-empty', '')}">
              <span class="shift-start">${matchHorario[1]}</span>
              <span class="shift-end">${matchHorario[2]}</span>
            </div>
          `;
        } else {
          // Francos, Vacaciones o vacíos
          let explicitLabel = displayVal;
          if (displayVal.toUpperCase() === 'FRANCO') explicitLabel = 'F';
          else if (displayVal.toUpperCase() === 'VACACIONES' || isOnVacation) explicitLabel = 'V';
          else if (displayVal.toUpperCase() === 'LIBRE') explicitLabel = 'L';
          else if (displayVal === '-') explicitLabel = '';

          displayHtml = `
            <div class="shift-cell ${finalInputClass.replace('input-empty', '')}">
              <span class="shift-label">${explicitLabel}</span>
            </div>
          `;
        }

        // 3. Generar la celda (el input queda invisible encima)
        html += `
            <td class="${isHoliday ? "holiday-col" : ""} ${finalWrapperClass} ${additionalCellClass} day-cell" ${titleAttr} data-collab="${collab.id}" data-date="${dStr}" style="position: relative; ${isOnVacation ? "background-color: rgba(14, 165, 233, 0.08);" : ""}${eventoCellStyle}">
              <div class="ot-indicator"></div>
              ${vacationTagHtml}
              
              <!-- Presentación visual (Apilada) -->
              ${displayHtml}
              
              <!-- Sistema transaccional intacto (Invisible hasta hacer focus) -->
              <input type="text" class="cell-input ${finalInputClass} cell-input-hidden" style="${styleStr}" data-collab="${collab.id}" data-date="${dStr}" value="${displayVal}" ${isDisabled ? 'disabled data-disabled="true"' : ""} placeholder="-">
            </td>
          `;
      });

      tr.innerHTML = html;
      tbody.appendChild(tr);
    });

    // Inyectar fila de totales por área
    const areaTotalsHTML = renderAreaCounters(
      areaName,
      groupedCollabsDesktop[areaName],
      days,
    );
    const trTotals = document.createElement("tr");
    trTotals.className = "area-totals-row";
    trTotals.dataset.area = areaName;
    trTotals.innerHTML = areaTotalsHTML;
    trTotals.innerHTML = areaTotalsHTML;
    tbody.appendChild(trTotals);
  });

  // ── INYECCIÓN DE REPOSITORES EXTERNOS ──
  if (state.repositoresData && state.repositoresData.length > 0) {
    const sortedRepos = [...state.repositoresData].sort((a, b) => {
      const empA = (a.empresa || "").toLowerCase();
      const empB = (b.empresa || "").toLowerCase();
      if (empA < empB) return -1;
      if (empA > empB) return 1;
      const nomA = (a.nombre || "").toLowerCase();
      const nomB = (b.nombre || "").toLowerCase();
      if (nomA < nomB) return -1;
      if (nomA > nomB) return 1;
      return 0;
    });

    const repoHeaderTr = document.createElement("tr");
    repoHeaderTr.className = "area-header-row";
    repoHeaderTr.innerHTML = `
            <td colspan="${days.length + 1}" style="background: var(--surface); padding: 12px; font-weight: 600; color: var(--primary); text-transform: uppercase; cursor: pointer; border-bottom: 2px solid var(--border);">
               <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span>Repositores Externos</span>
                  <svg class="area-toggle-icon" style="transition: transform 0.3s; transform: rotate(180deg);" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
               </div>
            </td>
         `;
    let reposVisible = true;
    repoHeaderTr.addEventListener("click", () => {
      reposVisible = !reposVisible;
      const icon = repoHeaderTr.querySelector(".area-toggle-icon");
      icon.style.transform = reposVisible ? "rotate(180deg)" : "rotate(0deg)";
      document.querySelectorAll(".repo-row").forEach((row) => {
        row.style.display = reposVisible ? "" : "none";
      });
    });
    tbody.appendChild(repoHeaderTr);

    sortedRepos.forEach((repo) => {
      const repoTr = document.createElement("tr");
      repoTr.className = "collab-row repo-row";
      repoTr.dataset.id = repo.id;

      const contactInfo =
        "Supervisor: " +
        (repo.supervisor || "-") +
        " (" +
        (repo.telSupervisor || "-") +
        ") | Marcas: " +
        (repo.marcas || "-");

      const cleanPhone = (phone) => {
        if (!phone) return "";
        if (phone.toLowerCase().trim() === "sin datos") return "";
        return phone.replace(/[\s\-\(\)]/g, "");
      };

      const repoPhoneRaw = repo.celular || "";
      const repoPhone = cleanPhone(repoPhoneRaw);
      const isRepoPhoneValid = repoPhone.length > 0;

      const supPhoneRaw = repo.telSupervisor || "";
      const supPhone = cleanPhone(supPhoneRaw);
      const isSupPhoneValid = supPhone.length > 0;

      const supEmailRaw = repo.email || repo.correo || "";
      const isSupEmailValid =
        supEmailRaw &&
        supEmailRaw.toLowerCase().trim() !== "sincorreo@sincorreo.com" &&
        supEmailRaw.toLowerCase().trim() !== "sin datos";

      const waIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-message-circle"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
      const mailIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-mail"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;

      const getIconStyle = (isValid, color) =>
        isValid
          ? `color: ${color}; cursor: pointer; transition: opacity 0.2s;`
          : `color: var(--text-muted); opacity: 0.3; pointer-events: none;`;

      let html = `
               <td class="collab-name-cell" title="${contactInfo}" style="position: relative; background: rgba(255,255,255,0.02); padding-right: 8px;">
                 <div style="display: flex; align-items: center; justify-content: space-between; height: 100%; width: 100%;">
                     <div style="display: flex; flex-direction: column; justify-content: center; cursor: help;">
                        <div style="font-weight: 500; font-size: 0.9rem;">${repo.nombre || "Sin Nombre"}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${repo.empresa || "Sin Empresa"}</div>
                     </div>
                     <div style="display: flex; gap: 10px; align-items: center;">
                         <!-- Repo WP -->
                         <a href="https://wa.me/${repoPhone}" target="_blank" title="${isRepoPhoneValid ? "Contactar Repositor" : "Sin Datos"}" style="${getIconStyle(isRepoPhoneValid, "#22c55e")}; display: flex; align-items: center;">
                             ${waIconSvg}
                         </a>
                         
                         <!-- Sup Block -->
                         <div style="display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);" title="Contacto Supervisor">
                             <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 600;">SUP</span>
                             <a href="https://wa.me/${supPhone}" target="_blank" title="${isSupPhoneValid ? "WhatsApp Supervisor" : "Sin Datos"}" style="${getIconStyle(isSupPhoneValid, "#22c55e")}; display: flex; align-items: center;">
                                 ${waIconSvg}
                             </a>
                             <a href="https://mail.google.com/mail/?view=cm&fs=1&to=${supEmailRaw}" target="_blank" title="${isSupEmailValid ? "Email Supervisor" : "Sin Datos"}" style="${getIconStyle(isSupEmailValid, "#3b82f6")}; display: flex; align-items: center;">
                                 ${mailIconSvg}
                             </a>
                         </div>
                     </div>
                 </div>
               </td>
             `;

      const diasMap = {
        1: "L",
        2: "M",
        3: "X",
        4: "J",
        5: "V",
        6: "S",
        0: "D",
      };

      days.forEach((d) => {
        const dStr = formatDate(d);
        const dayLetter = diasMap[d.getDay()];
        const repoDias = repo.diasVisita || "";
        const isExpected = repoDias.includes(dayLetter);

        const valRaw = state.planning[repo.id + "_" + dStr];
        let displayVal = "";
        if (typeof valRaw === "object" && valRaw !== null) {
          displayVal = valRaw.slot || valRaw.horario || "";
        } else if (typeof valRaw === "string") {
          displayVal = valRaw;
        }
        const isHoliday = state.holidays.includes(dStr);

        let bgClass = isHoliday ? "holiday-col" : "";
        if (isExpected) bgClass += " repo-esperado";

        let placeholderText = "-";
        if (isExpected && !displayVal) {
          placeholderText = repo.horario || "Visita";
        }

        const styleStr =
          "font-weight: 500; text-align: center; width: 100%; border: none; background: transparent; color: var(--text); cursor: default; pointer-events: none;";
        const disabledAttr = !userHasAccess
          ? 'disabled data-disabled="true"'
          : "";

        html += `
                   <td class="${bgClass.trim()}" style="position: relative;">
                     <input type="text" class="cell-input" style="${styleStr}" data-collab="${repo.id}" data-date="${dStr}" data-is-repositor="true" readonly value="${displayVal}" ${disabledAttr} placeholder="${placeholderText}">
                   </td>
                 `;
      });
      repoTr.innerHTML = html;
      tbody.appendChild(repoTr);
    });
  }
  // Counters Footer (Global removido, ahora es por área)
  const tfoot = document.getElementById("tableFooter");
  if (tfoot) tfoot.innerHTML = "";

  // Attach events
  attachScheduleEventListeners();

  renderHeatmap();
  updateDynamicHours(); // Llama a la actualización de horas inicial

  // 3. Restaurar Estado Después del Render
  if (focusCollab && focusDate) {
    const toFocus = document.querySelector(
      `.cell-input[data-collab="${focusCollab}"][data-date="${focusDate}"]`,
    );
    if (toFocus) {
      toFocus.focus();
      toFocus.select();
    }
  }
}

function renderAreaCounters(areaName, collabs, days) {
  let html = `
        <td style="background: rgba(15, 23, 42, 0.95); border-bottom: 2px solid var(--border); padding: 4px 8px 4px 15px; vertical-align: top;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
             <div style="display: flex; flex-direction: column; justify-content: flex-start; line-height: 1.2; padding: 2px 0;">
                <div style="color: transparent; font-size: 0.8rem; margin-bottom: 2px; user-select: none; pointer-events: none;">-</div>
                <span style="font-weight: bold; color: var(--primary); font-size: 0.8rem;">Subtotales ${areaName}</span>
                <div style="font-size: 0.65rem; color: var(--text-muted);">M(05-10)|I(11-13)|T(14-19)|N(20-00)|E(00-04)</div>
             </div>
             <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; line-height: 1.2; padding: 2px 0;">
                <div style="font-weight: bold; color: #a855f7; font-size: 0.8rem; margin-bottom: 2px;">Francos:</div>
                ${
                  areaName === "Disponibilidad"
                    ? `
                <div style="display: flex; gap: 12px; margin-top: 4px;">
                    <div style="display: flex; align-items: center; gap: 4px; border: 1px solid var(--danger); border-radius: 4px; padding: 2px 4px; background: rgba(239, 68, 68, 0.1);" title="Semana 1: Presupuesto Extra">
                       <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">W1 Ext:</span>
                       <span id="global-overtime-budget-w1" style="font-weight: bold; color: var(--danger); font-size: 0.85rem;">0h</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px; border: 1px solid var(--danger); border-radius: 4px; padding: 2px 4px; background: rgba(239, 68, 68, 0.1);" title="Semana 2: Presupuesto Extra">
                       <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">W2 Ext:</span>
                       <span id="global-overtime-budget-w2" style="font-weight: bold; color: var(--danger); font-size: 0.85rem;">0h</span>
                    </div>
                </div>`
                    : ""
                }
             </div>
          </div>
        </td>`;

  days.forEach((d) => {
    const dStr = formatDate(d);
    const counts = { M: 0, I: 0, T: 0, N: 0, E: 0 };
    let francos = 0;

    collabs.forEach((c) => {
      let isOnVacationToday = false;
      const targetD = new Date(dStr + "T00:00:00");

      for (let vac of state.vacations || []) {
        if (vac.colaboradorId === c.id) {
          const vacStart = new Date(vac.startDate + "T00:00:00");
          const vacEnd = new Date(vac.endDate + "T00:00:00");
          if (targetD >= vacStart && targetD <= vacEnd)
            isOnVacationToday = true;
        }
      }

      if (!isOnVacationToday) {
        const objForTardanza = getPlanningObj(c.id, dStr) || {};
        const valToday = getPlanningSlot(c.id, dStr);
        const parsedToday = parseShift(
          valToday,
          objForTardanza.tardanzaMinutosTotales || 0,
        );
        if (parsedToday) {
          if (
            parsedToday.group &&
            counts[parsedToday.group] !== undefined &&
            !parsedToday.isNV
          ) {
            counts[parsedToday.group]++;
          }
          if (parsedToday.type === "franco" || parsedToday.type === "libre") {
            francos++;
          }
        }
      }
    });

    html += `
          <td style="background: rgba(15, 23, 42, 0.95); border-bottom: 2px solid var(--border); vertical-align: top; padding: 4px 0;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; font-size: 0.65rem; line-height: 1.2; padding: 2px 0;">
               <div style="color: #a855f7; font-weight: bold; font-size: 0.8rem; margin-bottom: 2px;" title="Total Francos">${francos}</div>
               <div style="display: flex; flex-wrap: wrap; gap: 0.15rem 0.35rem; justify-content: center; color: var(--text-muted);">
                  <div>M:<strong style="color: var(--text); margin-left:1px;">${counts["M"]}</strong></div>
                  <div>I:<strong style="color: var(--text); margin-left:1px;">${counts["I"]}</strong></div>
                  <div>T:<strong style="color: var(--text); margin-left:1px;">${counts["T"]}</strong></div>
                  <div>N:<strong style="color: var(--text); margin-left:1px;">${counts["N"]}</strong></div>
                  <div>E:<strong style="color: var(--text); margin-left:1px;">${counts["E"]}</strong></div>
               </div>
            </div>
          </td>
        `;
  });
  return html;
}

function renderHeatmap() {
  const allDays = getWeekDays();
  const startIndex = window.currentHeatmapStartIndex || 0;
  // Saltamos el día de margen y tomamos los 7 días reales de la semana
  const days = allDays.slice(startIndex + 1, startIndex + 8);

  const areasToRender = ["Disponibilidad"];
  if (typeof groupedCollabsDesktop !== "undefined") {
    Object.keys(groupedCollabsDesktop).forEach((k) => {
      if (k !== "Disponibilidad") areasToRender.push(k);
    });
  }

  areasToRender.forEach((areaName) => {
    const gridId =
      areaName === "Disponibilidad"
        ? "heatmapGrid"
        : `heatmapGrid_${areaName.replace(/\s+/g, "")}`;
    const grid = document.getElementById(gridId);
    if (!grid) return;

    let html = `<div class="heatmap-row heatmap-header-row">`;
    html += `<div style="border-bottom: 1px solid rgba(255,255,255,0.05);"></div>`; // Empty corner cell
    for (let h = 0; h <= 23; h++) {
      const timeLabel = String(h).padStart(2, "0");
      html += `<div class="heatmap-header-cell" style="border-bottom: 1px solid rgba(255,255,255,0.05);">${timeLabel}h</div>`;
    }
    html += `</div>`;

    days.forEach((d) => {
      const dStr = formatDate(d);
      const weekDaysArr = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
      const monthsArr = [
        "ENE",
        "FEB",
        "MAR",
        "ABR",
        "MAY",
        "JUN",
        "JUL",
        "AGO",
        "SEP",
        "OCT",
        "NOV",
        "DIC",
      ];
      const dayNumStr = String(d.getDate()).padStart(2, "0");
      const dayLabel = `${weekDaysArr[d.getDay()]} ${dayNumStr} ${monthsArr[d.getMonth()]}`;

      const prevDateStr = formatDate(addDays(d, -1));

      const capitalizedLabel =
        dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);

      const isSkeleton =
        state.skeletonStartStr && dStr >= state.skeletonStartStr;

      html += `<div class="heatmap-row ${isSkeleton ? "skeleton-cell" : ""}" data-date="${dStr}">`;
      html += `<div class="heatmap-row-label">${capitalizedLabel}</div>`;

      const hourlyCounts = {};
      for (let h = 0; h <= 23; h++) hourlyCounts[h] = 0;

      state.collaborators.forEach((c) => {
        const collabArea = c.area || "Disponibilidad";
        if (collabArea !== areaName) return;

        const objForTardanza = getPlanningObj(c.id, dStr) || {};
        const valToday = getPlanningSlot(c.id, dStr);
        const parsedToday = parseShift(
          valToday,
          objForTardanza.tardanzaMinutosTotales || 0,
        );

        const targetDToday = new Date(dStr + "T00:00:00");
        const targetDPrev = new Date(prevDateStr + "T00:00:00");
        let isOnVacationToday = false;
        let isOnVacationPrev = false;
        for (let vac of state.vacations) {
          if (vac.colaboradorId === c.id) {
            const vacStart = new Date(vac.startDate + "T00:00:00");
            const vacEnd = new Date(vac.endDate + "T00:00:00");
            if (targetDToday >= vacStart && targetDToday <= vacEnd)
              isOnVacationToday = true;
            if (targetDPrev >= vacStart && targetDPrev <= vacEnd)
              isOnVacationPrev = true;
          }
        }

        const valPrev = getPlanningSlot(c.id, prevDateStr);
        const parsedPrev = parseShift(valPrev);

        for (let h = 0; h <= 23; h++) {
          if (
            !isOnVacationToday &&
            parsedToday &&
            parsedToday.type === "work"
          ) {
            if (parsedToday.end <= parsedToday.start) {
              if (h >= parsedToday.start) hourlyCounts[h]++;
            } else {
              if (h >= parsedToday.start && h < parsedToday.end)
                hourlyCounts[h]++;
            }
          }
          if (!isOnVacationPrev && parsedPrev && parsedPrev.type === "work") {
            if (parsedPrev.end <= parsedPrev.start) {
              if (h < parsedPrev.end) hourlyCounts[h]++;
            }
          }
        }
      });

      for (let h = 0; h <= 23; h++) {
        const count = hourlyCounts[h];
        let heatClass = "heat-danger";
        if (count >= 3) heatClass = "heat-success";
        else if (count >= 1) heatClass = "heat-warning";

        html += `<div class="heatmap-cell ${heatClass}" title="${h}h: ${count} personas">${count}</div>`;
      }
      html += `</div>`;
    });

    grid.innerHTML = html;
  });
}

// 10. INTERACCION Y GUARDADO
async function handleInputChange(e) {
  const input = e.target;
  if (input.readOnly || input.disabled) return;

  // MIDDLEWARE: Verificar permiso antes de procesar cualquier cambio
  if (!checkAccessWithToast("modificarHorario")) {
    input.value =
      getPlanningSlot(
        input.getAttribute("data-collab"),
        input.getAttribute("data-date"),
      ) || "";
    return;
  }
  const collabId = input.getAttribute("data-collab");
  const dateStr = input.getAttribute("data-date");
  const rawValue = input.value.replace("*", "").trim();
  const isRepositor = input.getAttribute("data-is-repositor") === "true";

  const oldValue = getPlanningSlot(collabId, dateStr);
  let finalValue = "";
  let parsedNew = null;
  let validation = { valid: true };

  if (isRepositor) {
    finalValue = rawValue;
  } else {
    parsedNew = parseShift(rawValue);
    if (parsedNew && parsedNew.type === "error") {
      showToast(
        "Error de Formato",
        `El turno '${rawValue}' no es válido. Usa '6a14', 'F', 'V', 'E'.`,
      );
      input.value = oldValue; // Revert
      return;
    }
    finalValue = parsedNew ? parsedNew.label : "";
    validation = validateTurn(collabId, dateStr, parsedNew);
  }

  if (finalValue === oldValue) {
    input.value = finalValue; // Limpia el formato de vista
    return;
  }

  // Check for fixed shift override
  const currentObj = getPlanningObj(collabId, dateStr);
  if (currentObj && currentObj.fijado) {
    const dateTxt = currentObj.fechaFijado || "fecha desconocida";
    if (
      !confirm(
        `Este horario fue fijado a petición del colaborador el ${dateTxt}.\n\n¿Estás seguro de que deseas modificarlo?`,
      )
    ) {
      input.value = oldValue;
      return;
    }
  }

  if (!isRepositor) {
    if (!validation.valid) {
      if (validation.type === "legal") {
        showToast(
          "ERROR CRÍTICO DE LEY",
          `No se puede asignar este horario.<br>El colaborador no cumple con las ${validation.req} de descanso obligatorio por Ley.`,
        );
      } else if (validation.type === "exceso_horas") {
        showToast("LÍMITE OPERATIVO VIOLADO", validation.msg);
      } else {
        showToast("Restricción Violada", validation.msg);
      }
      input.value = oldValue;
      input.classList.add("input-error");
      return;
    }

    input.classList.remove("input-error");

    if (parsedNew && parsedNew.type === "vacation") {
      const touchesBuena = getVacationSeason(dateStr) === "Buena";
      if (touchesBuena) {
        const collab = state.collaborators.find((c) => c.id === collabId);
        const hist = collab?.historialVacaciones || {};
        const currYear = new Date().getFullYear();
        const lastYear = currYear - 1;
        const twoYearsAgo = currYear - 2;
        if (hist[lastYear] === "Buena" || hist[twoYearsAgo] === "Buena") {
          showToast(
            "Regla 2x1",
            `El colaborador ${collab?.name || collabId} ya tuvo temporada Buena en los últimos 2 años. Solo le corresponde temporada Mala.`,
          );
          return;
        }
      }
    }
  }

  // Preserve metadata
  let obj = getPlanningObj(collabId, dateStr) || {};
  obj.slot = finalValue;

  if (finalValue === "") {
    delete state.planning[`${collabId}_${dateStr}`];
  } else {
    state.planning[`${collabId}_${dateStr}`] = obj;
  }

  if (oldValue !== finalValue) {
    logAudit("Modificar Turno", collabId, dateStr, oldValue, finalValue);
    if (typeof window.registrarLogActividad === "function") {
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
    if (parsed && parsed.type === "franco") francoCount++;
  }

  if (francoCount > 1) {
    const collabName =
      state.collaborators.find((c) => c.id === collabId)?.name ||
      "el colaborador";
    showToast(
      "Error de Planificación",
      `El colaborador ${collabName} tiene más de un Franco asignado en esta semana calendario. Usa 'Libre' para días extra.`,
    );
  }

  renderHeatmap(); // Update heat map in real time

  // Async save to Firestore
  if (!isMockMode) {
    if (!requireAuth()) {
      input.value = oldValue;
      return;
    }
    try {
      const docId = `${collabId}_${dateStr}`;
      setDoc(
        doc(db, "planificacion", docId),
        {
          colaboradorId: collabId,
          fecha: dateStr,
          slot: finalValue,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error guardando:", err);
      showToast("Error de conexión", "No se pudo guardar en la base de datos.");
    }
  }

  renderUI();
}

// 12. UTILS Y EVENTOS

function showToast(title, msg, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");

  let typeClass = "info";
  if (type === "error" || type === "danger") typeClass = "error";
  if (type === "success") typeClass = "success";
  if (type === "warning") typeClass = "warning";

  toast.className = `toast ${typeClass}`;

  const isPersistent = typeClass === "error" || typeClass === "danger";

  let html = `
        <div class="toast-title">${title}</div>
        <div class="toast-desc">${msg}</div>
        <button class="toast-close" onclick="this.parentElement.classList.remove('show'); setTimeout(() => this.parentElement.remove(), 400);">&times;</button>
      `;

  if (!isPersistent) {
    html += `
          <div class="toast-progress">
             <div class="toast-progress-bar"></div>
          </div>
        `;
  }

  toast.innerHTML = html;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
    if (!isPersistent) {
      const bar = toast.querySelector(".toast-progress-bar");
      if (bar) {
        // Forzar reflow para animación
        bar.getBoundingClientRect();
        bar.style.width = "0%";
      }
    }
  }, 10);

  if (!isPersistent) {
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
      }
    }, 5000);
  }
}

document.getElementById("prevDayBtn").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, -1);
  loadWeekPlanning();
});

document.getElementById("prevWeekBtn").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, -7);
  loadWeekPlanning();
});

document.getElementById("nextWeekBtn").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, 7);
  loadWeekPlanning();
});

document.getElementById("nextDayBtn").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, 1);
  loadWeekPlanning();
});

// 13. GESTION DE DOTACION
const configModal = document.getElementById("configModal");
const collabForm = document.getElementById("collabForm");

document.getElementById("configBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  console.log("CLICK: configBtn called!");

  // Cerrar el dropdown del nav antes de abrir el modal
  const dropdownMenu = document.getElementById("navDropdownMenu");
  if (dropdownMenu) dropdownMenu.style.display = "none";

  renderConfigModalList();
  collabForm.reset();
  document.getElementById("collabMode").value = "add";
  document.getElementById("cLegajo").disabled = false;
  document.getElementById("cCancelBtn").style.display = "none";
  document.getElementById("cDeleteBtn").style.display = "none";
  document.getElementById("cSubmitBtn").innerText = "Guardar";
  configModal.classList.add("active");
  // Renderizar tabla de Gestión de Invitados
  const invContainer = document.getElementById("gestionInvitadosContainer");
  // Función renderGestionInvitados eliminada
  if(typeof window.renderGestionInvitados === 'function') {
      window.renderGestionInvitados();
  }
});

document.getElementById("closeConfigModal").addEventListener("click", () => {
  configModal.classList.remove("active");
});

document.getElementById("cCancelBtn").addEventListener("click", () => {
  collabForm.reset();
  document.getElementById("collabMode").value = "add";
  document.getElementById("cLegajo").disabled = false;
  document.getElementById("cCancelBtn").style.display = "none";
  document.getElementById("cDeleteBtn").style.display = "none";
  document.getElementById("cSubmitBtn").innerText = "Guardar";
});

document.getElementById("cDeleteBtn").addEventListener("click", () => {
  const id = document.getElementById("cLegajo").value;
  if (id) deleteCollab(id);
});

collabForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const legajo = document.getElementById("cLegajo").value.trim();

  const existingCollab = state.collaborators.find((c) => c.id === legajo) || {};

  const newCollab = {
    id: legajo,
    name: document.getElementById("cName").value.trim(),
    esquema: document.getElementById("cEsquema").value.trim(),
    hours: parseInt(document.getElementById("cHours").value),
    domingosAcordados: parseInt(document.getElementById("cDoms").value),
    pasillo: document.getElementById("cPasillo").value.trim(),
    url_carpeta_comprobantes: document
      .getElementById("cFolderUrl")
      .value.trim(),
    fechaAlta: document.getElementById("cFechaAlta").value,
    area: document.getElementById("cArea").value,
  };

  // Guardar en Firebase
  if (!requireAuth()) return;
  if (!isMockMode) {
    try {
      await setDoc(doc(db, "colaboradores", legajo), newCollab, {
        merge: true,
      });
      logAudit(
        document.getElementById("collabMode").value === "edit"
          ? "Editar Colaborador"
          : "Crear Colaborador",
        legajo,
        "N/A",
        "",
        newCollab.name,
      );
    } catch (err) {
      console.error("Error al guardar colaborador", err);
      showToast("Error", "No se pudo guardar en la base de datos.");
      return;
    }
  }

  // Actualizar estado local (preservando historialVacaciones, saldoVacaciones, etc)
  const mergedCollab = { ...existingCollab, ...newCollab };
  const idx = state.collaborators.findIndex((c) => c.id === legajo);
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
  document.getElementById("collabMode").value = "add";
  document.getElementById("cLegajo").disabled = false;

  document.getElementById("cCancelBtn").style.display = "none";
  document.getElementById("cDeleteBtn").style.display = "none";
  document.getElementById("cSubmitBtn").innerText = "Guardar";

  renderConfigModalList();
  renderUI(); // Renderizar DOM sin recargar
});

function renderConfigModalList() {
  const container = document.getElementById("collabListContainer");
  container.innerHTML = "";

  state.collaborators.forEach((c) => {
    const div = document.createElement("div");
    div.className = "bento-card";
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
window.editCollab = function (id) {
  const c = state.collaborators.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("collabMode").value = "edit";
  const legInput = document.getElementById("cLegajo");
  legInput.value = c.id;
  legInput.disabled = true; // Bloquear edición de ID
  document.getElementById("cName").value = c.name;
  document.getElementById("cEsquema").value = c.esquema || "";
  document.getElementById("cHours").value = c.hours;
  document.getElementById("cDoms").value = c.domingosAcordados || 0;
  document.getElementById("cPasillo").value = c.pasillo;
  document.getElementById("cFechaAlta").value = c.fechaAlta || "";
  document.getElementById("cArea").value = c.area || "Disponibilidad";

  document.getElementById("cCancelBtn").style.display = "block";
  document.getElementById("cDeleteBtn").style.display = "block";
  document.getElementById("cSubmitBtn").innerText = "Actualizar";
};

window.deleteCollab = async function (id) {
  if (!requireAuth()) return;
  if (!confirm("¿Seguro que deseas eliminar al colaborador " + id + "?"))
    return;

  if (!isMockMode) {
    try {
      await deleteDoc(doc(db, "colaboradores", id));
    } catch (err) {
      console.error("Error al eliminar", err);
      showToast("Error", "No se pudo eliminar en la base de datos.");
      return;
    }
  }

  state.collaborators = state.collaborators.filter((c) => c.id !== id);

  // Limpiar turnos asociados localmente para que no queden huérfanos en la UI
  Object.keys(state.planning).forEach((key) => {
    if (key.startsWith(id + "_")) {
      delete state.planning[key];
    }
  });

  renderConfigModalList();
  renderUI(); // Renderizar DOM sin recargar
  showToast("Éxito", "Colaborador eliminado.");
};

// 14. MODULO ANUAL DE VACACIONES Y METRICAS

let currentMetricsYear = new Date().getFullYear().toString();

window.renderMetrics = async function () {
  const container = document.getElementById("metricsBentoGrid");
  if (!container) return;

  const yearSelector = document.getElementById("metricsYearSelector");
  if (yearSelector) {
    yearSelector.innerHTML = ""; // Resetear opciones

    let uniqueYears = new Set();
    const cy = new Date().getFullYear().toString();
    uniqueYears.add(cy); // Garantizar al menos el año actual

    if (state.planning) {
      Object.keys(state.planning).forEach((key) => {
        const parts = key.split("_");
        if (parts.length > 1) {
          const dateStr = parts[1];
          if (dateStr) {
            const year = dateStr.split("-")[0];
            if (year && year.length === 4) uniqueYears.add(year);
          }
        }
      });
    }

    const yearsArr = Array.from(uniqueYears).sort((a, b) => b - a);

    if (!yearsArr.includes(currentMetricsYear))
      currentMetricsYear = yearsArr[0];

    yearsArr.forEach((y) => {
      const opt = document.createElement("option");
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
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${currentMetricsYear}/AR`,
    );
    if (res.ok) {
      const data = await res.json();
      state.holidays = data.map((h) => h.date);
    }
  } catch (e) {
    console.error("Feriados error:", e);
    state.holidays = [
      `${currentMetricsYear}-01-01`,
      `${currentMetricsYear}-02-12`,
      `${currentMetricsYear}-02-13`,
      `${currentMetricsYear}-03-24`,
      `${currentMetricsYear}-03-29`,
      `${currentMetricsYear}-04-02`,
      `${currentMetricsYear}-05-01`,
      `${currentMetricsYear}-05-25`,
      `${currentMetricsYear}-06-20`,
      `${currentMetricsYear}-07-09`,
      `${currentMetricsYear}-12-08`,
      `${currentMetricsYear}-12-25`,
    ];
  }

  // 2. Fetch full year from Firestore
  try {
    if (!isMockMode) {
      const q = query(
        collection(db, "planificacion"),
        where("fecha", ">=", `${currentMetricsYear}-01-01`),
        where("fecha", "<=", `${currentMetricsYear}-12-31`),
      );
      const snap = await getDocs(q);
      snap.forEach((doc) => {
        state.planning[doc.id] = doc.data();
      });
    }
  } catch (e) {
    console.error("Firestore metrics fetch error:", e);
  }

  container.innerHTML = "";

  const isAbsence = (text) => {
    if (!text) return false;
    return text.trim().toLowerCase() === "e";
  };

  const isDayOff = (text) => {
    if (!text) return false;
    const t = text.toLowerCase();
    return t === "f" || t === "libre" || t === "v" || t === "vacaciones";
  };

  const getSickBlockCount = (collabId, dateStr) => {
    let count = 1;
    const [y, m, d] = dateStr.split("-");
    let currentD = new Date(y, m - 1, d);

    let tempD = addDays(currentD, -1);
    while (true) {
      const dStr = formatDate(tempD);
      const obj = getPlanningObj(collabId, dStr);
      const slot = obj ? obj.slot : getPlanningSlot(collabId, dStr);
      if (isAbsence(slot)) {
        count++;
        tempD = addDays(tempD, -1);
      } else if (isDayOff(slot)) {
        tempD = addDays(tempD, -1);
      } else {
        break;
      }
    }

    tempD = addDays(currentD, 1);
    while (true) {
      const dStr = formatDate(tempD);
      const obj = getPlanningObj(collabId, dStr);
      const slot = obj ? obj.slot : getPlanningSlot(collabId, dStr);
      if (isAbsence(slot)) {
        count++;
        tempD = addDays(tempD, 1);
      } else if (isDayOff(slot)) {
        tempD = addDays(tempD, 1);
      } else {
        break;
      }
    }
    return count;
  };

  const metricsData = [];

  state.collaborators.forEach((collab) => {
    let tardanzaTotalMins = 0;
    let partesPegados = [];
    let cambiosSolicitados = 0;
    let feriadosTrabajados = 0;
    let feriadosLibres = 0;
    let enfermedadTotalDias = 0;

    // Process all unique dates in planning to calculate metrics
    const allDates = Object.keys(state.planning)
      .filter((k) => k.startsWith(collab.id + "_"))
      .map((k) => k.split("_")[1])
      .filter((d) => d.startsWith(currentMetricsYear))
      .sort();

    allDates.forEach((dateStr) => {
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

      // b. Partes Pegados y Enfermedad
      const val = obj.slot || "";
      const isSick = isAbsence(val);
      if (isSick) {
        enfermedadTotalDias++;
        // Ensure date object properly reflects the date string natively without timezone offset issues
        const [year, month, day] = dateStr.split("-");
        const d = new Date(year, month - 1, day);
        const prevD = formatDate(addDays(d, -1));
        const nextD = formatDate(addDays(d, 1));

        const objPrev = getPlanningObj(collab.id, prevD);
        const objNext = getPlanningObj(collab.id, nextD);
        const slotPrev = objPrev
          ? objPrev.slot
          : getPlanningSlot(collab.id, prevD);
        const slotNext = objNext
          ? objNext.slot
          : getPlanningSlot(collab.id, nextD);

        if (isDayOff(slotPrev) || isDayOff(slotNext)) {
          if (getSickBlockCount(collab.id, dateStr) < 3) {
            partesPegados.push(dateStr);
          }
        }
      }

      // d. Asistencia Feriados
      if (state.holidays.includes(dateStr)) {
        const isClosed =
          dateStr.endsWith("-01-01") ||
          dateStr.endsWith("-05-01") ||
          dateStr.endsWith("-12-25");
        if (!isClosed) {
          const isFeriadoNoTrabajado =
            val.toLowerCase() === "f" ||
            (obj.comentario && obj.comentario.includes("Feriado No Trabajado"));

          let isOnVacation = false;
          const targetD = new Date(dateStr + "T00:00:00");
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

          if (isFeriadoNoTrabajado || isOnVacation) {
            feriadosLibres++;
          } else {
            const parsed = parseShift(val);
            if (parsed && parsed.type === "work" && !parsed.isNV) {
              feriadosTrabajados++;
            } else if (
              isDayOff(val) ||
              isAbsence(val) ||
              (parsed &&
                (["franco", "libre", "absence", "vacation"].includes(
                  parsed.type,
                ) ||
                  parsed.isNV))
            ) {
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
      feriadosLibres,
      enfermedadTotalDias,
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

  metricsData.forEach((data) => {
    const {
      collab,
      tardanzaTotalMins,
      partesPegados,
      cambiosSolicitados,
      feriadosTrabajados,
      feriadosLibres,
      enfermedadTotalDias,
    } = data;

    // Crear UI para colaborador
    const tardanzaHs = (tardanzaTotalMins / 60).toFixed(1);
    const ratioFeriados =
      feriadosTrabajados + feriadosLibres > 0
        ? Math.round(
            (feriadosTrabajados / (feriadosTrabajados + feriadosLibres)) * 100,
          )
        : 0;

    let alertsHtml = partesPegados
      .map(
        (p) =>
          `<div style="font-size: 0.75rem; color: var(--danger); margin-bottom: 2px;">⚠ Parte el ${p.substring(8, 10)}/${p.substring(5, 7)} pegado a Franco</div>`,
      )
      .join("");

    const card = document.createElement("div");
    card.style = `background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;`;
    card.onmouseover = () => {
      card.style.transform = "translateY(-2px)";
      card.style.boxShadow = "0 6px 12px rgba(0,0,0,0.3)";
    };
    card.onmouseout = () => {
      card.style.transform = "translateY(0)";
      card.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)";
    };
    card.onclick = () => openMetricsDetail(collab.id);

    card.innerHTML = `
            <div style="font-weight: bold; font-size: 1.1rem; color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 4px; display: flex; justify-content: space-between; align-items: baseline;">
               <span>${collab.name.split("(")[0].trim()}</span>
               <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">Leg: ${collab.id}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Tardanza Total</div>
                  <div style="font-size: 1rem; font-weight: bold; color: ${tardanzaTotalMins > 0 ? "var(--warning)" : "var(--success)"};">${tardanzaTotalMins} min <span style="font-size: 0.7rem; font-weight: normal;">(${tardanzaHs}h)</span></div>
               </div>
               
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Turnos Fijados</div>
                  <div style="font-size: 1rem; font-weight: bold; color: var(--text);">${cambiosSolicitados}</div>
               </div>
               
               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Presentismo en Feriados</div>
                  <div style="font-size: 1rem; font-weight: bold; color: var(--text);">${feriadosTrabajados} trab. / ${feriadosLibres} lib. <span style="font-size: 0.8rem; font-weight: normal; color: var(--info);">(${ratioFeriados}%)</span></div>
               </div>

               <div style="background: var(--surface); padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Enfermedad (Año)</div>
                  <div style="font-size: 1rem; font-weight: bold; color: ${enfermedadTotalDias > 0 ? "var(--danger)" : "var(--success)"};">${enfermedadTotalDias} día${enfermedadTotalDias !== 1 ? "s" : ""}</div>
               </div>
            </div>
            
            ${
              partesPegados.length > 0
                ? `
            <div style="margin-top: 4px; background: rgba(225, 29, 72, 0.1); border: 1px solid rgba(225, 29, 72, 0.3); padding: 8px; border-radius: 6px;">
               <div style="font-size: 0.75rem; font-weight: bold; color: var(--danger); margin-bottom: 4px;">Alertas de Auditoría:</div>
               ${alertsHtml}
            </div>`
                : `
            <div style="margin-top: 4px; font-size: 0.75rem; color: var(--success); text-align: center; padding: 4px; border: 1px dashed var(--border); border-radius: 6px;">
               ✓ Sin alertas de ausentismo estratégico
            </div>
            `
            }
          `;

    container.appendChild(card);
  });
};

window.openMetricsDetail = async function (collabId) {
  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return;

  document.getElementById("metricsDetailTitle").innerHTML =
    `${collab.name.split("(")[0].trim()} <span style="font-size: 0.9rem; color: var(--text-muted); font-weight: normal;">(Legajo: ${collab.id})</span>`;
  const content = document.getElementById("metricsDetailContent");

  // Show modal immediately with loading spinner
  document.getElementById("metricsDetailModal").style.display = "flex";
  content.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--text-muted);">
             <div style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-left-color: var(--primary); border-radius: 50%; animation: spinMetrics 1s linear infinite; margin-bottom: 15px;"></div>
             <style>@keyframes spinMetrics { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
             <div style="font-size: 0.9rem;">Calculando métricas...</div>
          </div>
       `;

  // Fetch employee full history from Firestore
  try {
    if (!isMockMode) {
      const q = query(
        collection(db, "planificacion"),
        where("colaboradorId", "==", collabId),
      );
      const snap = await getDocs(q);
      snap.forEach((doc) => {
        state.planning[doc.id] = doc.data();
      });
    }
  } catch (e) {
    console.error("Firestore history fetch error:", e);
  }

  const isAbsence = (text) => {
    if (!text) return false;
    return text.trim().toLowerCase() === "e";
  };
  const isDayOff = (text) =>
    text && ["f", "libre", "v", "vacaciones"].includes(text.toLowerCase());

  const getSickBlockCount = (collabId, dateStr) => {
    let count = 1;
    const [y, m, d] = dateStr.split("-");
    let currentD = new Date(y, m - 1, d);

    let tempD = addDays(currentD, -1);
    while (true) {
      const dStr = formatDate(tempD);
      const obj = getPlanningObj(collabId, dStr);
      const slot = obj ? obj.slot : getPlanningSlot(collabId, dStr);
      if (isAbsence(slot)) {
        count++;
        tempD = addDays(tempD, -1);
      } else if (isDayOff(slot)) {
        tempD = addDays(tempD, -1);
      } else {
        break;
      }
    }

    tempD = addDays(currentD, 1);
    while (true) {
      const dStr = formatDate(tempD);
      const obj = getPlanningObj(collabId, dStr);
      const slot = obj ? obj.slot : getPlanningSlot(collabId, dStr);
      if (isAbsence(slot)) {
        count++;
        tempD = addDays(tempD, 1);
      } else if (isDayOff(slot)) {
        tempD = addDays(tempD, 1);
      } else {
        break;
      }
    }
    return count;
  };

  const allDates = Object.keys(state.planning)
    .filter((k) => k.startsWith(collabId + "_"))
    .map((k) => k.split("_")[1])
    .sort();

  // Fetch holidays for all unique years in history
  const uniqueYears = Array.from(
    new Set(allDates.map((d) => d.substring(0, 4))),
  );
  const holidayFetches = uniqueYears.map(async (y) => {
    try {
      const res = await fetch(
        `https://date.nager.at/api/v3/PublicHolidays/${y}/AR`,
      );
      if (res.ok) {
        const data = await res.json();
        data.forEach((h) => {
          if (!state.holidays.includes(h.date)) state.holidays.push(h.date);
        });
      }
    } catch (e) {
      console.error(`Feriados error ${y}:`, e);
    }
  });
  await Promise.all(holidayFetches);

  content.innerHTML = "";

  // Agrupar por año y luego por mes
  const historyData = {};

  allDates.forEach((dateStr) => {
    const docId = `${collabId}_${dateStr}`;
    const obj = state.planning[docId];
    if (!obj) return;

    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(5, 7);

    if (!historyData[year]) historyData[year] = {};
    if (!historyData[year][month])
      historyData[year][month] = {
        tardanza: 0,
        alertas: [],
        ausencias: 0,
        feriadosTrab: 0,
        fijados: 0,
      };

    const monthData = historyData[year][month];

    if (obj.tardanzaMinutosTotales)
      monthData.tardanza += obj.tardanzaMinutosTotales;
    if (obj.fijado) monthData.fijados++;

    const val = obj.slot || "";
    const isSick = isAbsence(val);
    if (isSick) {
      monthData.ausencias++;

      const [y, m, dNum] = dateStr.split("-");
      const d = new Date(y, m - 1, dNum);
      const prevD = formatDate(addDays(d, -1));
      const nextD = formatDate(addDays(d, 1));

      const objPrev = getPlanningObj(collab.id, prevD);
      const objNext = getPlanningObj(collab.id, nextD);
      const slotPrev = objPrev
        ? objPrev.slot
        : getPlanningSlot(collab.id, prevD);
      const slotNext = objNext
        ? objNext.slot
        : getPlanningSlot(collab.id, nextD);

      if (isDayOff(slotPrev) || isDayOff(slotNext)) {
        if (getSickBlockCount(collabId, dateStr) < 3) {
          let msg = "";
          if (isDayOff(slotPrev) && isDayOff(slotNext))
            msg = `previo al ${prevD.substring(8, 10)}/${prevD.substring(5, 7)} y posterior al ${nextD.substring(8, 10)}/${nextD.substring(5, 7)}`;
          else if (isDayOff(slotPrev))
            msg = `posterior al Franco del ${prevD.substring(8, 10)}/${prevD.substring(5, 7)}`;
          else
            msg = `previo al Franco del ${nextD.substring(8, 10)}/${nextD.substring(5, 7)}`;

          monthData.alertas.push({ date: dateStr, desc: msg });
        }
      }
    }

    if (state.holidays.includes(dateStr)) {
      const isClosed =
        dateStr.endsWith("-01-01") ||
        dateStr.endsWith("-05-01") ||
        dateStr.endsWith("-12-25");
      if (!isClosed) {
        const isFeriadoNoTrabajado =
          val.toLowerCase() === "f" ||
          (obj.comentario && obj.comentario.includes("Feriado No Trabajado"));

        let isOnVacation = false;
        const targetD = new Date(dateStr + "T00:00:00");
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

        const parsed = parseShift(val);
        if (
          !isFeriadoNoTrabajado &&
          !isOnVacation &&
          parsed &&
          parsed.type === "work" &&
          !parsed.isNV
        )
          monthData.feriadosTrab++;
      }
    }
  });

  const sortedYears = Object.keys(historyData).sort((a, b) => b - a);

  if (sortedYears.length === 0) {
    content.innerHTML =
      '<p style="color: var(--text-muted); text-align: center; margin-top: 40px;">No hay registros históricos para este colaborador.</p>';
    document.getElementById("metricsDetailModal").style.display = "flex";
    return;
  }

  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  const getYearTotals = (year) => {
    let yearTardanza = 0,
      yearAlertas = 0,
      yearEnfermedad = 0,
      yearFijados = 0;
    for (let m = 1; m <= 12; m++) {
      let mStr = m.toString().padStart(2, "0");
      if (historyData[year] && historyData[year][mStr]) {
        const md = historyData[year][mStr];
        yearTardanza += md.tardanza;
        yearAlertas += md.alertas.length;
        yearEnfermedad += md.ausencias;
        yearFijados += md.fijados;
      }
    }
    return { yearTardanza, yearAlertas, yearEnfermedad, yearFijados };
  };

  const createYearBlock = (year) => {
    let yearTardanza = 0,
      yearAlertas = 0,
      yearEnfermedad = 0,
      yearFijados = 0;
    let allAlerts = [];
    let maxEnfermedad = 0,
      maxAlertas = 0;

    for (let m = 1; m <= 12; m++) {
      let mStr = m.toString().padStart(2, "0");
      if (historyData[year] && historyData[year][mStr]) {
        const md = historyData[year][mStr];
        yearTardanza += md.tardanza;
        yearAlertas += md.alertas.length;
        yearEnfermedad += md.ausencias;
        yearFijados += md.fijados;
        if (md.alertas.length > 0) allAlerts.push(...md.alertas);
        if (md.ausencias > maxEnfermedad) maxEnfermedad = md.ausencias;
        if (md.alertas.length > maxAlertas) maxAlertas = md.alertas.length;
      }
    }

    let chartBarsEnfermedad = "";
    let chartBarsAlertas = "";
    let monthlyGrid = "";

    for (let m = 1; m <= 12; m++) {
      let mStr = m.toString().padStart(2, "0");
      const md = historyData[year][mStr] || {
        tardanza: 0,
        alertas: [],
        ausencias: 0,
        feriadosTrab: 0,
        fijados: 0,
      };

      const hEnf = maxEnfermedad > 0 ? (md.ausencias / maxEnfermedad) * 100 : 0;
      const hAlt = maxAlertas > 0 ? (md.alertas.length / maxAlertas) * 100 : 0;

      chartBarsEnfermedad +=
        '<div title="' +
        monthNames[m - 1] +
        ": " +
        md.ausencias +
        ' días" style="display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; flex:1;">' +
        '<div style="width:60%; background: ' +
        (md.ausencias > 0 ? "var(--danger)" : "var(--border)") +
        "; height: " +
        hEnf +
        "%; min-height: " +
        (md.ausencias > 0 ? "4px" : "0") +
        '; border-radius: 4px 4px 0 0; transition: all 0.2s;"></div>' +
        '<div style="font-size: 0.6rem; color: var(--text-muted); margin-top: 4px;">' +
        monthNames[m - 1] +
        "</div>" +
        "</div>";

      chartBarsAlertas +=
        '<div title="' +
        monthNames[m - 1] +
        ": " +
        md.alertas.length +
        ' alertas" style="display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; flex:1;">' +
        '<div style="width:60%; background: ' +
        (md.alertas.length > 0 ? "var(--warning)" : "var(--border)") +
        "; height: " +
        hAlt +
        "%; min-height: " +
        (md.alertas.length > 0 ? "4px" : "0") +
        '; border-radius: 4px 4px 0 0; transition: all 0.2s;"></div>' +
        '<div style="font-size: 0.6rem; color: var(--text-muted); margin-top: 4px;">' +
        monthNames[m - 1] +
        "</div>" +
        "</div>";

      monthlyGrid +=
        '<div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 6px; padding: 6px; text-align: center;">' +
        '<div style="font-size: 0.75rem; font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">' +
        monthNames[m - 1] +
        "</div>" +
        '<div style="font-size: 0.7rem; display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color:var(--text-muted)">Enf:</span> <span style="font-weight:bold; color:' +
        (md.ausencias > 0 ? "var(--danger)" : "var(--text)") +
        '">' +
        md.ausencias +
        "</span></div>" +
        '<div style="font-size: 0.7rem; display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color:var(--text-muted)">Alert:</span> <span style="font-weight:bold; color:' +
        (md.alertas.length > 0 ? "var(--warning)" : "var(--text)") +
        '">' +
        md.alertas.length +
        "</span></div>" +
        '<div style="font-size: 0.7rem; display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color:var(--text-muted)">Fij:</span> <span style="font-weight:bold">' +
        md.fijados +
        "</span></div>" +
        '<div style="font-size: 0.7rem; display: flex; justify-content: space-between;"><span style="color:var(--text-muted)">Tard:</span> <span style="font-weight:bold; color:' +
        (md.tardanza > 0 ? "var(--warning)" : "var(--text)") +
        '">' +
        md.tardanza +
        "m</span></div>" +
        "</div>";
    }

    let alertListHtml =
      '<div style="color: var(--success); font-size: 0.85rem; padding: 10px; text-align: center;">✓ Sin alertas de ausentismo estratégico este año.</div>';
    if (allAlerts.length > 0) {
      alertListHtml = allAlerts
        .map(
          (a) =>
            '<div style="font-size: 0.8rem; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text);"><span style="color: var(--danger); font-weight: bold;">• ' +
            a.date.substring(8, 10) +
            "/" +
            a.date.substring(5, 7) +
            ":</span> " +
            a.desc +
            "</div>",
        )
        .join("");
    }

    const yearBlock = document.createElement("div");
    yearBlock.innerHTML =
      '<div style="background: var(--surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px;">' +
      '<h3 style="margin: 0 0 15px 0; color: white; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">DASHBOARD ' +
      year +
      "</h3>" +
      '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">' +
      '<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border);">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Días Enfermedad</div>' +
      '<div style="font-size: 1.5rem; font-weight: bold; color: ' +
      (yearEnfermedad > 0 ? "var(--danger)" : "var(--success)") +
      ';">' +
      yearEnfermedad +
      "</div>" +
      "</div>" +
      '<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border);">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Alertas Ausentismo</div>' +
      '<div style="font-size: 1.5rem; font-weight: bold; color: ' +
      (yearAlertas > 0 ? "var(--warning)" : "var(--success)") +
      ';">' +
      yearAlertas +
      "</div>" +
      "</div>" +
      '<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border);">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Turnos Fijados</div>' +
      '<div style="font-size: 1.5rem; font-weight: bold; color: var(--text);">' +
      yearFijados +
      "</div>" +
      "</div>" +
      '<div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border);">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Tardanza Total</div>' +
      '<div style="font-size: 1.5rem; font-weight: bold; color: ' +
      (yearTardanza > 0 ? "var(--warning)" : "var(--text)") +
      ';">' +
      yearTardanza +
      '<span style="font-size: 0.8rem; font-weight:normal;">m</span></div>' +
      "</div>" +
      "</div>" +
      '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; height: 120px;">' +
      '<div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; min-width: 0;">' +
      '<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Tendencia Enfermedad</div>' +
      '<div style="display: flex; flex-direction: row; flex: 1; align-items: flex-end; gap: 2px; min-width: 0; overflow: hidden;">' +
      chartBarsEnfermedad +
      "</div>" +
      "</div>" +
      '<div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; min-width: 0;">' +
      '<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Tendencia Alertas</div>' +
      '<div style="display: flex; flex-direction: row; flex: 1; align-items: flex-end; gap: 2px; min-width: 0; overflow: hidden;">' +
      chartBarsAlertas +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 20px;">' +
      monthlyGrid +
      "</div>" +
      '<div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 6px; padding: 10px;">' +
      '<div style="font-size: 0.85rem; font-weight: bold; color: var(--text); margin-bottom: 8px;">Bitácora de Alertas de Ausentismo Estratégico</div>' +
      '<div style="max-height: 120px; overflow-y: auto; padding-right: 5px; font-family: monospace;">' +
      alertListHtml +
      "</div>" +
      "</div>" +
      "</div>";
    return yearBlock;
  };

  const currentYear = sortedYears[0];
  content.appendChild(createYearBlock(currentYear));

  if (sortedYears.length > 1) {
    const prevYear = sortedYears[1];
    const curTot = getYearTotals(currentYear);
    const prevTot = getYearTotals(prevYear);

    const getDiffHtml = (cur, prev) => {
      const diff = cur - prev;
      if (diff === 0)
        return '<span style="color:var(--text-muted); font-size:0.8rem; margin-left: 8px;">(Igual)</span>';
      return diff > 0
        ? '<span style="color:var(--danger); font-size:0.8rem; margin-left: 8px;">(+' +
            diff +
            ")</span>"
        : '<span style="color:var(--success); font-size:0.8rem; margin-left: 8px;">(' +
            diff +
            ")</span>";
    };

    const getDiffTimeHtml = (cur, prev) => {
      const diff = cur - prev;
      if (diff === 0)
        return '<span style="color:var(--text-muted); font-size:0.8rem; margin-left: 8px;">(Igual)</span>';
      return diff > 0
        ? '<span style="color:var(--danger); font-size:0.8rem; margin-left: 8px;">(+' +
            diff +
            "m)</span>"
        : '<span style="color:var(--success); font-size:0.8rem; margin-left: 8px;">(' +
            diff +
            "m)</span>";
    };

    const compBlock = document.createElement("div");
    compBlock.innerHTML =
      '<div style="background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; padding: 15px; margin-bottom: 20px;">' +
      '<h3 style="margin: 0 0 12px 0; color: var(--primary); font-size: 1rem;">Comparativa Anual: ' +
      currentYear +
      " vs " +
      prevYear +
      "</h3>" +
      '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">' +
      '<div style="background: var(--surface); padding: 10px; border-radius: 6px; border: 1px solid var(--border); text-align: center;">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Días Enfermedad</div>' +
      '<div style="font-size: 1rem; color: var(--text); display: flex; align-items: center; justify-content: center;">' +
      "<span>" +
      currentYear +
      ": <b>" +
      curTot.yearEnfermedad +
      "</b></span>" +
      '<span style="margin: 0 6px; color: var(--text-muted)">|</span>' +
      "<span>" +
      prevYear +
      ": <b>" +
      prevTot.yearEnfermedad +
      "</b></span>" +
      getDiffHtml(curTot.yearEnfermedad, prevTot.yearEnfermedad) +
      "</div>" +
      "</div>" +
      '<div style="background: var(--surface); padding: 10px; border-radius: 6px; border: 1px solid var(--border); text-align: center;">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Alertas Ausentismo</div>' +
      '<div style="font-size: 1rem; color: var(--text); display: flex; align-items: center; justify-content: center;">' +
      "<span>" +
      currentYear +
      ": <b>" +
      curTot.yearAlertas +
      "</b></span>" +
      '<span style="margin: 0 6px; color: var(--text-muted)">|</span>' +
      "<span>" +
      prevYear +
      ": <b>" +
      prevTot.yearAlertas +
      "</b></span>" +
      getDiffHtml(curTot.yearAlertas, prevTot.yearAlertas) +
      "</div>" +
      "</div>" +
      '<div style="background: var(--surface); padding: 10px; border-radius: 6px; border: 1px solid var(--border); text-align: center;">' +
      '<div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Tardanza</div>' +
      '<div style="font-size: 1rem; color: var(--text); display: flex; align-items: center; justify-content: center;">' +
      "<span>" +
      currentYear +
      ": <b>" +
      curTot.yearTardanza +
      "m</b></span>" +
      '<span style="margin: 0 6px; color: var(--text-muted)">|</span>' +
      "<span>" +
      prevYear +
      ": <b>" +
      prevTot.yearTardanza +
      "m</b></span>" +
      getDiffTimeHtml(curTot.yearTardanza, prevTot.yearTardanza) +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";
    content.appendChild(compBlock);

    const histContainer = document.createElement("div");
    histContainer.id = "histContainer_" + collabId;

    const loadBtn = document.createElement("button");
    loadBtn.innerText =
      "Cargar historial de años anteriores (" +
      (sortedYears.length - 1) +
      " año/s)";
    loadBtn.style =
      "background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text); padding: 12px 20px; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-size: 0.95rem; width: 100%; margin-bottom: 10px; font-weight: bold;";
    loadBtn.onmouseover = () =>
      (loadBtn.style.background = "rgba(255,255,255,0.1)");
    loadBtn.onmouseout = () =>
      (loadBtn.style.background = "rgba(255,255,255,0.05)");
    loadBtn.onclick = () => {
      loadBtn.style.display = "none";
      for (let i = 1; i < sortedYears.length; i++) {
        histContainer.appendChild(createYearBlock(sortedYears[i]));
      }
    };
    histContainer.appendChild(loadBtn);
    content.appendChild(histContainer);
  }

  // Modal was displayed at the beginning of the function with the loader.
};

window.switchTab = function (tabId) {
  document
    .querySelectorAll(".app-tab-btn")
    .forEach((b) => b.classList.remove("active"));

  let btnId = "tabHorarios";
  if (tabId === "vacaciones") btnId = "vacationTabBtn";
  else if (tabId === "metricas") btnId = "metricsTabBtn";
  else if (tabId === "sugeridos") btnId = "suggestedTabBtn";

  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add("active");

  const seccionHorarios = document.getElementById("seccionHorarios");
  const seccionVacaciones = document.getElementById("seccionVacaciones");
  const seccionMetricas = document.getElementById("seccionMetricas");
  const seccionSugeridos = document.getElementById("seccionSugeridos");
  const navCenter = document.getElementById("dateNavigationContainer");

  if (seccionHorarios) seccionHorarios.style.display = "none";
  if (seccionVacaciones) seccionVacaciones.style.display = "none";
  if (seccionMetricas) seccionMetricas.style.display = "none";
  if (seccionSugeridos) seccionSugeridos.style.display = "none";

  if (navCenter) {
    navCenter.style.visibility = tabId === "horarios" ? "visible" : "hidden";
  }

  if (tabId === "vacaciones") {
    if (seccionVacaciones) seccionVacaciones.style.display = "flex";
    renderSaldosVacaciones();
    renderVacationTable();
  } else if (tabId === "metricas") {
    if (seccionMetricas) seccionMetricas.style.display = "block";
    renderMetrics();
  } else if (tabId === "sugeridos") {
    if (seccionSugeridos) seccionSugeridos.style.display = "flex";
    window.renderSugeridos();
  } else if (tabId === "horarios") {
    if (seccionHorarios) seccionHorarios.style.display = "flex";
    renderUI();
  }
};

const collabColors = [
  "#00d2ff",
  "#00e676",
  "#ff9100",
  "#ffd600",
  "#ff4081",
  "#00e5ff",
  "#b200ff",
  "#ff5252",
];

function getContrastColor(hex) {
  if (hex.indexOf("#") === 0) hex = hex.slice(1);
  if (hex.length === 3)
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000000" : "#ffffff";
}

function getCollabColor(id) {
  const sortedVacations = [...state.vacations].sort(
    (a, b) => new Date(a.startDate) - new Date(b.startDate),
  );
  const uniqueIdsInOrder = [
    ...new Set(sortedVacations.map((v) => v.colaboradorId)),
  ];
  let index = uniqueIdsInOrder.indexOf(id);
  if (index === -1) {
    const allIds = state.collaborators.map((c) => c.id).sort();
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

window.exportVacationsCSV = function () {
  // MIDDLEWARE: Verificar permiso antes de exportar
  if (!checkAccessWithToast("exportarExcelVacaciones")) return;
  const filterSelect = document.getElementById("vFilterYear");
  const selectedYear = filterSelect ? filterSelect.value : "Todos";

  let filteredVacations = state.vacations;
  if (selectedYear !== "Todos") {
    filteredVacations = state.vacations.filter(
      (v) => getVacationYear(v).toString() === selectedYear,
    );
  }

  filteredVacations.sort(
    (a, b) => new Date(a.startDate) - new Date(b.startDate),
  );

  let csvContent = "\uFEFF";
  csvContent +=
    "Legajo;Apellido y Nombre;Año Imputación;Fecha Inicio;Fecha Fin;Total Días\n";

  filteredVacations.forEach((v) => {
    const collab = state.collaborators.find((c) => c.id === v.colaboradorId);
    let cName = v.colaboradorId;
    if (collab) {
      const parts = collab.name.split("(")[0].trim().split(" ");
      cName =
        parts.length > 1
          ? `${parts[0]}, ${parts.slice(1).join(" ")}`
          : parts[0];
    }

    const totalDays =
      Math.ceil(
        Math.abs(
          new Date(v.endDate + "T00:00:00") -
            new Date(v.startDate + "T00:00:00"),
        ) /
          (1000 * 60 * 60 * 24),
      ) + 1;
    const formatDDMMYYYY = (d) => (d ? d.split("-").reverse().join("-") : d);

    csvContent += `${v.colaboradorId};"${cName}";${getVacationYear(v)};${formatDDMMYYYY(v.startDate)};${formatDDMMYYYY(v.endDate)};${totalDays}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Vacaciones_RRHH_${selectedYear}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

let isVFilterPopulated = false;

window.renderVacationTable = function renderVacationTable() {
  const tbody = document.getElementById("vacationTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filterSelect = document.getElementById("vFilterYear");
  const currentSelection = filterSelect ? filterSelect.value : "Todos";

  if (filterSelect) {
    const years = [
      ...new Set(state.vacations.map((v) => getVacationYear(v))),
    ].sort((a, b) => b - a);
    let currentYear = new Date().getFullYear();
    let optionsHtml = '<option value="Todos">Todos</option>';
    years.forEach((y) => {
      optionsHtml += `<option value="${y}">${y}</option>`;
    });
    filterSelect.innerHTML = optionsHtml;

    if (!isVFilterPopulated) {
      if (years.includes(currentYear)) {
        filterSelect.value = currentYear.toString();
      } else if (years.length > 0) {
        filterSelect.value = years.includes(currentYear + 1)
          ? (currentYear + 1).toString()
          : years[0].toString();
      }
      isVFilterPopulated = true;
    } else {
      filterSelect.value = currentSelection;
    }
  }

  const selectedYear = filterSelect ? filterSelect.value : "Todos";
  let filteredVacations = state.vacations;
  if (selectedYear !== "Todos") {
    filteredVacations = state.vacations.filter(
      (v) => getVacationYear(v).toString() === selectedYear,
    );
  }

  filteredVacations
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .forEach((v) => {
      const collab = state.collaborators.find((c) => c.id === v.colaboradorId);
      const cName = collab ? collab.name : v.colaboradorId;
      const color = getCollabColor(v.colaboradorId);

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border)";
      const formatDDMMYYYY = (d) => (d ? d.split("-").reverse().join("-") : d);
      const vYear = getVacationYear(v);
      const hasAttachment =
        collab &&
        collab.saldosVacaciones &&
        collab.saldosVacaciones[vYear] &&
        collab.saldosVacaciones[vYear].adjuntos &&
        collab.saldosVacaciones[vYear].adjuntos.length > 0;
      const attachmentIndicator = hasAttachment
        ? `<span style="color: var(--success); font-weight: bold; font-size: 1.1rem;" title="${collab.saldosVacaciones[vYear].adjuntos.length} archivo(s) cargado(s) para el periodo ${vYear}">✓</span>`
        : `<span style="color: var(--text-muted); font-weight: bold;">-</span>`;

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
            <td style="padding: 6px 8px; text-align: center; vertical-align: middle;">
               ${attachmentIndicator}
            </td>
          `;
      tbody.appendChild(tr);
    });

  if (document.getElementById("seccionVacaciones").style.display !== "none") {
    renderVacationCalendar();
  }
};

window.editVacation = function (id) {
  const v = state.vacations.find((x) => x.id === id);
  if (!v) return;
  document.getElementById("vEditId").value = v.id;
  document.getElementById("vCollab").value = v.colaboradorId;
  document.getElementById("vStartDate").value = v.startDate;
  document.getElementById("vWeeks").value = v.weeksCount;
  if (v.imputacionAnio) {
    document.getElementById("vImputacion").value = v.imputacionAnio;
  } else {
    document.getElementById("vImputacion").value = "";
  }

  document.getElementById("vFormTitle").innerText = "Editar Vacaciones";
  document.getElementById("vSubmitBtn").innerText = "Actualizar Periodo";
  document.getElementById("vCancelBtn").style.display = "block";
};

document.getElementById("vCancelBtn").addEventListener("click", () => {
  document.getElementById("vacationForm").reset();
  document.getElementById("vEditId").value = "";
  document.getElementById("vImputacion").value = "";
  document.getElementById("vFormTitle").innerText = "Registrar Vacaciones";
  document.getElementById("vSubmitBtn").innerText = "Guardar Periodo";
  document.getElementById("vCancelBtn").style.display = "none";
  renderSaldosVacaciones();
});

document
  .getElementById("vCollab")
  .addEventListener("change", renderSaldosVacaciones);

document.getElementById("vStartDate").addEventListener("change", (e) => {
  document.getElementById("vStartDateError").style.display = "none";
  if (!e.target.value) return;
  const vStart = new Date(e.target.value + "T00:00:00");
  let yearOfVacation = vStart.getFullYear();
  if (vStart.getMonth() < 9) {
    yearOfVacation -= 1;
  }
  const vImputacion = document.getElementById("vImputacion");
  if (vImputacion && vImputacion.value === "") {
    vImputacion.value = yearOfVacation;
  }
});

async function fetchHistorialVacaciones(collabId) {
  const q = query(
    collection(db, "vacaciones"),
    where("colaboradorId", "==", collabId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function calcularDiasTomados(collabId, año) {
  let diasTomados = 0;
  const vacsToUse = state.currentEmployeeVacations || [];
  vacsToUse.forEach((v) => {
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
        const diffDays =
          Math.ceil(Math.abs(vEnd - vStart) / (1000 * 60 * 60 * 24)) + 1;
        diasTomados += diffDays;
      }
    }
  });
  return diasTomados;
}

async function autoSaveSaldos(collabId) {
  // MIDDLEWARE: Verificar permiso antes de escribir saldos
  if (!requireAuth()) return;
  if (!checkAccessWithToast("gestionSaldos")) return;
  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return;

  if (!collab.saldosVacaciones) collab.saldosVacaciones = {};

  const container = document.getElementById("saldosVacacionesContainer");
  const years = Array.from(container.querySelectorAll(".saldo-year-row"));

  years.forEach((row) => {
    const y = row.dataset.year;
    const tipo = row.querySelector(".saldo-tipo").value;
    const asignados =
      parseInt(row.querySelector(".saldo-asignados").value, 10) || 0;
    const disp =
      parseInt(row.querySelector(".saldo-disponibles").innerText, 10) || 0;

    if (!collab.saldosVacaciones[y]) collab.saldosVacaciones[y] = {};
    collab.saldosVacaciones[y].periodoTipo = tipo;
    collab.saldosVacaciones[y].diasAsignados = asignados;
    collab.saldosVacaciones[y].diasDisponibles = disp;
  });

  if (!isMockMode) {
    try {
      await updateDoc(doc(db, "colaboradores", collabId), {
        saldosVacaciones: collab.saldosVacaciones,
      });
    } catch (e) {
      console.error("Error auto-saving saldos:", e);
    }
  }
}

async function renderSaldosVacaciones() {
  const collabId = document.getElementById("vCollab").value;
  const container = document.getElementById("saldosVacacionesContainer");
  if (!collabId) {
    container.innerHTML = "";
    state.currentEmployeeVacations = [];
    return;
  }

  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return;

  const folderContainer = document.getElementById("vViewFolderContainer");
  if (folderContainer) {
    folderContainer.innerHTML = "";
    if (state.currentUser?.rol === "RRHH") {
      folderContainer.style.display = "flex";
      let allAttachments = [];

      const folderUrl =
        collab.url_carpeta_comprobantes ||
        collab.carpeta_comprobantes_url ||
        collab.drive_url ||
        collab.carpetaComprobantesUrl;
      if (folderUrl) {
        allAttachments.push({
          type: "central",
          url: folderUrl,
          tooltip: "Formulario Centralizado",
        });
      }

      if (collab.saldosVacaciones) {
        Object.keys(collab.saldosVacaciones)
          .sort((a, b) => b - a)
          .forEach((year) => {
            const yearData = collab.saldosVacaciones[year];
            if (yearData.adjuntos && Array.isArray(yearData.adjuntos)) {
              yearData.adjuntos.forEach((adj, idx) => {
                const url = typeof adj === "string" ? adj : adj.url || adj.link;
                if (url)
                  allAttachments.push({
                    type: "legacy",
                    year: year,
                    index: idx,
                    url: url,
                    tooltip: `Archivo ${year} #${idx + 1}`,
                  });
              });
            }
          });
      }

      if (allAttachments.length === 0) {
        folderContainer.innerHTML = `<span style="font-size: 0.7rem; color: var(--text-muted); font-style: italic;">Sin archivos</span>`;
      } else {
        const canDelete = window.checkAccess("eliminarAdjunto");
        allAttachments.forEach((att) => {
          const wrap = document.createElement("div");
          wrap.style = "position: relative; display: inline-flex;";

          const btn = document.createElement("button");
          btn.type = "button";
          btn.title = att.tooltip;
          btn.style =
            "padding: 4px; border-radius: 4px; background: var(--surface); color: var(--text); border: 1px solid var(--border); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; pointer-events: auto !important;";
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
          btn.onclick = (e) => {
            e.preventDefault();
            window.open(att.url, "_blank");
          };
          wrap.appendChild(btn);

          if (canDelete && att.type === "legacy") {
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.title = "Eliminar comprobante";
            delBtn.style =
              "position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; pointer-events: auto !important;";
            delBtn.innerHTML = "✕";
            delBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!confirm(`¿Seguro que deseas eliminar el ${att.tooltip}?`))
                return;

              try {
                collab.saldosVacaciones[att.year].adjuntos.splice(att.index, 1);
                await setDoc(
                  doc(db, "colaboradores", collab.id),
                  {
                    saldosVacaciones: collab.saldosVacaciones,
                  },
                  { merge: true },
                );
                showToast("Comprobante eliminado", "success");
                renderSaldosVacaciones();
              } catch (err) {
                console.error(err);
                showToast("Error al eliminar", "error");
              }
            };
            wrap.appendChild(delBtn);
          }
          folderContainer.appendChild(wrap);
        });
      }
    } else {
      folderContainer.style.display = "none";
    }
  }

  // LAZY LOADING: Traer historial completo de este empleado
  container.innerHTML =
    '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Cargando historial...</div>';
  state.currentEmployeeVacations = await fetchHistorialVacaciones(collabId);
  container.innerHTML = ""; // Limpiar loader

  let maxYear = new Date().getFullYear();
  let minYear = maxYear - 3;
  if (collab.saldosVacaciones) {
    const savedYears = Object.keys(collab.saldosVacaciones).map((y) =>
      parseInt(y, 10),
    );
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
    let tipo = "N/A";
    let asignados = 0;
    let calculatedLawDays = calcularDiasVacacionesLey(collab.fechaAlta, y);

    if (collab.saldosVacaciones && collab.saldosVacaciones[y]) {
      tipo = collab.saldosVacaciones[y].periodoTipo || "N/A";
      asignados = collab.saldosVacaciones[y].diasAsignados;
      if (asignados === undefined || isNaN(asignados))
        asignados = calculatedLawDays;
    } else {
      if (collab.historialVacaciones && collab.historialVacaciones[y]) {
        tipo = collab.historialVacaciones[y];
      }
      asignados = calculatedLawDays;
    }

    const tomados = calcularDiasTomados(collabId, y);
    const disponibles = asignados - tomados;

    let colorCls = "";
    let fw = "";
    if (disponibles === 0 && asignados > 0) colorCls = "var(--success)";
    else if (disponibles < 0) {
      colorCls = "var(--danger)";
      fw = "bold";
    }

    html += `
             <div class="saldo-year-row" data-year="${y}" style="display: flex; gap: 0.5rem; align-items: center; background: rgba(255,255,255,0.02); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="width: 35px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">${y}</div>
                <select class="saldo-tipo" style="flex: 1; padding: 2px; font-size: 0.75rem; background: var(--background); color: var(--text); border: 1px solid var(--border); border-radius: 2px;">
                   <option value="N/A" ${tipo === "N/A" ? "selected" : ""}>N/A</option>
                   <option value="Buena" ${tipo === "Buena" ? "selected" : ""}>B (Buena)</option>
                   <option value="Mala" ${tipo === "Mala" ? "selected" : ""}>M (Mala)</option>
                </select>
                <div style="display: flex; flex-direction: column; align-items: center; width: 60px;">
                   <label style="font-size: 0.55rem; color: var(--text-muted); margin-bottom: 2px;">Asignados</label>
                   <input type="number" class="saldo-asignados" data-law-days="${calculatedLawDays}" value="${asignados}" min="0" style="width: 100%; padding: 2px; font-size: 0.75rem; text-align: center; background: var(--background); color: var(--text); border: 1px solid var(--border); border-radius: 2px;">
                </div>
                <div style="display: flex; flex-direction: column; align-items: center; width: 60px;">
                   <label style="font-size: 0.55rem; color: var(--text-muted); margin-bottom: 2px;">Disponibles</label>
                   <div class="saldo-disponibles" style="font-size: 0.85rem; color: ${colorCls}; font-weight: ${fw};">${disponibles}</div>
                </div>
                <button type="button" class="btn-year-notes" data-year="${y}" title="Notas y Adjuntos" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: background 0.2s, color 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='var(--primary)';" onmouseout="this.style.background='none'; this.style.color='var(--text-muted)';">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                       <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                 </button>
             </div>
          `;
  }

  // Calcular historial automático
  const historyByYear = {};
  (state.currentEmployeeVacations || []).forEach((v) => {
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

      const diffDays =
        Math.ceil(Math.abs(vEnd - vStart) / (1000 * 60 * 60 * 24)) + 1;

      historyByYear[yearOfVacation].push({
        start: vStart,
        end: vEnd,
        days: diffDays,
      });
    }
  });

  let historyHtml = "";
  const historyYears = Object.keys(historyByYear).sort((a, b) => b - a);

  if (historyYears.length === 0) {
    historyHtml =
      '<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Sin vacaciones aprobadas registradas.</div>';
  } else {
    historyYears.forEach((y) => {
      historyByYear[y].sort((a, b) => a.start - b.start);

      let tipoStr = "N/A";
      if (collab.saldosVacaciones && collab.saldosVacaciones[y]) {
        tipoStr = collab.saldosVacaciones[y].periodoTipo || "N/A";
      } else if (collab.historialVacaciones && collab.historialVacaciones[y]) {
        tipoStr = collab.historialVacaciones[y] || "N/A";
      }
      if (tipoStr === "Mala") tipoStr = "Malas";
      if (tipoStr === "Buena") tipoStr = "Buenas";

      const periodsStr = historyByYear[y]
        .map((p) => {
          const sDay = String(p.start.getDate()).padStart(2, "0");
          const sMonth = String(p.start.getMonth() + 1).padStart(2, "0");
          const sYear = String(p.start.getFullYear()).slice(-2);
          const sStr = `${sDay}-${sMonth}/${sYear}`;

          const eDay = String(p.end.getDate()).padStart(2, "0");
          const eMonth = String(p.end.getMonth() + 1).padStart(2, "0");
          const eYear = String(p.end.getFullYear()).slice(-2);
          const eStr = `${eDay}-${eMonth}/${eYear}`;

          return `${p.days} dias: del ${sStr} al ${eStr} |`;
        })
        .join("<br>");

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

  const containerHistorial = document.getElementById(
    "historialVacacionesContainer",
  );
  if (containerHistorial) {
    containerHistorial.innerHTML = historyHtml;
  }

  if (container) {
    container
      .querySelectorAll(".saldo-tipo, .saldo-asignados")
      .forEach((el) => {
        el.addEventListener("change", (e) => {
          const row = e.target.closest(".saldo-year-row");
          const y = parseInt(row.dataset.year, 10);
          const asignadosInput = row.querySelector(".saldo-asignados");
          const asignados = parseInt(asignadosInput.value, 10) || 0;

          if (e.target.classList.contains("saldo-asignados")) {
            const lawDays = parseInt(asignadosInput.dataset.lawDays, 10);
            if (lawDays > 0 && asignados !== lawDays) {
              const confirmed = confirm(
                `Atención: Estás modificando los días de vacaciones calculados por Ley. El valor original era de ${lawDays} días.\n\n¿Deseas confirmar el cambio manual?`,
              );
              if (!confirmed) {
                asignadosInput.value = lawDays; // revert
                return; // do not save
              } else {
                // Send audit log!
                if (typeof logAudit === "function") {
                  logAudit(
                    "Modificación manual días vacaciones",
                    collabId,
                    `${lawDays} días (Ley)`,
                    `${asignados} días (Manual)`,
                    collab.name,
                  );
                }
              }
            }
          }

          const tomados = calcularDiasTomados(collabId, y);
          const disponibles = asignados - tomados;

          const dispEl = row.querySelector(".saldo-disponibles");
          dispEl.innerText = disponibles;

          if (disponibles === 0 && asignados > 0) {
            dispEl.style.color = "var(--success)";
            dispEl.style.fontWeight = "normal";
          } else if (disponibles < 0) {
            dispEl.style.color = "var(--danger)";
            dispEl.style.fontWeight = "bold";
          } else {
            dispEl.style.color = "var(--text)";
            dispEl.style.fontWeight = "normal";
          }

          autoSaveSaldos(collabId);
        });
      });

    container.querySelectorAll(".btn-year-notes").forEach((btn) => {
      btn.addEventListener("click", () => {
        const year = btn.dataset.year;
        if (typeof openYearManagementModal === "function") {
          openYearManagementModal(collabId, year);
        }
      });
    });
  }

  const addNextBtn = document.getElementById("addNextYearBtn");
  if (addNextBtn) {
    addNextBtn.addEventListener("click", async () => {
      const nextYear = maxYear + 1;

      let tipo1 =
        collab.saldosVacaciones && collab.saldosVacaciones[maxYear]
          ? collab.saldosVacaciones[maxYear].periodoTipo
          : "N/A";
      let tipo2 =
        collab.saldosVacaciones && collab.saldosVacaciones[maxYear - 1]
          ? collab.saldosVacaciones[maxYear - 1].periodoTipo
          : "N/A";

      if (
        tipo1 === "N/A" &&
        collab.historialVacaciones &&
        collab.historialVacaciones[maxYear]
      )
        tipo1 = collab.historialVacaciones[maxYear];
      if (
        tipo2 === "N/A" &&
        collab.historialVacaciones &&
        collab.historialVacaciones[maxYear - 1]
      )
        tipo2 = collab.historialVacaciones[maxYear - 1];

      let newTipo = "Mala";
      if (tipo1 === "Mala" && tipo2 === "Mala") {
        newTipo = "Buena";
      }

      if (!collab.saldosVacaciones) collab.saldosVacaciones = {};
      const lawDays = calcularDiasVacacionesLey(collab.fechaAlta, nextYear);
      collab.saldosVacaciones[nextYear] = {
        periodoTipo: newTipo,
        diasAsignados: lawDays,
        diasDisponibles: lawDays,
      };

      if (!isMockMode) {
        try {
          await updateDoc(doc(db, "colaboradores", collabId), {
            saldosVacaciones: collab.saldosVacaciones,
          });
        } catch (e) {
          console.error("Error creating next year:", e);
        }
      }
      renderSaldosVacaciones();
    });
  }

  const removeBtn = document.getElementById("removeYearBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`¿Seguro que deseas eliminar el año ${maxYear}?`)) return;

      if (collab.saldosVacaciones && collab.saldosVacaciones[maxYear]) {
        delete collab.saldosVacaciones[maxYear];
        if (!isMockMode) {
          try {
            await updateDoc(doc(db, "colaboradores", collabId), {
              saldosVacaciones: collab.saldosVacaciones,
            });
          } catch (e) {
            console.error("Error deleting year:", e);
          }
        }
        renderSaldosVacaciones();
      }
    });
  }
}

document
  .getElementById("vacationForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    // MIDDLEWARE: Verificar permiso antes de guardar
    if (!checkAccessWithToast("modificarVacaciones")) return;

    const editId = document.getElementById("vEditId").value;
    const collabId = document.getElementById("vCollab").value;
    const startDateStr = document.getElementById("vStartDate").value;
    const weeks = parseInt(document.getElementById("vWeeks").value, 10);

    if (!collabId || !startDateStr || !weeks) return;

    let startD = new Date(startDateStr + "T00:00:00");
    const isHistoricalYear = startD.getFullYear() < new Date().getFullYear();

    if (!isHistoricalYear) {
      let shiftOccurred = false;

      while (true) {
        const dStr = formatDate(startD);
        const dDay = startD.getDay(); // 0 Sun
        const isHoliday = state.holidays.includes(dStr);

        // Revisar si coincide con el día de descanso (F o Libre o Franco)
        const slotValue = getPlanningSlot(collabId, dStr);
        const parsedSlot = parseShift(slotValue);
        const isDescanso =
          (parsedSlot && parsedSlot.type === "franco") ||
          (slotValue && ["f", "libre"].includes(slotValue.toLowerCase()));

        if (isHoliday || dDay === 0 || isDescanso) {
          startD = addDays(startD, 1);
          shiftOccurred = true;
        } else {
          break;
        }
      }

      if (shiftOccurred) {
        const newStartDateStr = formatDate(startD);
        document.getElementById("vStartDate").value = newStartDateStr;
        const partes = newStartDateStr.split("-");
        const fechaFormateada = `${partes[2]}/${partes[1]}/${partes[0]}`;
        showToast(
          "Traslado Automático",
          `La fecha de inicio fue trasladada automáticamente al día ${fechaFormateada} por coincidir con feriado/descanso (Art. 151 LCT).`,
        );
      }
    }
    document.getElementById("vStartDateError").style.display = "none";

    const endD = addDays(startD, weeks * 7 - 1);
    const endDateStr = formatDate(endD);

    // Validación 2x1 Temporada Buena
    let touchesBuena = false;
    for (let d = new Date(startD); d <= endD; d = addDays(d, 1)) {
      if (getVacationSeason(formatDate(d)) === "Buena") {
        touchesBuena = true;
        break;
      }
    }

    if (touchesBuena) {
      const collab = state.collaborators.find((c) => c.id === collabId);
      const hist = collab?.historialVacaciones || {};
      if (hist.year1 === "Buena" || hist.year2 === "Buena") {
        showToast(
          "Regla 2x1",
          `El colaborador ${collab?.name || collabId} ya tuvo temporada Buena en los últimos 2 años. Solo le corresponde temporada Mala.`,
        );
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

      state.vacations.forEach((v) => {
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
      showToast(
        "Superposición",
        "No se puede aprobar. En alguna de las semanas seleccionadas ya hay 2 o más personas de vacaciones.",
      );
      return;
    }

    const newVacId = `${collabId}_${startDateStr}`;
    const impVal = document.getElementById("vImputacion").value;

    const newVac = {
      id: newVacId,
      colaboradorId: collabId,
      startDate: startDateStr,
      endDate: endDateStr,
      weeksCount: weeks,
    };
    if (impVal) {
      newVac.imputacionAnio = parseInt(impVal, 10);
    }

    if (!requireAuth()) return;
    if (!isMockMode) {
      try {
        const batch = writeBatch(db);
        if (editId && editId !== newVacId) {
          batch.delete(doc(db, "vacaciones", editId));
        }
        batch.set(doc(db, "vacaciones", newVacId), newVac);
        await batch.commit();
        logAudit(
          editId ? "Editar Vacaciones" : "Registrar Vacaciones",
          collabId,
          `${startDateStr} a ${endDateStr}`,
          editId || "",
          `${weeks} Semanas`,
        );
      } catch (err) {
        showToast(
          "Error",
          "No se pudo guardar la vacación en la base de datos.",
        );
        return;
      }
    }

    if (editId) {
      if (isMockMode)
        state.vacations = state.vacations.filter((v) => v.id !== editId);
      showToast("Éxito", "Vacaciones actualizadas correctamente.");
    } else {
      showToast("Éxito", "Vacaciones registradas correctamente.");
    }

    if (isMockMode) {
      state.vacations.push(newVac);
      window.renderVacationTable();
    }
    document.getElementById("vCancelBtn").click(); // Reset form and mode
  });

window.deleteVacation = async function (id) {
  if (!confirm("¿Eliminar este registro de vacaciones?")) return;
  if (!isMockMode) {
    try {
      await deleteDoc(doc(db, "vacaciones", id));
      logAudit("Eliminar Vacaciones", id.split("_")[0], id, "Eliminado", "");
    } catch (err) {
      showToast("Error", "No se pudo eliminar de la base de datos.");
      return;
    }
  } else {
    state.vacations = state.vacations.filter((v) => v.id !== id);
    window.renderVacationTable();
  }
};

let calCurrentMonth = new Date();

document.getElementById("vCalPrevMonth").addEventListener("click", () => {
  calCurrentMonth.setMonth(calCurrentMonth.getMonth() - 1);
  renderVacationCalendar();
});

document.getElementById("vCalNextMonth").addEventListener("click", () => {
  calCurrentMonth.setMonth(calCurrentMonth.getMonth() + 1);
  renderVacationCalendar();
});

window.renderVacationCalendar = function () {
  const container = document.getElementById("vacationCalendarContainer");
  if (!container) return;

  container.innerHTML = "";

  // Generar 6 meses en grilla 2x3
  for (let i = 0; i < 6; i++) {
    const mDate = new Date(
      calCurrentMonth.getFullYear(),
      calCurrentMonth.getMonth() + i,
      1,
    );
    const monthName = mDate.toLocaleString("es-ES", {
      month: "long",
      year: "numeric",
    });

    const monthDiv = document.createElement("div");
    monthDiv.className = "vac-cal-month";

    let html = `<div class="vac-cal-header">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</div>`;
    html += `<div class="vac-cal-grid">`;

    const dayHeaders = ["L", "M", "M", "J", "V", "S", "D"];
    dayHeaders.forEach((dh) => {
      html += `<div class="vac-cal-day-header">${dh}</div>`;
    });

    const daysInMonth = new Date(
      mDate.getFullYear(),
      mDate.getMonth() + 1,
      0,
    ).getDate();
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
      state.vacations.forEach((v) => {
        const vStart = new Date(v.startDate + "T00:00:00");
        const vEnd = new Date(v.endDate + "T00:00:00");
        if (dTarget >= vStart && dTarget <= vEnd) {
          const collab = state.collaborators.find(
            (c) => c.id === v.colaboradorId,
          );
          let nameFormatted = v.colaboradorId;
          if (collab) {
            const parts = collab.name.split("(")[0].trim().split(" ");
            nameFormatted =
              parts.length > 1
                ? `${parts[0]}, ${parts.slice(1).join(" ")}`
                : parts[0];
          }
          onVacation.push(nameFormatted);
          onVacationIds.push(v.colaboradorId);
        }
      });

      currentWeek.push({
        day,
        dStr,
        onVacation,
        onVacationIds,
        isHoliday: state.holidays.includes(dStr),
      });

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
    weeks.forEach((week) => {
      // Rule of 3: If any day has >= 3 people on vacation, the whole week is danger
      const isWeekDanger = week.some(
        (wday) => wday && wday.onVacation.length >= 3,
      );

      week.forEach((wday) => {
        if (!wday) {
          html += `<div class="vac-cal-cell empty"></div>`;
        } else {
          const count = wday.onVacation.length;
          let densClass = "density-0";
          let inlineStyle = "";

          if (count === 1) {
            const color = getCollabColor(wday.onVacationIds[0]);
            const textColor = getContrastColor(color);
            inlineStyle = `background-color: ${color}; color: ${textColor}; border-color: transparent;`;
          } else if (count === 2) {
            const c1 = getCollabColor(wday.onVacationIds[0]);
            const c2 = getCollabColor(wday.onVacationIds[1]);
            inlineStyle = `background: linear-gradient(135deg, ${c1} 50%, ${c2} 50%); color: #fff; border-color: transparent; text-shadow: 0 0 2px #000;`;
          } else if (count >= 3) {
            densClass = "density-3";
          }

          if (isWeekDanger) {
            densClass = "week-danger";
            inlineStyle = "";
          }

          if (wday.isHoliday) {
            densClass += " holiday";
          }

          let tooltip =
            count > 0 ? wday.onVacation.join(", ") : "Sin vacaciones";
          if (wday.isHoliday) {
            tooltip = "Feriado" + (count > 0 ? " | " + tooltip : "");
          }

          const clickHandler = `onclick="window.showVacationDetails('${wday.dStr}', '${wday.onVacationIds.join(",")}')"`;
          const curPointer = "cursor: pointer;";
          html += `<div class="vac-cal-cell ${densClass}" style="${inlineStyle} ${curPointer}" title="${tooltip}" ${clickHandler}>${wday.day}</div>`;
        }
      });
    });

    html += `</div>`;
    monthDiv.innerHTML = html;
    container.appendChild(monthDiv);
  }
};

window.showVacationDetails = function (dStr, idsStr) {
  const detailContainer = document.getElementById("vacationDetailContainer");
  if (!detailContainer) return;

  if (!idsStr || idsStr.length === 0) {
    detailContainer.innerHTML = `
             <button onclick="document.getElementById('vacationDetailContainer').style.display='none'" style="position: absolute; top: 15px; right: 15px; z-index: 10000; background: transparent; border: none; color: #fff; cursor: pointer; padding: 10px; line-height: 1; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">&times;</button>
             <div style="text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-top: 10px;">
                Sin novedades para el ${dStr.split("-").reverse().join("/")}
             </div>
           `;
    detailContainer.style.display = "block";
    return;
  }

  const ids = idsStr.split(",");
  const targetD = new Date(dStr + "T00:00:00");

  let detailsHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
             <h4 style="margin: 0; color: #fff; font-size: 1rem;">Vacaciones del ${dStr.split("-").reverse().join("/")}</h4>
             <button onclick="document.getElementById('vacationDetailContainer').style.display='none'" style="position: absolute; top: 15px; right: 15px; z-index: 10000; background: transparent; border: none; color: #fff; cursor: pointer; padding: 10px; line-height: 1; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">&times;</button>
          </div>
       `;
  detailsHTML += `<div style="display: flex; flex-direction: column; gap: 8px;">`;

  ids.forEach((id) => {
    const collab = state.collaborators.find((c) => c.id === id);
    const collabName = collab ? collab.name : "Desconocido";
    const collabLegajo = collab ? collab.legajo || "-" : "-";

    let vacEntry = null;
    for (let v of state.vacations || []) {
      if (v.colaboradorId === id) {
        const vStart = new Date(v.startDate + "T00:00:00");
        const vEnd = new Date(v.endDate + "T00:00:00");
        if (targetD >= vStart && targetD <= vEnd) {
          vacEntry = v;
          break;
        }
      }
    }

    if (vacEntry) {
      const startStr = vacEntry.startDate.split("-").reverse().join("/");
      const endStr = vacEntry.endDate.split("-").reverse().join("/");
      const vColor = getCollabColor(id);
      detailsHTML += `
                 <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg); padding: 10px 14px; border-radius: 6px; border-left: 4px solid ${vColor}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);">
                    <div style="display: flex; flex-direction: column;">
                       <span style="font-weight: 600; font-size: 0.95rem; color: #fff;">${collabName}</span>
                       <span style="font-size: 0.8rem; color: var(--text-muted);">Legajo: ${collabLegajo}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; text-align: right;">
                       <span style="font-size: 0.85rem; color: #fff; font-weight: bold;">${startStr}</span>
                       <span style="font-size: 0.75rem; color: var(--text-muted);">al ${endStr}</span>
                    </div>
                 </div>
               `;
    }
  });

  detailsHTML += `</div>`;
  detailContainer.innerHTML = detailsHTML;
  detailContainer.style.display = "block";
};

// -- LÓGICA DE LOGIN Y RBAC --
let currentRole = "visitor";
// Legajo del invitado activo (sólo cuando currentRole === 'invitado')
let currentInvitadoLegajo = null;

function requireAuth() {
  return true;
}

window.checkAccess = function (permiso) {
  return true;
};
const checkAccess = window.checkAccess;

window.checkAccessWithToast = function (permiso) {
  if (!checkAccess(permiso)) {
    showToast(
      "Acceso denegado",
      "No tenés permiso para realizar esta acción.",
      "warning",
    );
    return false;
  }
  return true;
};

const adminLoginBtn = document.getElementById("adminLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const configBtn = document.getElementById("configBtn");
const pdfBtn = document.getElementById("pdfBtn");
// Actualiza la UI basada en el rol
const vacationTabBtn = document.getElementById("vacationTabBtn");

const loginModal = document.getElementById("loginModal");
const editorModal = document.getElementById("editorModal");
const userRoleText = document.getElementById("userRoleText");

// Los roles ahora se restauran exclusivamente desde Firebase Auth (onAuthStateChanged).
// No se restauran roles desde localStorage para evitar lecturas a Firestore sin autenticación.

// Inicializar módulo de permisos eliminado

function checkLogin() {
       const rol = 'Administrador';

       if (typeof logoutBtn !== 'undefined' && logoutBtn) logoutBtn.style.display = 'none';
       if (typeof configBtn !== 'undefined' && configBtn) configBtn.style.display = 'inline-flex';
       if (typeof pdfBtn !== 'undefined' && pdfBtn) pdfBtn.style.display = 'inline-flex';
       
       if (typeof vacationTabBtn !== 'undefined' && vacationTabBtn) vacationTabBtn.style.display = 'inline-block';
       if (typeof metricsTabBtn !== 'undefined' && metricsTabBtn) metricsTabBtn.style.display = 'inline-block';
       
       const suggestedTabBtn = document.getElementById('suggestedTabBtn');
       if (suggestedTabBtn) suggestedTabBtn.style.display = 'inline-block';

       if (typeof adminLoginBtn !== 'undefined' && adminLoginBtn) adminLoginBtn.style.display = 'none';
       
       const auditBellBtn = document.getElementById('auditBellBtn');
       if (auditBellBtn) {
          auditBellBtn.style.display = 'flex';
          if (typeof window.checkAuditLogs === 'function') window.checkAuditLogs();
       }

       const backupDriveBtn = document.getElementById('backupDriveBtn');
       if (backupDriveBtn) backupDriveBtn.style.display = 'inline-flex';

       const repositoresNavBtn = document.getElementById('repositoresNavBtn');
       if (repositoresNavBtn) repositoresNavBtn.style.display = 'inline-flex';

       const eventosBtn = document.getElementById('eventosNavBtn');
       if (eventosBtn) eventosBtn.style.display = 'inline-flex';

       const btnDownloadExcel = document.getElementById('btnDownloadExcel');
       if (btnDownloadExcel) btnDownloadExcel.style.display = 'flex';

       attachScheduleEventListeners();
       if (typeof syncPermissionsUI === 'function') syncPermissionsUI();

       const navToggleBtn = document.getElementById('navDropdownToggle');
       if (navToggleBtn) {
           navToggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> App Pública <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
       }
    }
    
    let currentContextCell = null;
function handleContextMenu(e) {
  if (e.target.closest('[data-is-repositor="true"]')) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  if (!requireAuth()) return;

  // Bloqueo estricto por permisos (Invitados)
  if (!checkAccessWithToast("modificarHorario")) return;

  let collabId = null;
  let dateStr = null;

  // Buscar el contenedor de la celda (el td, el div interno o el input)
  const tdNode = e.target.closest("td");
  const inputNode =
    e.target.closest(".cell-input") ||
    (tdNode ? tdNode.querySelector(".cell-input") : null);

  // Intentar sacar los atributos del input primero (que siempre los tuvo históricamente)
  if (inputNode) {
    collabId = inputNode.getAttribute("data-collab");
    dateStr = inputNode.getAttribute("data-date");
  }

  // Fallback: buscarlos en el DOM hacia arriba (td, tr, etc.)
  if (!collabId) {
    const collabNode = e.target.closest("[data-collab]");
    if (collabNode) collabId = collabNode.getAttribute("data-collab");
  }

  if (!dateStr) {
    const dateNode = e.target.closest("[data-date]");
    if (dateNode) dateStr = dateNode.getAttribute("data-date");
  }

  if (!collabId) return; // Sin colaborador no podemos procesar

  try {
    currentContextCell =
      inputNode || tdNode || e.target.closest("[data-collab]");

    // Asegurar compatibilidad para otras funciones que leen de currentContextCell
    if (currentContextCell && !currentContextCell.hasAttribute("data-collab"))
      currentContextCell.setAttribute("data-collab", collabId);
    if (
      currentContextCell &&
      dateStr &&
      !currentContextCell.hasAttribute("data-date")
    )
      currentContextCell.setAttribute("data-date", dateStr);

    const obj = getPlanningObj(collabId, dateStr) || {};

    document.getElementById("cellCommentInput").value = obj.comentario || "";
    document.getElementById("cellFixedInput").checked = !!obj.fijado;
    document.getElementById("cellFixedDateText").textContent =
      obj.fijado && obj.fechaFijado
        ? `*(Solicitado con tiempo: ${obj.fechaFijado})`
        : "*(Solicitado con tiempo)";

    document.getElementById("cellTardanzaInput").value =
      obj.tardanzaTexto || "";
    document.getElementById("cellTardanzaCheck").checked =
      !!obj.tardanzaConfirmada;

    // Overtime info
    const currentSlotForOt =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      (currentContextCell ? currentContextCell.value : "");
    const parsedOt = parseShift(currentSlotForOt);
    const otInfo = calculateOvertimeInfo(collabId, dateStr, parsedOt);
    const ctxOtBlock = document.getElementById("ctxOvertimeBlock");
    if (otInfo) {
      ctxOtBlock.style.display = "block";
      document.getElementById("ctxOvertimeContract").textContent =
        otInfo.contract + " hs";
      document.getElementById("ctxOvertimeProjected").textContent =
        otInfo.projected + " hs";
      document.getElementById("ctxOvertimeExcess").textContent =
        otInfo.excess + " hs";
      document.getElementById("cellOvertimeCheck").checked =
        !!obj.horaExtraValidada;
    } else {
      ctxOtBlock.style.display = "none";
      document.getElementById("cellOvertimeCheck").checked = false;
    }

    const ctxMenu = document.getElementById("contextMenu");

    // Inyección dinámica de Estados Rápidos y Cambio de Horario
    if (!document.getElementById("mobileQuickStatesBlock")) {
      const quickStatesHTML = `
                  <div id="mobileQuickStatesBlock" style="background: var(--bg); border: 1px solid var(--border); padding: 10px; border-radius: 6px; margin-bottom: 10px;">
                     <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 6px;">Estados Rápidos</label>
                     <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(40px, 1fr)); gap: 4px; margin-bottom: 10px;">
                        <button id="qs-E" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Enfermedad">E</button>
                        <button id="qs-Susp" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Suspensión">Susp</button>
                        <button id="qs-PG" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Permiso Gremial">PG</button>
                        <button id="qs-ACA" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Ausente con aviso">ACA</button>
                        <button id="qs-ASA" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Ausente sin aviso">ASA</button>
                        <button id="qs-LIBRE" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Libre">LIBRE</button>
                        <button id="qs-F" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="Franco">F</button>
                        <button id="qs-NV" style="padding: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold;" title="No Viene">No Viene</button>
                     </div>
                     <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 6px;">Modificar Horario del Día</label>
                     <div style="display: flex; gap: 4px; align-items: center;">
                        <input type="time" id="ctxTimeIn" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.8rem; font-family: inherit;">
                        <span style="color: var(--text-muted); font-size: 0.8rem;">a</span>
                        <input type="time" id="ctxTimeOut" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.8rem; font-family: inherit;">
                        <button id="qs-apply" style="background: var(--primary); color: #fff; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-weight: bold; font-size: 0.8rem;" title="Aplicar Horario">✓</button>
                     </div>
                  </div>
               `;
      ctxMenu.insertAdjacentHTML("afterbegin", quickStatesHTML);

      document
        .getElementById("qs-E")
        .addEventListener("click", () => window.setQuickState("E"));
      document
        .getElementById("qs-Susp")
        .addEventListener("click", () => window.setQuickState("Susp"));
      document
        .getElementById("qs-PG")
        .addEventListener("click", () => window.setQuickState("PG"));
      document
        .getElementById("qs-ACA")
        .addEventListener("click", () => window.setQuickState("ACA"));
      document
        .getElementById("qs-ASA")
        .addEventListener("click", () => window.setQuickState("ASA"));
      document
        .getElementById("qs-LIBRE")
        .addEventListener("click", () => window.setQuickState("LIBRE"));
      document
        .getElementById("qs-F")
        .addEventListener("click", () => window.setQuickState("F"));
      document
        .getElementById("qs-NV")
        .addEventListener("click", () => window.setNoVieneQuickState());
      document
        .getElementById("qs-apply")
        .addEventListener("click", () => window.applyCustomSchedule());
    }

    // Pre-fill Schedule Modifiers if slot is a time range
    let currentSlot =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      currentContextCell.value;
    if (typeof currentSlot === "string") {
      currentSlot = currentSlot.replace("*", "").trim();
    }
    document.getElementById("ctxTimeIn").value = "";
    document.getElementById("ctxTimeOut").value = "";
    if (currentSlot) {
      const matchTime = currentSlot.match(
        /(\d{1,2})(?::(\d{2}))?\s*(?:a|-)\s*(\d{1,2})(?::(\d{2}))?/i,
      );
      if (matchTime) {
        let tInH = matchTime[1];
        let tInM = matchTime[2] || "00";
        let tOutH = matchTime[3];
        let tOutM = matchTime[4] || "00";
        document.getElementById("ctxTimeIn").value =
          `${tInH.padStart(2, "0")}:${tInM}`;
        document.getElementById("ctxTimeOut").value =
          `${tOutH.padStart(2, "0")}:${tOutM}`;
      }
    }

    // Mostrar/ocultar bloque de inventario según si hay evento ese día
    const eventoHoy = state.eventos[dateStr];
    const ctxBlock = document.getElementById("ctxInventarioBlock");
    if (eventoHoy) {
      ctxBlock.style.display = "block";
      ctxBlock.style.borderColor = eventoHoy.color;
      document.getElementById("ctxInventarioLabel").textContent =
        `${eventoHoy.tipo}: ${eventoHoy.descripcion}`;
      document.getElementById("cellInventarioInput").checked =
        !!obj.esInventario;
    } else {
      ctxBlock.style.display = "none";
    }

    const backdrop = document.getElementById("contextMenuBackdrop");
    if (backdrop) backdrop.style.display = "block";

    // Cerrar cualquier menú previo antes de abrir el nuevo
    const prevMenu = document.getElementById("contextMenu");
    if (prevMenu && prevMenu.classList.contains("open")) {
      prevMenu.classList.remove("open");
    }

    // Sacar el menú de cualquier contenedor con stacking context restrictivo
    // y anclarlo directamente al body para que se pinte sobre todo
    document.body.appendChild(ctxMenu);

    document.addEventListener("click", (e) => {
      const ctxMenu = document.getElementById("contextMenu");
      if (ctxMenu && ctxMenu.classList.contains("open")) {
        if (!ctxMenu.contains(e.target)) {
          window.closeContextMenu();
        }
      }
    });

    // Cerrar menú al hacer clic derecho sobre otra celda de la grilla
    document.addEventListener(
      "contextmenu",
      (e) => {
        const ctxMenu = document.getElementById("contextMenu");
        if (ctxMenu && ctxMenu.classList.contains("open")) {
          const isOnGrid = e.target.closest("#tableBody");
          if (isOnGrid) {
            ctxMenu.classList.remove("open");
            const backdrop = document.getElementById("contextMenuBackdrop");
            if (backdrop) backdrop.style.display = "none";
          }
        }
      },
      true,
    ); // capture=true: se ejecuta ANTES que el listener del tbody

    // Apertura por clase — cero cálculos, garantizado
    ctxMenu.classList.add("open");
  } catch (err) {
    console.error("Error al renderizar el contextMenu:", err);
  }
}

window.closeContextMenu = function () {
  document.getElementById("contextMenu").classList.remove("open");
  const backdrop = document.getElementById("contextMenuBackdrop");
  if (backdrop) backdrop.style.display = "none";
};

// Clic fuera del menú → cerrar
document.addEventListener("click", (e) => {
  const ctxMenu = document.getElementById("contextMenu");
  if (ctxMenu && ctxMenu.classList.contains("open")) {
    if (!ctxMenu.contains(e.target)) {
      window.closeContextMenu();
    }
  }
});

// Clic derecho en otra celda → cerrar primero (capture=true, antes del listener del tbody)
document.addEventListener(
  "contextmenu",
  (e) => {
    const ctxMenu = document.getElementById("contextMenu");
    if (ctxMenu && ctxMenu.classList.contains("open")) {
      if (e.target.closest("#tableBody")) {
        ctxMenu.classList.remove("open");
        const bk = document.getElementById("contextMenuBackdrop");
        if (bk) bk.style.display = "none";
      }
    }
  },
  true,
);

window.deleteCellComment = async function () {
  if (!requireAuth()) return;
  document.getElementById("cellCommentInput").value = "";
  await autoSaveContextMenu();
  window.closeContextMenu();
  renderHeatmap();
};

window.setQuickState = async function (stateVal) {
  if (!requireAuth()) return;
  if (!currentContextCell) return;
  const collabId = currentContextCell.getAttribute("data-collab");
  const dateStr = currentContextCell.getAttribute("data-date");

  const obj = getPlanningObj(collabId, dateStr) || {};
  if (!obj.horarioOriginal) {
    obj.horarioOriginal =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      currentContextCell.value;
  }
  const parsedNew = parseShift(stateVal);

  obj.slot = stateVal;
  state.planning[`${collabId}_${dateStr}`] = obj;

  if (!isMockMode) {
    try {
      const docId = `${collabId}_${dateStr}`;
      setDoc(
        doc(db, "planificacion", docId),
        {
          colaboradorId: collabId,
          fecha: dateStr,
          slot: obj.slot,
          horarioOriginal: obj.horarioOriginal,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error guardando quick state:", err);
    }
  }
  window.closeContextMenu();
  renderUI();
};

window.setNoVieneQuickState = async function () {
  if (!requireAuth()) return;
  if (!currentContextCell) return;

  let inputEl =
    currentContextCell.tagName === "INPUT"
      ? currentContextCell
      : currentContextCell.querySelector("input.cell-input");
  if (!inputEl) return;

  let currentSlot = inputEl.value || "";
  let newSlot = "";

  if (currentSlot.trim() === "") {
    newSlot = "NV/";
  } else {
    if (!currentSlot.startsWith("NV/")) {
      newSlot = "NV/" + currentSlot;
    } else {
      newSlot = currentSlot;
    }
  }

  const collabId = currentContextCell.getAttribute("data-collab");
  const dateStr = currentContextCell.getAttribute("data-date");

  const obj = getPlanningObj(collabId, dateStr) || {};
  if (!obj.horarioOriginal) {
    obj.horarioOriginal =
      obj.slot || getPlanningSlot(collabId, dateStr) || currentSlot;
  }

  obj.slot = newSlot;
  state.planning[`${collabId}_${dateStr}`] = obj;

  if (!isMockMode) {
    try {
      const docId = `${collabId}_${dateStr}`;
      setDoc(
        doc(db, "planificacion", docId),
        {
          colaboradorId: collabId,
          fecha: dateStr,
          slot: obj.slot,
          horarioOriginal: obj.horarioOriginal,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error guardando NV quick state:", err);
    }
  }
  window.closeContextMenu();
  renderUI();

  // Si es solo NV/, enfocamos por si está en desktop y quiere seguir tipeando
  if (newSlot === "NV/") {
    inputEl.focus();
    setTimeout(() => {
      inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
    }, 0);
  }
};

window.applyCustomSchedule = async function () {
  if (!requireAuth()) return;
  if (!currentContextCell) return;

  const timeIn = document.getElementById("ctxTimeIn").value;
  const timeOut = document.getElementById("ctxTimeOut").value;
  if (!timeIn || !timeOut) return;

  const collabId = currentContextCell.getAttribute("data-collab");
  const dateStr = currentContextCell.getAttribute("data-date");

  const obj = getPlanningObj(collabId, dateStr) || {};
  if (!obj.horarioOriginal) {
    obj.horarioOriginal =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      currentContextCell.value;
  }

  let formattedTimeIn = timeIn.replace(/^0/, "").replace(/:00$/, ""); // strip leading zero and :00
  let formattedTimeOut = timeOut.replace(/^0/, "").replace(/:00$/, ""); // strip leading zero and :00
  const newSlotStr = `${formattedTimeIn}a${formattedTimeOut}`;

  const parsedNew = parseShift(newSlotStr);

  obj.slot = newSlotStr;
  state.planning[`${collabId}_${dateStr}`] = obj;

  if (!isMockMode) {
    try {
      const docId = `${collabId}_${dateStr}`;
      setDoc(
        doc(db, "planificacion", docId),
        {
          colaboradorId: collabId,
          fecha: dateStr,
          slot: obj.slot,
          horarioOriginal: obj.horarioOriginal,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error guardando custom schedule:", err);
    }
  }
  window.closeContextMenu();
  renderUI();
};

document
  .getElementById("cellFixedInput")
  .addEventListener("change", async (e) => {
    if (!requireAuth()) {
      e.target.checked = !e.target.checked;
      return;
    }
    if (!currentContextCell) return;
    const collabId = currentContextCell.getAttribute("data-collab");
    const dateStr = currentContextCell.getAttribute("data-date");

    const obj = getPlanningObj(collabId, dateStr) || {};
    obj.slot =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      currentContextCell.value;

    const isFixedNow = e.target.checked;
    if (isFixedNow) {
      const dt = new Date();
      const dia = String(dt.getDate()).padStart(2, "0");
      const mes = String(dt.getMonth() + 1).padStart(2, "0");
      const anio = dt.getFullYear();
      obj.fechaFijado = `${dia}/${mes}/${anio}`;
      document.getElementById("cellFixedDateText").textContent =
        `*(Solicitado con tiempo el dia ${obj.fechaFijado})`;
    } else {
      obj.fechaFijado = null;
      document.getElementById("cellFixedDateText").textContent =
        "*(Solicitado con tiempo)";
    }
    obj.fijado = isFixedNow;

    state.planning[`${collabId}_${dateStr}`] = obj;

    if (!isMockMode) {
      try {
        const docId = `${collabId}_${dateStr}`;
        setDoc(
          doc(db, "planificacion", docId),
          {
            colaboradorId: collabId,
            fecha: dateStr,
            slot: obj.slot,
            fijado: obj.fijado,
            fechaFijado: obj.fechaFijado,
          },
          { merge: true },
        );
      } catch (err) {
        console.error("Error auto-guardando fijado:", err);
      }
    }
    renderUI();
  });

async function autoSaveContextMenu() {
  if (!requireAuth()) return false;
  if (!currentContextCell) return;
  const collabId = currentContextCell.getAttribute("data-collab");
  const dateStr = currentContextCell.getAttribute("data-date");

  const tardanzaStr = document.getElementById("cellTardanzaInput").value.trim();
  let tardanzaMins = 0;
  if (tardanzaStr) {
    if (tardanzaStr.includes(":")) {
      let parts = tardanzaStr.split(":");
      tardanzaMins =
        (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    } else {
      tardanzaMins = parseInt(tardanzaStr, 10) || 0;
    }
  }

  const slotValue =
    getPlanningSlot(collabId, dateStr) || currentContextCell.value;
  const parsedWithNewTardanza = parseShift(slotValue, tardanzaMins);

  const validation = validateTurn(collabId, dateStr, parsedWithNewTardanza);
  if (!validation.valid && validation.type === "legal") {
    showToast(
      "ERROR CRÍTICO DE LEY",
      `No se puede asignar esta modificación.<br>El colaborador no cumple con las ${validation.req} de descanso obligatorio por Ley. (Descanso calculado: ${validation.actual} horas)`,
    );
    return false;
  }

  const obj = getPlanningObj(collabId, dateStr) || {};
  const oldSlot = obj.slot || currentContextCell.value;
  const oldComment = obj.comentario || "";

  obj.slot =
    obj.slot || getPlanningSlot(collabId, dateStr) || currentContextCell.value;
  obj.comentario = document.getElementById("cellCommentInput").value.trim();

  if (oldSlot !== obj.slot || oldComment !== obj.comentario) {
    if (typeof window.registrarLogActividad === "function") {
      const oldStr = oldSlot + (oldComment ? ` (${oldComment})` : "");
      const newStr = obj.slot + (obj.comentario ? ` (${obj.comentario})` : "");
      window.registrarLogActividad(collabId, dateStr, oldStr, newStr);
    }
  }

  obj.tardanzaTexto = tardanzaStr;
  obj.tardanzaMinutosTotales = tardanzaMins;
  obj.tardanzaConfirmada = document.getElementById("cellTardanzaCheck").checked;
  obj.horaExtraValidada = document.getElementById("cellOvertimeCheck").checked;

  state.planning[`${collabId}_${dateStr}`] = obj;

  if (!isMockMode) {
    try {
      const docId = `${collabId}_${dateStr}`;
      setDoc(
        doc(db, "planificacion", docId),
        {
          colaboradorId: collabId,
          fecha: dateStr,
          slot: obj.slot,
          comentario: obj.comentario,
          tardanzaTexto: obj.tardanzaTexto || "",
          tardanzaMinutosTotales: obj.tardanzaMinutosTotales || 0,
          tardanzaConfirmada: obj.tardanzaConfirmada || false,
          horaExtraValidada: obj.horaExtraValidada || false,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error auto-guardando detalles:", err);
    }
  }
  renderUI();
}

document
  .getElementById("cellTardanzaInput")
  .addEventListener("blur", autoSaveContextMenu);
document.getElementById("cellTardanzaCheck").addEventListener("change", (e) => {
  if (!e.target.checked) {
    document.getElementById("cellTardanzaInput").value = "";
  }
  autoSaveContextMenu();
});
document
  .getElementById("cellCommentInput")
  .addEventListener("blur", autoSaveContextMenu);

// Listener para marcar/desmarcar Inventario
document
  .getElementById("cellInventarioInput")
  .addEventListener("change", async (e) => {
    if (!requireAuth()) {
      e.target.checked = !e.target.checked;
      return;
    }
    if (!currentContextCell) return;
    if (!checkAccessWithToast("modificarHorario")) {
      e.target.checked = !e.target.checked; // revertir
      return;
    }
    const collabId = currentContextCell.getAttribute("data-collab");
    const dateStr = currentContextCell.getAttribute("data-date");
    const obj = getPlanningObj(collabId, dateStr) || {};
    obj.slot =
      obj.slot ||
      getPlanningSlot(collabId, dateStr) ||
      currentContextCell.value;
    obj.esInventario = e.target.checked;
    state.planning[`${collabId}_${dateStr}`] = obj;
    if (!isMockMode) {
      try {
        setDoc(
          doc(db, "planificacion", `${collabId}_${dateStr}`),
          {
            colaboradorId: collabId,
            fecha: dateStr,
            slot: obj.slot,
            esInventario: obj.esInventario,
          },
          { merge: true },
        );
      } catch (err) {
        console.error("Error guardando esInventario:", err);
      }
    }
    renderUI();
  });

document
  .getElementById("saveCellDetailsBtn")
  .addEventListener("click", async () => {
    const saved = await autoSaveContextMenu();
    if (saved !== false) {
      window.closeContextMenu();
      renderHeatmap();
    }
  });

// ── LEGAJO: legajo de Admin
const ADMIN_LEGAJO = "10045875";

// Limpiar y resetear el modal de acceso al abrirlo
function resetLoginModal() {
  document.getElementById("loginLegajo").value = "";
  document.getElementById("loginPass").value = "";
  document.getElementById("loginNombreHidden").value = "";
  document.getElementById("loginNombreDisplay").style.display = "none";
  document.getElementById("loginNombreDisplay").textContent = "";
  document.getElementById("loginPassWrapper").style.display = "none";
  document.getElementById("loginModalTitle").textContent = "Acceso";
  document.getElementById("loginModalTitle").style.color = "";
  document.getElementById("loginModalSubtitle").textContent =
    "Ingresá tu número de legajo.";
  document.getElementById("loginSubmitBtn").textContent = "Ingresar";
}

adminLoginBtn.addEventListener("click", () => {
  resetLoginModal();
  loginModal.style.display = "flex";
  setTimeout(() => document.getElementById("loginLegajo").focus(), 80);
});

document.getElementById("loginCancelBtn").addEventListener("click", () => {
  loginModal.style.display = "none";
});

// ── Detección dinámica al escribir el legajo ──────────────────────────────
// Lista solo para mostrar la caja de contraseña en la UI
const ADMIN_LEGAJOS_UI = ["10045875", "10021701"]; 

document.getElementById("loginLegajo").addEventListener("input", (e) => {
  const leg = e.target.value.trim();
  const title = document.getElementById("loginModalTitle");
  const subtitle = document.getElementById("loginModalSubtitle");
  const passWrapper = document.getElementById("loginPassWrapper");
  const submitBtn = document.getElementById("loginSubmitBtn");

  if (!leg) {
    title.textContent = "Acceso";
    title.style.color = "";
    subtitle.textContent = "Ingresá tu número de legajo.";
    passWrapper.style.display = "none";
    submitBtn.textContent = "Ingresar";
    return;
  }

  if (ADMIN_LEGAJOS_UI.includes(leg)) {
    title.textContent = "Acceso Administrador";
    title.style.color = "var(--warning)";
    subtitle.textContent = "Ingresá tu contraseña de administrador.";
    passWrapper.style.display = "block";
    submitBtn.textContent = "Ingresar como Admin";
  } else {
    title.textContent = "Acceso al Sistema";
    title.style.color = "var(--info)";
    subtitle.textContent = "Listo. Presioná Ingresar para acceder.";
    passWrapper.style.display = "none";
    submitBtn.textContent = "Ingresar";
  }
});

// Seccion de Submit y Logout
document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const leg = document.getElementById("loginLegajo").value.trim();
  if (!leg) return;

  const isAdminUI = ADMIN_LEGAJOS_UI.includes(leg);
  const email = leg + "@crew.app";
  const pass = isAdminUI ? document.getElementById("loginPass").value : "EquipoCrew2026!";

  if (isAdminUI && !pass) {
    showToast("Error", "Ingresa tu contraseña de administrador.");
    document.getElementById("loginPass").focus();
    return;
  }

  const submitBtn = document.getElementById("loginSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Ingresando...";

  const finishLogin = () => {
      const modal = document.getElementById("loginModal");
      if (modal) modal.style.setProperty("display", "none", "important");
      if (typeof checkLogin === "function") checkLogin();
      submitBtn.disabled = false;
      submitBtn.textContent = "Ingresar";
      if (typeof renderUI === "function") renderUI();
  };

  signInWithEmailAndPassword(auth, email, pass)
    .then(() => finishLogin())
    .catch((error) => {
      if (!isAdminUI) {
          createUserWithEmailAndPassword(auth, email, pass)
            .then(() => finishLogin())
            .catch((err2) => {
                showToast("Acceso denegado", "No se pudo validar el legajo.");
                submitBtn.disabled = false;
                submitBtn.textContent = "Ingresar";
            });
      } else {
          showToast("Error", "Contraseña de administrador incorrecta.");
          document.getElementById("loginPass").select();
          submitBtn.disabled = false;
          submitBtn.textContent = "Ingresar como Admin";
      }
    });
});

logoutBtn.addEventListener("click", () => {
  signOut(auth)
    .then(() => {
      window.userProfile = null;
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    })
    .catch((err) => console.error("Error al cerrar sesion:", err));
});

// --- RESTAURACIÓN: GESTIÓN DE INVITADOS ---
window.renderGestionInvitados = async function() {
    const container = document.getElementById("gestionInvitadosContainer");
    if (!container) return;
    
    container.innerHTML = "<div style='padding:20px; color:var(--text-muted); text-align:center;'>Cargando invitados...</div>";
    
    try {
        const q = query(collection(db, "usuarios"), where("rol", "==", "Invitado"));
        const snap = await getDocs(q);
        
        let html = `
        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-top: 20px;">
            <div style="padding: 15px; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: var(--primary); font-size: 1.1rem;">Gestión de Invitados</h3>
                <button onclick="window.crearInvitadoRapido()" style="background: var(--primary); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.8rem;">+ Nuevo Invitado</button>
            </div>
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead>
                    <tr style="background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border);">
                        <th style="padding: 10px 15px; color: var(--text-muted); font-size: 0.8rem;">Legajo</th>
                        <th style="padding: 10px 15px; color: var(--text-muted); font-size: 0.8rem;">Nombre</th>
                        <th style="padding: 10px 15px; color: var(--text-muted); font-size: 0.8rem;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        if (snap.empty) {
            html += `<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-muted);">No hay invitados registrados.</td></tr>`;
        } else {
            snap.forEach(docSnap => {
                const data = docSnap.data();
                html += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 10px 15px; font-weight: bold; color: var(--text);">${data.legajo}</td>
                        <td style="padding: 10px 15px; color: var(--text);">${data.nombre}</td>
                        <td style="padding: 10px 15px;">
                            <button onclick="window.eliminarInvitado('${docSnap.id}')" style="background: var(--danger); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Eliminar</button>
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = "<div style='padding:20px; color:var(--danger); text-align:center;'>Error al cargar invitados.</div>";
    }
};

window.crearInvitadoRapido = async function() {
    const legajo = prompt("Ingrese el número de legajo del nuevo invitado:");
    if (!legajo) return;
    const nombre = prompt("Ingrese el nombre completo del invitado:");
    if (!nombre) return;

    const email = legajo + "@crew.app";
    
    try {
        await setDoc(doc(db, "usuarios", email), {
            legajo: legajo,
            nombre: nombre,
            email: email,
            rol: "Invitado",
            fechaCreacion: new Date().toISOString()
        });
        if(typeof showToast === 'function') showToast("Éxito", "Invitado creado correctamente.");
        window.renderGestionInvitados();
    } catch (e) {
        if(typeof showToast === 'function') showToast("Error", "No se pudo crear el invitado.");
    }
};

window.eliminarInvitado = async function(docId) {
    if (!confirm("¿Seguro que deseas eliminar a este invitado?")) return;
    try {
        await deleteDoc(doc(db, "usuarios", docId));
        if(typeof showToast === 'function') showToast("Éxito", "Invitado eliminado.");
        window.renderGestionInvitados();
    } catch (e) {
        if(typeof showToast === 'function') showToast("Error", "No se pudo eliminar.");
    }
};

let pendingEditTarget = null;

document.getElementById("editorLegajo").addEventListener("input", (e) => {
  const leg = e.target.value.trim();
  const nomInput = document.getElementById("editorNombre");
  const nomDisplay = document.getElementById("editorNombreDisplay");

  if (leg) {
    let editorName = null;
    const collab = state.collaborators.find(
      (c) => String(c.id).trim() === leg || String(c.legajo).trim() === leg,
    );
    if (collab && collab.name) editorName = collab.name;

    if (editorName) {
      nomInput.value = editorName;
      nomDisplay.textContent = editorName;
    } else {
      nomInput.value = "";
      nomDisplay.textContent = "Legajo no encontrado";
    }
  } else {
    nomInput.value = "";
    nomDisplay.textContent = "";
  }
});

document.getElementById("editorCancelBtn").addEventListener("click", () => {
  editorModal.style.display = "none";
  pendingEditTarget = null;
});

document.getElementById("editorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = document.getElementById("editorNombre").value.trim();
  const leg = document.getElementById("editorLegajo").value.trim();
  if (!nom) {
    showToast("Error", "Legajo inválido o sin nombre asociado.");
    return;
  }
  if (nom && leg) {
    localStorage.setItem("editorNombre", nom);
    localStorage.setItem("editorLegajo", leg);
    currentRole = "editor";
    editorModal.style.display = "none";
    checkLogin();
    showToast("Firma", `Habilitado como editor: ${nom}`);
  }

  if (pendingEditTarget) {
    pendingEditTarget.focus();
    pendingEditTarget = null;
  }
});

window.requireEditor = function (e) {
  if (currentRole === "visitor") {
    e.preventDefault();
    pendingEditTarget = e.target;
    requireAuth();
  } else if (currentRole === "invitado") {
    // Verificar permiso modificarHorario antes de permitir la edición
    if (!checkAccessWithToast("modificarHorario")) {
      e.preventDefault();
    }
  }
};

// Exponer checkAccess globalmente para uso desde otras partes del código
window.checkAccess = checkAccess;

// -- LOG AUDITORÍA --
window.logAudit = async function (
  action,
  collabId,
  targetDate,
  oldValue,
  newValue,
) {
  if (!requireAuth()) return;
  if (isMockMode) return;
  try {
    let authorName = "Desconocido";
    if (currentRole === "admin") authorName = "Administrador (10045875)";
    else if (currentRole === "editor")
      authorName = `${localStorage.getItem("editorNombre")} (${localStorage.getItem("editorLegajo")})`;
    else if (currentRole === "invitado")
      authorName = `${localStorage.getItem("invitadoNombre")} (${localStorage.getItem("invitadoLegajo")}) [Invitado]`;

    const logRef = doc(collection(db, "logs_cambios"));
    await setDoc(logRef, {
      autor: authorName,
      accion: action,
      afectado: collabId,
      fechaTarget: targetDate || "N/A",
      valorAnterior: oldValue || "",
      valorNuevo: newValue || "",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error al guardar log de auditoría:", err);
  }
};

// -- EXPORTAR PDF AVANZADO --
const pdfModal = document.getElementById("pdfModal");
const pdfForm = document.getElementById("pdfForm");
const pdfCustomDates = document.getElementById("pdfCustomDates");
const pdfRadios = document.getElementsByName("pdfRange");

if (document.getElementById("pdfBtn")) {
  document.getElementById("pdfBtn").addEventListener("click", () => {
    pdfModal.style.display = "flex";
  });
}

document.getElementById("pdfCancelBtn").addEventListener("click", () => {
  pdfModal.style.display = "none";
});

pdfRadios.forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.value === "custom") {
      pdfCustomDates.style.display = "flex";
    } else {
      pdfCustomDates.style.display = "none";
    }
  });
});

pdfForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rangeType = document.querySelector(
    'input[name="pdfRange"]:checked',
  ).value;

  let startD = new Date(state.currentWeekStart);
  let endD = addDays(startD, 6); // Semana actual

  if (rangeType === "custom") {
    const valStart = document.getElementById("pdfDateStart").value;
    if (!valStart) {
      showToast("Error", "Debes seleccionar la fecha de inicio.");
      return;
    }
    startD = new Date(valStart + "T00:00:00");
    // Asegurar que sea lunes, opcionalmente, pero el usuario elige.
    endD = addDays(startD, 20); // 21 días total
  }

  pdfModal.style.display = "none";
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
                   Periodo: ${startDate.toLocaleDateString("es-ES")} al ${endDate.toLocaleDateString("es-ES")}
                </p>
             </div>
       `;

  state.collaborators.forEach((collab) => {
    htmlStr += `
          <div class="pdf-collaborator-card" style="margin-bottom: 6px; page-break-inside: avoid; border-bottom: 1px dashed #ccc; padding-bottom: 4px;">
            <div style="background-color: #e6e6e6; color: #000; font-weight: bold; padding: 2px 6px; font-size: 0.8rem; text-transform: uppercase; border: 1px solid #000;">
              ${collab.id} - ${collab.name.split("(")[0].trim()}
            </div>
            <table class="pdf-table-compact" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2px;">
              <tbody>
          `;

    weeks.forEach((weekDays, wIndex) => {
      htmlStr += `
                 <tr>
             `;

      weekDays.forEach((d) => {
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
        if (isOnVacation) val = "VACACIONES";
        if (!val.trim()) val = "-";
        if (val === "VACACIONES") val = "VAC";
        const dText =
          String(d.getDate()).padStart(2, "0") +
          "/" +
          String(d.getMonth() + 1).padStart(2, "0");
        let cellStyle =
          val.length > 6
            ? "font-size: 0.65rem !important; letter-spacing: -0.5px !important;"
            : "";

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
    margin: [10, 10, 10, 10], // Márgenes de 10mm en los cuatro lados
    filename: `Planificacion_${formatDate(startDate)}_al_${formatDate(endDate)}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }, // A4 Horizontal
  };

  try {
    const worker = html2pdf().set(opt).from(htmlStr);
    await worker.save();
    showToast("PDF Generado", "La descarga ha finalizado.");
  } catch (e) {
    console.error("PDF error:", e);
    showToast("Error", "Falló la generación del PDF.");
  }
}

// -- LOGS DE ACTIVIDAD (Auditoría de Turnos) --
window.registrarLogActividad = async function (
  collabId,
  targetDate,
  oldValue,
  newValue,
) {
  if (isMockMode) return;
  if (currentRole === "admin") return;

  try {
    let execLegajo = "Desconocido";
    let execNombre = "Desconocido";
    if (currentRole === "editor") {
      execLegajo = localStorage.getItem("editorLegajo") || "";
      execNombre = localStorage.getItem("editorNombre") || "";
    } else if (currentRole === "invitado") {
      execLegajo = localStorage.getItem("invitadoLegajo") || "";
      execNombre = localStorage.getItem("invitadoNombre") + " [Invitado]" || "";
    }

    const collab = state.collaborators.find(
      (c) => String(c.id) === String(collabId),
    );
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
      revisadoAdmin: false,
    });
  } catch (err) {
    console.error("Error guardando log de actividad:", err);
  }
};

window.checkAuditLogs = async function () {
  if (currentRole !== "admin") return;
  try {
    const q = query(
      collection(db, "logs_actividad"),
      where("revisadoAdmin", "==", false),
    );
    const snapshot = await getDocs(q);
    const auditBadge = document.getElementById("auditBadge");

    const docs = snapshot.docs.filter(
      (doc) => doc.data().ejecutorLegajo !== "10045875",
    );

    if (docs.length > 0) {
      auditBadge.style.display = "flex";
      auditBadge.textContent = docs.length;
    } else {
      auditBadge.style.display = "none";
    }
  } catch (err) {
    console.error("Error al consultar logs:", err);
  }
};

const auditBellBtn = document.getElementById("auditBellBtn");
const auditoriaModal = document.getElementById("auditoriaModal");
const auditCloseBtn = document.getElementById("auditCloseBtn");
const auditListContainer = document.getElementById("auditListContainer");
const auditHistoryToggleBtn = document.getElementById("auditHistoryToggleBtn");
let showingReviewedLogs = false;

if (auditHistoryToggleBtn) {
  auditHistoryToggleBtn.addEventListener("click", async () => {
    showingReviewedLogs = !showingReviewedLogs;
    auditHistoryToggleBtn.innerText = showingReviewedLogs
      ? "Ver Solo Pendientes"
      : "Ver Historial Completo";
    await renderAuditLogs();
  });
}

if (auditBellBtn) {
  auditBellBtn.addEventListener("click", async () => {
    auditoriaModal.style.display = "flex";
    showingReviewedLogs = false;
    if (auditHistoryToggleBtn)
      auditHistoryToggleBtn.innerText = "Ver Historial Completo";
    await renderAuditLogs();
  });
}

if (auditCloseBtn) {
  auditCloseBtn.addEventListener("click", () => {
    auditoriaModal.style.display = "none";
  });
}

async function renderAuditLogs() {
  auditListContainer.innerHTML =
    '<div style="text-align: center; color: var(--text-muted);">Cargando logs...</div>';
  try {
    let q;
    if (showingReviewedLogs) {
      q = query(collection(db, "logs_actividad")); // Trae todos para ordenarlos por fecha
    } else {
      q = query(
        collection(db, "logs_actividad"),
        where("revisadoAdmin", "==", false),
      );
    }

    const snapshot = await getDocs(q);
    let docs = snapshot.docs.filter(
      (doc) => doc.data().ejecutorLegajo !== "10045875",
    );

    // Ordenar por fecha descendente (más recientes primero)
    docs.sort((a, b) => {
      return new Date(b.data().fechaCambio) - new Date(a.data().fechaCambio);
    });

    if (docs.length === 0) {
      auditListContainer.innerHTML =
        '<div style="text-align: center; color: var(--text-muted); padding: 1rem;">No hay cambios para mostrar.</div>';
      return;
    }

    auditListContainer.innerHTML = "";
    docs.forEach((docSnap) => {
      const data = docSnap.data();
      const div = document.createElement("div");
      div.className = "audit-item";
      if (data.revisadoAdmin) {
        div.style.opacity = "0.7";
        div.style.background = "rgba(255,255,255,0.05)";
      }

      let dateParts = data.fechaTurno.split("-");
      let dateFormatted =
        dateParts.length === 3
          ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`
          : data.fechaTurno;

      let actionHtml = "";
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
                  <span class="audit-action">${data.estadoAnterior || "(vacío)"}</span> a <span class="audit-action">${data.estadoNuevo || "(vacío)"}</span> 
                  <br><span style="color: var(--text-muted); font-size: 0.75rem;">Afectado: ${data.colaboradorAfectado} | Editado: ${horaCambio}</span>
               </div>
               ${actionHtml}
             `;
      auditListContainer.appendChild(div);
    });

    document.querySelectorAll(".mark-reviewed-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        e.target.innerText = "Guardando...";
        e.target.disabled = true;
        e.target.style.background = "var(--text-muted)";
        await updateDoc(doc(db, "logs_actividad", id), { revisadoAdmin: true });
        await window.checkAuditLogs();
        await renderAuditLogs();
      });
    });
  } catch (err) {
    console.error("Error al renderizar logs:", err);
    auditListContainer.innerHTML =
      '<div style="color: var(--danger);">Error al cargar logs.</div>';
  }
}

// 12. BACKUP GOOGLE SHEETS
if (document.getElementById("backupDriveBtn")) {
  document
    .getElementById("backupDriveBtn")
    .addEventListener("click", generarBackupSheets);
}

async function generarBackupSheets() {
  const backupBtn = document.getElementById("backupDriveBtn");
  const originalText = backupBtn.innerText;
  const WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbxQ-HYUql7hIe7DUSzRjjQjiFSAxDFrLpXrhMPhKwqmB53DTV_b7BVmIP_QO79QHeWw/exec";
  const SPREADSHEET_ID = "1X3T8JIQ6APN8Gc3z7vVxz3rCEoiRRgSAUY4HIljm604";

  backupBtn.innerText = "Extrayendo...";
  backupBtn.disabled = true;

  try {
    // 1. Obtener toda la data de planificacion
    const planSnap = await getDocs(collection(db, "planificacion"));

    const monthMap = {};
    const datesByMonth = {};

    planSnap.forEach((docSnap) => {
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
    const monthNames = [
      "Ene",
      "Feb",
      "Mar",
      "Abr",
      "May",
      "Jun",
      "Jul",
      "Ago",
      "Sep",
      "Oct",
      "Nov",
      "Dic",
    ];

    for (const monthKey of Object.keys(monthMap)) {
      const [year, monthNum] = monthKey.split("-");
      const sheetName = monthNames[parseInt(monthNum) - 1] + " " + year;

      const datesArray = Array.from(datesByMonth[monthKey]).sort();
      const headers = ["Legajo", "Nombre"].concat(
        datesArray.map((d) => {
          const [y, m, day] = d.split("-");
          return day + "/" + m;
        }),
      );

      const matrix = [headers];

      state.collaborators.forEach((collab) => {
        const row = [collab.id, collab.name.split("(")[0].trim()];
        const collabData = monthMap[monthKey][collab.id] || {};

        datesArray.forEach((d) => {
          row.push(collabData[d] || "-");
        });
        matrix.push(row);
      });

      sheets.push({ name: sheetName, data: matrix });
    }

    backupBtn.innerText = "Enviando a Drive...";

    // 3. Enviar al Web App
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      mode: "no-cors", // Evita bloqueos CORS en el navegador al hablar con GAS
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain es mandatorio en no-cors
      body: JSON.stringify({
        spreadsheetId: SPREADSHEET_ID,
        sheets: sheets,
      }),
    });

    showToast(
      "Backup Enviado",
      "El proceso de respaldo se envió a Google Drive.",
    );
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
  const [yyyy, mm, dd] = fechaAlta.split("-");
  const fechaIngreso = new Date(yyyy, mm - 1, dd);
  const fechaCorte = new Date(añoDestino, 11, 31);

  if (fechaIngreso > fechaCorte) return 0;

  let antiguedad = añoDestino - fechaIngreso.getFullYear();
  if (
    fechaCorte.getMonth() < fechaIngreso.getMonth() ||
    (fechaCorte.getMonth() === fechaIngreso.getMonth() &&
      fechaCorte.getDate() < fechaIngreso.getDate())
  ) {
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
  if (localStorage.getItem("fechasMigradasV1")) return;

  const dates = {
    10047984: "2025-06-17",
    10047985: "2025-06-17",
    10047483: "2025-05-05",
    10047482: "2025-05-05",
    10044768: "2021-03-01",
    10036547: "2012-08-13",
    10036544: "2012-08-13",
    10036484: "2012-08-01",
    10036330: "2012-08-13",
    10036542: "2012-08-13",
    10036541: "2012-08-13",
    10023038: "2007-08-17",
  };

  console.log("Iniciando migración de fechas de alta...");
  for (let id in dates) {
    try {
      await updateDoc(
        doc(db, "colaboradores", id),
        { fechaAlta: dates[id] },
        { merge: true },
      );
    } catch (e) {
      // console.error("Fallo al migrar " + id, e)
    }
  }
  localStorage.setItem("fechasMigradasV1", "true");
  console.log("Fechas migradas exitosamente.");
}
// SCROLL INFINITO & WHEEL
const gridContainer = document.querySelector(".grid-container");
let isFetchingNextWeek = false;

// 1. (Funciones programáticas de scroll eliminadas para permitir scroll nativo)

// 2. Scroll event para lazy loading y sincronización del mapa de calor
let isScrolling = false;
gridContainer.addEventListener("scroll", async (e) => {
  if (isScrolling) return;
  window.requestAnimationFrame(async () => {
    isScrolling = false;
    // A. Sincronización dinámica del Mapa de Calor Superior (espejo del viewport)
    const colWidth = window.innerWidth <= 768 ? 75 : 120;
    let startIndex = Math.floor(gridContainer.scrollLeft / colWidth);
    if (startIndex < 0) startIndex = 0;

    if (startIndex !== window.currentHeatmapStartIndex) {
      window.currentHeatmapStartIndex = startIndex;
      renderHeatmap(); // Renderiza solo los 7 días correspondientes al frame actual
      updateDynamicHours(); // Actualiza etiquetas de horas flotantes (Móvil y Escritorio)
    }
  }); // Fin de requestAnimationFrame
});

// 3. Salto a fecha específica desde el almanaque (Móvil y Escritorio)
const mobileDatepickerTrigger = document.getElementById(
  "mobile-datepicker-trigger",
);
const desktopDatepickerTrigger = document.getElementById(
  "desktop-datepicker-trigger",
);

function attachDatepickerJump(triggerEl) {
  if (!triggerEl) return;
  triggerEl.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    const parts = e.target.value.split("-");
    const selectedDate = new Date(
      Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0),
    );

    if (window.innerWidth <= 768) {
      state.currentWeekStart = selectedDate;
      await loadWeekPlanning(false);
    } else {
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

        const targetDayIndex =
          selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1;
        gridContainer.scrollLeft = targetDayIndex * colWidth;
      }
    }
    e.target.value = "";
  });
}

attachDatepickerJump(mobileDatepickerTrigger);
attachDatepickerJump(desktopDatepickerTrigger);

// --- SUGERIDOS LOGIC ---
window.renderSugeridos = async function () {
  const dateInput = document.getElementById("suggestedDateFilter");
  if (!dateInput.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = new Date(tomorrow - tzOffset)
      .toISOString()
      .slice(0, -1)
      .split("T")[0];
    dateInput.value = localISOTime;
  }

  const selectedDateStr = dateInput.value;
  const tbody = document.getElementById("sugeridosTableBody");
  tbody.innerHTML =
    '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted);">Cargando sugerencias...</td></tr>';

  let sugerenciasGuardadas = {};
  if (typeof isMockMode === "undefined" || !isMockMode) {
    try {
      // Adaptado para usar Firestore v9 en base a los imports de tu proyecto
      const q = query(
        collection(db, "sugerencias"),
        where("fecha", "==", selectedDateStr),
      );
      const snap = await getDocs(q);
      snap.forEach((d) => {
        sugerenciasGuardadas[d.data().colaboradorId] = d.data();
      });

      // OBTENER NOTAS GLOBALES
      const globalDocRef = doc(db, "notas_globales", selectedDateStr);
      const globalDocSnap = await getDoc(globalDocRef);
      const globalNotesTA = document.getElementById("globalNotesTextarea");
      if (globalNotesTA) {
        globalNotesTA.value = globalDocSnap.exists()
          ? globalDocSnap.data().texto || ""
          : "";
        const canEdit =
          checkAccess("modificarSugeridos") && currentRole !== "visitor";
        globalNotesTA.readOnly = !canEdit;
        globalNotesTA.style.background = canEdit ? "var(--bg)" : "#f0f0f0";
        globalNotesTA.style.color = canEdit ? "var(--text)" : "#333";
        globalNotesTA.style.cursor = canEdit ? "text" : "not-allowed";
      }
    } catch (err) {
      console.error("Error al obtener sugerencias:", err);
    }
  }

  tbody.innerHTML = "";
  const cardsContainer = document.getElementById("sugeridosMobileCards");
  if (cardsContainer) cardsContainer.innerHTML = "";
  const isMobile = window.innerWidth <= 768;
  const forbiddenStates = ["VAC", "V", "SUS", "FRANCO", "F", "LIBRE", "-"];

  console.log(
    "Intentando renderizar tarjetas móviles. isMobile:",
    isMobile,
    "cardsContainer:",
    !!cardsContainer,
  );

  state.collaborators.forEach((collab) => {
    const isVac =
      state.vacations &&
      state.vacations.some(
        (vac) =>
          vac.colaboradorId === collab.id &&
          selectedDateStr >= vac.startDate &&
          selectedDateStr <= vac.endDate,
      );

    const rawTurno = getPlanningSlot(collab.id, selectedDateStr) || "-";
    const shiftText = isVac ? "V" : rawTurno;
    const isBlocked = forbiddenStates.includes(shiftText.toUpperCase().trim());

    const cleanName = collab.name.split("(")[0].split("-")[0].trim();

    const savedData = sugerenciasGuardadas[collab.id];
    const textValue = savedData ? savedData.texto : "";
    const authorLabel =
      savedData && savedData.legajo
        ? `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px; text-align: right;">Escrito por: <span style="color: var(--primary); font-weight: bold;">${savedData.legajo}</span></div>`
        : "";

    if (isMobile && cardsContainer) {
      const card = document.createElement("div");
      card.className = "mobile-card";
      card.innerHTML = `
                 <div style="grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1;">L. ${collab.id}</div>
                    <div style="font-weight: bold; font-size: 1rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${cleanName}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); gap: 0.4rem; display: flex;">
                        <span>${collab.pasillo}</span><span style="opacity:0.6;">(${collab.hours}h)</span>
                    </div>
                 </div>
                 <div style="grid-column: 2; grid-row: 1; text-align: right; font-size: 1.05rem; color: ${isBlocked ? "var(--info)" : "var(--text)"}; font-weight: 500;">
                    ${shiftText}
                 </div>
                 <div style="grid-column: 1 / -1; grid-row: 2;">
                    <textarea class="sugeridos-comment" 
                       data-collab="${collab.id}"
                       placeholder="${isBlocked ? "Inhabilitado (" + shiftText + ")" : "Agregar comentario..."}" 
                       ${isBlocked ? "disabled" : 'onmousedown="window.requireEditor(event)"'}
                       ${!isBlocked && currentRole === "visitor" ? "readonly" : ""}
                       rows="3" 
                       style="width: 100%; min-height: 80px; padding: 10px; border-radius: 6px; border: 1px solid var(--border); background: ${isBlocked ? "#2d3748" : "var(--bg)"}; color: ${isBlocked ? "#718096" : "#fff"}; resize: none; font-size: 0.95rem; font-family: inherit; box-sizing: border-box; opacity: ${isBlocked ? "0.6" : "1"}; ${isBlocked ? "cursor: not-allowed;" : ""}">${textValue}</textarea>
                    ${authorLabel}
                 </div>
               `;
      cardsContainer.appendChild(card);
    } else {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border)";
      tr.innerHTML = `
                 <td style="padding: 8px 12px; width: 350px;">
                    <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
                       <div style="font-size: 0.7em; color: var(--text-muted); line-height: 1;">L. ${collab.id}</div>
                       <div style="font-weight: bold; font-size: 0.95em; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                          ${cleanName}
                       </div>
                       <div class="collab-meta" style="font-size: 0.8em; display: flex; align-items: center; justify-content: flex-start; gap: 0.4rem; color: var(--text-muted);">
                          <span>${collab.pasillo}</span>
                          <span style="opacity: 0.6;">(${collab.hours}h)</span>
                       </div>
                    </div>
                 </td>
                 <td style="padding: 8px 12px; text-align: center; font-weight: 500; font-size: 0.9rem; color: ${isBlocked ? "var(--info)" : "var(--text)"};">
                    ${shiftText}
                 </td>
                 <td style="padding: 8px 12px;">
                    <textarea class="sugeridos-comment" 
                       data-collab="${collab.id}"
                       placeholder="${isBlocked ? "Inhabilitado (Estado: " + shiftText + ")" : "Agregar comentario..."}" 
                       ${isBlocked ? "disabled" : 'onmousedown="window.requireEditor(event)"'}
                       ${!isBlocked && currentRole === "visitor" ? "readonly" : ""}
                       rows="2" 
                       style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--border); background: ${isBlocked ? "#2d3748" : "var(--bg)"}; color: ${isBlocked ? "#718096" : "var(--text)"}; resize: none; font-size: 0.85rem; font-family: inherit; box-sizing: border-box; opacity: ${isBlocked ? "0.6" : "1"}; ${isBlocked ? "cursor: not-allowed;" : ""}">${textValue}</textarea>
                    ${authorLabel}
                 </td>
               `;
      tbody.appendChild(tr);
    }
  });

  document.querySelectorAll(".sugeridos-comment").forEach((textarea) => {
    textarea.addEventListener("blur", async (e) => {
      const val = e.target.value.trim();
      const collabId = e.target.getAttribute("data-collab");
      const originalData = sugerenciasGuardadas[collabId];
      const originalText = originalData ? originalData.texto : "";

      if (val !== originalText && !e.target.readOnly && !e.target.disabled) {
        // MIDDLEWARE: Verificar permiso antes de escribir sugerencia
        if (!checkAccessWithToast("modificarSugeridos")) return;
        let activeLegajo = localStorage.getItem("editorLegajo");
        if (currentRole === "admin") activeLegajo = "Admin";
        if (!activeLegajo) return;

        const commentData = {
          legajo: activeLegajo,
          fecha: selectedDateStr,
          colaboradorId: collabId,
          texto: val,
          timestamp: new Date().toISOString(),
        };

        try {
          await setDoc(
            doc(db, "sugerencias", `${selectedDateStr}_${collabId}`),
            commentData,
          );
          // Opcional: mostrar un mini toast visual para confirmar guardado
          if (typeof showToast === "function") {
            showToast(
              "Guardado",
              "Comentario de sugerencia guardado con éxito.",
              "success",
            );
          }
          sugerenciasGuardadas[collabId] = commentData; // Actualizar cache local
        } catch (err) {
          console.error("Error guardando sugerencia:", err);
          if (typeof showToast === "function") {
            showToast("Error", "No se pudo guardar la sugerencia.", "error");
          }
        }
      }
    });
  });
};

document
  .getElementById("suggestedDateFilter")
  ?.addEventListener("change", window.renderSugeridos);

document
  .getElementById("globalNotesTextarea")
  ?.addEventListener("blur", async (e) => {
    const val = e.target.value;
    const dateVal = document.getElementById("suggestedDateFilter").value;
    if (
      !dateVal ||
      !checkAccessWithToast("modificarSugeridos") ||
      currentRole === "visitor"
    )
      return;
    try {
      await setDoc(doc(db, "notas_globales", dateVal), {
        texto: val,
        fecha: dateVal,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Error guardando notas globales:", err);
    }
  });

document.getElementById("pdfSugeridosBtn")?.addEventListener("click", () => {
  // MIDDLEWARE: Verificar permiso antes de generar PDF de sugeridos
  if (!checkAccessWithToast("exportarSugeridosPdf")) return;
  const dateVal = document.getElementById("suggestedDateFilter").value;

  const header = document.createElement("h1");
  header.innerText = `Sugerencias del día: ${dateVal}`;
  header.style.color = "black";
  header.style.textAlign = "center";
  header.style.padding = "10px 0";
  header.style.margin = "0";
  header.style.fontFamily = "inherit";
  document.body.prepend(header);

  const textareas = document.querySelectorAll(".sugeridos-comment");
  const divs = [];
  textareas.forEach((ta) => {
    const div = document.createElement("div");
    div.innerHTML = ta.value.replace(/\n/g, "<br>");
    div.className = "print-only-text";
    div.style.cssText =
      "padding: 2px; font-size: 9.5pt; line-height: 1.15; word-break: break-all; color: black;";
    ta.parentNode.insertBefore(div, ta);
    ta.style.display = "none";
    divs.push({ div, ta });
  });

  const globalTA = document.getElementById("globalNotesTextarea");
  if (globalTA) {
    const globalDiv = document.createElement("div");
    globalDiv.innerHTML = `<strong>Comentarios Globales:</strong><br>${globalTA.value.replace(/\n/g, "<br>")}`;
    globalDiv.className = "print-only-text";
    globalDiv.style.cssText =
      "margin-top: 15px; padding: 10px; border: 1px solid #000; border-radius: 4px; font-size: 10pt; line-height: 1.2; word-break: break-all; color: #000000 !important; page-break-inside: avoid;";
    globalTA.parentNode.insertBefore(globalDiv, globalTA);
    globalTA.style.display = "none";
    divs.push({ div: globalDiv, ta: globalTA });
  }

  let container = document.getElementById("print-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "print-container";
    Array.from(document.body.childNodes).forEach((child) => {
      container.appendChild(child);
    });
    document.body.appendChild(container);
  }

  window.print();

  header.remove();
  divs.forEach((item) => {
    item.div.remove();
    item.ta.style.display = "";
  });
});

// INICIO - Arranque rapido: carga datos inmediatamente sin esperar Auth
window.appInitialized = false;
window.initApp = function () {
  if (window.appInitialized) return;
  window.appInitialized = true;
  migrateFechas().then(() => {
    loadInitialData();
  });
};

// applyPermissionsUI() - Actualizacion silenciosa de permisos.
// Llamada desde onAuthStateChanged cuando la sesion resuelve.
// NO recarga datos de Firestore; solo actualiza el DOM ya renderizado.
window.applyPermissionsUI = function () {
  console.log("[AUTH DEBUG] applyPermissionsUI() ejecutado.");

  // 1. Ocultar modal de login si esta visible
  const loginModalEl = document.getElementById("loginModal");
  if (loginModalEl) loginModalEl.style.display = "none";

  // 2. Actualizar header y botones de sesion centralizadamente en checkLogin
  //    checkLogin ya esta modificado para depender 100% de window.userProfile
  if (typeof checkLogin === "function") checkLogin();

  // 3. Re-renderizar grilla para activar controles segun permisos
  if (typeof renderUI === "function") renderUI();
};
// Disparar initApp() al instante: grilla visible con rol visitor.
// Cuando onAuthStateChanged resuelva, applyPermissionsUI() activa controles de admin.
window.initApp();

// ============================================================
// MÓDULO EVENTOS DIARIOS — Modal de gestión
// ============================================================

// Asignar el listener de forma aislada
document.getElementById("eventosNavBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  console.log("CLICK: eventosNavBtn called!");
  const dropdownMenu = document.getElementById("navDropdownMenu");
  if (dropdownMenu) dropdownMenu.style.display = "none";
  window.openEventosModal();
});

window.openEventosModal = async function () {
  document.getElementById("eventosModal").style.display = "flex";
  const hoy = formatDate(new Date());
  document.getElementById("eventoFechaInput").value = hoy;
  if (document.getElementById("eventoTiendaCerradaInput")) {
    document.getElementById("eventoTiendaCerradaInput").checked = false;
  }

  // Mostrar/ocultar controles de escritura según permiso
  const puedeEditar = checkAccess("gestionarEventos");
  const formBox =
    document.querySelector("#eventosModal [data-eventos-form]") ||
    document.querySelector("#eventosModal > div > div:nth-child(3)");
  const guardarBtn = document.querySelector(
    '#eventosModal button[onclick="window.saveEvento()"]',
  );
  if (guardarBtn) guardarBtn.style.display = puedeEditar ? "" : "none";

  // Banner de solo lectura
  const banner = document.getElementById("eventosSoloLecturaBanner");
  if (banner) banner.style.display = puedeEditar ? "none" : "flex";

  await window.renderEventosList();
};

window.currentEventosDate = new Date();

window.prevEventosMonth = function () {
  window.currentEventosDate.setMonth(window.currentEventosDate.getMonth() - 1);
  window.renderEventosList();
};

window.nextEventosMonth = function () {
  window.currentEventosDate.setMonth(window.currentEventosDate.getMonth() + 1);
  window.renderEventosList();
};

window.renderEventosList = async function () {
  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const y = window.currentEventosDate.getFullYear();
  const m = window.currentEventosDate.getMonth();
  const label = document.getElementById("eventosMonthLabel");
  if (label) label.innerText = `${monthNames[m]} ${y}`;

  const container = document.getElementById("eventosListContainer");
  container.innerHTML =
    '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">Cargando...</p>';
  if (isMockMode) {
    container.innerHTML =
      '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">No disponible en modo demo.</p>';
    return;
  }
  try {
    const startStr = `${y}-${(m + 1).toString().padStart(2, "0")}-01`;
    const endD = new Date(y, m + 1, 0);
    const endStr = `${y}-${(m + 1).toString().padStart(2, "0")}-${endD.getDate().toString().padStart(2, "0")}`;

    const q = query(
      collection(db, "eventos_diarios"),
      where("__name__", ">=", startStr),
      where("__name__", "<=", endStr),
    );
    const snap = await getDocs(q);
    const eventos = [];
    snap.forEach((d) => eventos.push({ id: d.id, ...d.data() }));
    eventos.sort((a, b) => a.id.localeCompare(b.id));

    let calendarHtml =
      '<div style="display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: auto repeat(6, 1fr); gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); flex: 1; min-height: 0;">';

    // Cabeceras de días
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    days.forEach((d) => {
      calendarHtml += `<div style="text-align: center; font-size: 0.75rem; font-weight: bold; color: var(--text-muted); padding: 6px 0;">${d}</div>`;
    });

    // Calcular celdas vacías iniciales
    let firstDay = new Date(y, m, 1).getDay();
    let startEmpty = firstDay === 0 ? 6 : firstDay - 1; // Ajustar a Lunes (0) a Domingo (6)
    for (let i = 0; i < startEmpty; i++) {
      calendarHtml += `<div style="background: rgba(255,255,255,0.02); border-radius: 4px;"></div>`;
    }

    // Celdas de días con eventos
    let daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      let dayStr = `${y}-${(m + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      let dayEvents = eventos.filter((ev) => ev.id === dayStr);

      let cellHtml = `<div style="background: var(--surface); border: 1px solid var(--border); border-radius: 4px; min-height: 0; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 4px;">
                <div style="font-size: 0.8rem; font-weight: bold; color: var(--text-muted); align-self: flex-end; margin-bottom: 2px;">${day}</div>`;

      dayEvents.forEach((ev) => {
        cellHtml += `<div style="background: ${ev.color}22; border-left: 3px solid ${ev.color}; border-radius: 4px; padding: 4px; position: relative; font-size: 0.65rem; color: var(--text); line-height: 1.2;">
                    <div style="font-weight: bold; margin-bottom: 2px; padding-right: 12px; word-break: break-word;">${ev.tipo}</div>
                    <div style="word-break: break-word; opacity: 0.9;" title="${ev.descripcion}">${ev.descripcion}</div>
                    <button onclick="window.deleteEvento('${ev.id}')" title="Borrar" style="position: absolute; top: 4px; right: 4px; background: transparent; border: none; color: var(--text); cursor: pointer; font-size: 0.8rem; padding: 0; line-height: 1; opacity: 0.7;">&times;</button>
                </div>`;
      });

      cellHtml += `</div>`;
      calendarHtml += cellHtml;
    }

    // Celdas vacías finales para completar exactamente 6 semanas (42 celdas)
    let totalCells = startEmpty + daysInMonth;
    let remainingCells = 42 - totalCells;
    for (let i = 0; i < remainingCells; i++) {
      calendarHtml += `<div style="background: rgba(255,255,255,0.02); border-radius: 4px;"></div>`;
    }

    calendarHtml += "</div>";
    container.innerHTML = calendarHtml;
  } catch (e) {
    container.innerHTML =
      '<p style="color: var(--danger); font-size: 0.85rem; text-align: center; padding: 1rem;">Error al cargar eventos.</p>';
    console.error("Error cargando lista de eventos:", e);
  }
};

window.saveEvento = async function () {
  if (!requireAuth()) return;
  if (!checkAccessWithToast("gestionarEventos")) return;
  const fecha = document.getElementById("eventoFechaInput").value;
  const tipo = document.getElementById("eventoTipoInput").value;
  const descripcion = document.getElementById("eventoDescInput").value.trim();
  const color = document.getElementById("eventoColorInput").value;
  const tiendaCerrada = document.getElementById(
    "eventoTiendaCerradaInput",
  ).checked;
  if (!fecha || !descripcion) {
    showToast(
      "Campos incompletos",
      "Completá la fecha y la descripción del evento.",
      "warning",
    );
    return;
  }
  if (!isMockMode) {
    try {
      await setDoc(doc(db, "eventos_diarios", fecha), {
        tipo,
        descripcion,
        color,
        tiendaCerrada,
      });
      state.eventos[fecha] = { tipo, descripcion, color, tiendaCerrada };
      showToast(
        "Evento guardado",
        `${tipo}: ${descripcion} — ${fecha}`,
        "success",
      );
      document.getElementById("eventoDescInput").value = "";
      document.getElementById("eventoTiendaCerradaInput").checked = false;
      await window.renderEventosList();
      renderUI();
    } catch (e) {
      showToast("Error", "No se pudo guardar el evento.", "error");
      console.error("Error guardando evento:", e);
    }
  }
};

window.deleteEvento = async function (fecha) {
  if (!requireAuth()) return;
  if (!checkAccessWithToast("gestionarEventos")) return;
  if (!isMockMode) {
    try {
      const { deleteDoc } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await deleteDoc(doc(db, "eventos_diarios", fecha));
      delete state.eventos[fecha];
      showToast(
        "Evento eliminado",
        `El evento del ${fecha} fue borrado.`,
        "info",
      );
      await window.renderEventosList();
      renderUI();
    } catch (e) {
      showToast("Error", "No se pudo borrar el evento.", "error");
      console.error("Error borrando evento:", e);
    }
  }
};

let currentYearModalCollabId = null;
let currentYearModalYear = null;

window.openYearManagementModal = function (collabId, year) {
  currentYearModalCollabId = collabId;
  currentYearModalYear = year;

  const collab = state.collaborators.find((c) => c.id === collabId);
  if (!collab) return;

  document.getElementById("yearModalTitle").innerText = year;
  document.getElementById("yearManagementModal").classList.add("active");

  const yearData =
    (collab.saldosVacaciones && collab.saldosVacaciones[year]) || {};
  document.getElementById("yearModalNotes").value = yearData.notas || "";

  renderYearAttachments(yearData.adjuntos || []);
};

function renderYearAttachments(adjuntos) {
  const listContainer = document.getElementById("yearModalAttachmentsList");
  if (!adjuntos || adjuntos.length === 0) {
    listContainer.innerHTML =
      '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 0.5rem 0;">No hay adjuntos para este año.</div>';
    return;
  }
  const canDelete = window.checkAccess("eliminarAdjunto");

  listContainer.innerHTML = adjuntos
    .map(
      (adj, index) => `
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 0.4rem 0.6rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
               <a href="${adj.url}" target="_blank" style="color: var(--primary); text-decoration: none; font-size: 0.8rem; display: flex; align-items: center; gap: 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  ${adj.name}
               </a>
               ${
                 canDelete
                   ? `
               <button type="button" onclick="deleteYearAttachment(${index})" title="Eliminar adjunto" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 2px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
               </button>
               `
                   : ""
               }
            </div>
        `,
    )
    .join("");
}

window.deleteYearAttachment = async function (index) {
  if (!confirm("¿Estás seguro de que deseas eliminar este adjunto?")) return;
  const collab = state.collaborators.find(
    (c) => c.id === currentYearModalCollabId,
  );
  if (
    !collab ||
    !collab.saldosVacaciones ||
    !collab.saldosVacaciones[currentYearModalYear]
  )
    return;

  const yearData = collab.saldosVacaciones[currentYearModalYear];
  if (yearData.adjuntos && yearData.adjuntos[index]) {
    yearData.adjuntos.splice(index, 1);
    if (!isMockMode) {
      try {
        await setDoc(
          doc(db, "colaboradores", currentYearModalCollabId),
          { saldosVacaciones: collab.saldosVacaciones },
          { merge: true },
        );
        showToast("Adjunto eliminado", "El adjunto ha sido removido.", "info");
        renderYearAttachments(yearData.adjuntos);
        if (typeof renderVacationTable === "function") renderVacationTable();
      } catch (e) {
        showToast("Error", "No se pudo eliminar el adjunto.", "error");
        console.error(e);
      }
    } else {
      renderYearAttachments(yearData.adjuntos);
      if (typeof renderVacationTable === "function") renderVacationTable();
    }
  }
};

document.getElementById("closeYearModal")?.addEventListener("click", () => {
  document.getElementById("yearManagementModal").classList.remove("active");
  currentYearModalCollabId = null;
  currentYearModalYear = null;
});

document
  .getElementById("btnSaveYearModal")
  ?.addEventListener("click", async () => {
    if (!currentYearModalCollabId || !currentYearModalYear) return;

    const notes = document.getElementById("yearModalNotes").value;
    const collab = state.collaborators.find(
      (c) => c.id === currentYearModalCollabId,
    );

    if (collab) {
      if (!collab.saldosVacaciones) collab.saldosVacaciones = {};
      if (!collab.saldosVacaciones[currentYearModalYear])
        collab.saldosVacaciones[currentYearModalYear] = {};

      collab.saldosVacaciones[currentYearModalYear].notas = notes;

      if (!isMockMode) {
        try {
          await setDoc(
            doc(db, "colaboradores", currentYearModalCollabId),
            { saldosVacaciones: collab.saldosVacaciones },
            { merge: true },
          );
          showToast(
            "Guardado exitoso",
            "Las notas de la temporada se han guardado.",
            "success",
          );
          document
            .getElementById("yearManagementModal")
            .classList.remove("active");
        } catch (e) {
          showToast("Error", "No se pudo guardar la nota.", "error");
          console.error("Error guardando notas de temporada:", e);
        }
      } else {
        document
          .getElementById("yearManagementModal")
          .classList.remove("active");
      }
    }
  });

const yearModalFileInput = document.getElementById("yearModalFileInput");
const btnUploadYearFile = document.getElementById("btnUploadYearFile");
const yearModalUploadProgress = document.getElementById(
  "yearModalUploadProgress",
);

if (btnUploadYearFile && yearModalFileInput) {
  btnUploadYearFile.addEventListener("click", () => {
    yearModalFileInput.click();
  });

  yearModalFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (isMockMode) {
      showToast(
        "Modo Demo",
        "La subida de archivos está deshabilitada en modo demo.",
        "info",
      );
      yearModalFileInput.value = "";
      return;
    }
    if (!storage) {
      showToast("Error", "Storage no está inicializado.", "error");
      return;
    }

    const collab = state.collaborators.find(
      (c) => c.id === currentYearModalCollabId,
    );
    if (!collab) return;

    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const path = `vacaciones/${currentYearModalYear}/${currentYearModalCollabId}/${fileName}`;
    const storageRef = ref(storage, path);

    btnUploadYearFile.style.display = "none";
    yearModalUploadProgress.style.display = "flex";

    try {
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress =
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          yearModalUploadProgress.innerText = `Subiendo... ${Math.round(progress)}%`;
        },
        (error) => {
          console.error("Upload error:", error);
          if (
            error.code === "storage/unauthorized" ||
            (error.message && error.message.toLowerCase().includes("cors")) ||
            (error.message && error.message.toLowerCase().includes("network"))
          ) {
            showToast(
              "Error de CORS (Entorno Local)",
              "Para subir archivos desde localhost, debes configurar las reglas de CORS en Firebase Storage usando gsutil. También puedes probar desde producción.",
              "error",
            );
          } else {
            showToast(
              "Error",
              "Hubo un problema al subir el archivo: " +
                (error.message || error.code),
              "error",
            );
          }
          btnUploadYearFile.style.display = "flex";
          yearModalUploadProgress.style.display = "none";
          yearModalFileInput.value = "";
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

          if (!collab.saldosVacaciones) collab.saldosVacaciones = {};
          if (!collab.saldosVacaciones[currentYearModalYear])
            collab.saldosVacaciones[currentYearModalYear] = {};
          if (!collab.saldosVacaciones[currentYearModalYear].adjuntos)
            collab.saldosVacaciones[currentYearModalYear].adjuntos = [];

          collab.saldosVacaciones[currentYearModalYear].adjuntos.push({
            name: file.name,
            url: downloadURL,
            path: path,
          });

          await setDoc(
            doc(db, "colaboradores", currentYearModalCollabId),
            { saldosVacaciones: collab.saldosVacaciones },
            { merge: true },
          );

          showToast(
            "Archivo subido",
            "El adjunto se guardó correctamente.",
            "success",
          );
          renderYearAttachments(
            collab.saldosVacaciones[currentYearModalYear].adjuntos,
          );
          if (typeof renderVacationTable === "function") renderVacationTable();

          btnUploadYearFile.style.display = "flex";
          yearModalUploadProgress.style.display = "none";
          yearModalFileInput.value = "";
        },
      );
    } catch (err) {
      console.error("Catch error upload:", err);
      showToast("Error", "Hubo un problema al iniciar la subida.", "error");
      btnUploadYearFile.style.display = "flex";
      yearModalUploadProgress.style.display = "none";
      yearModalFileInput.value = "";
    }
  });
}

window.forceHardRefresh = function () {
  // Preservar estado de sesión y navegación, y tags visuales
  const sessionKeys = [
    "adminLogged",
    "userLoggedIn",
    "invitadoLegajo",
    "invitadoNombre",
    "editorLegajo",
    "editorNombre",
    "lastDateNav",
  ];
  const preservedData = {};

  sessionKeys.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val !== null) preservedData[key] = val;
  });

  // Preservar claves de Firebase (Auth IndexedDB fallback o localStorage)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("firebase:")) {
      preservedData[key] = localStorage.getItem(key);
    }
  }

  localStorage.clear();
  sessionStorage.clear();

  // Restaurar sesión y Firebase
  Object.entries(preservedData).forEach(([key, val]) => {
    localStorage.setItem(key, val);
  });

  if ("caches" in window) {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      for (let registration of registrations) {
        registration.unregister();
      }
    });
  }

  setTimeout(() => {
    window.location.reload(true);
  }, 500);
};

// ==========================================
// DETECCIÓN AUTOMÁTICA DE NUEVAS VERSIONES (version.json)
// ==========================================
let currentAppVersion = localStorage.getItem("appVersion");
async function checkForAppUpdates() {
  try {
    // Construir ruta dinámica al archivo version.json (soporta subdirectorios como /horarios-app/)
    const basePath = window.location.pathname.substring(
      0,
      window.location.pathname.lastIndexOf("/"),
    );
    const url = `${window.location.origin}${basePath}/version.json?t=${new Date().getTime()}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const versionDisplay = document.getElementById("uiVersionDisplay");
      if (versionDisplay) versionDisplay.textContent = "vError";
      return;
    }
    const data = await res.json();

    if (!data || !data.version) {
      const versionDisplay = document.getElementById("uiVersionDisplay");
      if (versionDisplay) versionDisplay.textContent = "vError";
      return;
    }

    // Actualizar la interfaz si el elemento existe
    const versionDisplay = document.getElementById("uiVersionDisplay");
    if (versionDisplay) {
      versionDisplay.textContent = "v" + data.version;
    }

    if (!currentAppVersion) {
      currentAppVersion = data.version;
      localStorage.setItem("appVersion", currentAppVersion);
      console.log(
        `[App Version] Versión inicial cargada y guardada: ${currentAppVersion}`,
      );
    } else {
      console.log(
        `[App Version] Chequeo periódico. Local: ${currentAppVersion} | Servidor: ${data.version}`,
      );
      if (currentAppVersion !== data.version) {
        console.log(`[App Version] ¡NUEVA VERSIÓN DETECTADA! Mostrando botón.`);
        document.getElementById("updateAppBtn").style.display = "flex";
      }
    }
  } catch (e) {
    console.log("No se pudo comprobar la versión de la app", e);
  }
}

setTimeout(checkForAppUpdates, 5000);
setInterval(checkForAppUpdates, 180000);

// Dropdown Header Menu Logic
// (No necesita DOMContentLoaded porque este script corre después de que el HTML ya está en el DOM)
(function () {
  const toggleBtn = document.getElementById("navDropdownToggle");
  const dropdownMenu = document.getElementById("navDropdownMenu");
  if (toggleBtn && dropdownMenu) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = dropdownMenu.style.display === "flex";
      dropdownMenu.style.display = isVisible ? "none" : "flex";
    });

    // Cerrar el menú si se hace clic en alguna de sus opciones
    dropdownMenu.addEventListener("click", (e) => {
      if (
        e.target.closest(".nav-dropdown-item") ||
        e.target.closest("button")
      ) {
        dropdownMenu.style.display = "none";
      }
    });

    document.addEventListener("click", (e) => {
      // No cerrar si hay un modal activo
      const hasActiveModal =
        document.querySelector(".modal-overlay.active") ||
        document.querySelector('.login-overlay[style*="flex"]');
      if (hasActiveModal) return;
      if (!dropdownMenu.contains(e.target) && e.target !== toggleBtn) {
        dropdownMenu.style.display = "none";
      }
    });
  }
})();

// ── GESTIÓN DE REPOSITORES ──
const repositoresNavBtn = document.getElementById("repositoresNavBtn");
const repositoresModal = document.getElementById("repositoresModal");
const closeRepositoresModal = document.getElementById("closeRepositoresModal");
const repositorForm = document.getElementById("repositorForm");
const repositoresTableBody = document.querySelector("#repositoresTable tbody");
let unsubscribeRepositores = null;

if (
  repositoresNavBtn &&
  repositoresModal &&
  closeRepositoresModal &&
  repositorForm
) {
  repositoresNavBtn.addEventListener("click", () => {
    const dm = document.getElementById("navDropdownMenu");
    if (dm) dm.style.display = "none";
    repositoresModal.classList.add("active");
    cargarRepositores();
  });

  closeRepositoresModal.addEventListener("click", () => {
    repositoresModal.classList.remove("active");
    if (unsubscribeRepositores) {
      unsubscribeRepositores();
      unsubscribeRepositores = null;
    }
  });

  repositorForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("repoSubmitBtn");
    const originalText = btn.textContent;
    btn.textContent = "Guardando...";
    btn.disabled = true;

    try {
      const id = document.getElementById("repoId").value;

      const diasCheckboxes = document.querySelectorAll(
        'input[name="repoDias"]:checked',
      );
      const diasArr = Array.from(diasCheckboxes).map((cb) => cb.value);

      const data = {
        nombre: document.getElementById("repoNombre").value.trim(),
        celular: document.getElementById("repoCelular").value.trim(),
        empresa: document.getElementById("repoEmpresa").value.trim(),
        marcas: document.getElementById("repoMarcas").value.trim(),
        horario: document.getElementById("repoHorario").value.trim(),
        diasVisita: diasArr.join(", "),
        supervisor: document.getElementById("repoSupervisor").value.trim(),
        telSupervisor: document
          .getElementById("repoTelSupervisor")
          .value.trim(),
        email: document.getElementById("repoEmail").value.trim(),
      };

      if (id) {
        await updateDoc(doc(db, "repositores", id), data);
        if (window.showToast)
          window.showToast(
            "Repositores",
            "Repositor actualizado exitosamente.",
          );
      } else {
        await setDoc(doc(collection(db, "repositores")), data);
        if (window.showToast)
          window.showToast("Repositores", "Repositor creado exitosamente.");
      }
      repositorForm.reset();
      document.getElementById("repoId").value = "";
    } catch (err) {
      console.error("Error guardando repositor:", err);
      if (window.showToast)
        window.showToast("Error", "No se pudo guardar el repositor.", true);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  if (repositoresTableBody) {
    repositoresTableBody.addEventListener("click", async (e) => {
      const btnEdit = e.target.closest(".edit-repo-btn");
      const btnDel = e.target.closest(".delete-repo-btn");

      if (btnEdit) {
        const tr = btnEdit.closest("tr");
        document.getElementById("repoId").value = tr.dataset.id;
        document.getElementById("repoNombre").value = tr.dataset.nombre;
        document.getElementById("repoCelular").value = tr.dataset.celular;
        document.getElementById("repoEmpresa").value = tr.dataset.empresa;
        document.getElementById("repoMarcas").value = tr.dataset.marcas;
        document.getElementById("repoHorario").value = tr.dataset.horario;
        document.getElementById("repoSupervisor").value = tr.dataset.supervisor;
        document.getElementById("repoTelSupervisor").value =
          tr.dataset.telsupervisor;
        document.getElementById("repoEmail").value = tr.dataset.email;

        const diasCheckboxes = document.querySelectorAll(
          'input[name="repoDias"]',
        );
        diasCheckboxes.forEach((cb) => (cb.checked = false));
        if (tr.dataset.diasvisita) {
          const diasArr = tr.dataset.diasvisita.split(",").map((s) => s.trim());
          diasCheckboxes.forEach((cb) => {
            if (diasArr.includes(cb.value)) cb.checked = true;
          });
        }
      }

      if (btnDel) {
        const id = btnDel.closest("tr").dataset.id;
        if (confirm("¿Estás seguro de eliminar este repositor?")) {
          try {
            await deleteDoc(doc(db, "repositores", id));
            if (window.showToast)
              window.showToast("Repositores", "Repositor eliminado.");
          } catch (err) {
            console.error("Error eliminando repositor:", err);
            if (window.showToast)
              window.showToast(
                "Error",
                "No se pudo eliminar el repositor.",
                true,
              );
          }
        }
      }
    });
  }
}

function cargarRepositores() {
  if (unsubscribeRepositores) unsubscribeRepositores();

  const q = query(collection(db, "repositores"));
  unsubscribeRepositores = onSnapshot(q, (snap) => {
    if (!repositoresTableBody) return;
    repositoresTableBody.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const tr = document.createElement("tr");

      tr.dataset.id = docSnap.id;
      tr.dataset.nombre = data.nombre || "";
      tr.dataset.celular = data.celular || "";
      tr.dataset.empresa = data.empresa || "";
      tr.dataset.marcas = data.marcas || "";
      tr.dataset.horario = data.horario || "";
      tr.dataset.diasvisita = data.diasVisita || "";
      tr.dataset.supervisor = data.supervisor || "";
      tr.dataset.telsupervisor = data.telSupervisor || "";
      tr.dataset.email = data.email || "";

      tr.innerHTML = `
                <td>${data.nombre || "-"}</td>
                <td>${data.empresa || "-"}</td>
                <td style="white-space: nowrap;"><div style="display: flex; align-items: center; gap: 6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); flex-shrink: 0;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>${data.celular || "-"}</div></td>
                <td style="white-space: nowrap;"><div style="display: flex; align-items: center; gap: 6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${data.diasVisita || "-"}</div></td>
                <td style="white-space: nowrap;" class="repo-actions-td">
                   <button type="button" class="action-btn edit-repo-btn" title="Editar" style="background: transparent; border: none; box-shadow: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; padding: 8px;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                   </button>
                   <button type="button" class="action-btn delete-repo-btn" title="Eliminar" style="background: transparent; border: none; box-shadow: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; padding: 8px;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                   </button>
                </td>
             `;
      repositoresTableBody.appendChild(tr);
    });
  });
}

// Lógica para selección de fila con clic izquierdo
document.addEventListener("click", (e) => {
  // Ignorar clics que no sean el principal (izquierdo)
  if (e.button !== 0) return;

  const tr = e.target.closest("tr");
  if (!tr) return;

  // No interferir si el clic es en un elemento interactivo o de acción
  const interactive = e.target.closest(
    "button, input, select, textarea, a, .action-btn, [data-action]",
  );
  if (interactive) return;

  const wasSelected = tr.classList.contains("selected-row");

  // Quitar selección a cualquier otra fila
  document.querySelectorAll("tr.selected-row").forEach((row) => {
    row.classList.remove("selected-row");
  });

  // Alternar selección de la fila actual
  if (!wasSelected) {
    tr.classList.add("selected-row");
  }
});

// --- Context Menu Header (TAW / ARMADO) ---
const headerContextMenu = document.createElement("div");
headerContextMenu.id = "headerContextMenu";
headerContextMenu.innerHTML = `
      <label><input type="checkbox" id="chkTAW"> TAW</label>
      <label><input type="checkbox" id="chkARMADO"> ARMADO</label>
    `;
document.body.appendChild(headerContextMenu);

let activeHeaderDate = null;
const chkTAW = document.getElementById("chkTAW");
const chkARMADO = document.getElementById("chkARMADO");

document.getElementById("tableHeader").addEventListener("contextmenu", (e) => {
  const th = e.target.closest("th[data-header-date]");
  if (!th) return;

  e.preventDefault();
  activeHeaderDate = th.getAttribute("data-header-date");

  chkTAW.checked = state.tawDates.includes(activeHeaderDate);
  chkARMADO.checked = state.armadoDates.includes(activeHeaderDate);

  headerContextMenu.style.display = "block";
  headerContextMenu.style.left = e.pageX + "px";
  headerContextMenu.style.top = e.pageY + "px";
});

document.addEventListener("click", (e) => {
  if (!headerContextMenu.contains(e.target)) {
    headerContextMenu.style.display = "none";
  }
});

chkTAW.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.tawDates = [activeHeaderDate];
  } else {
    state.tawDates = [];
  }
  if (!isMockMode)
    setDoc(
      doc(db, "notas_globales", "tags"),
      { tawDates: state.tawDates },
      { merge: true },
    );
  renderDesktopView();
  headerContextMenu.style.display = "none";
});

chkARMADO.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.armadoDates = [activeHeaderDate];
  } else {
    state.armadoDates = [];
  }
  if (!isMockMode)
    setDoc(
      doc(db, "notas_globales", "tags"),
      { armadoDates: state.armadoDates },
      { merge: true },
    );
  renderDesktopView();
  headerContextMenu.style.display = "none";
});

