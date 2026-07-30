// =============================================================================
// admin-permissions.js — Módulo de Gestión de Permisos por Rol
// Crew App · Panel de Administración
// =============================================================================
// Este módulo se inicializa desde el <script type="module"> principal de
// index.html llamando a: initPermissionsModule({ db, state, ... })
// =============================================================================

// ─── ETIQUETAS LEGIBLES DE PERMISOS ──────────────────────────────────────────
export const PERMISOS_META = {
  // ── Claves originales (backward compat) ─────────────────────────────────
  modificarHorario:       { label: 'Mod.<br>Horario',       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>'  },
  imprimirPdf:            { label: 'PDF<br>Horarios',       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>'  },
  sugeridos:              { label: 'Ver<br>Sugeridos',      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2v1"></path><path d="M12 7a5 5 0 0 0-5 5c0 2 1.5 3 2 4.5l1 1.5h4l1-1.5c.5-1.5 2-2.5 2-4.5a5 5 0 0 0-5-5z"></path></svg>'  },
  modificarVacaciones:    { label: 'Reg.<br>Vacaciones',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path><circle cx="12" cy="12" r="4"></circle></svg>'  },
  bajarVacaciones:        { label: 'Bajar<br>Vacac.',       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>'  },
  verMetricas:            { label: 'Ver<br>Métricas',       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>'  },
  // ── Claves nuevas ─────────────────────────────────────────────────────────
  exportarPdfHorarios:    { label: 'Export<br>PDF',         icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'  },
  modificarSugeridos:     { label: 'Edit<br>Sugeridos',     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>'  },
  exportarSugeridosPdf:   { label: 'PDF<br>Sugeridos',      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'  },
  gestionSaldos:          { label: 'Gestión<br>Saldos',     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><line x1="12" y1="18" x2="12" y2="22"></line><line x1="12" y1="2" x2="12" y2="6"></line></svg>'  },
  exportarExcelVacaciones:{ label: 'Excel<br>Vacac.',       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>'  },
};

export const PERMISO_KEYS = Object.keys(PERMISOS_META);

// ─── LISTA FIJA DE INVITADOS AUTORIZADOS ─────────────────────────────────────
// Estos son los únicos 5 legajos que pueden acceder como rol 'invitado'.
// La detección del rol en el login se basa en esta lista, no en Firebase.
export const INVITADOS_AUTORIZADOS = {
  '10021755': 'Salazar Torres Carmen Elena',
  '10021393': 'Bazan Rodolfo Fabian',
  '10021701': 'Vargas Chirino Mauro Javier',
  '10036476': 'Guidet Fredes Maria Laura',
  '10045541': 'Diaz Daiana Maillen',
};

// ─── ESTADO INTERNO DEL MÓDULO ───────────────────────────────────────────────
let _db              = null;
let _state           = null;
let _isMockMode      = false;
let _showToast       = null;
let _getCurrentRole  = null;
let _getCurrentLegajo= null;
let _setDoc          = null;
let _doc             = null;
let _getDoc          = null;
let _getDocs         = null;
let _collection      = null;

// ─── INICIALIZACIÓN ───────────────────────────────────────────────────────────
export function initPermissionsModule(deps) {
  _db              = deps.db;
  _state           = deps.state;
  _isMockMode      = deps.isMockMode;
  _showToast       = deps.showToast;
  _getCurrentRole  = deps.getCurrentRole;
  _getCurrentLegajo= deps.getCurrentLegajo;
  _setDoc          = deps.setDoc;
  _doc             = deps.doc;
  _getDoc          = deps.getDoc;
  _getDocs         = deps.getDocs;
  _collection      = deps.collection;
}

// =============================================================================
// 1. ESTRUCTURA DE DATOS — Colección Firebase: permisos_invitados
// =============================================================================

export async function loadAllPermisosInvitados() {
  if (_isMockMode || !_db) return;
  try {
    // 2. LECTURA EN APERTURA: Limpiamos la caché primero para forzar la actualización con los datos reales
    _state.permisosInvitado = {};
    const snap = await _getDocs(_collection(_db, 'permisos_invitados'));
    snap.forEach(d => {
      _state.permisosInvitado[d.id] = d.data();
    });
  } catch (err) {
    console.error('[Permisos] Error cargando permisos de invitados:', err);
  }
}

export async function loadPermisosInvitado(legajoRaw) {
  if (_isMockMode || !_db) return null;

  // 1. Verificación de seguridad: si no viene el legajo, abortamos.
  const legajo = legajoRaw ? String(legajoRaw).trim() : null;
  if (!legajo) {
    console.error('[Permisos] Error: No se recibió un legajo para cargar.');
    return null;
  }

  try {
    const ref  = _doc(_db, 'permisos_invitados', legajo);
    const snap = await _getDoc(ref);

    if (snap.exists()) {
      _state.permisosInvitado[legajo] = snap.data();
      _state.currentInvitadoLegajo = legajo;

      console.log('Datos cargados. Forzando actualización...');
      syncPermissionsUI('invitado', legajo);

      return snap.data();
    } else {
      console.warn('[Permisos] No existe documento para el legajo:', legajo);
      return null;
    }
  } catch (err) {
    console.error('[Permisos] Error crítico en loadPermisosInvitado:', err);
    return null;
  }
}

export function checkAccess(permiso) {
  const role   = _getCurrentRole();
  const legajo = _getCurrentLegajo();

  if (role === 'visitor') return false;
  if (role === 'admin') return true;

  if (role === 'invitado') {
    const entry = _state.permisosInvitado?.[legajo];
    if (!entry || entry.activo === false) return false;

    const permitido = entry?.['permisos.' + permiso] === true || entry?.permisos?.[permiso] === true;
    if (permitido) return true;
    return false;
  }

  return true;
}

// =============================================================================
// 3. ACTUALIZACIÓN DE PERMISOS EN FIREBASE
// =============================================================================

export async function updatePermission(legajoRaw, permiso, valor) {
  const legajo = String(legajoRaw).trim(); // DEBUG: 4. Asegurar string exacto

  // Actualizar caché local
  if (!_state.permisosInvitado[legajo]) {
    _state.permisosInvitado[legajo] = { activo: false, permisos: {} };
  }

  if (permiso === 'activo') {
    _state.permisosInvitado[legajo].activo = valor;
  } else {
    if (!_state.permisosInvitado[legajo].permisos) {
      _state.permisosInvitado[legajo].permisos = {};
    }
    _state.permisosInvitado[legajo].permisos[permiso] = valor;
  }

  if (_isMockMode || !_db) {
    console.log(`[Permisos MOCK] updatePermission(${legajo}, ${permiso}, ${valor})`);
    return;
  }

  // DEBUG: 1. Escritura robusta en Firebase
  try {
    const docRef = _doc(_db, 'permisos_invitados', legajo);
    // Usamos merge: true y notación de punto para campos anidados
    const updateData = permiso === 'activo'
      ? { activo: valor }
      : { [`permisos.${permiso}`]: valor };
      
    await _setDoc(docRef, updateData, { merge: true });
    console.log(`Permiso '${permiso}' guardado para legajo ${legajo}: ${valor}`);
    
    // 2. LLAMADA POST-GUARDADO: Sincronizar UI instantáneamente
    syncPermissionsUI();
    
  } catch (e) {
    console.error("Error al guardar permiso:", e);
    alert("Error al guardar en Firebase, revisá la consola.");
    _showToast('Error', 'No se pudo guardar el permiso en la base de datos.');
  }
}

export async function crearInvitado(legajo) {
  const nuevoDoc = {
    activo: true,
    permisos: {
      modificarHorario:    false,
      imprimirPdf:         false,
      exportarPdfHorarios: false,
      sugeridos:           false,
      modificarSugeridos:  false,
      exportarSugeridosPdf:false,
      modificarVacaciones: false,
      bajarVacaciones:     false,
      exportarExcelVacaciones: false,
      gestionSaldos:       false,
      gestionarEventos:    false,
    }
  };
  _state.permisosInvitado[legajo] = nuevoDoc;
  if (_isMockMode || !_db) { console.log('[Permisos MOCK] crearInvitado(' + legajo + ')'); return; }
  try {
    await _setDoc(_doc(_db, 'permisos_invitados', legajo), nuevoDoc, { merge: true });
  } catch (err) {
    console.error('[Permisos] Error creando invitado:', err);
    _showToast('Error', 'No se pudo registrar el invitado.');
  }
}

// =============================================================================
// 4. RESTRICCIONES DE UI — syncPermissionsUI()
// =============================================================================

export function syncPermissionsUI(forcedRole, forcedLegajo) {
  const role   = forcedRole || _getCurrentRole();
  const legajo = forcedLegajo || _getCurrentLegajo();

  console.log("Sync UI intentando ejecutar para:", legajo);
  if (!legajo) return;

  const backupBtn = document.getElementById('backupDriveBtn');
  const bellBtn   = document.getElementById('auditBellBtn');

  if (role === 'admin') return; // checkLogin() ya gestiona todo para admin

  // Para cualquier rol que no sea admin: ocultar controles exclusivos de admin
  if (backupBtn) backupBtn.style.display = 'none';
  if (bellBtn)   bellBtn.style.display   = 'none';

  if (role !== 'invitado') return;

  // Firebase almacena los permisos con claves de punto literal al usar setDoc con merge:
  // { "permisos.verMetricas": true } — no como objeto anidado.
  // También soportamos la lectura del objeto anidado clásico para backward compat.
  const docData = _state.permisosInvitado?.[legajo];
  if (!docData) return;

  // Helper: lee la clave en formato plano (Firebase merge) o anidado (legacy)
  const get = (key) => docData['permisos.' + key] === true || docData?.permisos?.[key] === true;

  // ── PESTAÑAS (TABS) - Visibilidad y Redirección ─────────────────────────
  const canSeeVacaciones = get('modificarVacaciones') || get('bajarVacaciones') || get('exportarExcelVacaciones') || get('gestionSaldos');
  const vacationTabBtn = document.getElementById('vacationTabBtn');
  if (vacationTabBtn) vacationTabBtn.style.setProperty('display', canSeeVacaciones ? 'inline-block' : 'none', 'important');

  const canSeeSugeridos = get('sugeridos') || get('modificarSugeridos') || get('exportarSugeridosPdf');
  const suggestedTabBtn = document.getElementById('suggestedTabBtn');
  if (suggestedTabBtn) suggestedTabBtn.style.setProperty('display', canSeeSugeridos ? 'inline-block' : 'none', 'important');

  const canSeeMetrics = get('verMetricas');
  const metricsTabBtn = document.getElementById('metricsTabBtn');
  if (metricsTabBtn) metricsTabBtn.style.setProperty('display', canSeeMetrics ? 'inline-block' : 'none', 'important');

  // Redirigir si está en una pestaña sin permisos
  const activeSectionId = document.querySelector('.app-section.active')?.id;
  if (!canSeeVacaciones && activeSectionId === 'vacacionesSection') window.switchTab('semanal');
  if (!canSeeSugeridos && activeSectionId === 'sugeridosSection') window.switchTab('semanal');
  if (!canSeeMetrics && activeSectionId === 'metricsSection') window.switchTab('semanal');

  // ── BOTONES DE ACCIÓN ─────────────────────────────────────────────────────

  // Grid Semanal — PDF
  const pdfBtn = document.getElementById('pdfBtn');
  if (pdfBtn) pdfBtn.style.setProperty('display', get('imprimirPdf') || get('exportarPdfHorarios') ? 'inline-flex' : 'none', 'important');

  // Sugeridos — PDF
  const pdfSugeridosBtn = document.getElementById('pdfSugeridosBtn');
  if (pdfSugeridosBtn) pdfSugeridosBtn.style.setProperty('display', get('sugeridos') || get('exportarSugeridosPdf') ? 'inline-flex' : 'none', 'important');

  // Vacaciones — Guardar Periodo
  const vSubmitBtn = document.getElementById('vSubmitBtn');
  if (vSubmitBtn) vSubmitBtn.style.setProperty('display', get('modificarVacaciones') ? '' : 'none', 'important');

  // Vacaciones — Exportar Excel
  const vExportExcelBtn = document.getElementById('vExportExcelBtn');
  if (vExportExcelBtn) vExportExcelBtn.style.setProperty('display', get('exportarExcelVacaciones') || get('bajarVacaciones') ? '' : 'none', 'important');

  // Gestión de Saldos: inputs readonly si no tiene permiso
  const saldosContainer = document.getElementById('saldosVacacionesContainer');
  if (saldosContainer) {
    const canEditSaldos = get('gestionSaldos');
    saldosContainer.querySelectorAll('.saldo-tipo, .saldo-asignados').forEach(el => {
      el.disabled = !canEditSaldos;
      el.style.setProperty('pointer-events', canEditSaldos ? '' : 'none', 'important');
      el.style.opacity = canEditSaldos ? '' : '0.45';
    });
  }

  // Sugeridos: textareas readonly si no tiene permiso modificarSugeridos
  const canEditSugeridos = get('modificarSugeridos') || get('sugeridos');
  document.querySelectorAll('.sugeridos-comment').forEach(ta => {
    if (!canEditSugeridos) {
      ta.setAttribute('readonly', 'true');
      ta.style.setProperty('pointer-events', 'none', 'important');
      ta.style.opacity = '0.45';
    } else {
      ta.removeAttribute('readonly');
      ta.style.removeProperty('pointer-events');
      ta.style.opacity = '';
    }
  });

  // Grid Semanal: inputs readonly si no tiene permiso modificarHorario
  document.querySelectorAll('.cell-input').forEach(input => {
    if (!get('modificarHorario')) {
      input.setAttribute('readonly', 'true');
      input.style.setProperty('cursor', 'not-allowed', 'important');
    } else {
      input.removeAttribute('readonly');
      input.style.cursor = '';
    }
  });

  // Botón Eventos: solo visible si tiene permiso gestionarEventos
  const eventosBtn = document.getElementById('eventosNavBtn');
  if (eventosBtn) eventosBtn.style.display = get('gestionarEventos') ? 'flex' : 'none';
}


// =============================================================================
// 5. RENDERIZADO DE "GESTIÓN DE INVITADOS" EN EL configModal
// =============================================================================

export async function renderGestionInvitados(container) {
  if (!container) return;

  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;flex-wrap:wrap;">' +
      '<h3 style="margin:0;color:var(--primary);font-size:1rem;display:flex;align-items:center;gap:6px;">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>' +
      'Gestión de Invitados</h3>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">Accesos con permisos configurables. Los cambios se guardan instantáneamente en Firebase.</span>' +
    '</div>' +
    '<div id="invitadosTableWrapper">' +
      '<div style="display:flex;align-items:center;gap:0.5rem;color:var(--text-muted);font-size:0.85rem;padding:1rem 0;">' +
        '<span>⏳</span><span>Cargando permisos...</span>' +
      '</div>' +
    '</div>';

  await loadAllPermisosInvitados();

  const wrapper = container.querySelector('#invitadosTableWrapper');

  const PERMISO_KEYS_LOCAL = [
    'modificarHorario', 'imprimirPdf', 'sugeridos',
    'modificarVacaciones', 'bajarVacaciones', 'verMetricas',
    'exportarPdfHorarios', 'modificarSugeridos', 'exportarSugeridosPdf',
    'gestionSaldos', 'exportarExcelVacaciones', 'gestionarEventos',
  ];
  const PERMISOS_META_LOCAL = {
    modificarHorario:       { label: 'Mod.<br>Horario',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>' },
    imprimirPdf:            { label: 'PDF<br>Horarios',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>' },
    sugeridos:              { label: 'Ver<br>Sugeridos',   icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2v1"></path><path d="M12 7a5 5 0 0 0-5 5c0 2 1.5 3 2 4.5l1 1.5h4l1-1.5c.5-1.5 2-2.5 2-4.5a5 5 0 0 0-5-5z"></path></svg>' },
    modificarVacaciones:    { label: 'Reg.<br>Vacac.',     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path><circle cx="12" cy="12" r="4"></circle></svg>' },
    bajarVacaciones:        { label: 'Bajar<br>Vacac.',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' },
    verMetricas:            { label: 'Ver<br>Métricas',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>' },
    exportarPdfHorarios:    { label: 'Export<br>PDF',      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>' },
    modificarSugeridos:     { label: 'Edit<br>Suger.',     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>' },
    exportarSugeridosPdf:   { label: 'PDF<br>Suger.',      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>' },
    gestionSaldos:          { label: 'Gestión<br>Saldos',  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><line x1="12" y1="18" x2="12" y2="22"></line><line x1="12" y1="2" x2="12" y2="6"></line></svg>' },
    exportarExcelVacaciones:{ label: 'Excel<br>Vacac.',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>' },
    gestionarEventos:       { label: 'Gestionar<br>Eventos', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>' },
  };

  const headerCells = PERMISO_KEYS_LOCAL.map(key =>
    '<th title="' + PERMISOS_META_LOCAL[key].label.replace(/<br>/g," ") + '"' +
    ' style="padding:0.5rem 0.4rem;font-size:0.62rem;font-weight:600;color:var(--text-muted);text-align:center;white-space:nowrap;line-height:1.3;">' +
    PERMISOS_META_LOCAL[key].icon + '<br>' + PERMISOS_META_LOCAL[key].label + '</th>'
  ).join('');

  let rows = '';
  Object.entries(INVITADOS_AUTORIZADOS).forEach(([leg, nombre]) => {
    const entry  = _state.permisosInvitado?.[leg];
    const activo = entry?.activo ?? false;
    // Firebase almacena los permisos como claves con punto literal: "permisos.verMetricas"
    // NO como objeto anidado, por eso accedemos con bracket notation.

    const rowBg = activo
      ? 'background:rgba(59,130,246,0.07);'
      : 'opacity:0.52;';

    const permisosCells = PERMISO_KEYS_LOCAL.map(key => {
      const isChecked = entry?.['permisos.' + key] === true || entry?.permisos?.[key] === true;
      const chk = isChecked ? 'checked' : '';
      const dis = activo ? '' : 'disabled';
      return '<td style="text-align:center;padding:0.45rem 0.25rem;">' +
        '<input type="checkbox" class="perm-checkbox"' +
        ' data-legajo="' + leg + '" data-permiso="' + key + '"' +
        ' ' + chk + ' ' + dis +
        ' onchange="window.updatePermissionUI(this)"' +
        ' style="width:15px;height:15px;accent-color:var(--primary);cursor:' + (activo ? 'pointer' : 'not-allowed') + ';">' +
        '</td>';
    }).join('');

    rows +=
      '<tr id="inv-row-' + leg + '" style="border-bottom:1px solid var(--border);transition:all 0.25s;' + rowBg + '">' +
        '<td style="padding:0.5rem 0.6rem;font-size:0.72rem;font-weight:700;color:var(--text-muted);white-space:nowrap;font-family:monospace;">' + leg + '</td>' +
        '<td style="padding:0.5rem 0.6rem;font-size:0.82rem;white-space:nowrap;font-weight:500;">' + nombre + '</td>' +
        '<td style="padding:0.5rem 0.6rem;text-align:center;">' +
          '<label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.72rem;">' +
            '<input type="checkbox" class="activo-checkbox" data-legajo="' + leg + '"' +
            ' ' + (activo ? 'checked' : '') +
            ' onchange="window.toggleInvitadoActivo(this)"' +
            ' style="width:15px;height:15px;accent-color:var(--success);cursor:pointer;">' +
            '<span style="font-weight:600;color:' + (activo ? 'var(--success)' : 'var(--text-muted)') + ';">' +
              (activo ? '● Activo' : '○ Inactivo') +
            '</span>' +
          '</label>' +
        '</td>' +
        permisosCells +
      '</tr>';
  });

  wrapper.innerHTML =
    '<div style="overflow-x:auto;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
    '<thead>' +
    '<tr style="border-bottom:2px solid var(--border);">' +
    '<th style="text-align:left;padding:0.5rem 0.6rem;width:80px;font-size:0.62rem;text-transform:uppercase;color:var(--text-muted);">Legajo</th>' +
    '<th style="text-align:left;padding:0.5rem 0.6rem;width:180px;font-size:0.62rem;text-transform:uppercase;color:var(--text-muted);">Nombre</th>' +
    '<th style="text-align:center;padding:0.5rem 0.6rem;width:100px;font-size:0.62rem;text-transform:uppercase;color:var(--text-muted);">Estado</th>' +
    headerCells +
    '</tr>' +
    '</thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '</div>';
}

// ─── Handlers globales para los checkboxes inline ────────────────────────────

window.toggleInvitadoActivo = async function(checkbox) {
  const legajo = checkbox.dataset.legajo;
  const valor  = checkbox.checked;
  await updatePermission(legajo, 'activo', valor);

  const row = document.getElementById('inv-row-' + legajo);
  if (!row) return;
  const label = checkbox.closest('label');
  if (label) {
    const span = label.querySelector('span');
    if (span) {
      span.textContent = valor ? 'Activo' : 'Inactivo';
      span.style.color = valor ? 'var(--success)' : 'var(--text-muted)';
    }
  }
  row.style.opacity    = valor ? '1'    : '0.5';
  row.style.background = valor ? 'rgba(59,130,246,0.07)' : '';
  row.querySelectorAll('.perm-checkbox').forEach(cb => {
    cb.disabled    = !valor;
    cb.style.cursor= valor ? 'pointer' : 'not-allowed';
  });
};

window.updatePermissionUI = async function(checkbox) {
  const legajo  = checkbox.dataset.legajo;
  const permiso = checkbox.dataset.permiso;
  const valor   = checkbox.checked;
  await updatePermission(legajo, permiso, valor);
};
