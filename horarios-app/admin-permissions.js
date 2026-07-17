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
  modificarHorario:       { label: 'Mod.<br>Horario',       icon: '✏️'  },
  imprimirPdf:            { label: 'PDF<br>Horarios',       icon: '🖨️'  },
  sugeridos:              { label: 'Ver<br>Sugeridos',      icon: '💡'  },
  modificarVacaciones:    { label: 'Reg.<br>Vacaciones',    icon: '🏖️'  },
  bajarVacaciones:        { label: 'Bajar<br>Vacac.',       icon: '⬇️'  },
  verMetricas:            { label: 'Ver<br>Métricas',       icon: '📊'  },
  // ── Claves nuevas ─────────────────────────────────────────────────────────
  exportarPdfHorarios:    { label: 'Export<br>PDF',         icon: '📄'  },
  modificarSugeridos:     { label: 'Edit<br>Sugeridos',     icon: '✍️'  },
  exportarSugeridosPdf:   { label: 'PDF<br>Sugeridos',      icon: '📑'  },
  gestionSaldos:          { label: 'Gestión<br>Saldos',     icon: '💰'  },
  exportarExcelVacaciones:{ label: 'Excel<br>Vacac.',       icon: '📊'  },
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

// =============================================================================
// 2. MIDDLEWARE DE SEGURIDAD — checkAccess(permiso, accion)
// =============================================================================
// Uso: checkAccess('modificarVacaciones')
//      checkAccess('modificarVacaciones', 'edit')

export function checkAccess(permiso, accion = 'view') {
  const role   = _getCurrentRole();
  const legajo = _getCurrentLegajo();

  if (role === 'admin') return true;

  if (role === 'invitado') {
    const entry = _state.permisosInvitado?.[legajo];

    if (!entry || entry.activo === false) {
      _showToast('Acceso denegado', 'Tu cuenta de invitado está inactiva. Contacta al Administrador.');
      return false;
    }

    // Firebase almacena los permisos como claves con punto literal: "permisos.modificarHorario"
    // Si la acción es 'view' o 'edit', basta con que el permiso esté en true.
    // Se puede extender 'accion' para lógica diferenciada por tipo de operación.
    const permitido = entry?.['permisos.' + permiso] === true;
    if (permitido) return true;

    _showToast('Acceso denegado', 'No tenés permiso para esta acción. Contactá al Administrador.');
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

  // ── Las PESTAÑAS siempre son visibles para el invitado. ─────────────────────
  // Solo los BOTONES DE ACCIÓN dentro de cada sección se controlan aquí.

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
      '<h3 style="margin:0;color:var(--primary);font-size:1rem;">👥 Gestión de Invitados</h3>' +
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
    modificarHorario:       { label: 'Mod.<br>Horario',    icon: '✏️' },
    imprimirPdf:            { label: 'PDF<br>Horarios',    icon: '🖨️' },
    sugeridos:              { label: 'Ver<br>Sugeridos',   icon: '💡' },
    modificarVacaciones:    { label: 'Reg.<br>Vacac.',     icon: '🏖️' },
    bajarVacaciones:        { label: 'Bajar<br>Vacac.',    icon: '⬇️' },
    verMetricas:            { label: 'Ver<br>Métricas',    icon: '📊' },
    exportarPdfHorarios:    { label: 'Export<br>PDF',      icon: '📄' },
    modificarSugeridos:     { label: 'Edit<br>Suger.',     icon: '✍️' },
    exportarSugeridosPdf:   { label: 'PDF<br>Suger.',      icon: '📑' },
    gestionSaldos:          { label: 'Gestión<br>Saldos',  icon: '💰' },
    exportarExcelVacaciones:{ label: 'Excel<br>Vacac.',    icon: '📊' },
    gestionarEventos:       { label: 'Gestionar<br>Eventos', icon: '📅' },
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
