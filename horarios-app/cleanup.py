import re
import sys

def main():
    file_path = 'c:/Users/tarta/Documents/Crew/horarios-app/index.html'
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace imports
    old_import = 'import { initPermissionsModule, checkAccess, syncPermissionsUI, renderGestionInvitados, loadPermisosInvitado, crearInvitado } from "./admin-permissions.js";'
    new_import = 'import { initAuthManager } from "./auth-manager.js";'
    if old_import in content:
        content = content.replace(old_import, new_import)
    else:
        print("Warning: old import not found (exact match)")
        # Try regex
        content = re.sub(r'import\s*\{[^}]*\}\s*from\s*["\']\./admin-permissions\.js["\'];', new_import, content)

    # 2. Inject simple checkAccess and syncPermissionsUI functions near window.checkAccess definition or just globally inside the module
    # We saw `window.checkAccess = checkAccess;` around 7973.
    # We will inject our new checkAccess and syncPermissionsUI near the Firebase initialization.
    init_auth_code = """
    // --- NUEVO SISTEMA DE AUTH (RBAC) ---
    window.checkAccess = function(permiso) {
        if (!state.currentUser) return false;
        return state.currentUser.rol === 'admin';
    };

    window.syncPermissionsUI = function() {
        // Se puede expandir para ocultar/mostrar elementos genéricamente
        // En este caso checkLogin ya hace gran parte del trabajo
    };

    initAuthManager(app, state, (userProfile) => {
        if (userProfile) {
            currentRole = userProfile.rol === 'admin' ? 'admin' : 'visitor';
        } else {
            currentRole = 'visitor';
        }
        checkLogin();
        if (typeof renderCalendario === 'function') {
            renderCalendario();
        }
    });
    // ------------------------------------
    """
    
    # Remove initPermissionsModule call block
    content = re.sub(r'initPermissionsModule\(\{[\s\S]*?\}\);', init_auth_code, content)

    # 3. Clean up localStorage/sessionStorage role logic
    lines = content.split('\n')
    new_lines = []
    
    # We will remove lines that set or get userLoggedIn, adminLogged, invitadoLegajo, etc.
    skip_keywords = ['userLoggedIn', 'adminLogged', 'invitadoLegajo', 'invitadoNombre', 'editorLegajo', 'editorNombre', 'sessionStorage.clear()']
    
    for line in lines:
        if any(keyword in line for keyword in skip_keywords):
            if 'localStorage.setItem' in line or 'localStorage.getItem' in line or 'sessionStorage' in line:
                continue # Skip line
        
        new_lines.append(line)
        
    content = '\n'.join(new_lines)

    # Check if window.checkAccessWithToast is defined, we'll redefine it safely if it exists
    content = re.sub(
        r'window\.checkAccessWithToast\s*=\s*function\(permiso\)\s*\{[\s\S]*?return false;\s*\}', 
        '''window.checkAccessWithToast = function(permiso) {
      if (!window.checkAccess(permiso)) {
         showToast('No tienes permiso para ' + permiso, 'error');
         return false;
      }
      return true;
    }''', 
        content
    )

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print("index.html refactorizado correctamente.")

if __name__ == '__main__':
    main()
