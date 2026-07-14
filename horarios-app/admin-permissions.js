// =============================================================================
// admin-permissions.js — Módulo de Gestión de Permisos por Rol
// Crew App · Panel de Administración
// =============================================================================
// Este módulo se inicializa desde el <script type="module"> principal de
// index.html llamando a: initPermissionsModule({ db, state, ... })
// =============================================================================

// ─── ETIQUETAS LEGIBLES DE PERMISOS ──────────────────────────────────────────
export const PERMISOS_META = {
  modificarHorario:    { label: 'Mod. Horario',    icon: '✏️'  },
  imprimirPdf:         { label: 'Imprimir PDF',     icon: '🖨️'  },
  modificarVacaciones: { label: 'Mod. Vacaciones',  icon: '🏖️'  },
  verMetricas:         { label: 'Ver Métricas',     icon: '📊'  },
  sugeridos:           { label: 'Sugeridos',         icon: '💡'  },
  bajarVacaciones:     { label: 'Bajar Vacaciones', icon: '⬇️'  },
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
    const snap = await _getDocs(_collection(_db, 'permisos_invitados'));
    snap.forEach(d => {
      _state.permisosInvitado[d.id] = d.data();
    });
  } catch (err) {
    console.error('[Permisos] Error cargando permisos de invitados:', err);
  }
}

export async function loadPermisosInvitado(legajo) {
  if (_isMockMode || !_db) return null;
  try {
    const ref  = _doc(_db, 'permisos_invitados', legajo);
    const snap = await _getDoc(ref);
    if (snap.exists()) {
      _state.permisosInvitado[legajo] = snap.data();
      return snap.data();
    }
    return null;
  } catch (err) {
    console.error('[Permisos] Error cargando permisos de ' + legajo + ':', err);
    return null;
  }
}

// =============================================================================
// 2. MIDDLEWARE DE SEGURIDAD — checkAccess(permiso)
// =============================================================================

export function checkAccess(permiso) {
  const role   = _getCurrentRole();
  const legajo = _getCurrentLegajo();

  if (role === 'admin') return true;

  if (role === 'invitado') {
    const entry = _state.permisosInvitado?.[legajo];

    if (!entry || entry.activo === false) {
      _showToast('Acceso denegado', 'Tu cuenta de invitado está inactiva. Contacta al Administrador.');
      return false;
    }

    const perms = entry.permisos || {};
    if (perms[permiso] === true) return true;

    _showToast('Acceso denegado', 'No tenés permiso para esta acción. Contactá al Administrador.');
    return false;
  }

  return true;
}

// =============================================================================
// 3. ACTUALIZACIÓN DE PERMISOS EN FIREBASE
// =============================================================================

export async function updatePermission(legajo, permiso, valor) {
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
    console.log('[Permisos MOCK] updatePermission(' + legajo + ', ' + permiso + ', ' + valor + ')');
    return;
  }

  try {
    const ref = _doc(_db, 'permisos_invitados', legajo);
    const updateData = permiso === 'activo'
      ? { activo: valor }
      : { ['permisos.' + permiso]: valor };
    await _setDoc(ref, updateData, { merge: true });
  } catch (err) {
    console.error('[Permisos] Error guardando permiso:', err);
    _showToast('Error', 'No se pudo guardar el permiso en la base de datos.');
  }
}

