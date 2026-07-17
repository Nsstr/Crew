const fs = require('fs');

function applyInjections() {
  let code = fs.readFileSync('index.html', 'utf8');
  // Normalizar los saltos de línea para que los replaces funcionen.
  code = code.replace(/\r\n/g, '\n');

  // 1. Añadir requireAuth
  code = code.replace(
    'let currentInvitadoLegajo = null;',
    `let currentInvitadoLegajo = null;\n\n    // Helper de seguridad global: bloquea operaciones de escritura si no hay sesión\n    function requireAuth() {\n      if (currentRole === 'visitor') {\n        showToast("Acceso denegado", "Inicia sesión para editar esta información", "warning");\n        return false;\n      }\n      return true;\n    }`
  );

  // 2. handleInputChange
  code = code.replace(
    '      if (!isMockMode) {\n        try {\n          const docId = `${collabId}_${dateStr}`;',
    '      if (!isMockMode) {\n        if (!requireAuth()) {\n          input.value = oldValue;\n          return;\n        }\n        try {\n          const docId = `${collabId}_${dateStr}`;'
  );

  // 3. saveCollab
  code = code.replace(
    '      // Guardar en Firebase\n      if (!isMockMode) {',
    '      // Guardar en Firebase\n      if (!requireAuth()) return;\n      if (!isMockMode) {'
  );

  // 4. deleteCollab
  code = code.replace(
    '    window.deleteCollab = async function(id) {\n      if (!confirm(\'¿Seguro que deseas eliminar al colaborador \' + id + \'?\')) return;',
    '    window.deleteCollab = async function(id) {\n      if (!requireAuth()) return;\n      if (!confirm(\'¿Seguro que deseas eliminar al colaborador \' + id + \'?\')) return;'
  );

  // 5. saveVacation
  code = code.replace(
    '       if (!isMockMode) {\n          try {\n             const batch = writeBatch(db);',
    '       if (!requireAuth()) return;\n       if (!isMockMode) {\n          try {\n             const batch = writeBatch(db);'
  );

  // 6. deleteVacation
  code = code.replace(
    '    window.deleteVacation = async function(id) {\n       if (!confirm("¿Eliminar este periodo de vacaciones?")) return;',
    '    window.deleteVacation = async function(id) {\n       if (!requireAuth()) return;\n       if (!confirm("¿Eliminar este periodo de vacaciones?")) return;'
  );

  // 7. autoSaveSaldos
  code = code.replace(
    '    async function autoSaveSaldos(collabId) {\n       // MIDDLEWARE: Verificar permiso antes de escribir saldos\n       if (!checkAccess(\'gestionSaldos\')) return;\n       const collab = state.collaborators.find(c => c.id === collabId);',
    '    async function autoSaveSaldos(collabId) {\n       // MIDDLEWARE: Verificar permiso antes de escribir saldos\n       if (!requireAuth()) return;\n       if (!checkAccess(\'gestionSaldos\')) return;\n       const collab = state.collaborators.find(c => c.id === collabId);'
  );

  // 8. deleteCellComment
  code = code.replace(
    '    window.deleteCellComment = async function() {\n       document.getElementById(\'cellCommentInput\').value = \'\';',
    '    window.deleteCellComment = async function() {\n       if (!requireAuth()) return;\n       document.getElementById(\'cellCommentInput\').value = \'\';'
  );

  // 9. cellFixedInput
  code = code.replace(
    '    document.getElementById(\'cellFixedInput\').addEventListener(\'change\', async (e) => {\n       if (!currentContextCell) return;',
    '    document.getElementById(\'cellFixedInput\').addEventListener(\'change\', async (e) => {\n       if (!requireAuth()) { e.target.checked = !e.target.checked; return; }\n       if (!currentContextCell) return;'
  );

  // 10. autoSaveContextMenu
  code = code.replace(
    '    async function autoSaveContextMenu() {\n       if (!currentContextCell) return;',
    '    async function autoSaveContextMenu() {\n       if (!requireAuth()) return false;\n       if (!currentContextCell) return;'
  );

  // 11. cellInventarioInput
  code = code.replace(
    '    // Listener para marcar/desmarcar Inventario\n    document.getElementById(\'cellInventarioInput\').addEventListener(\'change\', async (e) => {\n      if (!currentContextCell) return;',
    '    // Listener para marcar/desmarcar Inventario\n    document.getElementById(\'cellInventarioInput\').addEventListener(\'change\', async (e) => {\n      if (!requireAuth()) {\n        e.target.checked = !e.target.checked;\n        return;\n      }\n      if (!currentContextCell) return;'
  );

  // 12. logAudit
  code = code.replace(
    '    window.logAudit = async function(action, collabId, targetDate, oldValue, newValue) {\n       if (isMockMode) return;',
    '    window.logAudit = async function(action, collabId, targetDate, oldValue, newValue) {\n       if (!requireAuth()) return;\n       if (isMockMode) return;'
  );

  // 13. saveEvento
  code = code.replace(
    '    window.saveEvento = async function() {\n      if (!checkAccess(\'gestionarEventos\')) return;',
    '    window.saveEvento = async function() {\n      if (!requireAuth()) return;\n      if (!checkAccess(\'gestionarEventos\')) return;'
  );

  // 14. deleteEvento
  code = code.replace(
    '    window.deleteEvento = async function(fecha) {\n      if (!checkAccess(\'gestionarEventos\')) return;',
    '    window.deleteEvento = async function(fecha) {\n      if (!requireAuth()) return;\n      if (!checkAccess(\'gestionarEventos\')) return;'
  );

  // 15. registrarLogActividad
  code = code.replace(
    '    window.registrarLogActividad = async function(collabId, targetDate, oldValue, newValue) {\n       if (isMockMode || !db) return;',
    '    window.registrarLogActividad = async function(collabId, targetDate, oldValue, newValue) {\n       if (!requireAuth()) return;\n       if (isMockMode || !db) return;'
  );

  // 16. sugerencias autoSave (hay dos lugares donde verifica isMockMode)
  // El blur del textarea:
  code = code.replace(
    '                 // Guardar en firebase\n                 if (!isMockMode) {',
    '                 // Guardar en firebase\n                 if (!requireAuth()) return;\n                 if (!isMockMode) {'
  );

  // El blur del notasGlobales:
  code = code.replace(
    '          if (!isMockMode) {\n             try {\n                 const dateVal = e.target.dataset.date;',
    '          if (!requireAuth()) return;\n          if (!isMockMode) {\n             try {\n                 const dateVal = e.target.dataset.date;'
  );

  // Convertir de nuevo a CRLF para Windows si se desea, o dejar en LF. 
  // Lo dejamos en LF, git se encarga.
  fs.writeFileSync('index.html', code);
  console.log('Injections done successfully');
}

applyInjections();
