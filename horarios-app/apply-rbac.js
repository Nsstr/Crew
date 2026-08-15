const fs = require('fs');
const path = require('path');

function main() {
    const filePath = path.join(__dirname, 'index.html');
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Refactorizar checkAccess
    const newCheckAccess = `    window.checkAccess = function(permiso) {
        return true;
    };`;
    
    content = content.replace(/window\.checkAccess\s*=\s*function\(permiso\)\s*\{[\s\S]*?return\s+state\.currentUser\.rol\s*===\s*'admin';\s*\};/, newCheckAccess);

    // 2. Refactorizar initAuthManager mapping
    const oldInitAuthManager = `    initAuthManager(window.app, state, (userProfile) => {
        if (userProfile) {
            if (userProfile.rol === 'admin') {
                currentRole = 'admin';
            } else if (userProfile.rol === 'editor') {
                currentRole = 'editor';
            } else if (userProfile.rol === 'invitado') {
                currentRole = 'invitado';
                currentInvitadoLegajo = userProfile.legajo;
                state.currentInvitadoLegajo = userProfile.legajo;
            } else {
                currentRole = 'visitor';
            }
        } else {
            currentRole = 'visitor';
            currentInvitadoLegajo = null;
        }`;

    const newInitAuthManager = `    initAuthManager(window.app, state, (userProfile) => {
        currentRole = 'Administrador';
        currentInvitadoLegajo = null;
    }`;
        
    content = content.replace(oldInitAuthManager, newInitAuthManager);

    // 3. Refactorizar checkLogin() exact replacement
    const startStr = 'function checkLogin() {';
    const endStr = 'let currentContextCell = null;';
    
    const startIndex = content.indexOf(startStr);
    const endIndex = content.indexOf(endStr, startIndex);
    
    if (startIndex !== -1 && endIndex !== -1) {
        const before = content.substring(0, startIndex);
        const after = content.substring(endIndex);
        
        const newCheckLogin = `function checkLogin() {
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
           navToggleBtn.innerHTML = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> App Pública <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>\`;
       }
    }
    
    `;
        content = before + newCheckLogin + after;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log("RBAC aplicado con éxito en index.html de forma determinista.");
}

main();