export async function crearInvitado(legajo) {
  const nuevoDoc = {
    activo: true,
    permisos: {
      modificarHorario:    false,
      imprimirPdf:         false,
      modificarVacaciones: false,
      verMetricas:         false,
      sugeridos:           false,
      bajarVacaciones:     false,
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
// 4. RESTRICCIONES DE UI — applyUIRestrictions()
// =============================================================================

export function applyUIRestrictions() {
  const role   = _getCurrentRole();
  const legajo = _getCurrentLegajo();

  const backupBtn   = document.getElementById('backupDriveBtn');
  const bellBtn     = document.getElementById('auditBellBtn');

  if (role === 'admin') return; // checkLogin() ya gestiona todo para admin

  // Para cualquier rol que no sea admin: ocultar controles exclusivos de admin
  if (backupBtn) backupBtn.style.display = 'none';
  if (bellBtn)   bellBtn.style.display   = 'none';

  if (role !== 'invitado') return;

  // ── Restricciones granulares para invitados ──────────────────────────────
  const entry = _state.permisosInvitado?.[legajo];
  const perms = entry?.permisos || {};

  // imprimirPdf
  const pdfBtn = document.getElementById('pdfBtn');
  if (pdfBtn) pdfBtn.style.display = perms.imprimirPdf ? 'inline-flex' : 'none';

  // verMetricas
  const metricsTab = document.getElementById('metricsTabBtn');
  if (metricsTab) metricsTab.style.display = perms.verMetricas ? 'inline-block' : 'none';

  // sugeridos
  const sugeridosTab = document.getElementById('suggestedTabBtn');
  if (sugeridosTab) sugeridosTab.style.display = perms.sugeridos ? 'inline-block' : 'none';

  // modificarVacaciones / bajarVacaciones
  const vacTab = document.getElementById('vacationTabBtn');
  if (vacTab) {
    vacTab.style.display = (perms.modificarVacaciones || perms.bajarVacaciones) ? 'inline-block' : 'none';
  }

  // modificarHorario
  document.querySelectorAll('.cell-input').forEach(input => {
    if (!perms.modificarHorario) {
      input.setAttribute('readonly', 'true');
      input.style.cursor = 'not-allowed';
    } else {
      input.removeAttribute('readonly');
      input.style.cursor = '';
    }
  });
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

  // Cargar permisos actuales desde Firebase para los 5 invitados fijos
  await loadAllPermisosInvitados();

  const wrapper = container.querySelector('#invitadosTableWrapper');

  const PERMISO_KEYS_LOCAL = ['modificarHorario','imprimirPdf','modificarVacaciones','verMetricas','sugeridos','bajarVacaciones'];
  const PERMISOS_META_LOCAL = {
    modificarHorario:    { label: 'Mod.<br>Horario',   icon: '✏️' },
    imprimirPdf:         { label: 'Impr.<br>PDF',       icon: '🖨️' },
    modificarVacaciones: { label: 'Mod.<br>Vacac.',     icon: '🏖️' },
    verMetricas:         { label: 'Ver<br>Métricas',    icon: '📊' },
    sugeridos:           { label: 'Sugeridos',           icon: '💡' },
    bajarVacaciones:     { label: 'Bajar<br>Vacac.',    icon: '⬇️' },
  };

  const headerCells = PERMISO_KEYS_LOCAL.map(key =>
    '<th title="' + PERMISOS_META_LOCAL[key].label.replace(/<br>/g," ") + '"' +
    ' style="padding:0.5rem 0.4rem;font-size:0.62rem;font-weight:600;color:var(--text-muted);text-align:center;white-space:nowrap;line-height:1.3;">' +
    PERMISOS_META_LOCAL[key].icon + '<br>' + PERMISOS_META_LOCAL[key].label + '</th>'
  ).join('');

  // ── Iterar la lista FIJA de los 5 invitados autorizados ──────────────────
  let rows = '';
  Object.entries(INVITADOS_AUTORIZADOS).forEach(([leg, nombre]) => {
    const entry  = _state.permisosInvitado?.[leg];
    const activo = entry?.activo ?? false;
    const perms  = entry?.permisos || {};

    const rowBg = activo
      ? 'background:rgba(59,130,246,0.07);'
      : 'opacity:0.52;';

    const permisosCells = PERMISO_KEYS_LOCAL.map(key => {
      const chk = perms[key] ? 'checked' : '';
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
    '<th style="padding:0.5rem 0.6rem;text-align:left;font-size:0.68rem;color:var(--text-muted);font-weight:600;">LEGAJO</th>' +
    '<th style="padding:0.5rem 0.6rem;text-align:left;font-size:0.68rem;color:var(--text-muted);font-weight:600;">NOMBRE</th>' +
    '<th style="padding:0.5rem 0.6rem;text-align:center;font-size:0.68rem;color:var(--text-muted);font-weight:600;">ESTADO</th>' +
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
